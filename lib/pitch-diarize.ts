/**
 * Crude client-side pitch / voice-height heuristics for provisional speaker labels
 * when whisper.cpp tinydiarize is unavailable.
 */

import { trackAudioContext } from '@/lib/capture-resources';
import { MAX_SPEAKERS } from '@/lib/speaker-letters';

export type PitchCentroid = {
  speakerId: number;
  pitchHz: number;
  count: number;
};

const MIN_HZ = 70;
const MAX_HZ = 400;
const WINDOW_SEC = 1.2;
const ASSIGN_LOG_THRESHOLD = 0.18; // ~ relative pitch distance

function autocorrelationPitch(
  samples: Float32Array,
  sampleRate: number
): number | null {
  if (samples.length < sampleRate * 0.03) return null;

  // Energy / RMS gate
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i]! * samples[i]!;
  const rms = Math.sqrt(energy / samples.length);
  if (rms < 0.01) return null;

  const minLag = Math.floor(sampleRate / MAX_HZ);
  const maxLag = Math.min(Math.floor(sampleRate / MIN_HZ), samples.length - 1);
  if (maxLag <= minLag + 2) return null;

  let bestLag = -1;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let normA = 0;
    let normB = 0;
    const n = samples.length - lag;
    for (let i = 0; i < n; i++) {
      const a = samples[i]!;
      const b = samples[i + lag]!;
      corr += a * b;
      normA += a * a;
      normB += b * b;
    }
    const denom = Math.sqrt(normA * normB) || 1;
    const c = corr / denom;
    if (c > bestCorr) {
      bestCorr = c;
      bestLag = lag;
    }
  }

  if (bestLag < 0 || bestCorr < 0.35) return null;
  const hz = sampleRate / bestLag;
  if (hz < MIN_HZ || hz > MAX_HZ) return null;
  return hz;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export type PitchAnalysis = {
  medianHz: number | null;
  windowPitches: Array<number | null>;
  /** true when windows look bimodal / highly variable */
  likelyMultiSpeaker: boolean;
};

export async function analyzeBlobPitch(blob: Blob): Promise<PitchAnalysis> {
  const empty: PitchAnalysis = {
    medianHz: null,
    windowPitches: [],
    likelyMultiSpeaker: false,
  };
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
    return empty;
  }

  try {
    const ctx = trackAudioContext(new AudioContext());
    try {
      const buf = await blob.arrayBuffer();
      const audio = await ctx.decodeAudioData(buf.slice(0));
      const channel = audio.getChannelData(0);
      const sr = audio.sampleRate;
      const win = Math.max(256, Math.floor(sr * WINDOW_SEC));
      const hop = Math.floor(win * 0.75);
      const windowPitches: Array<number | null> = [];

      for (let start = 0; start + win <= channel.length; start += hop) {
        const slice = channel.subarray(start, start + win);
        // Downsample ~4x for speed
        const step = Math.max(1, Math.floor(sr / 8000));
        const ds = new Float32Array(Math.floor(slice.length / step));
        for (let i = 0, j = 0; j < ds.length; i += step, j++) {
          ds[j] = slice[i]!;
        }
        windowPitches.push(autocorrelationPitch(ds, sr / step));
      }

      const voiced = windowPitches.filter((p): p is number => p != null);
      const med = median(voiced);
      let likelyMultiSpeaker = false;
      if (voiced.length >= 4 && med != null) {
        const low = voiced.filter((p) => p < med);
        const high = voiced.filter((p) => p >= med);
        if (low.length >= 2 && high.length >= 2) {
          const lowMed = median(low)!;
          const highMed = median(high)!;
          likelyMultiSpeaker =
            Math.abs(Math.log(highMed) - Math.log(lowMed)) > ASSIGN_LOG_THRESHOLD;
        }
      }

      return { medianHz: med, windowPitches, likelyMultiSpeaker };
    } finally {
      await ctx.close().catch(() => undefined);
    }
  } catch (err) {
    console.warn('pitch analysis failed:', err);
    return empty;
  }
}

function logDistance(a: number, b: number): number {
  return Math.abs(Math.log(a) - Math.log(b));
}

/** Assign a pitch to nearest centroid or open a new A–G slot. */
export function assignSpeakerByPitch(
  pitchHz: number,
  centroids: PitchCentroid[]
): { speakerId: number; centroids: PitchCentroid[] } {
  const next = centroids.map((c) => ({ ...c }));
  if (next.length === 0) {
    next.push({ speakerId: 1, pitchHz, count: 1 });
    return { speakerId: 1, centroids: next };
  }

  let best = next[0]!;
  let bestDist = logDistance(pitchHz, best.pitchHz);
  for (let i = 1; i < next.length; i++) {
    const c = next[i]!;
    const d = logDistance(pitchHz, c.pitchHz);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }

  if (bestDist <= ASSIGN_LOG_THRESHOLD || next.length >= MAX_SPEAKERS) {
    const idx = next.findIndex((c) => c.speakerId === best.speakerId);
    const cur = next[idx]!;
    const count = cur.count + 1;
    next[idx] = {
      ...cur,
      count,
      pitchHz: (cur.pitchHz * cur.count + pitchHz) / count,
    };
    return { speakerId: cur.speakerId, centroids: next };
  }

  const used = new Set(next.map((c) => c.speakerId));
  let speakerId = 1;
  while (used.has(speakerId) && speakerId <= MAX_SPEAKERS) speakerId += 1;
  next.push({ speakerId, pitchHz, count: 1 });
  return { speakerId, centroids: next };
}

/**
 * When windows look multi-speaker, split text into two provisional turns (A/B-ish)
 * by first/second half pitch.
 */
export function provisionalTurnsFromPitch(
  text: string,
  analysis: PitchAnalysis,
  centroids: PitchCentroid[]
): { turns: Array<{ speaker: number; text: string }>; centroids: PitchCentroid[] } {
  const trimmed = text.trim();
  if (!trimmed) return { turns: [], centroids };

  if (
    !analysis.likelyMultiSpeaker ||
    analysis.medianHz == null ||
    analysis.windowPitches.filter((p) => p != null).length < 4
  ) {
    if (analysis.medianHz == null) {
      return {
        turns: [{ speaker: 1, text: trimmed }],
        centroids,
      };
    }
    const assigned = assignSpeakerByPitch(analysis.medianHz, centroids);
    return {
      turns: [{ speaker: assigned.speakerId, text: trimmed }],
      centroids: assigned.centroids,
    };
  }

  const voicedIdx = analysis.windowPitches
    .map((p, i) => (p != null ? i : -1))
    .filter((i) => i >= 0);
  const midWin = voicedIdx[Math.floor(voicedIdx.length / 2)] ?? 0;
  const first = analysis.windowPitches
    .slice(0, midWin + 1)
    .filter((p): p is number => p != null);
  const second = analysis.windowPitches
    .slice(midWin + 1)
    .filter((p): p is number => p != null);
  const firstMed = median(first) ?? analysis.medianHz;
  const secondMed = median(second) ?? analysis.medianHz;

  let cents = centroids;
  const a = assignSpeakerByPitch(firstMed, cents);
  cents = a.centroids;
  const b = assignSpeakerByPitch(secondMed, cents);
  cents = b.centroids;

  // Split text near midpoint on sentence / whitespace boundary
  const mid = Math.floor(trimmed.length / 2);
  let split = mid;
  const window = trimmed.slice(Math.max(0, mid - 40), Math.min(trimmed.length, mid + 40));
  const local = window.search(/[。．！？!?\n]/);
  if (local >= 0) {
    split = Math.max(0, mid - 40) + local + 1;
  } else {
    const sp = trimmed.lastIndexOf(' ', mid);
    if (sp > mid * 0.3) split = sp + 1;
  }

  const left = trimmed.slice(0, split).trim();
  const right = trimmed.slice(split).trim();
  const turns: Array<{ speaker: number; text: string }> = [];
  if (left) turns.push({ speaker: a.speakerId, text: left });
  if (right) turns.push({ speaker: b.speakerId, text: right });
  if (turns.length === 0) turns.push({ speaker: a.speakerId, text: trimmed });
  return { turns, centroids: cents };
}
