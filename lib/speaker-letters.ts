/** Speaker slots A–G (internal ids 1–7). */

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
  { id: 'other', label: 'その他', speakerId: 3 },
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
 * A 自分, B セミナー, C その他. D–G are bare letters (no role in parentheses).
 */
export function zoomLetterButtonLabel(speakerId: number): string {
  const letter = letterForSpeakerId(speakerId);
  if (speakerId === 1) return `発言者${letter}（自分）`;
  if (speakerId === 2) return `発言者${letter}（セミナー）`;
  if (speakerId === 3) return `発言者${letter}（その他）`;
  return `発言者${letter}`;
}

/**
 * Quiet card-meta label. null means omit the word (unset / unknown speaker).
 * Zoom A and mic メイン (id 1) → 自分. Zoom B → セミナー.
 * Zoom C–G stay as the letter so multiple others stay distinguishable.
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
  if (speakerId > MAX_SPEAKERS) return null;
  return letterForSpeakerId(speakerId);
}
