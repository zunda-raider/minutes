'use client';

import { haltLiveCapture, useLiveCaptureOn } from '@/lib/live-capture';

/** One top-bar 停止 for mic, Zoom, and GD. Kills the share. Disabled when nothing is held. */
export function StopShareButton() {
  const on = useLiveCaptureOn();
  return (
    <button
      type="button"
      className="haltShare"
      aria-label="共有を停止"
      disabled={!on}
      onClick={() => haltLiveCapture()}
    >
      停止
    </button>
  );
}
