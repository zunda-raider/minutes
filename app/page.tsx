'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './page.module.css';

type LangOption = { code: string; label: string };

type TranscriptEntry = {
  id: string;
  text: string;
  lang: string;
  at: string; // ISO
};

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

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [langs, setLangs] = useState<LangOption[]>([
    { code: 'ja', label: '日本語' },
    { code: 'en', label: 'English' },
  ]);
  const [lang, setLang] = useState('ja');

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/config');
        if (!res.ok) return;
        const data = (await res.json()) as {
          defaultLang?: string;
          langs?: LangOption[];
        };
        if (cancelled) return;
        if (Array.isArray(data.langs) && data.langs.length > 0) {
          setLangs(data.langs);
        }
        if (data.defaultLang) {
          setLang(data.defaultLang);
        }
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
          const entry: TranscriptEntry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            text,
            lang: data.lang || langRef.current,
            at: new Date().toISOString(),
          };
          setEntries((prev) => [...prev, entry]);
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

      // Final stop (user ended session)
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
    // Do NOT clear previous transcript history

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
    // isRecording cleared in onstop after last segment is queued
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

  const copyAll = async () => {
    if (entries.length === 0) return;
    const all = entries.map((e) => e.text).join('\n\n');
    await copyText('__all__', all);
  };

  const clearAll = () => {
    setEntries([]);
    setCopiedId(null);
  };

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>🎤 議事録アプリ</h1>
      <p className={styles.hint}>
        録音中も約{SEGMENT_MS / 1000}
        秒ごとに Whisper へ送信します。文字起こし待ちでも録音は続きます。結果は履歴に追加されます。
      </p>

      <div className={styles.langRow}>
        <label htmlFor="lang-select" className={styles.langLabel}>
          言語 / Language
        </label>
        <select
          id="lang-select"
          className={styles.langSelect}
          value={lang}
          disabled={isRecording}
          onChange={(e) => setLang(e.target.value)}
        >
          {langs.map((opt) => (
            <option key={opt.code} value={opt.code}>
              {opt.label} ({opt.code})
            </option>
          ))}
        </select>
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          className={isRecording ? styles.stopButton : styles.startButton}
        >
          {isRecording ? '🛑 停止' : '▶️ 録音開始'}
        </button>
      </div>

      <div className={styles.statusRow} aria-live="polite">
        {isRecording && <span className={styles.badgeRecording}>● 録音中</span>}
        {isTranscribing && (
          <span className={styles.badgeTranscribing}>
            ⏳ 文字起こし中（残り {pendingCount}）
          </span>
        )}
        {!isRecording && !isTranscribing && (
          <span className={styles.badgeIdle}>待機中</span>
        )}
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <section className={styles.result}>
        <div className={styles.resultHeader}>
          <h2 className={styles.resultTitle}>📝 結果（{entries.length}）</h2>
          <div className={styles.resultActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={copyAll}
              disabled={entries.length === 0}
            >
              {copiedId === '__all__' ? '✓ コピーした' : '全てコピー'}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={clearAll}
              disabled={entries.length === 0}
            >
              履歴をクリア
            </button>
          </div>
        </div>

        {entries.length === 0 ? (
          <p className={styles.empty}>
            {isTranscribing ? '最初の結果を待っています…' : 'まだ結果はないよ〜'}
          </p>
        ) : (
          <ul className={styles.entryList}>
            {entries.map((entry, index) => (
              <li key={entry.id} className={styles.entry}>
                <div className={styles.entryMeta}>
                  <span>
                    #{index + 1} · {entry.lang} · {formatTime(entry.at)}
                  </span>
                  <button
                    type="button"
                    className={styles.copyButton}
                    onClick={() => copyText(entry.id, entry.text)}
                  >
                    {copiedId === entry.id ? '✓ コピーした' : 'コピー'}
                  </button>
                </div>
                <pre className={styles.transcript}>{entry.text}</pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
