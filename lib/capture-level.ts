/**
 * Levels for "is this capturer actually producing samples?"
 * Speech / room-noise RMS is a different question (see QUIET_RMS in self-energy).
 * A dead getDisplayMedia or mic track stays `live` + enabled + unmuted and
 * still yields exact (or denormal) zeros to the next MediaRecorder.
 */

/** Peak |sample| at or above this means the capturer has delivered real audio. */
export const HEARD_PEAK = 0.002;

/**
 * Peak below this, after we have already heard audio on the same share,
 * is digital silence — not a quiet room. Live loopback noise sits above it.
 */
export const DEAD_TRACK_PEAK = 1e-4;

export type CaptureLevel = 'heard' | 'dead' | 'quiet';

export function classifyCapturePeak(peak: number, everHeard: boolean): CaptureLevel {
  if (!Number.isFinite(peak) || peak < 0) return 'quiet';
  if (peak >= HEARD_PEAK) return 'heard';
  if (everHeard && peak < DEAD_TRACK_PEAK) return 'dead';
  return 'quiet';
}
