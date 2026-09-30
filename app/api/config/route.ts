import { NextResponse } from 'next/server';
import { getWhisperLangConfig, langLabel } from '@/lib/whisper-lang';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { defaultLang, langs } = getWhisperLangConfig();
  return NextResponse.json({
    defaultLang,
    langs: langs.map((code) => ({ code, label: langLabel(code) })),
  });
}
