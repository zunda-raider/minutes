/**
 * Zoom / system-audio capture shared by Home and GD live.
 * Display media (video required by the browser) plus system audio, then a
 * parallel mic used only to tell 自分 from everyone else.
 */

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
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (err) {
    console.warn('self mic unavailable:', err);
    return null;
  }
}

/**
 * Screen/window/tab share with system audio. Video tracks are stopped so
 * Whisper only sees audio.
 */
export async function acquireSystemAudio(): Promise<MediaStream> {
  const options: DisplayMediaOptionsWithSystemAudio = {
    video: true,
    audio: true,
    systemAudio: 'include',
    windowAudio: 'system',
  };
  const displayStream = await navigator.mediaDevices.getDisplayMedia(options);
  const audioTracks = displayStream.getAudioTracks();
  displayStream.getVideoTracks().forEach((track) => track.stop());

  if (audioTracks.length === 0) {
    displayStream.getTracks().forEach((track) => track.stop());
    throw new NoSystemAudioError();
  }

  return new MediaStream(audioTracks);
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

  const stopTracks = () => {
    opts.system.getTracks().forEach((track) => track.stop());
    opts.mic?.getTracks().forEach((track) => track.stop());
  };

  const finish = () => {
    if (ended) return;
    ended = true;
    want = false;
    if (timer) clearInterval(timer);
    timer = null;
    stopTracks();
    opts.onEnded?.(reason);
  };

  const arm = () => {
    if (!want || ended) return;
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
    systemRecorder = recorder;

    const micLive =
      opts.mic != null &&
      opts.mic.getAudioTracks().some((track) => track.readyState === 'live');
    let nextMic: MediaRecorder | null = null;
    if (micLive && opts.mic) {
      try {
        nextMic = new MediaRecorder(opts.mic, { mimeType });
        nextMic.ondataavailable = (event) => {
          if (event.data.size > 0) micChunks.push(event.data);
        };
        micDone = false;
      } catch (err) {
        console.warn('self mic recorder failed:', err);
        nextMic = null;
        micDone = true;
      }
    }

    const finishSegment = () => {
      if (!systemDone || !micDone || settled) return;
      settled = true;
      if (systemRecorder === recorder) systemRecorder = null;
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
        nextMic = null;
        micDone = true;
      }
    }
  };

  const requestStop = (why: 'stopped' | 'share-ended' | 'error') => {
    if (ended) return;
    reason = why;
    want = false;
    rotate = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    const rec = systemRecorder;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        finish();
      }
      return;
    }
    finish();
  };

  opts.system.getAudioTracks().forEach((track) => {
    track.onended = () => {
      if (!want || ended) return;
      requestStop('share-ended');
    };
  });

  arm();
  timer = setInterval(() => {
    if (!want || ended) return;
    const rec = systemRecorder;
    if (!rec || rec.state !== 'recording') return;
    rotate = true;
    try {
      rec.stop();
    } catch {
      rotate = false;
    }
  }, segmentMs);

  return {
    stop: () => requestStop('stopped'),
  };
}
