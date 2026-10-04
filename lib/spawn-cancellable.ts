import { spawn, type ChildProcess } from 'child_process';

export class ProcessAbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

/** SIGKILL the child and anything it spawned. `detached` makes it a group leader. */
export function killChildTree(proc: ChildProcess) {
  const pid = proc.pid;
  if (pid == null) return;
  if (proc.exitCode != null || proc.signalCode != null) return;
  try {
    process.kill(-pid, 'SIGKILL');
    return;
  } catch {
    /* not a group leader (or already gone) */
  }
  try {
    proc.kill('SIGKILL');
  } catch {
    /* already exited */
  }
}

export function runCancellableProcess(
  command: string,
  args: string[],
  label: string,
  opts: {
    signal?: AbortSignal;
    shouldStop?: () => boolean;
    onSpawn?: (proc: ChildProcess) => void;
  }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted || opts.shouldStop?.()) {
      reject(new ProcessAbortedError());
      return;
    }

    const proc = spawn(command, args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    opts.onSpawn?.(proc);
    if (opts.signal?.aborted || opts.shouldStop?.()) {
      killChildTree(proc);
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => {
      killChildTree(proc);
    };
    opts.signal?.addEventListener('abort', onAbort);

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    proc.on('error', (err) => {
      finish(() => reject(new Error(`${label} を起動できませんでした: ${err.message}`)));
    });
    proc.on('close', (code, closeSignal) => {
      if (opts.signal?.aborted || opts.shouldStop?.()) {
        finish(() => reject(new ProcessAbortedError()));
        return;
      }
      if (code === 0) {
        finish(() => resolve({ stdout, stderr }));
        return;
      }
      finish(() =>
        reject(
          new Error(
            `${label} が失敗しました (exit ${code ?? closeSignal})${
              stderr ? `: ${stderr.slice(0, 500)}` : ''
            }`
          )
        )
      );
    });
  });
}
