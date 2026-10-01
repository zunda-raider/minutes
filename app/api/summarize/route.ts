import { NextResponse } from 'next/server';
import {
  ensureOllamaRunning,
  getOllamaBaseUrl,
  getOllamaModel,
} from '@/lib/ollama';

export const runtime = 'nodejs';

const SYSTEM_PROMPT = `あなたは会議議事録の要約アシスタントです。
与えられた文字起こし（時系列・古い順）を読み、必ず日本語で要約してください。
次の見出しを使った箇条書きで出力してください（該当がなければ「なし」）:

## 議題・トピック
- ...

## 決定事項
- ...

## アクションアイテム（担当が分かれば付記）
- ...

## その他メモ
- ...

余計な前置きや英語の説明は出さないでください。`;

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

async function summarizeWithOllama(transcript: string): Promise<string> {
  const baseUrl = getOllamaBaseUrl();
  const model = getOllamaModel();
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
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `以下の会議文字起こしを要約してください。\n\n${transcript}`,
          },
        ],
      }),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Ollamaに接続できません（${baseUrl}）。\`ollama serve\` を確認してください。 (${detail})`
    );
  }

  const data = (await res.json()) as {
    error?: string;
    message?: { content?: string };
  };

  if (!res.ok) {
    throw new Error(
      data.error ||
        `Ollama API error (${res.status}). \`ollama pull ${model}\` を試してください。`
    );
  }

  const summary = data.message?.content?.trim() ?? '';
  if (!summary) throw new Error('Ollamaの要約結果が空でした。');
  return summary;
}

async function summarizeWithOpenAI(transcript: string): Promise<string> {
  const apiKey = getOpenAiKey();
  if (!apiKey) throw new Error('翻訳用APIキー未設定');

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
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `以下の会議文字起こしを要約してください。\n\n${transcript}`,
        },
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

  const summary = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!summary) throw new Error('要約結果が空でした。');
  return summary;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON を読めませんでした。' }, { status: 400 });
  }

  const transcript =
    body && typeof body === 'object' && 'transcript' in body
      ? String((body as { transcript: unknown }).transcript ?? '').trim()
      : body && typeof body === 'object' && 'text' in body
        ? String((body as { text: unknown }).text ?? '').trim()
        : '';

  if (!transcript) {
    return NextResponse.json(
      { error: '要約する文字起こしが空です。' },
      { status: 400 }
    );
  }

  const provider = getProvider();
  const errors: string[] = [];
  const tryOllama = provider === 'ollama' || provider === 'auto';
  const tryOpenAI = provider === 'openai' || provider === 'auto';

  if (tryOllama) {
    try {
      const summary = await summarizeWithOllama(transcript);
      return NextResponse.json({ summary, provider: 'ollama' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ollama要約に失敗しました。';
      console.error('ollama summarize error:', err);
      if (provider === 'ollama') {
        return NextResponse.json({ error: message }, { status: 503 });
      }
      errors.push(message);
    }
  }

  if (tryOpenAI) {
    try {
      const summary = await summarizeWithOpenAI(transcript);
      return NextResponse.json({
        summary,
        provider: 'openai',
        ...(errors.length ? { fallbackFrom: 'ollama' } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OpenAI要約に失敗しました。';
      console.error('openai summarize error:', err);
      errors.push(message);
      return NextResponse.json(
        {
          error:
            errors.length > 1
              ? `Ollama失敗 → OpenAIも失敗: ${errors.join(' / ')}`
              : message,
        },
        { status: message.includes('APIキー未設定') ? 503 : 502 }
      );
    }
  }

  return NextResponse.json(
    { error: errors[0] || '要約プロバイダがありません。' },
    { status: 503 }
  );
}
