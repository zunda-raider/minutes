/**
 * Merge a card selection into one block.
 * Text is concatenated in chronological order.
 * The earliest card keeps its id, note, time, and speaker.
 */

export type MergeableEntry = {
  id: string;
  note: number;
  text: string;
  at: string;
  textJa?: string;
};

export function mergeSelectedCards<T extends MergeableEntry>(
  entries: T[],
  selectedIds: ReadonlySet<string>
): T[] {
  if (selectedIds.size < 2) return entries;
  const selected = entries
    .filter((entry) => selectedIds.has(entry.id))
    .sort((a, b) => a.note - b.note || a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  if (selected.length < 2) return entries;

  const first = selected[0]!;
  const text = selected
    .map((entry) => entry.text.trim())
    .filter((part) => part.length > 0)
    .join('\n');
  const ja = selected.every((entry) => entry.textJa?.trim())
    ? selected.map((entry) => entry.textJa!.trim()).join('\n')
    : undefined;
  const drop = new Set(selected.slice(1).map((entry) => entry.id));
  const merged: T = {
    ...first,
    text: text || first.text,
    textJa: ja,
  };
  return entries
    .filter((entry) => !drop.has(entry.id))
    .map((entry) => (entry.id === first.id ? merged : entry));
}
