export type LiveSpeaker = '自分' | '他者';

export type DemoLine = {
  atSec: number;
  speaker: LiveSpeaker;
  text: string;
};

/** Default session length. The live screen can change it from 1 to 180 minutes. */
export const GD_LIVE_DURATION_MS = 12 * 60 * 1000;

/** Vertical scale. One minute is this many pixels, so silence stays blank. */
export const GD_PX_PER_SEC = 11;

/** Self-lane blanks shorter than this stay uncolored. */
export const GD_SILENCE_MS = 48_000;

/** Card cap. Taller text clips and shows the edge warning. */
export const GD_MAX_CARD_PX = 210;
