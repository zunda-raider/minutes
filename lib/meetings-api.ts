/**
 * Browser helpers for /api/meetings*. Returns null / false when DB is
 * unavailable so the UI can keep using localStorage.
 */

import type { StoredTranscriptEntry } from './history-storage';
import type { MeetingNotebook } from './meeting-notebooks';

export type MeetingsApiError = {
  error?: string;
  configured?: boolean;
};

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** GET /api/meetings — null if not configured / unreachable. */
export async function fetchMeetingsFromApi(): Promise<MeetingNotebook[] | null> {
  try {
    const res = await fetch('/api/meetings');
    if (res.status === 503) return null;
    if (!res.ok) {
      console.error('meetings GET failed:', res.status);
      return null;
    }
    const data = await readJson<{ meetings?: MeetingNotebook[] }>(res);
    if (!data || !Array.isArray(data.meetings)) return null;
    return data.meetings;
  } catch (err) {
    console.error('meetings GET error:', err);
    return null;
  }
}

/** PUT /api/meetings — full replace (sync / migrate). */
export async function replaceMeetingsViaApi(
  meetings: MeetingNotebook[]
): Promise<MeetingNotebook[] | null> {
  try {
    const res = await fetch('/api/meetings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetings }),
    });
    if (res.status === 503) return null;
    if (!res.ok) {
      console.error('meetings PUT failed:', res.status);
      return null;
    }
    const data = await readJson<{ meetings?: MeetingNotebook[] }>(res);
    if (!data || !Array.isArray(data.meetings)) return null;
    return data.meetings;
  } catch (err) {
    console.error('meetings PUT error:', err);
    return null;
  }
}

export async function createMeetingViaApi(
  meeting: MeetingNotebook
): Promise<MeetingNotebook | null> {
  try {
    const res = await fetch('/api/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meeting }),
    });
    if (res.status === 503) return null;
    if (!res.ok) {
      console.error('meetings POST failed:', res.status);
      return null;
    }
    const data = await readJson<{ meeting?: MeetingNotebook }>(res);
    return data?.meeting ?? null;
  } catch (err) {
    console.error('meetings POST error:', err);
    return null;
  }
}

export async function deleteMeetingViaApi(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/meetings/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (res.status === 503) return false;
    return res.ok || res.status === 404;
  } catch (err) {
    console.error('meetings DELETE error:', err);
    return false;
  }
}

export async function appendCardsViaApi(
  meetingId: string,
  cards: StoredTranscriptEntry[]
): Promise<MeetingNotebook | null> {
  try {
    const res = await fetch(
      `/api/meetings/${encodeURIComponent(meetingId)}/cards`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards }),
      }
    );
    if (res.status === 503) return null;
    if (!res.ok) {
      console.error('meetings cards POST failed:', res.status);
      return null;
    }
    const data = await readJson<{ meeting?: MeetingNotebook }>(res);
    return data?.meeting ?? null;
  } catch (err) {
    console.error('meetings cards POST error:', err);
    return null;
  }
}
