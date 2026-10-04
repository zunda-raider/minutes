/**
 * Zoom / system-audio capture shared by Home and GD live.
 * Display media (video required by the browser) plus system audio, then a
 * parallel mic used only to tell 自分 from everyone else.
 */

import {
  clearTrackedInterval,
  ensureRecorderStops,
  forgetStream,
  rememberStream,
  silenceRecorder,
  stopStreamTracks,
  trackInterval,
  trackRecorder,
} from '@/lib/capture-resources';

export const ZOOM_SEGMENT_MS = 60_000;

export const SYSTEM_AUDIO_HELP =
  '画面共有ダイアログで「システム音声を共有」をオンにしてください。Zoom・LINE・その他アプリの通話ウィンドウ / タブ / 画面を共有できます。macOS で音声が取れない場合は BlackHole などの仮想オーディオでアプリ出力をマイクへルーティングし、「マイク」モードで録音してください。';

type DisplayMediaOptionsWithSystemAudio = DisplayMediaStreamOptions & {
  systemAudio?: 'include' | 'exclude';
  windowAudio?: 'system' | 'window' | 'exclude';
};

export class NoSystemAudioError extends Error {
  constructor() {
    super('NO_SYSTEM_AUDIO');
    this.name = 'NoSystemAudioError';
  }
}

export function pickRecorderMimeType(): string {
  return MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
}

/** Parallel mic for 自分 energy. Null when permission or the device fails. */
export async function openSelfMic(): Promise<MediaStream | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    rememberStream(stream);
    return stream;
  } catch (err) {
    console.warn('self mic unavailable:', err);
    return null;
  }
}

/**
 * Screen/window/tab share with system audio. Video tracks are stopped so
 * Whisper only sees audio.
 */
/** Audio-only stream -> original display capture, so 停止 can end video too. */
const displayRoots = new WeakMap<MediaStream, MediaStream>();

/**
 * True when the stream still has a live, enabled audio track (safe to record
 * again). A disabled track is not reusable: Chrome keeps it `live` but the
 * next MediaRecorder writes silence.
 */
export function hasLiveAudio(
  stream: MediaStream | null | undefined
): stream is MediaStream {
  return !!stream?.getAudioTracks().some(
    (track) => track.readyState === 'live' && track.enabled
  );
}

/**
 * A held share must be recorded with every live track enabled. Hard-halt and
 * the old acquire path disabled display video (and sometimes audio) without
 * the track ending; ScreenCaptureKit then delivers silence until enabled is
 * restored or the capturer is actually stopped.
 */
export function reviveHeldCapture(stream: MediaStream | null | undefined) {
  if (!stream) return;
  const root = displayRoots.get(stream);
  const bundles = root && root !== stream ? [stream, root] : [stream];
  for (const item of bundles) {
    for (const track of item.getTracks()) {
      if (track.readyState !== 'live' || track.enabled) continue;
      try {
        track.enabled = true;
      } catch {
        /* ended between the check and the write */
      }
    }
  }
}

/** Stop every track on these streams, including the display capture they came from. */
export function stopMediaTracks(...streams: Array<MediaStream | null | undefined>) {
  const pending: MediaStream[] = [];
  const seen = new Set<MediaStream>();
  for (const stream of streams) {
    if (!stream || seen.has(stream)) continue;
    seen.add(stream);
    pending.push(stream);
    const root = displayRoots.get(stream);
    if (root && !seen.has(root)) {
      seen.add(root);
      pending.push(root);
    }
  }
  for (const stream of pending) {
    forgetStream(stream);
    // Audio before video. Chrome ignores videoTrack.stop() while system audio
    // is live, so a video stop during acquire does not actually end the capturer.
    stopStreamTracks(stream);
  }
}

export async function acquireSystemAudio(): Promise<MediaStream> {
  const options: DisplayMediaOptionsWithSystemAudio = {
    video: true,
    audio: true,
    systemAudio: 'include',
    windowAudio: 'system',
  };
  const displayStream = await navigator.mediaDevices.getDisplayMedia(options);
  rememberStream(displayStream);
  const audioTracks = displayStream.getAudioTracks();
  // Prefer to end video immediately so frames are not composited for the whole
  // meeting. Chrome often ignores that stop() while the audio track is still
  // live; the track stays in this stream so a later halt can stop audio first,
  // then video. Do not mute it or constrain frameRate while it is still live:
  // that silences system audio for the rest of the share.
  for (const track of displayStream.getVideoTracks()) {
    try {
      track.stop();
    } catch {
      /* already ended */
    }
    // If Chrome ignored stop() because system audio is still live, leave the
    // video track enabled. enabled=false or frameRate:0 stops the capturer
    // from producing audio samples while the audio track stays "live", so
    // every later recorder (including a soft-stop reuse) is silent.
  }

  if (audioTracks.length === 0) {
    stopMediaTracks(displayStream);
    throw new NoSystemAudioError();
  }

  const audioOnly = new MediaStream(audioTracks);
  displayRoots.set(audioOnly, displayStream);
  rememberStream(audioOnly);
  return audioOnly;
}

export type ZoomChunk = {
  /** Seconds since this recorder started. Whisper times are added to this. */
  offsetSec: number;
  systemBlob: Blob;
  micBlob: Blob | null;
};

export type ZoomRecorder = {
  stop: () => void;
};

/**
 * Record system audio and the parallel mic in lockstep, rotating every
 * segment. The last partial segment is delivered on stop.
 */
export function startZoomSegmentRecorder(opts: {
  system: MediaStream;
  mic: MediaStream | null;
  segmentMs?: number;
  onChunk: (chunk: ZoomChunk) => void;
  onEnded?: (reason: 'stopped' | 'share-ended' | 'error') => void;
}): ZoomRecorder {
  const mimeType = pickRecorderMimeType();
  const segmentMs = opts.segmentMs ?? ZOOM_SEGMENT_MS;
  const origin = performance.now();
  let want = true;
  let rotate = false;
  let ended = false;
  let reason: 'stopped' | 'share-ended' | 'error' = 'stopped';
  let timer: ReturnType<typeof setInterval> | null = null;
  let systemRecorder: MediaRecorder | null = null;
  let micRecorder: MediaRecorder | null = null;

  const stopTracks = () => {
    stopMediaTracks(opts.system, opts.mic);
  };

  const clearTimer = () => {
    clearTrackedInterval(timer);
    timer = null;
  };

  const finish = () => {
    if (ended) return;
    ended = true;
    want = false;
    clearTimer();
    const mic = micRecorder;
    micRecorder = null;
    // If the system recorder never reached onstop, the self-mic recorder would
    // keep the microphone open. Soft stop still flushes a live mic via requestStop.
    if (mic && mic.state !== 'inactive') {
      try {
        mic.stop();
      } catch {
        /* already stopping */
      }
    }
    // Soft stop keeps display + system audio and the self mic.
    // Share-ended and errors drop the tracks. Top-bar 停止 stops them itself.
    if (reason !== 'stopped') stopTracks();
    opts.onEnded?.(reason);
  };

  const arm = () => {
    if (!want || ended) return;
    reviveHeldCapture(opts.system);
    reviveHeldCapture(opts.mic);
    const offsetSec = (performance.now() - origin) / 1000;
    const systemChunks: Blob[] = [];
    const micChunks: Blob[] = [];
    let systemBlob: Blob | null = null;
    let micBlob: Blob | null = null;
    let systemDone = false;
    let micDone = true;
    let settled = false;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(opts.system, { mimeType });
    } catch (err) {
      console.warn('system recorder failed:', err);
      reason = 'error';
      finish();
      return;
    }
    systemRecorder = trackRecorder(recorder);

    const micLive =
      opts.mic != null &&
      opts.mic.getAudioTracks().some((track) => track.readyState === 'live');
    let nextMic: MediaRecorder | null = null;
    if (micLive && opts.mic) {
      try {
        nextMic = trackRecorder(new MediaRecorder(opts.mic, { mimeType }));
        nextMic.ondataavailable = (event) => {
          if (event.data.size > 0) micChunks.push(event.data);
        };
        micDone = false;
        micRecorder = nextMic;
      } catch (err) {
        console.warn('self mic recorder failed:', err);
        nextMic = null;
        micRecorder = null;
        micDone = true;
      }
    } else {
      micRecorder = null;
    }

    const finishSegment = () => {
      if (!systemDone || !micDone || settled) return;
      settled = true;
      if (systemRecorder === recorder) systemRecorder = null;
      if (micRecorder === nextMic) micRecorder = null;
      if (systemBlob && systemBlob.size > 0) {
        opts.onChunk({ offsetSec, systemBlob, micBlob });
      }
      if (want && rotate && !ended) {
        rotate = false;
        arm();
        return;
      }
      if (!want) finish();
    };

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) systemChunks.push(event.data);
    };
    recorder.onerror = () => {
      reason = 'error';
      want = false;
      rotate = false;
      finish();
    };
    recorder.onstop = () => {
      systemBlob = new Blob(systemChunks, { type: mimeType });
      systemDone = true;
      if (nextMic && nextMic.state === 'recording') {
        try {
          nextMic.stop();
        } catch {
          micDone = true;
        }
      } else if (!micDone) {
        micDone = true;
      }
      finishSegment();
    };

    if (nextMic) {
      nextMic.onstop = () => {
        micBlob = micChunks.length > 0 ? new Blob(micChunks, { type: mimeType }) : null;
        micDone = true;
        finishSegment();
      };
      nextMic.onerror = () => {
        console.warn('self mic recorder error; continuing without auto 自分');
        micBlob = null;
        micDone = true;
        finishSegment();
      };
    }

    try {
      recorder.start(1000);
    } catch (err) {
      console.warn('system recorder start failed:', err);
      reason = 'error';
      finish();
      return;
    }
    if (nextMic && nextMic.state === 'inactive') {
      try {
        nextMic.start(1000);
      } catch (err) {
        console.warn('self mic start failed:', err);
        silenceRecorder(nextMic);
        nextMic = null;
        if (micRecorder && micRecorder.state === 'inactive') micRecorder = null;
        micDone = true;
      }
    }
  };

  const requestStop = (why: 'stopped' | 'share-ended' | 'error') => {
    // Always drop the rotate interval, even when finish() already set ended
    // before the timer id was stored.
    clearTimer();
    if (ended) return;
    reason = why;
    want = false;
    rotate = false;
    const sys = systemRecorder;
    const mic = micRecorder;
    const sysLive = !!sys && sys.state !== 'inactive';
    const micLive = !!mic && mic.state !== 'inactive';
    if (!sysLive && !micLive) {
      finish();
      return;
    }
    let stopping = false;
    if (sysLive && sys) {
      try {
        sys.stop();
        stopping = true;
      } catch {
        /* stop already queued onstop, or the recorder never started */
      }
    }
    // System onstop stops the mic recorder after the system blob is sealed.
    // Stopping both here races that and drops the self-mic blob. Only stop the
    // mic directly when the system recorder will not reach onstop.
    if (!stopping && micLive && mic) {
      try {
        mic.stop();
        stopping = true;
      } catch {
        /* already stopping */
      }
    }
    // If nothing accepted stop(), no onstop is coming — end now so the timer stays dead.
    if (!stopping) finish();
    // Soft stop keeps the tracks, so a recorder that never reaches onstop would
    // keep encoding. Hard halt also silenceRecorder()s these immediately.
    ensureRecorderStops(sys);
    ensureRecorderStops(mic);
  };

  opts.system.getAudioTracks().forEach((track) => {
    track.onended = () => {
      if (!want || ended) return;
      requestStop('share-ended');
    };
  });

  arm();
  if (ended) {
    clearTimer();
  } else {
    timer = trackInterval(
      setInterval(() => {
        if (!want || ended) {
          clearTimer();
          return;
        }
        const rec = systemRecorder;
        if (!rec || rec.state !== 'recording') return;
        rotate = true;
        try {
          rec.stop();
        } catch {
          rotate = false;
        }
      }, segmentMs)
    );
  }

  return {
    stop: () => requestStop('stopped'),
  };
}
