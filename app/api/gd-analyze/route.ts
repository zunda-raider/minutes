import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const PAUSED =
  'Ollamaはいま要約だけです。GD分析は止めています。';

/** Heavy GD voyage/analysis stays off. Live 論点整理 uses /api/gd-organize. */
export async function POST() {
  return NextResponse.json({ error: PAUSED }, { status: 503 });
}
