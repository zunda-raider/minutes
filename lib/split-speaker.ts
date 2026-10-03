/**
 * Changing speaker on a selection splits the card.
 * The selected text becomes its own segment with the new speaker.
 * Unselected text stays in separate segments with the old speaker.
 * A whole-card selection (no partial span) only changes speaker.
 */

export type SplittableEntry = {
  id: string;
  note: number;
  text: string;
  lang: string;
  at: string;
  textJa?: string;
  speakerId?: number;
  source?: 'mic' | 'system';
};

/** Character offsets into entry.text. end is exclusive. */
export type TextSpan = { start: number; end: number };

type Fragment = { text: string; selected: boolean };

function fragments(text: string, span: TextSpan | undefined): Fragment[] {
  if (!span) return [{ text, selected: true }];
  const start = Math.max(0, Math.min(text.length, Math.floor(span.start)));
  const end = Math.max(start, Math.min(text.length, Math.floor(span.end)));
  if (end <= start) return [{ text, selected: true }];
  if (start === 0 && end === text.length) return [{ text, selected: true }];

  const raw: Fragment[] = [
    { text: text.slice(0, start), selected: false },
    { text: text.slice(start, end), selected: true },
    { text: text.slice(end), selected: false },
  ];
  const kept = raw
    .map((part) => ({ ...part, text: part.text.trim() }))
    .filter((part) => part.text.length > 0);
  if (kept.length === 0) return [{ text: text.trim() || text, selected: true }];
  return kept;
}

/** Notes that stay in order between this card and the next, first note unchanged. */
function pieceNotes(base: number, next: number | null, count: number): number[] {
  if (count <= 1) return [base];
  const upper = next != null && next > base ? next : base + count;
  const step = (upper - base) / count;
  return Array.from({ length: count }, (_, i) => (i === 0 ? base : base + step * i));
}

/**
 * Selected cards are rewritten in chronological order.
 * `spans` holds a partial text selection; cards without a span are wholly selected.
 */
export function applySpeakerSplit<T extends SplittableEntry>(
  entries: T[],
  selectedIds: ReadonlySet<string>,
  spans: ReadonlyMap<string, TextSpan>,
  speakerId: number,
  newId: () => string
): T[] {
  const ordered = [...entries].sort(
    (a, b) => a.note - b.note || a.id.localeCompare(b.id)
  );
  const out: T[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const entry = ordered[i]!;
    if (!selectedIds.has(entry.id)) {
      out.push(entry);
      continue;
    }
    const nextNote = ordered[i + 1]?.note ?? null;
    const parts = fragments(entry.text, spans.get(entry.id));
    const notes = pieceNotes(entry.note, nextNote, parts.length);
    const single = parts.length === 1;
    parts.forEach((part, idx) => {
      out.push({
        ...entry,
        id: idx === 0 ? entry.id : newId(),
        note: notes[idx]!,
        text: part.text,
        textJa: single ? entry.textJa : undefined,
        speakerId: part.selected ? speakerId : entry.speakerId,
        source: part.selected ? 'system' : entry.source,
      });
    });
  }
  return out;
}
