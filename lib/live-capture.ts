'use client';

import { useSyncExternalStore } from 'react';
import { stopMediaTracks } from '@/lib/zoom-capture';

type Entry = {
  stop: () => void;
  streams: MediaStream[];
};

const entries = new Set<Entry>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/**
 * Mic Home, Zoom Home, and GD live share one 停止.
 * `stop` ends that mode's MediaRecorder; every display, system-audio, and mic track is stopped too.
 */
export function watchLiveCapture(stop: () => void, streams: MediaStream[]): () => void {
  const entry: Entry = { stop, streams };
  entries.add(entry);
  emit();
  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    if (entries.delete(entry)) emit();
  };
}

/** End every mic, Zoom, and GD recorder, then stop all of their tracks. */
export function haltLiveCapture() {
  const snapshot = [...entries];
  entries.clear();
  emit();
  for (const entry of snapshot) {
    try {
      entry.stop();
    } catch (err) {
      console.warn('live capture stop failed:', err);
    }
  }
  for (const entry of snapshot) {
    stopMediaTracks(...entry.streams);
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLiveCaptureOn() {
  return useSyncExternalStore(
    subscribe,
    () => entries.size > 0,
    () => false
  );
}
