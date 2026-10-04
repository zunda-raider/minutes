import type { WhisperSegment } from '@/lib/diarize-parse';
import type { LiveSpeaker } from '@/lib/gd-live-demo';
import { SELF_SPEAKER_ID, speakersFromMicEnergy } from '@/lib/self-energy';

export type ZoomUtterance = {
  /** Seconds from the start of this audio chunk. */
  startSec: number;
  endSec: number;
  speaker: LiveSpeaker;
  text: string;
};

type TranscribePayload = {
  text?: string;
  error?: string;
  segments?: WhisperSegment[];
  diarize?: { warning?: string | null };
};

/**
 * Send one Zoom/system chunk to local Whisper and tag 自分 from the parallel mic.
 * Segments without a clear self-mic stay on 他者 (left lane).
 */
export async function transcribeZoomChunk(
  systemBlob: Blob,
  micBlob: Blob | null,
  lang = 'ja'
): Promise<ZoomUtterance[]> {
  const formData = new FormData();
  formData.append(
    'file',
    new File([systemBlob], 'audio.webm', { type: systemBlob.type || 'audio/webm' })
  );
  formData.append('lang', lang);

  const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
  let data: TranscribePayload;
  try {
    data = (await res.json()) as TranscribePayload;
  } catch {
    throw new Error('サーバー応答を読めませんでした。');
  }
  if (!res.ok) {
    throw new Error(data.error || `文字起こしに失敗しました (${res.status})`);
  }

  const text = data.text?.trim() ?? '';
  const segments: WhisperSegment[] =
    data.segments && data.segments.length > 0
      ? data.segments
      : text
        ? [{ text, startSec: 0, endSec: Number.POSITIVE_INFINITY }]
        : [];
  if (segments.length === 0) return [];

  let tagged: Array<{ text: string; speakerId?: number }>;
  if (micBlob && micBlob.size > 0) {
    try {
      tagged = await speakersFromMicEnergy(systemBlob, micBlob, segments);
    } catch (err) {
      console.warn('mic energy self-tag failed:', err);
      tagged = segments.map((segment) => ({ text: segment.text }));
    }
  } else {
    tagged = segments.map((segment) => ({ text: segment.text }));
  }

  const utterances: ZoomUtterance[] = [];
  tagged.forEach((row, index) => {
    const body = row.text.trim();
    if (!body) return;
    const segment = segments[index]!;
    const end = Number.isFinite(segment.endSec) ? segment.endSec : segment.startSec;
    utterances.push({
      startSec: segment.startSec,
      endSec: end,
      speaker: row.speakerId === SELF_SPEAKER_ID ? '自分' : '他者',
      text: body,
    });
  });
  return utterances;
}
