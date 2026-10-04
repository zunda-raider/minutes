'use client';

import { haltLiveCapture, useLiveCaptureOn } from '@/lib/live-capture';

/** Top-bar 停止. Always this label. Disabled when nothing is capturing. */
export function StopShareButton() {
  const on = useLiveCaptureOn();
  return (
    <button
      type="button"
      className="haltShare"
      aria-label="録音と画面共有を停止"
      disabled={!on}
      onClick={() => haltLiveCapture()}
    >
      停止
    </button>
  );
}
