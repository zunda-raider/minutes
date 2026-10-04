/**
 * Resources that keep the tab hot after 停止 or a share-end.
 * Hard halt (`haltLiveCapture`) bumps the generation, runs hooks, then
 * `finishHardHalt` so nothing here can outlive the click.
 * Soft stop (Home Record/Stop, GD 終了) must clear its own rotate interval
 * and must not call finish — the share stays up on purpose.
 */

const intervals = new Set<ReturnType<typeof setInterval>>();
const recorders = new Set<MediaRecorder>();
const contexts = new Set<AudioContext>();
const analysers = new Set<AnalyserNode>();
const audioNodes = new Set<AudioNode>();
const aborts = new Set<AbortController>();
const clocks = new Set<() => void>();
const hooks = new Set<() => void>();
const streams = new Set<MediaStream>();

let generation = 0;

export function captureGeneration(): number {
  return generation;
}

export function rememberStream(stream: MediaStream | null | undefined) {
  if (stream) streams.add(stream);
}

export function forgetStream(stream: MediaStream | null | undefined) {
  if (stream) streams.delete(stream);
}

function endTrack(track: MediaStreamTrack) {
  // Do not clear `enabled` first. Chrome ignores stop() on a disabled
  // display or mic track and leaves it live, so the next recorder (or the
  // next getDisplayMedia / getUserMedia) captures silence while hasLiveAudio
  // still looks true.
  try {
    if (!track.enabled) track.enabled = true;
  } catch {
    /* already dead */
  }
  try {
    track.stop();
  } catch {
    /* already ended */
  }
}

/**
 * Audio tracks first. Chrome ignores videoTrack.stop() while system audio is
 * still live, and macOS may not notice the audio stop until the next turn,
 * so a still-live display track is stopped again on a microtask and a short timer.
 * Video is not stopped until audio has ended; muting either track is not a
 * substitute for stop() (a muted live track records silence on reuse).
 */
export function stopStreamTracks(stream: MediaStream) {
  const tracks = stream.getTracks();
  const audio = tracks.filter((track) => track.kind === 'audio');
  const video = tracks.filter((track) => track.kind === 'video');
  const other = tracks.filter(
    (track) => track.kind !== 'audio' && track.kind !== 'video'
  );
  const audioLive = () => audio.some((track) => track.readyState === 'live');
  const endVideo = () => {
    if (audioLive()) return;
    for (const track of video) endTrack(track);
  };
  const endAudio = () => {
    for (const track of audio) {
      if (track.readyState === 'live') endTrack(track);
    }
    for (const track of other) {
      if (track.readyState === 'live') endTrack(track);
    }
    endVideo();
  };
  for (const track of audio) {
    if (video.length > 0 && track.readyState === 'live') {
      track.addEventListener('ended', endVideo, { once: true });
    }
  }
  endAudio();
  if (audioLive() || video.some((track) => track.readyState !== 'ended')) {
    queueMicrotask(endAudio);
    setTimeout(endAudio, 50);
  }
}

export function trackInterval(id: ReturnType<typeof setInterval>) {
  intervals.add(id);
  return id;
}

export function clearTrackedInterval(id: ReturnType<typeof setInterval> | null | undefined) {
  if (id == null) return;
  clearInterval(id);
  intervals.delete(id);
}

export function trackRecorder(recorder: MediaRecorder) {
  recorders.add(recorder);
  const drop = () => {
    recorders.delete(recorder);
  };
  recorder.addEventListener('stop', drop, { once: true });
  recorder.addEventListener('error', drop, { once: true });
  return recorder;
}

/**
 * MediaRecorder.stop() usually fires onstop and releases the encoder.
 * If it doesn't, a soft stop would leave the self-mic recorder (and its
 * device) running. One follow-up stop, not an interval.
 */
export function ensureRecorderStops(
  recorder: MediaRecorder | null | undefined,
  afterMs = 2000
) {
  if (!recorder || recorder.state === 'inactive') return;
  setTimeout(() => {
    if (recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* already stopping */
      }
    }
  }, afterMs);
}

/**
 * Force the recorder inactive so it cannot keep a device.
 * Handlers stay: clearing ondataavailable/onstop before the queued events
 * run makes Chrome drop the final blob and sometimes never leave `recording`,
 * which holds the mic or system-audio capturer for the next start.
 */
export function silenceRecorder(recorder: MediaRecorder | null | undefined) {
  if (!recorder) return;
  recorders.delete(recorder);
  if (recorder.state !== 'inactive') {
    try {
      recorder.stop();
    } catch {
      /* already stopping */
    }
  }
}

export function trackAudioContext(ctx: AudioContext) {
  contexts.add(ctx);
  ctx.addEventListener('statechange', () => {
    if (ctx.state === 'closed') contexts.delete(ctx);
  });
  return ctx;
}

export function trackAnalyser(node: AnalyserNode) {
  analysers.add(node);
  return node;
}

export function trackAudioNode(node: AudioNode) {
  audioNodes.add(node);
  return node;
}

export function trackAbort(controller: AbortController) {
  aborts.add(controller);
  controller.signal.addEventListener(
    'abort',
    () => {
      aborts.delete(controller);
    },
    { once: true }
  );
  return controller;
}

/** GD clock (and any other rAF loop). `cancel` must be idempotent. */
export function trackClock(cancel: () => void): () => void {
  clocks.add(cancel);
  return () => {
    clocks.delete(cancel);
  };
}

/** Page / GD register queue cancellation here. Soft stop does not run these. */
export function registerHaltHook(fn: () => void): () => void {
  hooks.add(fn);
  return () => {
    hooks.delete(fn);
  };
}

/** Queues, clocks, rotate timers, in-flight fetches. Streams stay until finish. */
export function beginHardHalt() {
  generation += 1;
  for (const hook of [...hooks]) {
    try {
      hook();
    } catch (err) {
      console.warn('halt hook failed:', err);
    }
  }
  for (const cancel of [...clocks]) {
    try {
      cancel();
    } catch {
      /* already cancelled */
    }
  }
  clocks.clear();
  for (const id of [...intervals]) clearTrackedInterval(id);
  for (const controller of [...aborts]) {
    try {
      controller.abort();
    } catch {
      /* already aborted */
    }
  }
  aborts.clear();
}

/** Recorders, audio graphs, and any stream a UI ref already dropped. */
export function finishHardHalt() {
  for (const recorder of [...recorders]) silenceRecorder(recorder);
  for (const node of analysers) {
    try {
      node.disconnect();
    } catch {
      /* already disconnected */
    }
  }
  analysers.clear();
  for (const node of audioNodes) {
    try {
      node.disconnect();
    } catch {
      /* already disconnected */
    }
  }
  audioNodes.clear();
  for (const ctx of [...contexts]) {
    contexts.delete(ctx);
    try {
      void ctx.close();
    } catch {
      /* already closed */
    }
  }
  const pending = [...streams];
  streams.clear();
  for (const stream of pending) stopStreamTracks(stream);
}
