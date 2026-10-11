import { NextResponse } from 'next/server';
import { isDbConfigured } from '@/lib/db';
import { getMeetingFromDb, moveCardInDb } from '@/lib/meetings-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ cardId: string }> };

/**
 * Move a filed card to another meeting, or remove it from its meeting.
 * Body: { meetingId: string | null }
 */
export async function PATCH(req: Request, ctx: Ctx) {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: 'DATABASE_URL が未設定です', configured: false },
      { status: 503 }
    );
  }
  const { cardId } = await ctx.params;
  try {
    const body = (await req.json()) as unknown;
    const raw =
      body && typeof body === 'object' && 'meetingId' in body
        ? (body as { meetingId: unknown }).meetingId
        : undefined;
    if (raw !== null && typeof raw !== 'string') {
      return NextResponse.json(
        { error: 'meetingId（文字列 or null）が必要です' },
        { status: 400 }
      );
    }
    if (typeof raw === 'string' && !(await getMeetingFromDb(raw))) {
      return NextResponse.json({ error: '移動先が見つかりません' }, { status: 404 });
    }
    const moved = await moveCardInDb(cardId, raw);
    if (!moved) {
      return NextResponse.json({ error: 'カードが見つかりません' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, from: moved.from, to: raw, configured: true });
  } catch (err) {
    console.error('meeting card PATCH failed:', err);
    return NextResponse.json({ error: 'カードの移動に失敗しました' }, { status: 500 });
  }
}
