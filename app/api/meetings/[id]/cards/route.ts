import { NextResponse } from 'next/server';
import { isDbConfigured } from '@/lib/db';
import { appendCardsInDb, parseMeeting } from '@/lib/meetings-db';
import type { StoredTranscriptEntry } from '@/lib/history-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

function dbUnavailable() {
  return NextResponse.json(
    { error: 'DATABASE_URL が未設定です', configured: false },
    { status: 503 }
  );
}

function parseCards(value: unknown): StoredTranscriptEntry[] | null {
  // Reuse meeting parser: wrap as fake meeting
  const wrapped = parseMeeting({
    id: '_',
    date: '1970-01-01',
    title: '',
    createdAt: new Date(0).toISOString(),
    entries: value,
  });
  return wrapped ? wrapped.entries : null;
}

/** Append cards into a notebook (dedupe by card id). Body: { cards } */
export async function POST(req: Request, ctx: Ctx) {
  if (!isDbConfigured()) return dbUnavailable();
  const { id } = await ctx.params;
  try {
    const body = (await req.json()) as unknown;
    const cardsRaw =
      body && typeof body === 'object' && 'cards' in body
        ? (body as { cards: unknown }).cards
        : body;
    const cards = parseCards(cardsRaw);
    if (!cards) {
      return NextResponse.json(
        { error: 'cards の形式が不正です' },
        { status: 400 }
      );
    }
    const meeting = await appendCardsInDb(id, cards);
    if (!meeting) {
      return NextResponse.json({ error: '見つかりません' }, { status: 404 });
    }
    return NextResponse.json({ meeting, configured: true });
  } catch (err) {
    console.error('meeting cards POST failed:', err);
    return NextResponse.json(
      { error: 'カードの追加に失敗しました' },
      { status: 500 }
    );
  }
}
