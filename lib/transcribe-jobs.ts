/**
 * In-flight /api/transcribe child processes (ffmpeg, whisper-cli).
 * Hard stop aborts the browser fetch, but Next often keeps the route
 * running, so the client also posts the job id here. The id is marked
 * cancelled even if that post wins the race before the job is registered.
 */

type Killer = () => void;

const jobs = new Map<string, Killer>();
const cancelled: string[] = [];
const cancelledSet = new Set<string>();

const MAX_CANCELLED = 200;

function rememberCancelled(id: string) {
  if (cancelledSet.has(id)) return;
  cancelledSet.add(id);
  cancelled.push(id);
  while (cancelled.length > MAX_CANCELLED) {
    const old = cancelled.shift();
    if (old) cancelledSet.delete(old);
  }
}

export function isTranscribeJobCancelled(id: string): boolean {
  return cancelledSet.has(id);
}

/**
 * Register the killer used to SIGKILL this job's process group.
 * If stop already asked to cancel this id, the killer runs immediately.
 */
export function registerTranscribeJob(id: string, kill: Killer): () => void {
  if (cancelledSet.has(id)) {
    try {
      kill();
    } catch {
      /* already dead */
    }
    return () => {};
  }
  jobs.set(id, kill);
  return () => {
    if (jobs.get(id) === kill) jobs.delete(id);
  };
}

export function cancelTranscribeJob(id: string): boolean {
  rememberCancelled(id);
  const kill = jobs.get(id);
  if (!kill) return false;
  jobs.delete(id);
  try {
    kill();
  } catch {
    /* already dead */
  }
  return true;
}
