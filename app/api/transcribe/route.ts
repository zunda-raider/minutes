import { NextResponse } from 'next/server';
import type { ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { getWhisperLangConfig, resolveRequestLang } from '@/lib/whisper-lang';
import {
  getDiarizeConfig,
  parseDiarizedTranscript,
  stripTimestamps,
} from '@/lib/whisper-diarize';
import { parseWhisperSegments } from '@/lib/diarize-parse';
import { resolveWhisperModelPath } from '@/lib/whisper-model';
import { ProcessAbortedError, killChildTree, runCancellableProcess } from '@/lib/spawn-cancellable';
import { registerTranscribeJob } from '@/lib/transcribe-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

const JOB_ID = /^[A-Za-z0-9-]{8,80}$/;

function abortedResponse() {
  return NextResponse.json({ error: 'aborted', aborted: true }, { status: 499 });
}

export async function POST(req: Request) {
  const whisperBin = requireEnv('WHISPER_BIN');
  const ffmpegBin = requireEnv('FFMPEG_BIN') ?? 'ffmpeg';
  const tempDir = requireEnv('TEMP_DIR') ?? path.join(os.tmpdir(), 'minutes-temp');
  const langConfig = getWhisperLangConfig();

  if (!whisperBin) {
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

  const requestedModel = formData.get('modelKey');
  const modelKeyField =
    typeof requestedModel === 'string'
      ? requestedModel
      : requestedModel == null
        ? new URL(req.url).searchParams.get('modelKey')
        : String(requestedModel);
  const picked = resolveWhisperModelPath(modelKeyField);
  const whisperModel = picked.path;
  const diarize = getDiarizeConfig(whisperModel ?? '');

  if (!whisperModel) {
    return NextResponse.json(
      {
        error:
          'WHISPER_BIN と WHISPER_MODEL を .env.local に設定してください（.env.example 参照）。',
      },
      { status: 500 }
    );
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

  const rawJobId = formData.get('jobId');
  const jobId = typeof rawJobId === 'string' && JOB_ID.test(rawJobId) ? rawJobId : '';

  const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const webmPath = path.join(tempDir, `${id}.webm`);
  const wavPath = path.join(tempDir, `${id}.wav`);

  const active = new Set<ChildProcess>();
  let stopped = req.signal.aborted;
  const stopChildren = () => {
    stopped = true;
    for (const proc of active) killChildTree(proc);
  };
  const onRequestAbort = () => stopChildren();
  req.signal.addEventListener('abort', onRequestAbort);
  const unregisterJob = jobId ? registerTranscribeJob(jobId, stopChildren) : () => {};

  const run = (command: string, args: string[], label: string) =>
    runCancellableProcess(command, args, label, {
      signal: req.signal,
      shouldStop: () => stopped,
      onSpawn: (proc) => {
        active.add(proc);
        proc.on('close', () => active.delete(proc));
        if (stopped) killChildTree(proc);
      },
    });

  try {
    if (stopped) return abortedResponse();
    await fs.mkdir(tempDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length === 0) {
      return NextResponse.json({ error: '音声データが空です。' }, { status: 400 });
    }
    await fs.writeFile(webmPath, buffer);

    await run(
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
        const result = await run(
          whisperBin,
          [...baseArgs, ...diarize.args],
          'whisper-cli'
        );
        stdout = result.stdout;
        usedDiarize = true;
      } catch (diarizeErr) {
        if (stopped || req.signal.aborted || diarizeErr instanceof ProcessAbortedError) {
          throw diarizeErr;
        }
        console.warn('diarize whisper failed; retrying without:', diarizeErr);
        const msg =
          diarizeErr instanceof Error ? diarizeErr.message : String(diarizeErr);
        diarizeWarning =
          (diarizeWarning ? diarizeWarning + ' ' : '') +
          `自動話者分けオプションが使えないため通常文字起こしにフォールバックしました。（${msg.slice(0, 180)}）`;
        const result = await run(whisperBin, baseArgs, 'whisper-cli');
        stdout = result.stdout;
        usedDiarize = false;
      }
    } else {
      const result = await run(whisperBin, baseArgs, 'whisper-cli');
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
      model: {
        key: picked.key,
        label: picked.label,
        fallback: picked.fallback,
      },
      turns: parsed.turns,
      segments: parseWhisperSegments(stdout),
      hasDiarizeMarks: parsed.hasDiarizeMarks,
      diarize: {
        requested: diarize.enabled,
        mode: diarize.mode,
        used: usedDiarize,
        warning: diarizeWarning,
      },
    });
  } catch (err) {
    if (stopped || req.signal.aborted || err instanceof ProcessAbortedError) {
      console.info('transcribe aborted; killed ffmpeg/whisper-cli');
      return abortedResponse();
    }
    console.error('transcribe error:', err);
    const message = err instanceof Error ? err.message : '文字起こしに失敗しました。';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    req.signal.removeEventListener('abort', onRequestAbort);
    unregisterJob();
    stopChildren();
    await Promise.allSettled([fs.unlink(webmPath), fs.unlink(wavPath)]);
  }
}
