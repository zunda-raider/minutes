/**
 * Whisper model slots.
 * modelKey 1 = WHISPER_MODEL (Home / Note / Zoom).
 * modelKey 2 = WHISPER_MODEL2 (GD default). Unset model 2 falls back to model 1.
 */

export type WhisperModelKey = 1 | 2;

export type WhisperModelSlot = {
  key: WhisperModelKey;
  /** File basename without ggml- prefix and .bin suffix, for short UI labels. */
  label: string;
  configured: boolean;
  /** True when this slot is served by WHISPER_MODEL because WHISPER_MODEL2 is empty. */
  fallback: boolean;
};

export function whisperModelLabel(modelPath: string): string {
  const base = modelPath.replace(/\\/g, '/').split('/').pop() ?? '';
  return base.replace(/^ggml-/i, '').replace(/\.bin$/i, '');
}

export function getWhisperModelSlots(): {
  model1: string;
  model2: string;
  slots: Record<'1' | '2', WhisperModelSlot>;
} {
  const model1 = process.env.WHISPER_MODEL?.trim() || '';
  const model2Raw = process.env.WHISPER_MODEL2?.trim() || '';
  const model2Configured = model2Raw.length > 0;
  const model2 = model2Configured ? model2Raw : model1;

  return {
    model1,
    model2,
    slots: {
      '1': {
        key: 1,
        label: whisperModelLabel(model1),
        configured: model1.length > 0,
        fallback: false,
      },
      '2': {
        key: 2,
        label: whisperModelLabel(model2),
        configured: model2Configured,
        fallback: !model2Configured && model1.length > 0,
      },
    },
  };
}

/** Missing or unknown modelKey stays on slot 1 so non-GD callers are unchanged. */
export function resolveWhisperModelPath(modelKey: string | null | undefined): {
  key: WhisperModelKey;
  path: string | null;
  label: string;
  fallback: boolean;
} {
  const { model1, model2, slots } = getWhisperModelSlots();
  if (modelKey === '2') {
    return {
      key: 2,
      path: model2 || null,
      label: slots['2'].label,
      fallback: slots['2'].fallback,
    };
  }
  return {
    key: 1,
    path: model1 || null,
    label: slots['1'].label,
    fallback: false,
  };
}
