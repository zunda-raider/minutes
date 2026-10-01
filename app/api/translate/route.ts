import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function getApiKey(): string | null {
  const key =
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.TRANSLATE_API_KEY?.trim() ||
    null;
  return key || null;
}

export async function POST(req: Request) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: '翻訳用APIキー未設定' },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON を読めませんでした。' }, { status: 400 });
  }

  const text =
    body && typeof body === 'object' && 'text' in body
      ? String((body as { text: unknown }).text ?? '').trim()
      : '';

  if (!text) {
    return NextResponse.json({ error: 'text が空です。' }, { status: 400 });
  }

  const baseUrl = (
    process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1'
  ).replace(/\/$/, '');
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are a professional translator. Translate the user text from English to natural Japanese. Output ONLY the Japanese translation, with no quotes or commentary.',
          },
          { role: 'user', content: text },
        ],
      }),
    });

    const data = (await res.json()) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };

    if (!res.ok) {
      const msg = data.error?.message || `OpenAI API error (${res.status})`;
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const textJa = data.choices?.[0]?.message?.content?.trim() ?? '';
    if (!textJa) {
      return NextResponse.json(
        { error: '翻訳結果が空でした。' },
        { status: 502 }
      );
    }

    return NextResponse.json({ textJa });
  } catch (err) {
    console.error('translate error:', err);
    const message = err instanceof Error ? err.message : '翻訳に失敗しました。';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
