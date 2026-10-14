/**
 * 「分割」: split one card at a text selection into up to three cards
 * [before][selected][after], in reading order. Times are interpolated by
 * character offset between this card's time and the next card's time.
 */
import type { TextSpan } from './split-speaker';

export type SplitCard = {
  id: string;
  note: number;
  text: string;
  lang: string;
  at: string;
  textJa?: string;
  speakerId?: number;
  source?: 'mic' | 'system';
};

/** Fallback length of one card when there is no next card (ms). */
const DEFAULT_SPAN_MS = 20_000;

export function splitPieces(text: string, span: TextSpan): string[] {
  const start = Math.max(0, Math.min(text.length, Math.floor(span.start)));
  const end = Math.max(start, Math.min(text.length, Math.floor(span.end)));
  if (end <= start) return [text];
  const pieces = [text.slice(0, start), text.slice(start, end), text.slice(end)]
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return pieces.length === 0 ? [text] : pieces;
}

/**
 * Split `card` into pieces. `next` is the following card in chronological
 * order (if any) so notes and times stay between the two.
 * Returns [card] unchanged when the selection does not actually split it.
 */
export function splitCard<T extends SplitCard>(
  card: T,
  span: TextSpan,
  next: { note: number; at: string } | null,
  newId: () => string
): T[] {
  const pieces = splitPieces(card.text, span);
  if (pieces.length <= 1) return [card];

  const startMs = Date.parse(card.at);
  const nextMs = next ? Date.parse(next.at) : NaN;
  const spanMs =
    Number.isFinite(nextMs) && nextMs > startMs ? nextMs - startMs : DEFAULT_SPAN_MS;
  const upperNote = next && next.note > card.note ? next.note : card.note + 1;
  const noteStep = (upperNote - card.note) / pieces.length;

  // Character offsets of each piece within the original text.
  const offsets: number[] = [];
  let cursor = 0;
  for (const p of pieces) {
    const idx = card.text.indexOf(p, cursor);
    offsets.push(idx < 0 ? cursor : idx);
    cursor = (idx < 0 ? cursor : idx) + p.length;
  }
  const total = Math.max(1, card.text.length);

  return pieces.map((text, i) => {
    const at = Number.isFinite(startMs)
      ? new Date(startMs + Math.round((spanMs * offsets[i]!) / total)).toISOString()
      : card.at;
    return {
      ...card,
      id: i === 0 ? card.id : newId(),
      note: i === 0 ? card.note : card.note + noteStep * i,
      text,
      at,
      textJa: undefined,
    };
  });
}

/** Replace the card with its pieces in place inside a chronological list. */
export function splitCardInList<T extends SplitCard>(
  list: T[],
  cardId: string,
  span: TextSpan,
  newId: () => string
): T[] {
  const ordered = [...list].sort((a, b) => a.note - b.note);
  const idx = ordered.findIndex((e) => e.id === cardId);
  if (idx < 0) return list;
  const next = ordered[idx + 1] ?? null;
  const pieces = splitCard(ordered[idx]!, span, next, newId);
  if (pieces.length <= 1) return list;
  const out: T[] = [];
  for (const e of list) {
    if (e.id === cardId) out.push(...pieces);
    else out.push(e);
  }
  return out;
}
