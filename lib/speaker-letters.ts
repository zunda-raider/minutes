/** Speaker slots A–G (internal ids 1–7). */

/** Speaker A — 自分 (explicit pick only in Zoom seminar). */
export const SELF_SPEAKER_ID = 1;
/** Speaker B — セミナー (Zoom / seminar default for unmarked speech). */
export const SEMINAR_SPEAKER_ID = 2;
/** Speaker C — それ以外. */
export const OTHER_SPEAKER_ID = 3;

export const SPEAKER_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;
export type SpeakerLetter = (typeof SPEAKER_LETTERS)[number];
export const MAX_SPEAKERS = SPEAKER_LETTERS.length;

export function letterForSpeakerId(speakerId: number | undefined | null): string {
  if (speakerId == null || speakerId < 1) return '?';
  return SPEAKER_LETTERS[speakerId - 1] ?? `?${speakerId}`;
}

export function nextSpeakerId(current: number | undefined | null): number {
  if (current == null || current < 1) return 1;
  if (current >= MAX_SPEAKERS) return 1;
  return current + 1;
}

export function defaultSpeakerLabel(speakerId: number): string {
  return letterForSpeakerId(speakerId);
}

export type RecordingSource = 'mic' | 'system';

/** Zoom manual picker: big category buttons, in display order. */
export const ZOOM_CATEGORIES = [
  { id: 'seminar', label: 'セミナー', speakerId: 2 },
  { id: 'self', label: '自分', speakerId: 1 },
  { id: 'other', label: 'それ以外', speakerId: 3 },
] as const;

/**
 * Post-hoc buckets. 自分 → A, セミナー → B, それ以外 → C.
 * Display order for the selection toolbar (not the optional live picker).
 */
export const ASSIGN_BUCKETS = [
  { id: 'self', label: '自分', speakerId: 1 },
  { id: 'seminar', label: 'セミナー', speakerId: 2 },
  { id: 'other', label: 'それ以外', speakerId: 3 },
] as const;

export type ZoomCategoryId = (typeof ZOOM_CATEGORIES)[number]['id'];

/** Which big button stays highlighted for the active Zoom speaker. */
export function zoomCategoryForSpeaker(
  speakerId: number | undefined | null
): ZoomCategoryId | null {
  if (speakerId === 1) return 'self';
  if (speakerId === 2) return 'seminar';
  if (speakerId != null && speakerId >= 3 && speakerId <= MAX_SPEAKERS) {
    return 'other';
  }
  return null;
}

/**
 * Letter-button caption.
 * A 自分, B セミナー, C それ以外. D–G are bare letters (no role in parentheses).
 */
export function zoomLetterButtonLabel(speakerId: number): string {
  const letter = letterForSpeakerId(speakerId);
  if (speakerId === 1) return `発言者${letter}（自分）`;
  if (speakerId === 2) return `発言者${letter}（セミナー）`;
  if (speakerId === 3) return `発言者${letter}（それ以外）`;
  return `発言者${letter}`;
}

/**
 * Quiet card-meta label. null means omit the word (unset / unknown speaker).
 * Zoom A and mic メイン (id 1) → 自分. Zoom B → セミナー.
 * Zoom C (それ以外 bucket) → それ以外. D–G stay as the letter.
 * Mic 質問者 only when the segment was recorded in mic mode.
 */
export function quietSpeakerTag(
  speakerId: number | undefined | null,
  source?: RecordingSource | null
): string | null {
  if (speakerId == null || !Number.isFinite(speakerId) || speakerId < 1) {
    return null;
  }
  if (source === 'mic') {
    if (speakerId === 1) return '自分';
    if (speakerId === 2) return '質問者';
    return null;
  }
  if (speakerId === 1) return '自分';
  if (speakerId === 2) return 'セミナー';
  if (speakerId === 3) return 'それ以外';
  if (speakerId > MAX_SPEAKERS) return null;
  return letterForSpeakerId(speakerId);
}

export type CardSpeakerTone = 'self' | 'seminar' | 'other' | 'letter' | 'questioner';

/**
 * Card color + chip text for at-a-glance who.
 * 自分 / セミナー / それ以外 / 質問者, and D–G as 発言者X. null = unset.
 */
export function cardSpeakerBadge(
  speakerId: number | undefined | null,
  source?: RecordingSource | null
): { tone: CardSpeakerTone; label: string } | null {
  const tag = quietSpeakerTag(speakerId, source);
  if (!tag || speakerId == null) return null;
  if (source === 'mic') {
    return speakerId === 1
      ? { tone: 'self', label: '自分' }
      : { tone: 'questioner', label: '質問者' };
  }
  if (speakerId === 1) return { tone: 'self', label: '自分' };
  if (speakerId === 2) return { tone: 'seminar', label: 'セミナー' };
  if (speakerId === 3) return { tone: 'other', label: 'それ以外' };
  return { tone: 'letter', label: `発言者${tag}` };
}
