/**
 * Persist recorded segment audio (webm/wav/…) in IndexedDB for download.
 * Text history stays in localStorage; blobs are too large for that.
 */

export type StoredAudioSegment = {
  id: string;
  note: number;
  at: string;
  mimeType: string;
  blob: Blob;
};

const DB_NAME = 'minutes.audio.v1';
const STORE = 'segments';
const DB_VERSION = 1;

function canUseIdb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export function extensionForMime(mimeType: string): string {
  const m = (mimeType || '').toLowerCase();
  if (m.includes('wav')) return 'wav';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  return 'webm';
}

export function filenameForSegment(seg: {
  note: number;
  at: string;
  mimeType: string;
  id: string;
}): string {
  const ext = extensionForMime(seg.mimeType);
  const stamp = seg.at.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const notePart = seg.note > 0 ? `note${seg.note}` : 'segment';
  return `minutes-${notePart}-${stamp}-${seg.id.slice(-6)}.${ext}`;
}

export async function saveAudioSegment(
  segment: StoredAudioSegment
): Promise<void> {
  if (!canUseIdb()) return;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await reqToPromise(tx.objectStore(STORE).put(segment));
  } finally {
    db.close();
  }
}

export async function getAudioSegment(
  id: string
): Promise<StoredAudioSegment | null> {
  if (!canUseIdb()) return null;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const row = await reqToPromise(
      tx.objectStore(STORE).get(id) as IDBRequest<StoredAudioSegment | undefined>
    );
    return row ?? null;
  } finally {
    db.close();
  }
}

export async function listAudioIds(): Promise<string[]> {
  if (!canUseIdb()) return [];
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    return await reqToPromise(tx.objectStore(STORE).getAllKeys() as IDBRequest<IDBValidKey[]>).then(
      (keys) => keys.map(String)
    );
  } finally {
    db.close();
  }
}

export async function listAudioSegments(): Promise<StoredAudioSegment[]> {
  if (!canUseIdb()) return [];
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const rows = await reqToPromise(
      tx.objectStore(STORE).getAll() as IDBRequest<StoredAudioSegment[]>
    );
    return (rows ?? []).sort((a, b) => a.note - b.note || a.at.localeCompare(b.at));
  } finally {
    db.close();
  }
}

export async function clearAllAudio(): Promise<void> {
  if (!canUseIdb()) return;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await reqToPromise(tx.objectStore(STORE).clear());
  } finally {
    db.close();
  }
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}
