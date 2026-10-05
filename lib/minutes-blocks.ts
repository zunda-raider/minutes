/**
 * 議事録をまとめる — numbered note blocks (#1, #2, …) over transcript cards.
 *
 * A block owns a half-open note range [startNote, endNote). Ranges, not ids,
 * so speaker splits (2 → 2, 2.5) and merges stay inside the same block.
 * endNote is floor(max note)+1, so fragments of the last card stay inside
 * while the next recording (ceil) lands in the following block.
 */

export type MinutesBlock = {
  id: string;
  /** 1-based block number shown as #N */
  index: number;
  /** inclusive */
  startNote: number;
  /** exclusive */
  endNote: number;
  createdAt: string;
  /** Optional short title (Ollama, best effort). */
  title?: string;
};

export const MINUTES_BLOCKS_KEY = 'minutes.notes.blocks.v1';

type NoteLike = { note: number };

function canUseStorage(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof localStorage !== 'undefined' &&
    typeof localStorage.getItem === 'function' &&
    typeof localStorage.setItem === 'function'
  );
}

function isBlock(value: unknown): value is MinutesBlock {
  if (!value || typeof value !== 'object') return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.id === 'string' &&
    typeof b.index === 'number' &&
    typeof b.startNote === 'number' &&
    typeof b.endNote === 'number' &&
    typeof b.createdAt === 'string' &&
    (b.title === undefined || typeof b.title === 'string')
  );
}

export function loadMinutesBlocks(): MinutesBlock[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(MINUTES_BLOCKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isBlock).sort((a, b) => a.index - b.index);
  } catch (err) {
    console.error('minutes blocks load failed:', err);
    return [];
  }
}

export function saveMinutesBlocks(blocks: MinutesBlock[]): void {
  if (!canUseStorage()) return;
  try {
    if (blocks.length === 0) localStorage.removeItem(MINUTES_BLOCKS_KEY);
    else localStorage.setItem(MINUTES_BLOCKS_KEY, JSON.stringify(blocks));
  } catch (err) {
    console.error('minutes blocks save failed:', err);
  }
}

export function clearStoredMinutesBlocks(): void {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(MINUTES_BLOCKS_KEY);
  } catch (err) {
    console.error('minutes blocks clear failed:', err);
  }
}

/** Where the next block starts. */
export function groupedUpTo(blocks: MinutesBlock[]): number {
  return blocks.reduce((max, b) => Math.max(max, b.endNote), 0);
}

/** Cards not yet in any block, oldest first. */
export function ungroupedEntries<T extends NoteLike>(
  entries: T[],
  blocks: MinutesBlock[]
): T[] {
  const from = groupedUpTo(blocks);
  return entries.filter((e) => e.note >= from).sort((a, b) => a.note - b.note);
}

/** Cards inside one block, oldest first. */
export function entriesInBlock<T extends NoteLike>(
  entries: T[],
  block: MinutesBlock
): T[] {
  return entries
    .filter((e) => e.note >= block.startNote && e.note < block.endNote)
    .sort((a, b) => a.note - b.note);
}

/** Next block (#N) over every ungrouped card, or null when nothing piled up. */
export function makeNextBlock<T extends NoteLike>(
  entries: T[],
  blocks: MinutesBlock[],
  now: Date = new Date()
): MinutesBlock | null {
  const pending = ungroupedEntries(entries, blocks);
  if (pending.length === 0) return null;
  const maxNote = pending[pending.length - 1]!.note;
  const index = blocks.reduce((max, b) => Math.max(max, b.index), 0) + 1;
  return {
    id: `blk-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    index,
    startNote: groupedUpTo(blocks),
    endNote: Math.floor(maxNote + 1e-9) + 1,
    createdAt: now.toISOString(),
  };
}
