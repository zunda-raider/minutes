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
};

export const HISTORY_STORAGE_KEY = 'minutes.transcript.entries.v1';
export const SUMMARY_STORAGE_KEY = 'minutes.transcript.summary.v1';

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
    (e.textJa === undefined || typeof e.textJa === 'string')
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
