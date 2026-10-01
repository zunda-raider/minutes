import { NextResponse } from 'next/server';
import { getWhisperLangConfig, langLabel } from '@/lib/whisper-lang';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { defaultLang, langs } = getWhisperLangConfig();
  const ollamaBase =
    process.env.OLLAMA_BASE_URL?.trim() || 'http://127.0.0.1:11434';
  const ollamaModel = process.env.OLLAMA_MODEL?.trim() || 'llama3.2';
  const provider = (process.env.TRANSLATE_PROVIDER?.trim() || 'auto').toLowerCase();
  const openaiConfigured = Boolean(
    process.env.OPENAI_API_KEY?.trim() || process.env.TRANSLATE_API_KEY?.trim()
  );
  // Ollama is local-default; treat as "configured" for UI (runtime may still be down)
  const translateConfigured =
    provider === 'openai' ? openaiConfigured : true;

  return NextResponse.json({
    defaultLang,
    langs: langs.map((code) => ({ code, label: langLabel(code) })),
    translateConfigured,
    translateProvider: provider === 'openai' || provider === 'ollama' ? provider : 'auto',
    ollama: {
      baseUrl: ollamaBase.replace(/\/$/, ''),
      model: ollamaModel,
    },
    openaiConfigured,
  });
}
