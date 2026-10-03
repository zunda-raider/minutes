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

/**
 * Quiet card-meta label. null means omit the word (unset / unknown speaker).
 * Zoom A and mic メイン (id 1) are both treated as self → 自分.
 * Mic 質問者 only when the segment was recorded in mic mode.
 * Zoom B–G are the letter only.
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
  if (speakerId > MAX_SPEAKERS) return null;
  return letterForSpeakerId(speakerId);
}
