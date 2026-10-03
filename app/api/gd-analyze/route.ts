import { NextResponse } from 'next/server';
import {
  buildGdSystemPrompt,
  buildGdUserContent,
  contentToAnalysis,
  formatGdNote,
  type GdSpeaker,
  type GdUtteranceInput,
} from '@/lib/gd-analyze';
import {
  ensureOllamaRunning,
  getOllamaBaseUrl,
  getOllamaModel,
} from '@/lib/ollama';

export const runtime = 'nodejs';

function asSpeaker(value: unknown): GdSpeaker {
  return value === '自分' ? '自分' : '他者';
}

function readUtterances(value: unknown): GdUtteranceInput[] | null {
  if (!Array.isArray(value)) return null;
  const out: GdUtteranceInput[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const note =
      typeof rec.note === 'number'
        ? rec.note
        : typeof rec.note === 'string'
          ? Number(rec.note)
          : NaN;
    if (!Number.isFinite(note)) continue;
    const key = formatGdNote(note);
    if (seen.has(key)) continue;
    seen.add(key);
    const text = typeof rec.text === 'string' ? rec.text : '';
    out.push({ note, text, speaker: asSpeaker(rec.speaker) });
  }
  return out;
}

async function analyzeWithOllama(
  utterances: GdUtteranceInput[],
  genre?: string
): Promise<string> {
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
        format: 'json',
        options: { temperature: 0.2 },
        messages: [
          { role: 'system', content: buildGdSystemPrompt(genre) },
          { role: 'user', content: buildGdUserContent(utterances, genre) },
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
    message?: { content?: unknown };
  };

  if (!res.ok) {
    throw new Error(
      data.error ||
        `Ollama API error (${res.status}). \`ollama pull ${model}\` を試してください。`
    );
  }

  const content = data.message?.content;
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object') return JSON.stringify(content);
  return '';
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON を読めませんでした。' }, { status: 400 });
  }

  const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const utterances = readUtterances(rec?.utterances);
  if (!utterances || utterances.length === 0) {
    return NextResponse.json(
      { error: '分析する発言がありません。' },
      { status: 400 }
    );
  }

  const genre =
    typeof rec?.genre === 'string'
      ? rec.genre.trim()
      : typeof rec?.context === 'string'
        ? rec.context.trim()
        : '';

  try {
    const raw = await analyzeWithOllama(utterances, genre || undefined);
    const analysis = contentToAnalysis(
      raw,
      utterances.map((u) => u.note)
    );
    return NextResponse.json(analysis);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'GD分析に失敗しました。';
    console.error('gd-analyze error:', err);
    const status = message.includes('接続できません') || message.includes('Ollama') ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
