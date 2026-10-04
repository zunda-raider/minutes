import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const PAUSED =
  'Ollamaはいま要約だけです。GD分析は止めています。';

/** Heavy GD analysis stays off. Summary keeps /api/summarize. */
export async function POST() {
  return NextResponse.json({ error: PAUSED }, { status: 503 });
}
