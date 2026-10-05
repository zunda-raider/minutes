import { NextResponse } from 'next/server';
import { getOllamaBaseUrl, getOllamaModel, isOllamaReachable } from '@/lib/ollama';

export const runtime = 'nodejs';

/**
 * Best-effort short title for one 議事録 block (#N).
 * Never starts Ollama; when it is down the client keeps the plain #N heading.
 */
export async function POST(req: Request) {
  let text = '';
  let genre = '';
  try {
    const body = (await req.json()) as { text?: unknown; genre?: unknown };
    text = typeof body.text === 'string' ? body.text.trim() : '';
    genre = typeof body.genre === 'string' ? body.genre.trim() : '';
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: 'empty' }, { status: 400 });

  const baseUrl = getOllamaBaseUrl();
  if (!(await isOllamaReachable(baseUrl))) {
    return NextResponse.json({ error: 'ollama offline' }, { status: 503 });
  }

  const system =
    '会議の文字起こしの一部に、日本語で短い見出しを1つだけ付けてください。' +
    '20文字以内。記号・引用符・説明は不要。見出しだけを出力。' +
    (genre ? `\n会議の文脈: ${genre}` : '');

  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model: getOllamaModel(),
        stream: false,
        options: { temperature: 0.2 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: text.slice(0, 6000) },
        ],
      }),
    });
    const data = (await res.json()) as { message?: { content?: string }; error?: string };
    if (!res.ok) {
      return NextResponse.json({ error: data.error || `ollama ${res.status}` }, { status: 502 });
    }
    const title = (data.message?.content ?? '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)
      ?.replace(/^[#\s「『"'*・-]+|[」』"'*。\s]+$/g, '')
      .slice(0, 24);
    if (!title) return NextResponse.json({ error: 'empty title' }, { status: 502 });
    return NextResponse.json({ title });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: detail }, { status: 502 });
  }
}
