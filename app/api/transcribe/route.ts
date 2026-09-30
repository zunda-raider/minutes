import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

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

function stripTimestamps(raw: string): string {
  return raw
    .replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g, '')
    .trim();
}

export async function POST(req: Request) {
  const whisperBin = requireEnv('WHISPER_BIN');
  const whisperModel = requireEnv('WHISPER_MODEL');
  const ffmpegBin = requireEnv('FFMPEG_BIN') ?? 'ffmpeg';
  const tempDir = requireEnv('TEMP_DIR') ?? path.join(os.tmpdir(), 'minutes-temp');
  const whisperLang = requireEnv('WHISPER_LANG') ?? 'ja';

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

    const { stdout } = await runProcess(
      whisperBin,
      ['-m', whisperModel, '-f', wavPath, '-l', whisperLang],
      'whisper-cli'
    );

    // Prefer plain text; -nt should omit timestamps, but strip anyway if present
    const plainText = stripTimestamps(stdout);

    return NextResponse.json({ text: plainText });
  } catch (err) {
    console.error('transcribe error:', err);
    const message = err instanceof Error ? err.message : '文字起こしに失敗しました。';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await Promise.allSettled([fs.unlink(webmPath), fs.unlink(wavPath)]);
  }
}
