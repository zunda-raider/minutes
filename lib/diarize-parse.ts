/**
 * Client + server safe parsing of whisper.cpp diarization markers.
 */

export type DiarizeTurn = {
  /** 1-based speaker index */
  speaker: number;
  text: string;
};

/** Strip [hh:mm:ss.mmm --> …] prefixes whisper-cli prints. */
export function stripTimestamps(raw: string): string {
  return raw
    .replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g, '')
    .trim();
}

/**
 * Parse tinydiarize [SPEAKER_TURN] and (speaker N) style tags into turns.
 */
export function parseDiarizedTranscript(raw: string): {
  plainText: string;
  turns: DiarizeTurn[];
  hasDiarizeMarks: boolean;
} {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const turns: DiarizeTurn[] = [];
  let speaker = 1;
  let hasDiarizeMarks = false;
  const textParts: string[] = [];

  for (const line of lines) {
    if (
      /^(whisper_|main:|system_info:|ggml_|cpu_get_|error:)/i.test(line) ||
      /^whisper_init/i.test(line)
    ) {
      continue;
    }

    let body = stripTimestamps(line);
    if (!body) continue;

    const speakerMatch = body.match(
      /^\(?\s*speaker\s*[#:]?\s*(\d+|\?)\s*\)?\s*[:：-]?\s*/i
    );
    if (speakerMatch) {
      hasDiarizeMarks = true;
      const n = speakerMatch[1];
      if (n && n !== '?') {
        const parsed = parseInt(n, 10);
        speaker = parsed === 0 ? 1 : Math.max(1, parsed);
      }
      body = body.slice(speakerMatch[0].length).trim();
    }

    const labeled = body.match(/^speaker\s*(\d+)\s*[:：]\s*/i);
    if (labeled) {
      hasDiarizeMarks = true;
      speaker = Math.max(1, parseInt(labeled[1]!, 10));
      body = body.slice(labeled[0].length).trim();
    }

    const turnToken =
      /\s*\[SPEAKER_TURN\]\s*$/i.test(body) || /\s*\[_SOLM_\]\s*$/i.test(body);
    if (turnToken) {
      hasDiarizeMarks = true;
      body = body.replace(/\s*\[(?:SPEAKER_TURN|_SOLM_)\]\s*$/i, '').trim();
    }

    if (body) {
      turns.push({ speaker, text: body });
      textParts.push(body);
    }

    if (turnToken) {
      speaker = speaker === 1 ? 2 : 1;
    }
  }

  const plainText =
    textParts.length > 0
      ? textParts.join('\n')
      : stripTimestamps(raw)
          .replace(/\s*\[SPEAKER_TURN\]/gi, '')
          .replace(/\s*\[_SOLM_\]/gi, '')
          .trim();

  return { plainText, turns, hasDiarizeMarks };
}

/**
 * Remap chunk-local speakers so the first turn continues from `continueFrom`.
 */
export function remapSpeakersContinuity(
  turns: DiarizeTurn[],
  continueFrom: number | null
): { turns: DiarizeTurn[]; lastSpeaker: number | null } {
  if (turns.length === 0) {
    return { turns, lastSpeaker: continueFrom };
  }

  const map = new Map<number, number>();
  let nextId = 1;
  const used = new Set<number>();

  if (continueFrom && continueFrom > 0) {
    map.set(turns[0]!.speaker, continueFrom);
    used.add(continueFrom);
    nextId = Math.max(nextId, continueFrom + 1);
  }

  const out: DiarizeTurn[] = turns.map((t) => {
    let global = map.get(t.speaker);
    if (global == null) {
      if (
        continueFrom &&
        map.size === 1 &&
        (continueFrom === 1 || continueFrom === 2)
      ) {
        global = continueFrom === 1 ? 2 : 1;
      } else {
        while (used.has(nextId)) nextId += 1;
        global = nextId;
        nextId += 1;
      }
      map.set(t.speaker, global);
      used.add(global);
    }
    return { speaker: global, text: t.text };
  });

  return {
    turns: out,
    lastSpeaker: out[out.length - 1]?.speaker ?? continueFrom,
  };
}
