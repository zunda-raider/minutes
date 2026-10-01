'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './page.module.css';

type LangOption = { code: string; label: string };

type TranscriptEntry = {
  id: string;
  note: number; // stable chronological note number (1 = oldest)
  text: string;
  lang: string;
  at: string; // ISO
  textJa?: string;
};

type Screen = 'home' | 'note1' | 'note2';

/** How often to cut a segment and send it to Whisper while still recording. */
const SEGMENT_MS = 25_000;

function pickMimeType(): string {
  return MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ja-JP', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function isEnglishEntry(entry: TranscriptEntry): boolean {
  return entry.lang === 'en' || entry.lang.startsWith('en-');
}

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(new Set());
  const [langs, setLangs] = useState<LangOption[]>([
    { code: 'ja', label: '日本語' },
    { code: 'en', label: 'English' },
  ]);
  const [lang, setLang] = useState('ja');
  const [translateConfigured, setTranslateConfigured] = useState(false);
  const [screen, setScreen] = useState<Screen>('home');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef('audio/webm');
  const langRef = useRef(lang);
  langRef.current = lang;

  const wantRecordingRef = useRef(false);
  const rotateAfterStopRef = useRef(false);
  const segmentTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const uploadQueueRef = useRef<Blob[]>([]);
  const queueRunningRef = useRef(false);

  const isTranscribing = pendingCount > 0;
  const untranslatedEn = entries.filter(
    (e) => isEnglishEntry(e) && !e.textJa
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/config');
        if (!res.ok) return;
        const data = (await res.json()) as {
          defaultLang?: string;
          langs?: LangOption[];
          translateConfigured?: boolean;
        };
        if (cancelled) return;
        if (Array.isArray(data.langs) && data.langs.length > 0) {
          setLangs(data.langs);
        }
        if (data.defaultLang) {
          setLang(data.defaultLang);
        }
        setTranslateConfigured(Boolean(data.translateConfigured));
      } catch (e) {
        console.error('config fetch failed:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (segmentTimerRef.current) clearInterval(segmentTimerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const clearSegmentTimer = () => {
    if (segmentTimerRef.current) {
      clearInterval(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }
  };

  const processQueue = useCallback(async () => {
    if (queueRunningRef.current) return;
    queueRunningRef.current = true;

    while (uploadQueueRef.current.length > 0) {
      const blob = uploadQueueRef.current.shift()!;
      try {
        const formData = new FormData();
        formData.append(
          'file',
          new File([blob], 'audio.webm', { type: blob.type || mimeTypeRef.current })
        );
        formData.append('lang', langRef.current);

        const res = await fetch('/api/transcribe', {
          method: 'POST',
          body: formData,
        });

        let data: { text?: string; error?: string; lang?: string };
        try {
          data = await res.json();
        } catch (parseErr) {
          console.error('レスポンスエラー:', parseErr);
          setError('サーバー応答を読めませんでした。');
          setPendingCount((n) => Math.max(0, n - 1));
          continue;
        }

        if (!res.ok) {
          setError(data.error || `文字起こしに失敗しました (${res.status})`);
          setPendingCount((n) => Math.max(0, n - 1));
          continue;
        }

        const text = data.text?.trim() ?? '';
        if (text.length > 0) {
          setEntries((prev) => {
            const entry: TranscriptEntry = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              note: prev.length + 1,
              text,
              lang: data.lang || langRef.current,
              at: new Date().toISOString(),
            };
            // Chronological store (oldest → newest)
            return [...prev, entry];
          });
          setError('');
        } else {
          setError('変換はできたけど、内容が空でした。');
        }
      } catch (fetchErr) {
        console.error('送信エラー:', fetchErr);
        setError('文字起こしリクエストに失敗しました。');
      } finally {
        setPendingCount((n) => Math.max(0, n - 1));
      }
    }

    queueRunningRef.current = false;
  }, []);

  const enqueueTranscribe = useCallback(
    (blob: Blob) => {
      if (blob.size === 0) return;
      uploadQueueRef.current.push(blob);
      setPendingCount((n) => n + 1);
      void processQueue();
    },
    [processQueue]
  );

  const startRecorderOnStream = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;

    const mimeType = mimeTypeRef.current;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onerror = () => {
      setError('録音中にエラーが発生しました。');
      wantRecordingRef.current = false;
      clearSegmentTimer();
      stopTracks();
      setIsRecording(false);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      mediaRecorderRef.current = null;

      if (blob.size > 0) {
        enqueueTranscribe(blob);
      }

      if (wantRecordingRef.current && rotateAfterStopRef.current && streamRef.current) {
        rotateAfterStopRef.current = false;
        startRecorderOnStream();
        return;
      }

      if (!wantRecordingRef.current) {
        stopTracks();
        setIsRecording(false);
      }
    };

    recorder.start(1000);
    mediaRecorderRef.current = recorder;
  }, [enqueueTranscribe]);

  const rotateSegment = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    if (!wantRecordingRef.current) return;
    rotateAfterStopRef.current = true;
    recorder.stop();
  }, []);

  const startRecording = async () => {
    setError('');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      console.error('マイク許可エラー:', e);
      setError(
        'マイクにアクセスできませんでした。ブラウザのマイク許可を確認してください。'
      );
      return;
    }

    streamRef.current = stream;
    mimeTypeRef.current = pickMimeType();
    wantRecordingRef.current = true;
    rotateAfterStopRef.current = false;

    startRecorderOnStream();
    setIsRecording(true);

    clearSegmentTimer();
    segmentTimerRef.current = setInterval(() => {
      rotateSegment();
    }, SEGMENT_MS);
  };

  const stopRecording = () => {
    wantRecordingRef.current = false;
    rotateAfterStopRef.current = false;
    clearSegmentTimer();

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      stopTracks();
      setIsRecording(false);
      return;
    }
    recorder.stop();
  };

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((cur) => (cur === id ? null : cur));
      }, 1500);
    } catch (e) {
      console.error('copy failed:', e);
      setError('クリップボードへのコピーに失敗しました。');
    }
  };

  const formatEntryForCopy = (e: TranscriptEntry) =>
    e.textJa ? `${e.text}\n\n（日本語）\n${e.textJa}` : e.text;

  /** Always oldest → newest, independent of which Note screen is open. */
  const copyAll = async () => {
    if (entries.length === 0) return;
    const chronological = [...entries].sort((a, b) => a.note - b.note);
    const all = chronological.map(formatEntryForCopy).join('\n\n---\n\n');
    await copyText('__all__', all);
  };

  const note1Entries = [...entries].sort((a, b) => a.note - b.note); // oldest → newest
  const note2Entries = [...entries].sort((a, b) => b.note - a.note); // newest → oldest

  const clearAll = () => {
    setEntries([]);
    setCopiedId(null);
  };

  const translateEntry = async (entry: TranscriptEntry) => {
    if (!isEnglishEntry(entry) || entry.textJa) return;

    setTranslatingIds((prev) => new Set(prev).add(entry.id));
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: entry.text }),
      });
      const data = (await res.json()) as { textJa?: string; error?: string };
      if (!res.ok) {
        setError(data.error || `翻訳に失敗しました (${res.status})`);
        return;
      }
      if (!data.textJa?.trim()) {
        setError('翻訳結果が空でした。');
        return;
      }
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id ? { ...e, textJa: data.textJa!.trim() } : e
        )
      );
      setError('');
    } catch (e) {
      console.error('translate failed:', e);
      setError('翻訳リクエストに失敗しました。');
    } finally {
      setTranslatingIds((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    }
  };

  const translateAllEnglish = async () => {
    const targets = entries.filter((e) => isEnglishEntry(e) && !e.textJa);
    for (const entry of targets) {
      // Sequential to avoid rate limits
      await translateEntry(entry);
    }
  };


  const renderEntryCard = (entry: TranscriptEntry) => {
    const translating = translatingIds.has(entry.id);
    const showTranslate = isEnglishEntry(entry) && !entry.textJa;
    return (
      <li key={entry.id} className={styles.entry}>
        <div className={styles.entryMeta}>
          <div className={styles.entryMetaLeft}>
            <span className={styles.entryIndex}>#{entry.note}</span>
            <span className={styles.langBadge}>{entry.lang}</span>
            <time className={styles.entryTime} dateTime={entry.at}>
              {formatTime(entry.at)}
            </time>
          </div>
          <div className={styles.entryActions}>
            {showTranslate && (
              <button
                type="button"
                className={styles.translateButton}
                disabled={translating}
                onClick={() => translateEntry(entry)}
              >
                {translating ? 'Translating…' : 'To Japanese'}
              </button>
            )}
            <button
              type="button"
              className={styles.copyButton}
              onClick={() => copyText(entry.id, formatEntryForCopy(entry))}
            >
              {copiedId === entry.id ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <pre className={styles.transcript}>{entry.text}</pre>
        {entry.textJa && (
          <div className={styles.translationBlock}>
            <div className={styles.translationLabel}>Japanese</div>
            <pre className={styles.transcriptJa}>{entry.textJa}</pre>
          </div>
        )}
      </li>
    );
  };

  const renderNoteScreen = (
    title: string,
    subtitle: string,
    list: TranscriptEntry[]
  ) => (
    <div className={styles.app}>
      <div className={styles.bgGlow} aria-hidden="true" />

      <header className={styles.noteTopBar}>
        <button
          type="button"
          className={styles.backButton}
          onClick={() => setScreen('home')}
        >
          <span className={styles.backChevron} aria-hidden="true" />
          Home
        </button>
        <div className={styles.noteHeading}>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
        <div className={styles.topMeta}>
          <span className={styles.metaChip}>{entries.length} segments</span>
          <span className={styles.metaChip}>Copy all = 古い順</span>
        </div>
      </header>

      {(isRecording || isTranscribing) && (
        <div className={styles.liveStrip} aria-live="polite">
          {isRecording && (
            <span className={styles.pillLive}>
              <span className={styles.dotPulse} aria-hidden="true" />
              Recording continues
            </span>
          )}
          {isTranscribing && (
            <span className={styles.pillQueue}>
              <span className={styles.dotAmber} aria-hidden="true" />
              Transcribing · {pendingCount}
            </span>
          )}
        </div>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <section className={styles.feed}>
        <div className={styles.feedHeader}>
          <div>
            <h2 className={styles.feedTitle}>Timeline</h2>
            <p className={styles.feedCount}>
              {list.length === 0
                ? 'No segments yet'
                : `Showing ${list.length} · # stays chronological`}
            </p>
          </div>
          <div className={styles.feedActions}>
            {untranslatedEn.length > 0 && (
              <button
                type="button"
                className={styles.ghostButton}
                onClick={translateAllEnglish}
                disabled={translatingIds.size > 0}
              >
                {translateConfigured
                  ? `Translate all EN (${untranslatedEn.length})`
                  : 'Translate all EN'}
              </button>
            )}
            <button
              type="button"
              className={styles.ghostButton}
              onClick={copyAll}
              disabled={entries.length === 0}
            >
              {copiedId === '__all__' ? 'Copied' : 'Copy all'}
            </button>
            <button
              type="button"
              className={styles.ghostButtonDanger}
              onClick={clearAll}
              disabled={entries.length === 0}
            >
              Clear
            </button>
          </div>
        </div>

        {list.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyOrb} aria-hidden="true" />
            <h3 className={styles.emptyTitle}>No notes yet</h3>
            <p className={styles.emptyBody}>
              Go back Home, hit Record, and segments will appear here as a
              browsable timeline.
            </p>
            <button
              type="button"
              className={styles.recordButton}
              onClick={() => setScreen('home')}
            >
              Back to Home
            </button>
          </div>
        ) : (
          <ul className={styles.entryList}>{list.map(renderEntryCard)}</ul>
        )}
      </section>
    </div>
  );

  if (screen === 'note1') {
    return renderNoteScreen(
      'Note 1',
      '古い順 · oldest → newest',
      note1Entries
    );
  }

  if (screen === 'note2') {
    return renderNoteScreen(
      'Note 2',
      '新しい順 · newest → oldest',
      note2Entries
    );
  }

  // Home = PR #6 polished control UI + compact Note entry points
  return (
    <div className={styles.app}>
      <div className={styles.bgGlow} aria-hidden="true" />

      <header className={styles.topBar}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true" />
          <div className={styles.brandText}>
            <h1 className={styles.title}>Minutes</h1>
            <p className={styles.subtitle}>Local Whisper meeting notes</p>
          </div>
        </div>
        <div className={styles.topMeta}>
          <span className={styles.metaChip}>~{SEGMENT_MS / 1000}s segments</span>
          <span className={styles.metaChip}>{entries.length} segments</span>
        </div>
      </header>

      <aside className={styles.controlDock}>
        <div className={styles.dockInner}>
          <div className={styles.dockGroup}>
            <span className={styles.dockLabel}>Language</span>
            <div className={styles.langToggle} role="group" aria-label="Language">
              {langs.map((opt) => (
                <button
                  key={opt.code}
                  type="button"
                  className={
                    lang === opt.code ? styles.langButtonActive : styles.langButton
                  }
                  disabled={isRecording}
                  aria-pressed={lang === opt.code}
                  onClick={() => setLang(opt.code)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.dockGroupCenter}>
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              className={
                isRecording ? styles.recordButtonActive : styles.recordButton
              }
              aria-pressed={isRecording}
            >
              <span
                className={
                  isRecording ? styles.recordIconStop : styles.recordIconPlay
                }
                aria-hidden="true"
              />
              <span>{isRecording ? 'Stop' : 'Record'}</span>
            </button>
          </div>

          <div className={styles.dockGroup} aria-live="polite">
            <span className={styles.dockLabel}>Status</span>
            <div className={styles.statusPills}>
              {isRecording && (
                <span className={styles.pillLive}>
                  <span className={styles.dotPulse} aria-hidden="true" />
                  Recording
                </span>
              )}
              {isTranscribing && (
                <span className={styles.pillQueue}>
                  <span className={styles.dotAmber} aria-hidden="true" />
                  Transcribing · {pendingCount}
                </span>
              )}
              {!isRecording && !isTranscribing && (
                <span className={styles.pillIdle}>
                  <span className={styles.dotIdle} aria-hidden="true" />
                  Idle
                </span>
              )}
            </div>
          </div>
        </div>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </aside>

      <nav className={styles.noteEntryBar} aria-label="Notes">
        <span className={styles.dockLabel}>Notes</span>
        <div className={styles.noteEntryButtons}>
          <button
            type="button"
            className={styles.noteEntryButton}
            onClick={() => setScreen('note1')}
          >
            Note 1 · 古い順
          </button>
          <button
            type="button"
            className={styles.noteEntryButton}
            onClick={() => setScreen('note2')}
          >
            Note 2 · 新しい順
          </button>
        </div>
        <p className={styles.noteEntryHint}>
          Open a Note screen to browse the full timeline
        </p>
      </nav>

      <section className={styles.feed}>
        <div className={styles.feedHeader}>
          <div>
            <h2 className={styles.feedTitle}>Transcript</h2>
            <p className={styles.feedCount}>
              {entries.length} segments · newest on top (home preview)
            </p>
          </div>
          <div className={styles.feedActions}>
            {untranslatedEn.length > 0 && (
              <button
                type="button"
                className={styles.ghostButton}
                onClick={translateAllEnglish}
                disabled={translatingIds.size > 0}
              >
                {translateConfigured
                  ? `Translate all EN (${untranslatedEn.length})`
                  : 'Translate all EN'}
              </button>
            )}
            <button
              type="button"
              className={styles.ghostButton}
              onClick={copyAll}
              disabled={entries.length === 0}
            >
              {copiedId === '__all__' ? 'Copied' : 'Copy all'}
            </button>
            <button
              type="button"
              className={styles.ghostButtonDanger}
              onClick={clearAll}
              disabled={entries.length === 0}
            >
              Clear
            </button>
          </div>
        </div>

        {entries.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyOrb} aria-hidden="true" />
            <h3 className={styles.emptyTitle}>
              {isTranscribing ? 'Waiting for the first segment' : 'Ready when you are'}
            </h3>
            <p className={styles.emptyBody}>
              {isTranscribing
                ? 'Audio is queued for Whisper. New text will appear here.'
                : 'Hit Record to capture mic audio. Use Note 1 / Note 2 to browse history in either order.'}
            </p>
          </div>
        ) : (
          <ul className={styles.entryList}>
            {note2Entries.map(renderEntryCard)}
          </ul>
        )}
      </section>
    </div>
  );
}
