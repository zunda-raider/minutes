/** Shared Whisper language allow-list helpers (server-only env). */

const DEFAULT_LANG = 'ja';
const DEFAULT_LANGS = ['ja', 'en'] as const;

export type WhisperLangConfig = {
  defaultLang: string;
  langs: string[];
};

function normalizeLang(code: string): string {
  return code.trim().toLowerCase();
}

/** Parse WHISPER_LANGS=ja,en (comma-separated). Falls back to ja,en. */
export function parseAllowedLangs(raw?: string | null): string[] {
  if (!raw?.trim()) {
    return [...DEFAULT_LANGS];
  }
  const parsed = raw
    .split(',')
    .map(normalizeLang)
    .filter((c) => /^[a-z]{2}(-[a-z]{2})?$/.test(c));
  // de-dupe while preserving order
  return [...new Set(parsed.length > 0 ? parsed : [...DEFAULT_LANGS])];
}

export function getWhisperLangConfig(): WhisperLangConfig {
  const langs = parseAllowedLangs(process.env.WHISPER_LANGS);
  const fromEnv = process.env.WHISPER_LANG?.trim()
    ? normalizeLang(process.env.WHISPER_LANG)
    : DEFAULT_LANG;
  const defaultLang = langs.includes(fromEnv) ? fromEnv : langs[0]!;
  return { defaultLang, langs };
}

/**
 * Resolve request language against allow-list.
 * @returns lang code or null if provided but invalid
 */
export function resolveRequestLang(
  requested: string | null | undefined,
  config: WhisperLangConfig = getWhisperLangConfig()
): { lang: string } | { error: string } {
  if (requested == null || String(requested).trim() === '') {
    return { lang: config.defaultLang };
  }
  const code = normalizeLang(String(requested));
  if (!config.langs.includes(code)) {
    return {
      error: `Unsupported language "${code}". Allowed: ${config.langs.join(', ')}`,
    };
  }
  return { lang: code };
}

/** Human-readable labels for known codes (UI). */
export function langLabel(code: string): string {
  switch (code) {
    case 'ja':
      return '日本語';
    case 'en':
      return 'English';
    default:
      return code;
  }
}
