/**
 * Home already cuts near HOME_SEGMENT_MS (~60s).
 * Whisper windows / pitch / diarize can emit many short turns inside one cut.
 * Fold them into one card so minutes stay ~1-minute blocks.
 * GD live keeps fine Whisper rows via transcribe-zoom.ts.
 */

export type HomeChunk = {
  text: string;
  speaker?: number;
};

export function coalesceHomeCaptureChunks(
  chunks: ReadonlyArray<HomeChunk>
): HomeChunk[] {
  const parts = chunks
    .map((chunk) => ({
      text: chunk.text.trim(),
      speaker: chunk.speaker,
    }))
    .filter((chunk) => chunk.text.length > 0);
  if (parts.length <= 1) return parts;

  const text = parts.map((part) => part.text).join('\n');
  const votes = new Map<number, number>();
  for (const part of parts) {
    if (part.speaker == null) continue;
    votes.set(part.speaker, (votes.get(part.speaker) ?? 0) + part.text.length);
  }
  let speaker: number | undefined;
  let best = 0;
  for (const [id, n] of votes) {
    if (n > best) {
      best = n;
      speaker = id;
    }
  }
  return [{ text, speaker }];
}
