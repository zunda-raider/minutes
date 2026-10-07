import { NextResponse } from 'next/server';
import { isDbConfigured } from '@/lib/db';
import {
  listMeetingsFromDb,
  parseMeeting,
  parseMeetings,
  replaceAllMeetingsInDb,
  upsertMeetingInDb,
} from '@/lib/meetings-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function dbUnavailable() {
  return NextResponse.json(
    {
      error: 'DATABASE_URL が未設定です',
      configured: false,
    },
    { status: 503 }
  );
}

/** List all meeting notebooks (with cards). */
export async function GET() {
  if (!isDbConfigured()) return dbUnavailable();
  try {
    const meetings = await listMeetingsFromDb();
    return NextResponse.json({ meetings, configured: true });
  } catch (err) {
    console.error('meetings GET failed:', err);
    return NextResponse.json(
      { error: '議事録の読み込みに失敗しました', configured: true },
      { status: 500 }
    );
  }
}

/** Create / upsert one meeting notebook. Body: { meeting } */
export async function POST(req: Request) {
  if (!isDbConfigured()) return dbUnavailable();
  try {
    const body = (await req.json()) as unknown;
    const meetingRaw =
      body && typeof body === 'object' && 'meeting' in body
        ? (body as { meeting: unknown }).meeting
        : body;
    const meeting = parseMeeting(meetingRaw);
    if (!meeting) {
      return NextResponse.json(
        { error: 'meeting の形式が不正です' },
        { status: 400 }
      );
    }
    const saved = await upsertMeetingInDb(meeting);
    return NextResponse.json({ meeting: saved, configured: true });
  } catch (err) {
    console.error('meetings POST failed:', err);
    return NextResponse.json(
      { error: '議事録の保存に失敗しました', configured: true },
      { status: 500 }
    );
  }
}

/** Replace all notebooks (sync / localStorage migrate). Body: { meetings } */
export async function PUT(req: Request) {
  if (!isDbConfigured()) return dbUnavailable();
  try {
    const body = (await req.json()) as unknown;
    const listRaw =
      body && typeof body === 'object' && 'meetings' in body
        ? (body as { meetings: unknown }).meetings
        : body;
    const meetings = parseMeetings(listRaw);
    if (!meetings) {
      return NextResponse.json(
        { error: 'meetings の形式が不正です' },
        { status: 400 }
      );
    }
    const saved = await replaceAllMeetingsInDb(meetings);
    return NextResponse.json({ meetings: saved, configured: true });
  } catch (err) {
    console.error('meetings PUT failed:', err);
    return NextResponse.json(
      { error: '議事録の同期に失敗しました', configured: true },
      { status: 500 }
    );
  }
}
