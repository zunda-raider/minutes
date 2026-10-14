/**
 * 「削除」: remove exactly the selected character span from a card's text.
 * Doubled whitespace left at the seam is collapsed and the result trimmed.
 */
import type { TextSpan } from './split-speaker';

export function removeSpanFromText(text: string, span: TextSpan): string {
  const start = Math.max(0, Math.min(text.length, Math.floor(span.start)));
  const end = Math.max(start, Math.min(text.length, Math.floor(span.end)));
  if (end <= start) return text;
  const before = text.slice(0, start);
  const after = text.slice(end);
  const joined =
    /\s$/.test(before) && /^\s/.test(after)
      ? before.replace(/\s+$/, ' ') + after.replace(/^\s+/, '')
      : before + after;
  return joined.replace(/ {2,}/g, ' ').replace(/ +([、。,.!?！？])/g, '$1').trim();
}

/**
 * Apply the deletion to one card in a list. Returns `{ list, emptied }`;
 * when the remaining text is empty the list is returned unchanged and
 * `emptied` is true so the caller can ask whether to delete the card.
 */
export function deleteSpanInList<T extends { id: string; text: string; textJa?: string }>(
  list: T[],
  cardId: string,
  span: TextSpan
): { list: T[]; emptied: boolean } {
  const card = list.find((e) => e.id === cardId);
  if (!card) return { list, emptied: false };
  const text = removeSpanFromText(card.text, span);
  if (text === card.text) return { list, emptied: false };
  if (text.length === 0) return { list, emptied: true };
  return {
    list: list.map((e) => (e.id === cardId ? { ...e, text, textJa: undefined } : e)),
    emptied: false,
  };
}
