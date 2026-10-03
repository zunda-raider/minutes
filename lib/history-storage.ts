/**
 * Client-side persistence for transcript history (browser localStorage).
 * Safe to import from client components; all access is guarded for SSR.
 */

export type StoredTranscriptEntry = {
  id: string;
  note: number;
  text: string;
  lang: string;
  at: string;
  textJa?: string;
  /** 1-based speaker id when known / assigned */
  speakerId?: number;
  /** Recording source when known. Mic id 2 is 質問者; Zoom id 2 is speaker B. */
  source?: 'mic' | 'system';
};

export const HISTORY_STORAGE_KEY = 'minutes.transcript.entries.v1';
export const SUMMARY_STORAGE_KEY = 'minutes.transcript.summary.v1';
export const GENRE_STORAGE_KEY = 'minutes.meeting.genre.v1';
export const SPEAKER_LABELS_KEY = 'minutes.speakers.labels.v1';
export const SPEAKER_MODE_KEY = 'minutes.speakers.mode.v1';

function canUseStorage(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof localStorage !== 'undefined' &&
    typeof localStorage.getItem === 'function' &&
    typeof localStorage.setItem === 'function'
  );
}

function isEntry(value: unknown): value is StoredTranscriptEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.note === 'number' &&
    typeof e.text === 'string' &&
    typeof e.lang === 'string' &&
    typeof e.at === 'string' &&
    (e.textJa === undefined || typeof e.textJa === 'string') &&
    (e.speakerId === undefined ||
      (typeof e.speakerId === 'number' && Number.isFinite(e.speakerId))) &&
    (e.source === undefined || e.source === 'mic' || e.source === 'system')
  );
}

/** Returns parsed entries, or [] if missing/invalid. */
export function loadEntries(): StoredTranscriptEntry[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).sort((a, b) => a.note - b.note);
  } catch (err) {
    console.error('history load failed:', err);
    return [];
  }
}

export function saveEntries(entries: StoredTranscriptEntry[]): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch (err) {
    console.error('history save failed:', err);
    throw err;
  }
}

export function clearStoredEntries(): void {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch (err) {
    console.error('history clear failed:', err);
  }
}

export function loadSummary(): string {
  if (!canUseStorage()) return '';
  try {
    return localStorage.getItem(SUMMARY_STORAGE_KEY) ?? '';
  } catch (err) {
    console.error('summary load failed:', err);
    return '';
  }
}

export function saveSummary(summary: string): void {
  if (!canUseStorage()) return;
  try {
    if (!summary) {
      localStorage.removeItem(SUMMARY_STORAGE_KEY);
    } else {
      localStorage.setItem(SUMMARY_STORAGE_KEY, summary);
    }
  } catch (err) {
    console.error('summary save failed:', err);
    throw err;
  }
}

export function clearStoredSummary(): void {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(SUMMARY_STORAGE_KEY);
  } catch (err) {
    console.error('summary clear failed:', err);
  }
}

export function loadGenre(): string {
  if (!canUseStorage()) return '';
  try {
    return localStorage.getItem(GENRE_STORAGE_KEY) ?? '';
  } catch (err) {
    console.error('genre load failed:', err);
    return '';
  }
}

export function saveGenre(genre: string): void {
  if (!canUseStorage()) return;
  try {
    const trimmed = genre.trim();
    if (!trimmed) {
      localStorage.removeItem(GENRE_STORAGE_KEY);
    } else {
      localStorage.setItem(GENRE_STORAGE_KEY, trimmed);
    }
  } catch (err) {
    console.error('genre save failed:', err);
    throw err;
  }
}

export type SpeakerLabels = Record<string, string>; // speakerId → display name

export function loadSpeakerLabels(): SpeakerLabels {
  if (!canUseStorage()) return {};
  try {
    const raw = localStorage.getItem(SPEAKER_LABELS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: SpeakerLabels = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch (err) {
    console.error('speaker labels load failed:', err);
    return {};
  }
}

export function saveSpeakerLabels(labels: SpeakerLabels): void {
  if (!canUseStorage()) return;
  try {
    const cleaned: SpeakerLabels = {};
    for (const [k, v] of Object.entries(labels)) {
      if (v.trim()) cleaned[k] = v.trim();
    }
    if (Object.keys(cleaned).length === 0) {
      localStorage.removeItem(SPEAKER_LABELS_KEY);
    } else {
      localStorage.setItem(SPEAKER_LABELS_KEY, JSON.stringify(cleaned));
    }
  } catch (err) {
    console.error('speaker labels save failed:', err);
    throw err;
  }
}

export function clearStoredSpeakerLabels(): void {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(SPEAKER_LABELS_KEY);
  } catch (err) {
    console.error('speaker labels clear failed:', err);
  }
}

export type SpeakerMode = 'manual' | 'auto';

export function loadSpeakerMode(): SpeakerMode {
  if (!canUseStorage()) return 'manual';
  try {
    const raw = localStorage.getItem(SPEAKER_MODE_KEY);
    return raw === 'auto' ? 'auto' : 'manual';
  } catch (err) {
    console.error('speaker mode load failed:', err);
    return 'manual';
  }
}

export function saveSpeakerMode(mode: SpeakerMode): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(SPEAKER_MODE_KEY, mode);
  } catch (err) {
    console.error('speaker mode save failed:', err);
    throw err;
  }
}
