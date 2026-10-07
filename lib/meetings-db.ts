/**
 * Server-side persistence for named meeting notebooks + cards.
 * Mirrors MeetingNotebook / StoredTranscriptEntry shapes used by the UI.
 */

import type { PoolClient } from 'pg';
import type { StoredTranscriptEntry } from './history-storage';
import {
  sortMeetings,
  type MeetingNotebook,
} from './meeting-notebooks';
import { getPool } from './db';

type MeetingRow = {
  id: string;
  meeting_date: Date | string;
  title: string;
  created_at: Date | string;
};

type CardRow = {
  id: string;
  meeting_id: string;
  note: number | string;
  text: string;
  lang: string;
  at: Date | string;
  text_ja: string | null;
  speaker_id: number | null;
  source: string | null;
};

function dateToYmd(value: Date | string): string {
  if (typeof value === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    if (m) return m[1]!;
    const d = new Date(value);
    if (Number.isFinite(d.getTime())) {
      // Fallback for unexpected ISO strings: calendar day in Asia/Tokyo
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
    }
    return value;
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function toIso(value: Date | string): string {
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : value;
  }
  return value.toISOString();
}

function rowToCard(row: CardRow): StoredTranscriptEntry {
  const entry: StoredTranscriptEntry = {
    id: row.id,
    note: typeof row.note === 'number' ? row.note : Number(row.note),
    text: row.text,
    lang: row.lang,
    at: toIso(row.at),
  };
  if (row.text_ja != null && row.text_ja !== '') entry.textJa = row.text_ja;
  if (row.speaker_id != null && Number.isFinite(row.speaker_id)) {
    entry.speakerId = row.speaker_id;
  }
  if (row.source === 'mic' || row.source === 'system') {
    entry.source = row.source;
  }
  return entry;
}

function isEntry(value: unknown): value is StoredTranscriptEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.note === 'number' &&
    Number.isFinite(e.note) &&
    typeof e.text === 'string' &&
    typeof e.lang === 'string' &&
    typeof e.at === 'string' &&
    (e.textJa === undefined || typeof e.textJa === 'string') &&
    (e.speakerId === undefined ||
      (typeof e.speakerId === 'number' && Number.isFinite(e.speakerId))) &&
    (e.source === undefined || e.source === 'mic' || e.source === 'system')
  );
}

function isMeetingInput(value: unknown): value is MeetingNotebook {
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

export function parseMeeting(value: unknown): MeetingNotebook | null {
  return isMeetingInput(value) ? value : null;
}

export function parseMeetings(value: unknown): MeetingNotebook[] | null {
  if (!Array.isArray(value)) return null;
  const out: MeetingNotebook[] = [];
  for (const item of value) {
    if (!isMeetingInput(item)) return null;
    out.push(item);
  }
  return out;
}

async function insertCards(
  client: PoolClient,
  meetingId: string,
  cards: StoredTranscriptEntry[]
): Promise<void> {
  for (const card of cards) {
    await client.query(
      `INSERT INTO meeting_cards
        (id, meeting_id, note, text, lang, at, text_ja, speaker_id, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         meeting_id = EXCLUDED.meeting_id,
         note = EXCLUDED.note,
         text = EXCLUDED.text,
         lang = EXCLUDED.lang,
         at = EXCLUDED.at,
         text_ja = EXCLUDED.text_ja,
         speaker_id = EXCLUDED.speaker_id,
         source = EXCLUDED.source`,
      [
        card.id,
        meetingId,
        card.note,
        card.text,
        card.lang,
        card.at,
        card.textJa ?? null,
        card.speakerId ?? null,
        card.source ?? null,
      ]
    );
  }
}

async function insertMeeting(
  client: PoolClient,
  meeting: MeetingNotebook
): Promise<void> {
  await client.query(
    `INSERT INTO meetings (id, meeting_date, title, created_at)
     VALUES ($1, $2::date, $3, $4::timestamptz)
     ON CONFLICT (id) DO UPDATE SET
       meeting_date = EXCLUDED.meeting_date,
       title = EXCLUDED.title,
       created_at = EXCLUDED.created_at`,
    [meeting.id, meeting.date, meeting.title, meeting.createdAt]
  );
  await client.query(`DELETE FROM meeting_cards WHERE meeting_id = $1`, [
    meeting.id,
  ]);
  await insertCards(client, meeting.id, meeting.entries);
}

export async function listMeetingsFromDb(): Promise<MeetingNotebook[]> {
  const pool = getPool();
  const meetingsRes = await pool.query<MeetingRow>(
    `SELECT id, meeting_date, title, created_at
     FROM meetings
     ORDER BY meeting_date DESC, created_at DESC`
  );
  if (meetingsRes.rows.length === 0) return [];

  const ids = meetingsRes.rows.map((r) => r.id);
  const cardsRes = await pool.query<CardRow>(
    `SELECT id, meeting_id, note, text, lang, at, text_ja, speaker_id, source
     FROM meeting_cards
     WHERE meeting_id = ANY($1::text[])
     ORDER BY note ASC`,
    [ids]
  );

  const byMeeting = new Map<string, StoredTranscriptEntry[]>();
  for (const row of cardsRes.rows) {
    const list = byMeeting.get(row.meeting_id) ?? [];
    list.push(rowToCard(row));
    byMeeting.set(row.meeting_id, list);
  }

  return sortMeetings(
    meetingsRes.rows.map((row) => ({
      id: row.id,
      date: dateToYmd(row.meeting_date),
      title: row.title,
      createdAt: toIso(row.created_at),
      entries: byMeeting.get(row.id) ?? [],
    }))
  );
}

export async function getMeetingFromDb(
  id: string
): Promise<MeetingNotebook | null> {
  const pool = getPool();
  const meetingsRes = await pool.query<MeetingRow>(
    `SELECT id, meeting_date, title, created_at
     FROM meetings WHERE id = $1`,
    [id]
  );
  const row = meetingsRes.rows[0];
  if (!row) return null;

  const cardsRes = await pool.query<CardRow>(
    `SELECT id, meeting_id, note, text, lang, at, text_ja, speaker_id, source
     FROM meeting_cards
     WHERE meeting_id = $1
     ORDER BY note ASC`,
    [id]
  );

  return {
    id: row.id,
    date: dateToYmd(row.meeting_date),
    title: row.title,
    createdAt: toIso(row.created_at),
    entries: cardsRes.rows.map(rowToCard),
  };
}

export async function replaceAllMeetingsInDb(
  meetings: MeetingNotebook[]
): Promise<MeetingNotebook[]> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM meeting_cards');
    await client.query('DELETE FROM meetings');
    for (const meeting of sortMeetings(meetings)) {
      await insertMeeting(client, meeting);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return listMeetingsFromDb();
}

export async function upsertMeetingInDb(
  meeting: MeetingNotebook
): Promise<MeetingNotebook> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertMeeting(client, meeting);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const saved = await getMeetingFromDb(meeting.id);
  if (!saved) throw new Error('meeting upsert failed');
  return saved;
}

export async function deleteMeetingFromDb(id: string): Promise<boolean> {
  const pool = getPool();
  const res = await pool.query(`DELETE FROM meetings WHERE id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function appendCardsInDb(
  meetingId: string,
  cards: StoredTranscriptEntry[]
): Promise<MeetingNotebook | null> {
  const existing = await getMeetingFromDb(meetingId);
  if (!existing) return null;
  const seen = new Set(existing.entries.map((e) => e.id));
  const added = cards.filter((c) => !seen.has(c.id));
  if (added.length === 0) return existing;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertCards(client, meetingId, added);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getMeetingFromDb(meetingId);
}
