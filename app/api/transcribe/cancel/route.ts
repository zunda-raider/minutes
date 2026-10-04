import { NextResponse } from 'next/server';
import { cancelTranscribeJob } from '@/lib/transcribe-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JOB_ID = /^[A-Za-z0-9-]{8,80}$/;

/** Hard stop. Kills ffmpeg / whisper-cli for this upload even if the POST is still running. */
export async function POST(req: Request) {
  let jobId = '';
  try {
    const body = (await req.json()) as { jobId?: unknown };
    jobId = typeof body.jobId === 'string' ? body.jobId : '';
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  if (!JOB_ID.test(jobId)) {
    return NextResponse.json({ error: 'jobId required' }, { status: 400 });
  }
  const killed = cancelTranscribeJob(jobId);
  return NextResponse.json({ ok: true, killed });
}
