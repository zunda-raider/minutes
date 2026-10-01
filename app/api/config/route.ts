import { NextResponse } from 'next/server';
import { getWhisperLangConfig, langLabel } from '@/lib/whisper-lang';
import { getOllamaBaseUrl, getOllamaModel, resolveOllamaBin } from '@/lib/ollama';
import { getDiarizeConfig } from '@/lib/whisper-diarize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { defaultLang, langs } = getWhisperLangConfig();
  const whisperModel = process.env.WHISPER_MODEL?.trim() || '';
  const diarize = getDiarizeConfig(whisperModel);
  const provider = (process.env.TRANSLATE_PROVIDER?.trim() || 'auto').toLowerCase();
  const openaiConfigured = Boolean(
    process.env.OPENAI_API_KEY?.trim() || process.env.TRANSLATE_API_KEY?.trim()
  );
  const translateConfigured =
    provider === 'openai' ? openaiConfigured : true;

  return NextResponse.json({
    defaultLang,
    langs: langs.map((code) => ({ code, label: langLabel(code) })),
    translateConfigured,
    translateProvider:
      provider === 'openai' || provider === 'ollama' ? provider : 'auto',
    ollama: {
      baseUrl: getOllamaBaseUrl(),
      model: getOllamaModel(),
      bin: resolveOllamaBin(),
    },
    openaiConfigured,
    diarize: {
      enabled: diarize.enabled,
      mode: diarize.mode,
      modelLooksTdrz: diarize.modelLooksTdrz,
      speakerModelConfigured: Boolean(diarize.speakerModel),
      setupHint: diarize.setupHint,
      active: diarize.enabled && diarize.args.length > 0,
    },
  });
}
