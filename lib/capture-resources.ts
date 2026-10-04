/**
 * Resources that keep the tab hot after 停止 or a share-end.
 * Hard halt (`haltLiveCapture`) bumps the generation, runs hooks, then
 * `finishHardHalt` so nothing here can outlive the click.
 * Soft stop must clear its own rotate interval; it must not call finish.
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

/** Audio tracks first so a display-video stop is not ignored while audio is live. */
export function stopStreamTracks(stream: MediaStream) {
  const tracks = stream.getTracks();
  const ordered = [
    ...tracks.filter((track) => track.kind === 'audio'),
    ...tracks.filter((track) => track.kind !== 'audio' && track.kind !== 'video'),
    ...tracks.filter((track) => track.kind === 'video'),
  ];
  for (const track of ordered) {
    try {
      track.enabled = false;
    } catch {
      /* already dead */
    }
    try {
      track.stop();
    } catch {
      /* already ended */
    }
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

/** Drop handlers and force the recorder inactive so it cannot keep a device. */
export function silenceRecorder(recorder: MediaRecorder | null | undefined) {
  if (!recorder) return;
  recorders.delete(recorder);
  recorder.ondataavailable = null;
  recorder.onerror = null;
  recorder.onstop = null;
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
