/**
 * POST /api/transcribe and, if the caller aborts, also POST the job id.
 * Aborting the upload alone does not stop ffmpeg / whisper-cli: the route
 * keeps running after the browser hangs up. The cancel post is what kills them.
 */

function cancelJob(jobId: string) {
  void fetch('/api/transcribe/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId }),
    keepalive: true,
  }).catch(() => {
    /* server already gone, or the job never started */
  });
}

export async function postTranscribe(
  formData: FormData,
  signal?: AbortSignal
): Promise<Response> {
  const jobId = crypto.randomUUID();
  formData.append('jobId', jobId);
  if (signal?.aborted) cancelJob(jobId);
  else signal?.addEventListener('abort', () => cancelJob(jobId), { once: true });
  return fetch('/api/transcribe', { method: 'POST', body: formData, signal });
}
