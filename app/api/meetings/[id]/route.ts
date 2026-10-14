import { NextResponse } from 'next/server';
import { isDbConfigured } from '@/lib/db';
import {
  deleteMeetingFromDb,
  getMeetingFromDb,
  parseMeeting,
  upsertMeetingInDb,
} from '@/lib/meetings-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

function dbUnavailable() {
  return NextResponse.json(
    { error: 'DATABASE_URL が未設定です', configured: false },
    { status: 503 }
  );
}

export async function GET(_req: Request, ctx: Ctx) {
  if (!isDbConfigured()) return dbUnavailable();
  const { id } = await ctx.params;
  try {
    const meeting = await getMeetingFromDb(id);
    if (!meeting) {
      return NextResponse.json({ error: '見つかりません' }, { status: 404 });
    }
    return NextResponse.json({ meeting, configured: true });
  } catch (err) {
    console.error('meeting GET failed:', err);
    return NextResponse.json(
      { error: '議事録の読み込みに失敗しました' },
      { status: 500 }
    );
  }
}

/** Full replace of one notebook (metadata + cards). */
export async function PUT(req: Request, ctx: Ctx) {
  if (!isDbConfigured()) return dbUnavailable();
  const { id } = await ctx.params;
  try {
    const body = (await req.json()) as unknown;
    const meetingRaw =
      body && typeof body === 'object' && 'meeting' in body
        ? (body as { meeting: unknown }).meeting
        : body;
    const meeting = parseMeeting(meetingRaw);
    if (!meeting || meeting.id !== id) {
      return NextResponse.json(
        { error: 'meeting の形式が不正です（id 不一致）' },
        { status: 400 }
      );
    }
    const saved = await upsertMeetingInDb(meeting);
    return NextResponse.json({ meeting: saved, configured: true });
  } catch (err) {
    console.error('meeting PUT failed:', err);
    return NextResponse.json(
      { error: '議事録の保存に失敗しました' },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  if (!isDbConfigured()) return dbUnavailable();
  const { id } = await ctx.params;
  try {
    const ok = await deleteMeetingFromDb(id);
    if (!ok) {
      return NextResponse.json({ error: '見つかりません' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, configured: true });
  } catch (err) {
    console.error('meeting DELETE failed:', err);
    return NextResponse.json(
      { error: '議事録の削除に失敗しました' },
      { status: 500 }
    );
  }
}
