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
  trackAnalyser,
  trackAudioContext,
  trackAudioNode,
  trackInterval,
  trackRecorder,
} from '@/lib/capture-resources';
import {
  classifyCapturePeak,
  HEARD_PEAK,
  type CaptureLevel,
} from '@/lib/capture-level';

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
 * True when the stream still has a live, enabled, unmuted audio track (safe
 * to record again). A disabled track is not reusable: Chrome keeps it `live`
 * but the next MediaRecorder writes silence. A muted track is the same
 * silence and will not clear until the capturer is replaced.
 */
export function hasLiveAudio(
  stream: MediaStream | null | undefined
): stream is MediaStream {
  return !!stream?.getAudioTracks().some(
    (track) => track.readyState === 'live' && track.enabled && !track.muted
  );
}

/**
 * MediaRecorder bound to a stream that has already been stopped often writes
 * silence if it is handed that same stream object again. A fresh MediaStream
 * around the same MediaStreamTrack is not enough: after the first recorder
 * stops, Chrome (ScreenCaptureKit / the system-audio capturer) keeps the
 * track `live`, enabled, and unmuted, but stops delivering samples until a
 * consumer that is NOT a second MediaRecorder is attached.
 *
 * The hot tap is that consumer. It stays connected across 中断, 終了, and
 * segment rotation. Each recorder gets its own destination node so a stopped
 * recorder cannot pin the capturer. Do not clone the display tracks: stopping
 * a clone ends the original. Do not close the AudioContext on a soft stop.
 */
type CaptureMeta = {
  everHeard: boolean;
  stale: boolean;
  notified: boolean;
  sessions: number;
  segmentsThisSession: number;
  onDead: ((info: { peak: number; early: boolean }) => void) | null;
};

type CaptureTap = {
  ctx: AudioContext;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  buf: Float32Array;
  peak: number;
  timer: ReturnType<typeof setInterval>;
};

const captureMeta = new WeakMap<MediaStream, CaptureMeta>();
const captureTaps = new WeakMap<MediaStream, CaptureTap>();

function metaOf(stream: MediaStream): CaptureMeta {
  let meta = captureMeta.get(stream);
  if (!meta) {
    meta = {
      everHeard: false,
      stale: false,
      notified: false,
      sessions: 0,
      segmentsThisSession: 0,
      onDead: null,
    };
    captureMeta.set(stream, meta);
  }
  return meta;
}

export function describeAudio(stream: MediaStream | null | undefined): string {
  if (!stream) return 'no-stream';
  const tracks = stream.getAudioTracks();
  if (tracks.length === 0) return 'no-audio-track';
  return tracks
    .map(
      (track) =>
        `${track.readyState}:enabled=${track.enabled}:muted=${track.muted}:id=${track.id}`
    )
    .join(',');
}

export function isCaptureStale(stream: MediaStream | null | undefined): boolean {
  if (!stream) return false;
  return captureMeta.get(stream)?.stale === true;
}

export function captureSessionCount(stream: MediaStream | null | undefined): number {
  if (!stream) return 0;
  return captureMeta.get(stream)?.sessions ?? 0;
}

export function markCaptureStale(
  stream: MediaStream | null | undefined,
  why: string
) {
  if (!stream) return;
  const meta = metaOf(stream);
  meta.stale = true;
  console.warn('[capture] stale share', why, describeAudio(stream));
}

function flagDeadCapture(
  stream: MediaStream,
  why: string,
  peak: number,
  early: boolean
) {
  const meta = metaOf(stream);
  meta.stale = true;
  if (meta.notified) return;
  meta.notified = true;
  console.warn('[capture] silent reuse', {
    why,
    peak,
    early,
    tracks: describeAudio(stream),
  });
  meta.onDead?.({ peak, early });
}

function sampleTap(stream: MediaStream, tap: CaptureTap) {
  if (tap.ctx.state === 'closed') return;
  reviveHeldCapture(stream);
  let max = 0;
  try {
    tap.analyser.getFloatTimeDomainData(tap.buf);
    for (let i = 0; i < tap.buf.length; i += 1) {
      const value = Math.abs(tap.buf[i] ?? 0);
      if (value > max) max = value;
    }
  } catch {
    return;
  }
  if (max > tap.peak) tap.peak = max;
  const meta = metaOf(stream);
  if (tap.peak >= HEARD_PEAK) meta.everHeard = true;
  // Re-enable anything a previous halt left disabled. Do not treat a mute
  // edge as death here: Chrome mutes display audio until the first sample,
  // and a transient mute must not force 共有し直す. Stuck mute is digital
  // silence and the segment watcher flags it on a reused share.
}

function createTap(stream: MediaStream): CaptureTap | null {
  const existing = captureTaps.get(stream);
  if (existing) {
    if (existing.ctx.state !== 'closed') return existing;
    metaOf(stream).stale = true;
    closeCaptureTap(stream, true);
    console.warn('[capture] AudioContext closed on a held share', describeAudio(stream));
    return null;
  }
  if (typeof AudioContext === 'undefined') return null;
  reviveHeldCapture(stream);
  const tracks = stream
    .getAudioTracks()
    .filter((track) => track.readyState === 'live' && track.enabled);
  if (tracks.length === 0) return null;
  let ctx: AudioContext;
  try {
    ctx = trackAudioContext(new AudioContext());
  } catch (err) {
    console.warn('[capture] AudioContext failed:', err);
    return null;
  }
  let source: MediaStreamAudioSourceNode;
  try {
    source = ctx.createMediaStreamSource(new MediaStream(tracks));
  } catch (err) {
    console.warn('[capture] media stream source failed:', err);
    void ctx.close().catch(() => {});
    return null;
  }
  trackAudioNode(source);
  const keeper = trackAudioNode(ctx.createMediaStreamDestination());
  const analyser = trackAnalyser(ctx.createAnalyser());
  analyser.fftSize = 2048;
  try {
    source.connect(keeper);
    source.connect(analyser);
  } catch (err) {
    console.warn('[capture] tap connect failed:', err);
    void ctx.close().catch(() => {});
    return null;
  }
  const tap: CaptureTap = {
    ctx,
    source,
    analyser,
    buf: new Float32Array(analyser.fftSize),
    peak: 0,
    timer: setInterval(() => {
      sampleTap(stream, tap);
    }, 200),
  };
  trackInterval(tap.timer);
  captureTaps.set(stream, tap);
  void ctx.resume().catch((err) => {
    console.warn('[capture] AudioContext resume failed:', err);
  });
  console.info('[capture] hot tap', describeAudio(stream), ctx.state);
  return tap;
}

/**
 * Keep the capturer pulling. Call from the 開始 / 再開 gesture so resume()
 * still counts as user activation. Soft stop must not close this context.
 */
export async function primeCaptureTap(
  stream: MediaStream | null | undefined
): Promise<'ok' | 'suspended' | 'missing'> {
  if (!stream) return 'missing';
  const tap = createTap(stream);
  if (!tap) return 'missing';
  if (tap.ctx.state === 'suspended') {
    try {
      await tap.ctx.resume();
    } catch (err) {
      console.warn('[capture] AudioContext resume failed:', err);
    }
  }
  if (tap.ctx.state !== 'running') {
    console.warn('[capture] AudioContext not running', tap.ctx.state, describeAudio(stream));
    return 'suspended';
  }
  return 'ok';
}

export type RecordedSlice = {
  stream: MediaStream;
  release: () => void;
};

/**
 * A new destination for one MediaRecorder. The hot tap stays up after release.
 * Null when the graph is not running — caller may record the raw tracks once,
 * and must re-acquire instead of reusing a dead share.
 */
export function openRecordedSlice(source: MediaStream): RecordedSlice | null {
  const tap = captureTaps.get(source);
  if (!tap || tap.ctx.state === 'closed') return null;
  if (tap.ctx.state === 'suspended') {
    void tap.ctx.resume().catch(() => {});
  }
  if (tap.ctx.state !== 'running') return null;
  const dest = tap.ctx.createMediaStreamDestination();
  try {
    tap.source.connect(dest);
  } catch (err) {
    console.warn('[capture] slice connect failed:', err);
    return null;
  }
  let released = false;
  return {
    stream: dest.stream,
    release: () => {
      if (released) return;
      released = true;
      try {
        tap.source.disconnect(dest);
      } catch {
        /* already disconnected */
      }
    },
  };
}

function rawRecorderInput(source: MediaStream): MediaStream | null {
  reviveHeldCapture(source);
  const tracks = source
    .getAudioTracks()
    .filter((track) => track.readyState === 'live' && track.enabled);
  if (tracks.length === 0) return null;
  return new MediaStream(tracks);
}

function recorderInput(source: MediaStream): RecordedSlice | null {
  const slice = openRecordedSlice(source);
  if (slice) return slice;
  const raw = rawRecorderInput(source);
  if (!raw) return null;
  console.warn('[capture] recording raw tracks; hot tap unavailable', describeAudio(source));
  return { stream: raw, release: () => {} };
}

/** One user start / 再開 / next 開始. Segment rotation must not call this. */
export function beginCaptureSession(stream: MediaStream | null | undefined) {
  if (!stream) return;
  const meta = metaOf(stream);
  meta.sessions += 1;
  meta.segmentsThisSession = 0;
  console.info(
    '[capture] session',
    meta.sessions,
    meta.stale ? 'stale' : 'ok',
    describeAudio(stream)
  );
}

/**
 * Digital silence on a reused share (session >= 2). The first segment also
 * checks after 2.5s so 再開 does not wait out a full Whisper slice.
 * Slices shorter than 8s (a quick 中断) are not evidence.
 */
export function watchDeadSystemCapture(
  stream: MediaStream,
  onDead: (info: { peak: number; early: boolean }) => void
): () => void {
  const tap = captureTaps.get(stream);
  if (!tap || tap.ctx.state !== 'running') return () => {};
  const meta = metaOf(stream);
  meta.onDead = onDead;
  const segmentIndex = meta.segmentsThisSession;
  meta.segmentsThisSession += 1;
  const session = meta.sessions;
  tap.peak = 0;
  const started = performance.now();
  let cancel = false;
  const judge = (early: boolean): CaptureLevel => {
    if (cancel && early) return 'quiet';
    // Only the first slice of a start/再開 is checked early. Later slices
    // wait for the full segment so a short pause between turns is not death.
    if (early && segmentIndex !== 0) return 'quiet';
    const verdict = classifyCapturePeak(tap.peak, meta.everHeard);
    if (verdict === 'dead') {
      flagDeadCapture(
        stream,
        `${early ? 'early' : 'segment'}:session=${session}:index=${segmentIndex}`,
        tap.peak,
        early
      );
    }
    return verdict;
  };
  const earlyTimer = setTimeout(() => {
    judge(true);
  }, 2500);
  return () => {
    if (cancel) return;
    cancel = true;
    clearTimeout(earlyTimer);
    if (performance.now() - started < 8000) return;
    judge(false);
  };
}

function closeCaptureTap(stream: MediaStream, keepMeta: boolean) {
  const tap = captureTaps.get(stream);
  if (tap) {
    captureTaps.delete(stream);
    clearTrackedInterval(tap.timer);
    try {
      tap.source.disconnect();
    } catch {
      /* already disconnected */
    }
    try {
      tap.analyser.disconnect();
    } catch {
      /* already disconnected */
    }
    try {
      void tap.ctx.close();
    } catch {
      /* already closed */
    }
  }
  if (!keepMeta) captureMeta.delete(stream);
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
    // Drop the hot tap before stop(). A live AudioContext keeps the device
    // (and a dead-but-live track) pinned after 停止.
    closeCaptureTap(stream, false);
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
  /** Added to every chunk so a resumed GD continues the same timeline. */
  timeOffsetSec?: number;
  onChunk: (chunk: ZoomChunk) => void;
  onEnded?: (reason: 'stopped' | 'share-ended' | 'error') => void;
  /** Reused share produced digital silence, or the track looks live but dead. */
  onSilentCapture?: (info: { peak: number; early: boolean }) => void;
}): ZoomRecorder {
  const mimeType = pickRecorderMimeType();
  const segmentMs = opts.segmentMs ?? ZOOM_SEGMENT_MS;
  const timeOffsetSec = opts.timeOffsetSec ?? 0;
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

  let notedSession = false;
  let endWatch: (() => void) | null = null;
  const stopWatch = () => {
    const end = endWatch;
    endWatch = null;
    end?.();
  };

  const finish = () => {
    if (ended) return;
    ended = true;
    want = false;
    clearTimer();
    stopWatch();
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
    stopWatch();
    const systemInput = recorderInput(opts.system);
    const micInput = opts.mic ? recorderInput(opts.mic) : null;
    if (!systemInput) {
      reason = 'error';
      finish();
      return;
    }
    const offsetSec = timeOffsetSec + (performance.now() - origin) / 1000;
    const systemChunks: Blob[] = [];
    const micChunks: Blob[] = [];
    let systemBlob: Blob | null = null;
    let micBlob: Blob | null = null;
    let systemDone = false;
    let micDone = true;
    let settled = false;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(systemInput.stream, { mimeType });
    } catch (err) {
      console.warn('system recorder failed:', err);
      systemInput.release();
      micInput?.release();
      reason = 'error';
      finish();
      return;
    }
    systemRecorder = trackRecorder(recorder);

    let nextMic: MediaRecorder | null = null;
    if (micInput) {
      try {
        nextMic = trackRecorder(new MediaRecorder(micInput.stream, { mimeType }));
        nextMic.ondataavailable = (event) => {
          if (event.data.size > 0) micChunks.push(event.data);
        };
        micDone = false;
        micRecorder = nextMic;
      } catch (err) {
        console.warn('self mic recorder failed:', err);
        micInput?.release();
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
      systemInput.release();
      reason = 'error';
      want = false;
      rotate = false;
      finish();
    };
    recorder.onstop = () => {
      systemInput.release();
      stopWatch();
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
        micInput?.release();
        micBlob = micChunks.length > 0 ? new Blob(micChunks, { type: mimeType }) : null;
        micDone = true;
        finishSegment();
      };
      nextMic.onerror = () => {
        console.warn('self mic recorder error; continuing without auto 自分');
        micInput?.release();
        micBlob = null;
        micDone = true;
        finishSegment();
      };
    }

    try {
      recorder.start(1000);
    } catch (err) {
      console.warn('system recorder start failed:', err);
      systemInput.release();
      micInput?.release();
      reason = 'error';
      finish();
      return;
    }
    if (!notedSession) {
      notedSession = true;
      beginCaptureSession(opts.system);
    }
    endWatch = watchDeadSystemCapture(opts.system, (info) => {
      opts.onSilentCapture?.(info);
    });
    if (nextMic && nextMic.state === 'inactive') {
      try {
        nextMic.start(1000);
      } catch (err) {
        console.warn('self mic start failed:', err);
        silenceRecorder(nextMic);
        micInput?.release();
        nextMic = null;
        if (micRecorder && micRecorder.state === 'inactive') micRecorder = null;
        micDone = true;
      }
    } else if (!nextMic) {
      micInput?.release();
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
