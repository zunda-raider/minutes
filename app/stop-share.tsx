'use client';

import { haltLiveCapture, useLiveCaptureOn } from '@/lib/live-capture';

/** One top-bar 停止 for mic, Zoom, and GD. Always shown. Disabled when idle. */
export function StopShareButton() {
  const on = useLiveCaptureOn();
  return (
    <button
      type="button"
      className="haltShare"
      aria-label="録音を停止"
      disabled={!on}
      onClick={() => haltLiveCapture()}
    >
      停止
    </button>
  );
}
