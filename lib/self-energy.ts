import { trackAudioContext } from '@/lib/capture-resources';

/**
 * Zoom/system mode only: compare a parallel mic stream against system audio
 * to tag 自分 (A) vs それ以外 (C). Mic-only recording must not call this.
 *
 * RMS is computed on decoded float PCM (full scale ≈ 1) inside each
 * transcribed time window. Quiet windows stay unset.
 */

/** Speaker A — 自分. */
export const SELF_SPEAKER_ID = 1;
/** Speaker C — それ以外. */
export const OTHER_SPEAKER_ID = 3;

/** Channels under this RMS are treated as silent. */
export const QUIET_RMS = 0.012;
/**
 * Mic must be at least this multiple of the system RMS (and above the floor)
 * to count as 自分.
 */
export const MIC_DOMINANT_RATIO = 1.35;
/**
 * System must be at least this multiple of the mic RMS to count as それ以外
 * when the mic is not already quiet.
 */
export const SYSTEM_DOMINANT_RATIO = 1.35;

export type EnergyLabel = 'self' | 'other' | 'unset';

export type EnergyWindow = {
  text: string;
  startSec: number;
  endSec: number;
};

export function classifyMicVsSystem(micRms: number, systemRms: number): EnergyLabel {
  const mic = Number.isFinite(micRms) ? Math.max(0, micRms) : 0;
  const sys = Number.isFinite(systemRms) ? Math.max(0, systemRms) : 0;
  const micLoud = mic >= QUIET_RMS;
  const sysLoud = sys >= QUIET_RMS;
  if (!micLoud && !sysLoud) return 'unset';
  if (micLoud && mic >= sys * MIC_DOMINANT_RATIO) return 'self';
  if (sysLoud && !micLoud) return 'other';
  if (sysLoud && sys >= mic * SYSTEM_DOMINANT_RATIO) return 'other';
  return 'unset';
}

export function speakerIdForEnergy(label: EnergyLabel): number | undefined {
  if (label === 'self') return SELF_SPEAKER_ID;
  if (label === 'other') return OTHER_SPEAKER_ID;
  return undefined;
}

export function rmsRange(
  samples: Float32Array,
  sampleRate: number,
  startSec: number,
  endSec: number
): number {
  if (sampleRate <= 0 || samples.length === 0) return 0;
  const duration = samples.length / sampleRate;
  const start = Math.max(0, Math.floor(Math.max(0, startSec) * sampleRate));
  const endLimit = Number.isFinite(endSec) ? endSec : duration;
  let end = Math.ceil(endLimit * sampleRate);
  end = Math.min(samples.length, Math.max(start, end));
  const n = end - start;
  if (n <= 0) return 0;
  let acc = 0;
  for (let i = start; i < end; i++) {
    const s = samples[i]!;
    acc += s * s;
  }
  return Math.sqrt(acc / n);
}

export async function decodeMonoPcm(
  blob: Blob
): Promise<{ samples: Float32Array; sampleRate: number } | null> {
  if (typeof AudioContext === 'undefined') return null;
  const ctx = trackAudioContext(new AudioContext());
  try {
    const buf = await blob.arrayBuffer();
    const audio = await ctx.decodeAudioData(buf.slice(0));
    const frames = audio.length;
    if (frames === 0) return null;
    if (audio.numberOfChannels === 1) {
      return {
        samples: new Float32Array(audio.getChannelData(0)),
        sampleRate: audio.sampleRate,
      };
    }
    const mixed = new Float32Array(frames);
    const scale = 1 / audio.numberOfChannels;
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const ch = audio.getChannelData(c);
      for (let i = 0; i < frames; i++) mixed[i] += ch[i]! * scale;
    }
    return { samples: mixed, sampleRate: audio.sampleRate };
  } catch (err) {
    console.warn('decodeMonoPcm failed:', err);
    return null;
  } finally {
    await ctx.close().catch(() => {});
  }
}

/**
 * Tag each transcript window. Decode failure leaves speakers unset
 * (no auto-自分) rather than guessing.
 */
export async function speakersFromMicEnergy(
  systemBlob: Blob,
  micBlob: Blob,
  windows: EnergyWindow[]
): Promise<Array<{ text: string; speakerId?: number }>> {
  const [systemPcm, micPcm] = await Promise.all([
    decodeMonoPcm(systemBlob),
    decodeMonoPcm(micBlob),
  ]);
  if (!systemPcm || !micPcm) {
    return windows.map((w) => ({ text: w.text }));
  }
  const systemDuration = systemPcm.samples.length / systemPcm.sampleRate;
  return windows.map((w) => {
    const end = Number.isFinite(w.endSec) ? w.endSec : systemDuration;
    const label = classifyMicVsSystem(
      rmsRange(micPcm.samples, micPcm.sampleRate, w.startSec, end),
      rmsRange(systemPcm.samples, systemPcm.sampleRate, w.startSec, end)
    );
    return { text: w.text, speakerId: speakerIdForEnergy(label) };
  });
}
