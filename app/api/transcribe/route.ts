import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { getWhisperLangConfig, resolveRequestLang } from '@/lib/whisper-lang';
import {
  getDiarizeConfig,
  parseDiarizedTranscript,
  stripTimestamps,
} from '@/lib/whisper-diarize';

export const runtime = 'nodejs';

function requireEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function runProcess(
  command: string,
  args: string[],
  label: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    proc.on('error', (err) => {
      reject(new Error(`${label} を起動できませんでした: ${err.message}`));
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `${label} が失敗しました (exit ${code})${stderr ? `: ${stderr.slice(0, 500)}` : ''}`
          )
        );
      }
    });
  });
}

export async function POST(req: Request) {
  const whisperBin = requireEnv('WHISPER_BIN');
  const whisperModel = requireEnv('WHISPER_MODEL');
  const ffmpegBin = requireEnv('FFMPEG_BIN') ?? 'ffmpeg';
  const tempDir = requireEnv('TEMP_DIR') ?? path.join(os.tmpdir(), 'minutes-temp');
  const langConfig = getWhisperLangConfig();
  const diarize = getDiarizeConfig(whisperModel ?? '');

  if (!whisperBin || !whisperModel) {
    return NextResponse.json(
      {
        error:
          'WHISPER_BIN と WHISPER_MODEL を .env.local に設定してください（.env.example 参照）。',
      },
      { status: 500 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'リクエストを読めませんでした。' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: '音声ファイルが見つかりません。' }, { status: 400 });
  }

  const requestedLang = formData.get('lang');
  const langField =
    typeof requestedLang === 'string'
      ? requestedLang
      : requestedLang == null
        ? null
        : String(requestedLang);

  const resolved = resolveRequestLang(langField, langConfig);
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }
  const whisperLang = resolved.lang;

  const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const webmPath = path.join(tempDir, `${id}.webm`);
  const wavPath = path.join(tempDir, `${id}.wav`);

  try {
    await fs.mkdir(tempDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length === 0) {
      return NextResponse.json({ error: '音声データが空です。' }, { status: 400 });
    }
    await fs.writeFile(webmPath, buffer);

    await runProcess(
      ffmpegBin,
      ['-y', '-i', webmPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath],
      'ffmpeg'
    );

    const baseArgs = ['-m', whisperModel, '-f', wavPath, '-l', whisperLang];
    const wantDiarizeArgs = diarize.enabled && diarize.args.length > 0;
    let diarizeWarning: string | null = diarize.setupHint;
    let usedDiarize = false;
    let stdout = '';

    if (wantDiarizeArgs) {
      try {
        const result = await runProcess(
          whisperBin,
          [...baseArgs, ...diarize.args],
          'whisper-cli'
        );
        stdout = result.stdout;
        usedDiarize = true;
      } catch (diarizeErr) {
        console.warn('diarize whisper failed; retrying without:', diarizeErr);
        const msg =
          diarizeErr instanceof Error ? diarizeErr.message : String(diarizeErr);
        diarizeWarning =
          (diarizeWarning ? diarizeWarning + ' ' : '') +
          `自動話者分けオプションが使えないため通常文字起こしにフォールバックしました。（${msg.slice(0, 180)}）`;
        const result = await runProcess(whisperBin, baseArgs, 'whisper-cli');
        stdout = result.stdout;
        usedDiarize = false;
      }
    } else {
      const result = await runProcess(whisperBin, baseArgs, 'whisper-cli');
      stdout = result.stdout;
    }

    const parsed = parseDiarizedTranscript(stdout);
    const plainText =
      parsed.plainText ||
      stripTimestamps(stdout)
        .replace(/\s*\[SPEAKER_TURN\]/gi, '')
        .replace(/\s*\[_SOLM_\]/gi, '')
        .trim();

    return NextResponse.json({
      text: plainText,
      lang: whisperLang,
      turns: parsed.turns,
      hasDiarizeMarks: parsed.hasDiarizeMarks,
      diarize: {
        requested: diarize.enabled,
        mode: diarize.mode,
        used: usedDiarize,
        warning: diarizeWarning,
      },
    });
  } catch (err) {
    console.error('transcribe error:', err);
    const message = err instanceof Error ? err.message : '文字起こしに失敗しました。';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await Promise.allSettled([fs.unlink(webmPath), fs.unlink(wavPath)]);
  }
}
