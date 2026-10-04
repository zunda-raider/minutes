'use client';

import { useSyncExternalStore } from 'react';
import { beginHardHalt, finishHardHalt } from '@/lib/capture-resources';
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
 * `stop` is the hard halt for that mode (recorder, then its tracks).
 * Ordinary end keeps the MediaStream and leaves this registration in place.
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

/**
 * Hard stop. Cancels rotate timers, the GD clock, and pending transcribe
 * work before UI stops run, then kills recorders, audio graphs, display
 * video, system audio, and the self mic — including streams a ref dropped.
 */
export function haltLiveCapture() {
  const snapshot = [...entries];
  entries.clear();
  emit();
  beginHardHalt();
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
  finishHardHalt();
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
