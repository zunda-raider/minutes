import { NextResponse } from 'next/server';
import {
  ensureOllamaRunning,
  getOllamaBaseUrl,
  getOllamaModel,
} from '@/lib/ollama';
import {
  buildOrganizePrompt,
  coerceOrganize,
  idsOf,
  logicTreeHasContent,
  sanitizeLogicTree,
  tailTranscript,
} from '@/lib/gd-organize';

export const runtime = 'nodejs';
export const maxDuration = 120;

const TRANSCRIPT_CAP = 4000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSONを読めませんでした。' }, { status: 400 });
  }

  const rec = asRecord(body);
  if (!rec) {
    return NextResponse.json({ error: 'リクエストの形が違います。' }, { status: 400 });
  }

  const theme = typeof rec.theme === 'string' ? rec.theme : '';
  const transcript = tailTranscript(
    typeof rec.transcript === 'string' ? rec.transcript : '',
    TRANSCRIPT_CAP
  );
  const tree = sanitizeLogicTree(rec.tree);
  if (!transcript && !logicTreeHasContent(tree)) {
    return NextResponse.json(
      { error: '文字起こしか、名前の入った大論点を入れてから整理できます。' },
      { status: 400 }
    );
  }

  const baseUrl = getOllamaBaseUrl();
  const model = getOllamaModel();
  try {
    await ensureOllamaRunning(baseUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ollamaを起動できませんでした。';
    return NextResponse.json({ error: message }, { status: 503 });
  }

  const prompt = buildOrganizePrompt({ theme, transcript, tree });
  const timeout = AbortSignal.timeout(75_000);
  const signal = AbortSignal.any([req.signal, timeout]);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        options: { temperature: 0.2, num_predict: 480, num_ctx: 8192 },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'AbortError') {
      return NextResponse.json({ error: '論点整理を中止しました。' }, { status: 499 });
    }
    if (name === 'TimeoutError') {
      return NextResponse.json(
        { error: 'Ollamaの応答が時間内に返りませんでした。もう一度試してください。' },
        { status: 504 }
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Ollamaに接続できません（${baseUrl}）。\`ollama serve\` を確認してください。 (${detail})` },
      { status: 503 }
    );
  }

  let data: { error?: string; message?: { content?: string } };
  try {
    data = (await res.json()) as { error?: string; message?: { content?: string } };
  } catch {
    return NextResponse.json({ error: 'Ollamaの応答を読めませんでした。' }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json(
      {
        error:
          data.error ||
          `Ollama API error (${res.status}). \`ollama pull ${model}\` を試してください。`,
      },
      { status: 502 }
    );
  }

  const content = data.message?.content?.trim() ?? '';
  if (!content) {
    return NextResponse.json({ error: 'Ollamaの整理結果が空でした。' }, { status: 502 });
  }

  const organized = coerceOrganize(content, idsOf(tree));
  return NextResponse.json(organized);
}
