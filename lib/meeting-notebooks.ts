/**
 * Named meeting notebooks — archive transcript cards by hand
 * (name-first; date optional / defaults to today), not an LLM summary.
 *
 * Per-card 「議事録に入れる」 snapshots a card into a named meeting
 * (mic / Zoom / GD harbor alike) so it leaves Home without losing the notebook.
 */

import type { StoredTranscriptEntry } from './history-storage';
import {
  clearStoredMinutesBlocks,
  entriesInBlock,
  loadMinutesBlocks,
  type MinutesBlock,
} from './minutes-blocks';

export type MeetingNotebook = {
  id: string;
  /** YYYY-MM-DD (Asia/Tokyo calendar day) */
  date: string;
  /** Free-text meeting name, e.g. 人材ミーティング */
  title: string;
  createdAt: string;
  /** Snapshotted cards archived into this notebook */
  entries: StoredTranscriptEntry[];
};

export const MEETINGS_KEY = 'minutes.meetings.v1';
export const ACTIVE_MEETING_KEY = 'minutes.meetings.active.v1';

function canUseStorage(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof localStorage !== 'undefined' &&
    typeof localStorage.getItem === 'function' &&
    typeof localStorage.setItem === 'function'
  );
}

function isEntry(value: unknown): value is StoredTranscriptEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.note === 'number' &&
    typeof e.text === 'string' &&
    typeof e.lang === 'string' &&
    typeof e.at === 'string' &&
    (e.textJa === undefined || typeof e.textJa === 'string') &&
    (e.speakerId === undefined ||
      (typeof e.speakerId === 'number' && Number.isFinite(e.speakerId))) &&
    (e.source === undefined || e.source === 'mic' || e.source === 'system')
  );
}

function isMeeting(value: unknown): value is MeetingNotebook {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    typeof m.date === 'string' &&
    typeof m.title === 'string' &&
    typeof m.createdAt === 'string' &&
    Array.isArray(m.entries) &&
    m.entries.every(isEntry)
  );
}

/** Asia/Tokyo calendar day as YYYY-MM-DD. */
export function todayTokyo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** "10月3日" from YYYY-MM-DD. */
export function formatMeetingDateLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  return `${Number(m[2])}月${Number(m[3])}日`;
}

export function meetingDisplayName(meeting: Pick<MeetingNotebook, 'date' | 'title'>): string {
  const date = formatMeetingDateLabel(meeting.date);
  const title = meeting.title.trim();
  return title ? `${date} ${title}` : date;
}

export function sortMeetings(meetings: MeetingNotebook[]): MeetingNotebook[] {
  return [...meetings].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function loadMeetings(): MeetingNotebook[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(MEETINGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return sortMeetings(parsed.filter(isMeeting));
  } catch (err) {
    console.error('meetings load failed:', err);
    return [];
  }
}

export function saveMeetings(meetings: MeetingNotebook[]): void {
  if (!canUseStorage()) return;
  try {
    if (meetings.length === 0) localStorage.removeItem(MEETINGS_KEY);
    else localStorage.setItem(MEETINGS_KEY, JSON.stringify(sortMeetings(meetings)));
  } catch (err) {
    console.error('meetings save failed:', err);
  }
}

export function clearStoredMeetings(): void {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(MEETINGS_KEY);
    localStorage.removeItem(ACTIVE_MEETING_KEY);
  } catch (err) {
    console.error('meetings clear failed:', err);
  }
}

export function loadActiveMeetingId(): string | null {
  if (!canUseStorage()) return null;
  try {
    return localStorage.getItem(ACTIVE_MEETING_KEY);
  } catch {
    return null;
  }
}

export function saveActiveMeetingId(id: string | null): void {
  if (!canUseStorage()) return;
  try {
    if (!id) localStorage.removeItem(ACTIVE_MEETING_KEY);
    else localStorage.setItem(ACTIVE_MEETING_KEY, id);
  } catch (err) {
    console.error('active meeting save failed:', err);
  }
}

/** Name-first create; date omitted → Asia/Tokyo today. */
export function createMeeting(
  title: string,
  date: string = '',
  now: Date = new Date()
): MeetingNotebook {
  const ymd = date.trim() || todayTokyo(now);
  return {
    id: `mtg-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    date: ymd,
    title: title.trim(),
    createdAt: now.toISOString(),
    entries: [],
  };
}

/** Append cards into a meeting (dedupe by id, keep meeting order then new). */
export function appendCardsToMeeting(
  meeting: MeetingNotebook,
  cards: StoredTranscriptEntry[]
): MeetingNotebook {
  if (cards.length === 0) return meeting;
  const seen = new Set(meeting.entries.map((e) => e.id));
  const added = cards.filter((c) => !seen.has(c.id));
  if (added.length === 0) return meeting;
  return {
    ...meeting,
    entries: [...meeting.entries, ...added].sort((a, b) => a.note - b.note),
  };
}

/**
 * One-shot migrate: anonymous #1/#2 blocks → named meetings.
 * Uses each block's optional title, or 「ブロック #N」.
 */
export function migrateBlocksToMeetings(
  blocks: MinutesBlock[],
  homeEntries: StoredTranscriptEntry[]
): MeetingNotebook[] {
  if (blocks.length === 0) return [];
  return sortMeetings(
    blocks.map((block) => {
      const created = new Date(block.createdAt);
      const date = Number.isFinite(created.getTime())
        ? todayTokyo(created)
        : todayTokyo();
      return {
        id: `mtg-migrated-${block.id}`,
        date,
        title: (block.title && block.title.trim()) || `ブロック #${block.index}`,
        createdAt: block.createdAt,
        entries: entriesInBlock(homeEntries, block),
      };
    })
  );
}

/**
 * Load meetings; if empty, promote legacy minutes blocks once and clear them.
 */
export function loadMeetingsWithMigration(
  homeEntries: StoredTranscriptEntry[]
): MeetingNotebook[] {
  const existing = loadMeetings();
  if (existing.length > 0) return existing;
  const blocks = loadMinutesBlocks();
  if (blocks.length === 0) return [];
  const migrated = migrateBlocksToMeetings(blocks, homeEntries);
  saveMeetings(migrated);
  clearStoredMinutesBlocks();
  return migrated;
}
