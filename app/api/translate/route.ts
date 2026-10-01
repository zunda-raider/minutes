import { NextResponse } from 'next/server';
import {
  ensureOllamaRunning,
  getOllamaBaseUrl,
  getOllamaModel,
} from '@/lib/ollama';

export const runtime = 'nodejs';

const BASE_SYSTEM_PROMPT =
  'You are a professional translator. Translate the user text from English to natural Japanese. Output ONLY the Japanese translation, with no quotes or commentary.';

function buildTranslateSystemPrompt(genre?: string): string {
  const g = genre?.trim();
  if (!g) return BASE_SYSTEM_PROMPT;
  return (
    BASE_SYSTEM_PROMPT +
    ` The meeting genre/context is: "${g}". Prefer terminology and tone appropriate for that domain.`
  );
}

function buildTranslateUserContent(text: string, genre?: string): string {
  const g = genre?.trim();
  if (!g) return text;
  return `Meeting context/genre: ${g}

Text to translate:
${text}`;
}

function getOpenAiKey(): string | null {
  return (
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.TRANSLATE_API_KEY?.trim() ||
    null
  );
}

type Provider = 'ollama' | 'openai' | 'auto';

function getProvider(): Provider {
  const raw = (process.env.TRANSLATE_PROVIDER?.trim() || 'auto').toLowerCase();
  if (raw === 'ollama' || raw === 'openai' || raw === 'auto') return raw;
  return 'auto';
}

async function translateWithOllama(text: string, genre?: string): Promise<string> {
  const baseUrl = getOllamaBaseUrl();
  const model = getOllamaModel();

  // Local Next server only: wake Ollama if needed
  await ensureOllamaRunning(baseUrl);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: buildTranslateSystemPrompt(genre) },
          { role: 'user', content: buildTranslateUserContent(text, genre) },
        ],
      }),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Ollamaに接続できません（${baseUrl}）。\`ollama serve\` が起動しているか、モデル \`${model}\` を pull 済みか確認してください。 (${detail})`
    );
  }

  const data = (await res.json()) as {
    error?: string;
    message?: { content?: string };
  };

  if (!res.ok) {
    throw new Error(
      data.error ||
        `Ollama API error (${res.status}). モデル \`${model}\` があるか \`ollama pull ${model}\`（例: llama3.2 / gemma2）を試してください。`
    );
  }

  const textJa = data.message?.content?.trim() ?? '';
  if (!textJa) {
    throw new Error('Ollamaの翻訳結果が空でした。');
  }
  return textJa;
}

async function translateWithOpenAI(text: string, genre?: string): Promise<string> {
  const apiKey = getOpenAiKey();
  if (!apiKey) {
    throw new Error('翻訳用APIキー未設定');
  }

  const baseUrl = (
    process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1'
  ).replace(/\/$/, '');
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';

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
        { role: 'system', content: buildTranslateSystemPrompt(genre) },
        { role: 'user', content: buildTranslateUserContent(text, genre) },
      ],
    }),
  });

  const data = (await res.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };

  if (!res.ok) {
    throw new Error(data.error?.message || `OpenAI API error (${res.status})`);
  }

  const textJa = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!textJa) {
    throw new Error('翻訳結果が空でした。');
  }
  return textJa;
}

export async function POST(req: Request) {
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

  const genre =
    body && typeof body === 'object'
      ? String(
          (body as { genre?: unknown; context?: unknown }).genre ??
            (body as { context?: unknown }).context ??
            ''
        ).trim()
      : '';

  const provider = getProvider();
  const errors: string[] = [];

  const tryOllama = provider === 'ollama' || provider === 'auto';
  const tryOpenAI = provider === 'openai' || provider === 'auto';

  if (tryOllama) {
    try {
      const textJa = await translateWithOllama(text, genre || undefined);
      return NextResponse.json({ textJa, provider: 'ollama' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ollama翻訳に失敗しました。';
      console.error('ollama translate error:', err);
      if (provider === 'ollama') {
        return NextResponse.json({ error: message }, { status: 503 });
      }
      errors.push(message);
    }
  }

  if (tryOpenAI) {
    try {
      const textJa = await translateWithOpenAI(text, genre || undefined);
      return NextResponse.json({
        textJa,
        provider: 'openai',
        ...(errors.length ? { fallbackFrom: 'ollama' } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OpenAI翻訳に失敗しました。';
      console.error('openai translate error:', err);
      errors.push(message);
      const status = message.includes('APIキー未設定') ? 503 : 502;
      return NextResponse.json(
        {
          error:
            errors.length > 1
              ? `Ollama失敗 → OpenAIも失敗: ${errors.join(' / ')}`
              : message,
        },
        { status }
      );
    }
  }

  return NextResponse.json(
    {
      error:
        errors[0] ||
        '翻訳プロバイダがありません。Ollamaを起動するか OPENAI_API_KEY を設定してください。',
    },
    { status: 503 }
  );
}
