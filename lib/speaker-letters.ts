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
