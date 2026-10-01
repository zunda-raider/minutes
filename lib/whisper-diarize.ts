/**
 * whisper.cpp speaker diarization helpers (tinydiarize / embedding / extra args).
 */

export type DiarizeMode = 'off' | 'tdrz' | 'embedding' | 'extra';

export type DiarizeConfig = {
  enabled: boolean;
  mode: DiarizeMode;
  /** Extra CLI args when mode is tdrz / embedding / extra */
  args: string[];
  speakerModel: string | null;
  modelLooksTdrz: boolean;
  /** Human-readable setup hint (JP) when enabled but incomplete */
  setupHint: string | null;
};

export type { DiarizeTurn } from '@/lib/diarize-parse';
export {
  stripTimestamps,
  parseDiarizedTranscript,
  remapSpeakersContinuity,
} from '@/lib/diarize-parse';

function truthyEnv(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function splitArgs(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw.trim().split(/\s+/).filter(Boolean);
}

export function modelPathLooksTdrz(modelPath: string): boolean {
  return /tdrz/i.test(modelPath);
}

export function getDiarizeConfig(modelPath: string): DiarizeConfig {
  const enabled = truthyEnv('WHISPER_DIARIZE');
  const speakerModel = process.env.WHISPER_SPEAKER_MODEL?.trim() || null;
  const extra = splitArgs(process.env.WHISPER_DIARIZE_ARGS);
  const forced = (process.env.WHISPER_DIARIZE_MODE?.trim() || '').toLowerCase();
  const modelLooksTdrz = modelPathLooksTdrz(modelPath);

  if (!enabled) {
    return {
      enabled: false,
      mode: 'off',
      args: [],
      speakerModel,
      modelLooksTdrz,
      setupHint: null,
    };
  }

  if (
    forced === 'extra' ||
    (forced === '' && extra.length > 0 && !modelLooksTdrz && !speakerModel)
  ) {
    if (extra.length === 0 && forced === 'extra') {
      return {
        enabled: true,
        mode: 'extra',
        args: [],
        speakerModel,
        modelLooksTdrz,
        setupHint:
          'WHISPER_DIARIZE_MODE=extra のときは WHISPER_DIARIZE_ARGS に whisper-cli 追加引数を指定してください。',
      };
    }
    if (extra.length > 0) {
      return {
        enabled: true,
        mode: 'extra',
        args: extra,
        speakerModel,
        modelLooksTdrz,
        setupHint: null,
      };
    }
  }

  if (forced === 'tdrz' || (forced === '' && modelLooksTdrz)) {
    return {
      enabled: true,
      mode: 'tdrz',
      args: ['-tdrz', ...extra],
      speakerModel,
      modelLooksTdrz,
      setupHint: modelLooksTdrz
        ? null
        : 'tdrz モードです。モデルは ggml-small.en-tdrz.bin 等（英語専用 tinydiarize）を WHISPER_MODEL に指定してください。',
    };
  }

  if (forced === 'embedding' || (forced === '' && Boolean(speakerModel))) {
    if (!speakerModel) {
      return {
        enabled: true,
        mode: 'embedding',
        args: [],
        speakerModel: null,
        modelLooksTdrz,
        setupHint:
          'embedding モードには WHISPER_SPEAKER_MODEL（例: ggml-speaker-ecapa-tdnn.bin）と diarize 対応ビルドの whisper-cli が必要です。',
      };
    }
    return {
      enabled: true,
      mode: 'embedding',
      args: ['--diarize', '--diarize-model', speakerModel, ...extra],
      speakerModel,
      modelLooksTdrz,
      setupHint: null,
    };
  }

  return {
    enabled: true,
    mode: 'off',
    args: [],
    speakerModel,
    modelLooksTdrz,
    setupHint:
      'WHISPER_DIARIZE=1 ですが自動話者分け用モデル/引数が未設定です。' +
      ' tinydiarize なら *tdrz* モデル + WHISPER_DIARIZE_MODE=tdrz、' +
      'または WHISPER_SPEAKER_MODEL / WHISPER_DIARIZE_ARGS を設定してください。' +
      ' UI の手動「話者」ラベルは利用できます。',
  };
}
