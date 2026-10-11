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
  /** Optional time range (ISO) used by 「時間で自動振り分け」. */
  startAt?: string;
  endAt?: string;
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
    m.entries.every(isEntry) &&
    (m.startAt === undefined || typeof m.startAt === 'string') &&
    (m.endAt === undefined || typeof m.endAt === 'string')
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

// ---------------------------------------------------------------------------
// Time ranges / auto-file / move
// ---------------------------------------------------------------------------

function ms(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Effective range of a meeting: explicit startAt/endAt, else first..last card.
 * Meetings with neither have no range (never auto-filled into).
 */
export function meetingRange(
  meeting: MeetingNotebook
): { start: number; end: number } | null {
  let start = ms(meeting.startAt);
  let end = ms(meeting.endAt);
  if (start == null || end == null) {
    const times = meeting.entries
      .map((e) => ms(e.at))
      .filter((t): t is number => t != null);
    if (times.length > 0) {
      start ??= Math.min(...times);
      end ??= Math.max(...times);
    }
  }
  if (start == null || end == null || end < start) return null;
  return { start, end };
}

/** Update a meeting's explicit time range (empty string clears). */
export function setMeetingRange(
  meeting: MeetingNotebook,
  startAt: string | undefined,
  endAt: string | undefined
): MeetingNotebook {
  const next: MeetingNotebook = { ...meeting };
  if (startAt) next.startAt = startAt;
  else delete next.startAt;
  if (endAt) next.endAt = endAt;
  else delete next.endAt;
  return next;
}

export type AutoFilePlan = {
  /** meetingId → cards that will be appended */
  byMeeting: Map<string, StoredTranscriptEntry[]>;
  total: number;
};

/**
 * Plan: each unfiled card goes into the meeting whose range contains its
 * timestamp (narrowest range wins). Cards already in any meeting are skipped.
 */
export function planAutoFile(
  cards: StoredTranscriptEntry[],
  meetings: MeetingNotebook[]
): AutoFilePlan {
  const filed = new Set<string>();
  for (const m of meetings) for (const e of m.entries) filed.add(e.id);
  const ranges = meetings
    .map((m) => ({ id: m.id, r: meetingRange(m) }))
    .filter((x): x is { id: string; r: { start: number; end: number } } => !!x.r)
    .sort((a, b) => a.r.end - a.r.start - (b.r.end - b.r.start));
  const byMeeting = new Map<string, StoredTranscriptEntry[]>();
  let total = 0;
  for (const card of cards) {
    if (filed.has(card.id)) continue;
    const t = ms(card.at);
    if (t == null) continue;
    const hit = ranges.find((x) => t >= x.r.start && t <= x.r.end);
    if (!hit) continue;
    const list = byMeeting.get(hit.id) ?? [];
    list.push(card);
    byMeeting.set(hit.id, list);
    total += 1;
  }
  return { byMeeting, total };
}

/** Apply a plan: append cards to their meetings. */
export function applyAutoFilePlan(
  meetings: MeetingNotebook[],
  plan: AutoFilePlan
): MeetingNotebook[] {
  return meetings.map((m) => {
    const cards = plan.byMeeting.get(m.id);
    return cards ? appendCardsToMeeting(m, cards) : m;
  });
}

/** Cards whose timestamp is within [startIso, endIso] (inclusive). */
export function cardsInRange(
  cards: StoredTranscriptEntry[],
  startIso: string,
  endIso: string
): StoredTranscriptEntry[] {
  const s = ms(startIso);
  const e = ms(endIso);
  if (s == null || e == null || e < s) return [];
  return cards.filter((c) => {
    const t = ms(c.at);
    return t != null && t >= s && t <= e;
  });
}

/** Remove one card from whichever meeting holds it. */
export function removeCardFromMeetings(
  meetings: MeetingNotebook[],
  cardId: string
): { meetings: MeetingNotebook[]; card: StoredTranscriptEntry | null } {
  let card: StoredTranscriptEntry | null = null;
  const next = meetings.map((m) => {
    const found = m.entries.find((e) => e.id === cardId);
    if (!found) return m;
    card = found;
    return { ...m, entries: m.entries.filter((e) => e.id !== cardId) };
  });
  return { meetings: next, card };
}

/** Move one card into another meeting (no-op if target missing). */
export function moveCardToMeeting(
  meetings: MeetingNotebook[],
  cardId: string,
  targetId: string
): MeetingNotebook[] {
  if (!meetings.some((m) => m.id === targetId)) return meetings;
  const { meetings: removed, card } = removeCardFromMeetings(meetings, cardId);
  if (!card) return meetings;
  return removed.map((m) => (m.id === targetId ? appendCardsToMeeting(m, [card]) : m));
}
