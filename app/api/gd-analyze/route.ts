import { NextResponse } from 'next/server';
import {
  ensureOllamaRunning,
  getOllamaBaseUrl,
  getOllamaModel,
} from '@/lib/ollama';
import { buildGdScorePrompt, coerceGdSelfEval, placeholderEval } from '@/lib/gd-score';

export const runtime = 'nodejs';
export const maxDuration = 120;

/** One end-of-session eval. Live 論点整理 stays on /api/gd-organize. */
const TRANSCRIPT_CAP = 48_000;

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
  const genre = typeof rec.genre === 'string' ? rec.genre : '';
  let transcript = typeof rec.transcript === 'string' ? rec.transcript.trim() : '';
  let clipped = false;
  if (transcript.length > TRANSCRIPT_CAP) {
    transcript = transcript.slice(transcript.length - TRANSCRIPT_CAP);
    clipped = true;
  }
  if (!transcript) {
    return NextResponse.json(
      placeholderEval('文字起こしが空なので、評価は仮表示です。')
    );
  }

  const baseUrl = getOllamaBaseUrl();
  const model = getOllamaModel();
  try {
    await ensureOllamaRunning(baseUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ollamaを起動できませんでした。';
    return NextResponse.json(placeholderEval(message));
  }

  const prompt = buildGdScorePrompt({
    theme,
    genre,
    transcript: clipped ? `（長いため先頭を省略）\n${transcript}` : transcript,
  });
  const timeout = AbortSignal.timeout(90_000);
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
        options: { temperature: 0.2, num_predict: 900, num_ctx: 16384 },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'AbortError') {
      return NextResponse.json({ error: '評価を中止しました。' }, { status: 499 });
    }
    if (name === 'TimeoutError') {
      return NextResponse.json(
        placeholderEval('Ollamaの応答が時間内に返りませんでした。')
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      placeholderEval(`Ollamaに接続できません（${baseUrl}）。${detail}`)
    );
  }

  let data: { error?: string; message?: { content?: string } };
  try {
    data = (await res.json()) as { error?: string; message?: { content?: string } };
  } catch {
    return NextResponse.json(placeholderEval('Ollamaの応答を読めませんでした。'));
  }
  if (!res.ok) {
    return NextResponse.json(
      placeholderEval(data.error || `Ollama API error (${res.status})。\`ollama pull ${model}\` を試してください。`)
    );
  }
  const content = data.message?.content?.trim() ?? '';
  if (!content) {
    return NextResponse.json(placeholderEval('Ollamaの評価が空でした。'));
  }
  const evalResult = coerceGdSelfEval(content);
  if (clipped && evalResult.warning) {
    evalResult.warning = `文字起こしの先頭を省略しました。${evalResult.warning}`;
  } else if (clipped) {
    evalResult.warning = '文字起こしが長いため、先頭を省略して評価しました。';
  }
  return NextResponse.json(evalResult);
}
