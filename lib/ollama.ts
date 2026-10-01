import { spawn } from 'child_process';
import fs from 'fs';

export function getOllamaBaseUrl(): string {
  return (
    process.env.OLLAMA_BASE_URL?.trim() || 'http://127.0.0.1:11434'
  ).replace(/\/$/, '');
}

/** Default llama3.2; user also has gemma2:latest available. */
export function getOllamaModel(): string {
  return process.env.OLLAMA_MODEL?.trim() || 'llama3.2';
}

/**
 * Resolve ollama binary for local Next.js server only.
 * Prefer OLLAMA_BIN, then /usr/local/bin/ollama (Homebrew Intel/older), then PATH.
 */
export function resolveOllamaBin(): string {
  const fromEnv = process.env.OLLAMA_BIN?.trim();
  if (fromEnv) return fromEnv;

  const candidates = [
    '/usr/local/bin/ollama',
    '/opt/homebrew/bin/ollama',
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      // ignore
    }
  }
  return 'ollama';
}

export async function isOllamaReachable(
  baseUrl: string = getOllamaBaseUrl(),
  timeoutMs = 1500
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * If Ollama HTTP API is down, try to spawn `ollama serve` detached (local npm run
 * dev / next start only — not available on Vercel / pure browser).
 */
export async function ensureOllamaRunning(
  baseUrl: string = getOllamaBaseUrl()
): Promise<{ started: boolean; bin?: string }> {
  if (await isOllamaReachable(baseUrl)) {
    return { started: false };
  }

  const bin = resolveOllamaBin();

  try {
    const child = spawn(bin, ['serve'], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Ollamaが停止中で、自動起動にも失敗しました（${bin}）。` +
        `ターミナルで \`brew install ollama\` のうえ \`/usr/local/bin/ollama serve\` か \`ollama serve\` を手動起動してください。` +
        `（この自動起動はローカルの Next.js サーバー上でのみ動作します。Vercel / ブラウザ単体では不可。） (${detail})`
    );
  }

  // Wait for API to come up
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (await isOllamaReachable(baseUrl, 2000)) {
      return { started: true, bin };
    }
  }

  throw new Error(
    `Ollama（${bin} serve）を起動しましたが ${baseUrl} が応答しません。` +
      `モデルは \`ollama pull llama3.2\`（または gemma2）済みか確認し、必要なら手動で \`ollama serve\` してください。` +
      `OLLAMA_BIN=/usr/local/bin/ollama を .env.local に設定できます。`
  );
}
