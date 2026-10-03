/**
 * Home shows newer segments first, but a split utterance must still read
 * top-to-bottom. Fragments of one segment share `at`; keep that group in
 * note order and only reverse the groups.
 * Note 1 / Note 2 keep their plain note sorts.
 */

export function newestFirstReadingOrder<
  T extends { id: string; note: number; at: string },
>(entries: T[]): T[] {
  const chronological = [...entries].sort(
    (a, b) => a.note - b.note || a.id.localeCompare(b.id)
  );
  const groups: T[][] = [];
  for (const entry of chronological) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && prev.at === entry.at) last.push(entry);
    else groups.push([entry]);
  }
  const out: T[] = [];
  for (let i = groups.length - 1; i >= 0; i--) out.push(...groups[i]!);
  return out;
}
