'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './page.module.css';
import {
  clearStoredEntries,
  clearStoredSpeakerLabels,
  clearStoredSummary,
  loadEntries,
  loadGenre,
  loadSpeakerLabels,
  loadSummary,
  saveEntries,
  saveGenre,
  saveSpeakerLabels,
  saveSpeakerMode,
  saveSummary,
  loadSpeakerMode,
  type SpeakerLabels,
  type SpeakerMode,
} from '@/lib/history-storage';
import { remapSpeakersContinuity, type DiarizeTurn } from '@/lib/diarize-parse';
import {
  defaultSpeakerLabel,
  letterForSpeakerId,
  SPEAKER_LETTERS,
} from '@/lib/speaker-letters';
import { MIC_ROLES, micRoleLabel } from '@/lib/mic-roles';
import {
  analyzeBlobPitch,
  assignSpeakerByPitch,
  provisionalTurnsFromPitch,
  type PitchCentroid,
} from '@/lib/pitch-diarize';
import {
  clearAllAudio,
  filenameForSegment,
  getAudioSegment,
  listAudioIds,
  listAudioSegments,
  saveAudioSegment,
  triggerBlobDownload,
} from '@/lib/audio-storage';
import { buildStoreZip } from '@/lib/zip-store';

type LangOption = { code: string; label: string };

type TranscriptEntry = {
  id: string;
  note: number; // stable chronological note number (1 = oldest)
  text: string;
  lang: string;
  at: string; // ISO
  textJa?: string;
  /** 1-based speaker id */
  speakerId?: number;
};

type DiarizeStatus = {
  enabled: boolean;
  mode: string;
  active: boolean;
  setupHint: string | null;
};

type Screen = 'home' | 'note1' | 'note2';
type AudioSource = 'mic' | 'system';

/** Mic: shorter chunks. Zoom/system + manual speaker flow: ~1 minute windows. */
const SEGMENT_MS_MIC = 25_000;
const SEGMENT_MS_SYSTEM = 60_000;

const SYSTEM_AUDIO_HELP =
  '画面共有ダイアログで「システム音声を共有」をオンにしてください。Zoom・LINE・その他アプリの通話ウィンドウ / タブ / 画面を共有できます。macOS で音声が取れない場合は BlackHole などの仮想オーディオでアプリ出力をマイクへルーティングし、「マイク」モードで録音してください。';

type DisplayMediaOptionsWithSystemAudio = DisplayMediaStreamOptions & {
  systemAudio?: 'include' | 'exclude';
  windowAudio?: 'system' | 'window' | 'exclude';
};

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
  const [historyReady, setHistoryReady] = useState(false);
  const [summary, setSummary] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [genre, setGenre] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [audioSource, setAudioSource] = useState<AudioSource>('mic');
  const [speakerLabels, setSpeakerLabels] = useState<SpeakerLabels>({});
  const [speakerMode, setSpeakerMode] = useState<SpeakerMode>('manual');
  const [diarizeStatus, setDiarizeStatus] = useState<DiarizeStatus | null>(null);
  const [autoAssignBusy, setAutoAssignBusy] = useState(false);
  const [renamingEntryId, setRenamingEntryId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [audioIds, setAudioIds] = useState<Set<string>>(() => new Set());
  const [audioBusyId, setAudioBusyId] = useState<string | null>(null);
  /** Active speaker while recording (Zoom A–G or mic role). */
  const [activeSpeakerId, setActiveSpeakerId] = useState<number>(1);
  const summaryRef = useRef<HTMLElement | null>(null);
  const genreInputRef = useRef<HTMLInputElement | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef('audio/webm');
  const langRef = useRef(lang);
  langRef.current = lang;

  const wantRecordingRef = useRef(false);
  const rotateAfterStopRef = useRef(false);
  const segmentTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  type UploadJob = {
    blob: Blob;
    /** Speaker selected when the segment was cut */
    speakerId: number | null;
    source: AudioSource;
  };
  const uploadQueueRef = useRef<UploadJob[]>([]);
  const queueRunningRef = useRef(false);
  const entriesLenRef = useRef(0);
  const lastSpeakerRef = useRef<number | null>(null);
  const speakerModeRef = useRef<SpeakerMode>('manual');
  const pitchCentroidsRef = useRef<PitchCentroid[]>([]);
  const audioSourceRef = useRef<AudioSource>('mic');
  const activeSpeakerRef = useRef<number>(1);

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
          diarize?: {
            enabled?: boolean;
            mode?: string;
            active?: boolean;
            setupHint?: string | null;
          };
        };
        if (cancelled) return;
        if (Array.isArray(data.langs) && data.langs.length > 0) {
          setLangs(data.langs);
        }
        if (data.defaultLang) {
          setLang(data.defaultLang);
        }
        setTranslateConfigured(Boolean(data.translateConfigured));
        if (data.diarize) {
          setDiarizeStatus({
            enabled: Boolean(data.diarize.enabled),
            mode: data.diarize.mode || 'off',
            active: Boolean(data.diarize.active),
            setupHint: data.diarize.setupHint ?? null,
          });
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

  // Hydrate transcript history + summary from localStorage (client only)
  useEffect(() => {
    setEntries(loadEntries());
    setSummary(loadSummary());
    setGenre(loadGenre());
    setSpeakerLabels(loadSpeakerLabels());
    const mode = loadSpeakerMode();
    setSpeakerMode(mode);
    speakerModeRef.current = mode;
    setHistoryReady(true);
    void listAudioIds()
      .then((ids) => setAudioIds(new Set(ids)))
      .catch((err) => console.error('audio id list failed:', err));
  }, []);

  // Persist on every change after hydrate (including clear → [])
  useEffect(() => {
    entriesLenRef.current = entries.length;
  }, [entries]);

  useEffect(() => {
    if (!historyReady) return;
    try {
      saveEntries(entries);
    } catch {
      setError(
        '履歴の保存に失敗しました（ストレージ容量不足の可能性があります）。'
      );
    }
  }, [entries, historyReady]);

  useEffect(() => {
    if (!historyReady) return;
    try {
      saveSummary(summary);
    } catch {
      setError(
        '要約の保存に失敗しました（ストレージ容量不足の可能性があります）。'
      );
    }
  }, [summary, historyReady]);

  useEffect(() => {
    if (!historyReady) return;
    try {
      saveGenre(genre);
    } catch {
      setError('ジャンルの保存に失敗しました。');
    }
  }, [genre, historyReady]);

  useEffect(() => {
    if (!historyReady) return;
    try {
      saveSpeakerLabels(speakerLabels);
    } catch {
      setError('話者名の保存に失敗しました。');
    }
  }, [speakerLabels, historyReady]);

  useEffect(() => {
    speakerModeRef.current = speakerMode;
    if (!historyReady) return;
    try {
      saveSpeakerMode(speakerMode);
    } catch {
      setError('話者モードの保存に失敗しました。');
    }
  }, [speakerMode, historyReady]);

  useEffect(() => {
    audioSourceRef.current = audioSource;
    // Mic only uses roles 1–2; clamp if switching from Zoom A–G
    if (audioSource === 'mic') {
      setActiveSpeakerId((cur) => (cur > 2 ? 1 : cur));
    }
  }, [audioSource]);

  useEffect(() => {
    activeSpeakerRef.current = activeSpeakerId;
  }, [activeSpeakerId]);

  const segmentMs =
    audioSource === 'system' ? SEGMENT_MS_SYSTEM : SEGMENT_MS_MIC;

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
      const job = uploadQueueRef.current.shift()!;
      const blob = job.blob;
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

        let data: {
          text?: string;
          error?: string;
          lang?: string;
          turns?: DiarizeTurn[];
          hasDiarizeMarks?: boolean;
          diarize?: {
            requested?: boolean;
            mode?: string;
            used?: boolean;
            warning?: string | null;
          };
        };
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

        if (data.diarize?.warning) {
          setError(data.diarize.warning);
        }

        const text = data.text?.trim() ?? '';
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const at = new Date().toISOString();
        const mimeType = blob.type || mimeTypeRef.current || 'audio/webm';
        const lang = data.lang || langRef.current;

        const mode =
          job.source === 'mic' ? 'manual' : speakerModeRef.current;
        const hasWhisperDiarize = Boolean(
          data.hasDiarizeMarks && data.turns && data.turns.length > 0
        );

        let chunks: Array<{ speaker?: number; text: string }> = [];

        if (mode === 'auto' && hasWhisperDiarize) {
          const { turns, lastSpeaker } = remapSpeakersContinuity(
            data.turns!,
            lastSpeakerRef.current
          );
          if (lastSpeaker != null) lastSpeakerRef.current = lastSpeaker;
          chunks = turns;
        } else if (mode === 'auto' && text) {
          // Pitch / voice-height heuristic when tinydiarize unavailable
          try {
            const analysis = await analyzeBlobPitch(blob);
            const provisional = provisionalTurnsFromPitch(
              text,
              analysis,
              pitchCentroidsRef.current
            );
            pitchCentroidsRef.current = provisional.centroids;
            chunks = provisional.turns;
            if (chunks.length > 0) {
              lastSpeakerRef.current =
                chunks[chunks.length - 1]!.speaker ?? lastSpeakerRef.current;
            }
            if (!data.diarize?.used && analysis.medianHz != null) {
              // Soft notice only when not already showing a whisper warning
              if (!data.diarize?.warning) {
                setError('');
              }
            }
          } catch (pitchErr) {
            console.warn('auto pitch assign failed:', pitchErr);
            chunks = [{ text, speaker: undefined }];
          }
        } else if (text) {
          // Manual: stamp with speaker locked at segment cut time (Zoom active speaker / mic role)
          if (
            mode === 'manual' &&
            job.speakerId != null &&
            (job.source === 'system' || job.source === 'mic')
          ) {
            chunks = [{ text, speaker: job.speakerId }];
          } else {
            chunks = [{ text, speaker: undefined }];
          }
        }

        if (text.length > 0 || chunks.some((t) => t.text.trim())) {
          const newEntries: TranscriptEntry[] = [];
          let note = entriesLenRef.current;
          for (const turn of chunks) {
            const turnText = turn.text.trim();
            if (!turnText) continue;
            note += 1;
            newEntries.push({
              id:
                newEntries.length === 0
                  ? id
                  : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              note,
              text: turnText,
              lang,
              at,
              speakerId: turn.speaker,
            });
          }
          if (newEntries.length > 0) {
            setEntries((prev) => [...prev, ...newEntries]);
            entriesLenRef.current = note;
            try {
              await saveAudioSegment({
                id: newEntries[0]!.id,
                note: newEntries[0]!.note,
                at,
                mimeType,
                blob,
              });
              setAudioIds((prev) => new Set(prev).add(newEntries[0]!.id));
            } catch (audioErr) {
              console.error('audio save failed:', audioErr);
            }
            if (!data.diarize?.warning) setError('');
          }
        } else {
          // Keep empty / near-silent segment audio for session download.
          try {
            await saveAudioSegment({
              id,
              note: 0,
              at,
              mimeType,
              blob,
            });
            setAudioIds((prev) => new Set(prev).add(id));
          } catch (audioErr) {
            console.error('orphan audio save failed:', audioErr);
          }
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
      uploadQueueRef.current.push({
        blob,
        speakerId: activeSpeakerRef.current,
        source: audioSourceRef.current,
      });
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

  const acquireAudioStream = async (
    source: AudioSource
  ): Promise<MediaStream> => {
    if (source === 'mic') {
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }

    const options: DisplayMediaOptionsWithSystemAudio = {
      video: true,
      audio: true,
      systemAudio: 'include',
      windowAudio: 'system',
    };
    const displayStream = await navigator.mediaDevices.getDisplayMedia(options);
    const audioTracks = displayStream.getAudioTracks();
    // Whisper only needs audio; drop the video track to keep blobs small.
    displayStream.getVideoTracks().forEach((track) => track.stop());

    if (audioTracks.length === 0) {
      displayStream.getTracks().forEach((track) => track.stop());
      const err = new Error('NO_SYSTEM_AUDIO');
      err.name = 'NoSystemAudioError';
      throw err;
    }

    return new MediaStream(audioTracks);
  };

  const startRecording = async () => {
    setError('');

    let stream: MediaStream;
    try {
      stream = await acquireAudioStream(audioSource);
    } catch (e) {
      const err = e as DOMException | Error;
      console.error('音声ソース取得エラー:', err);
      if (err.name === 'AbortError' || err.name === 'NotAllowedError') {
        setError(
          audioSource === 'system'
            ? '画面共有がキャンセルされたか、許可されませんでした。'
            : 'マイクにアクセスできませんでした。ブラウザのマイク許可を確認してください。'
        );
        return;
      }
      if (err.name === 'NoSystemAudioError' || err.message === 'NO_SYSTEM_AUDIO') {
        setError(SYSTEM_AUDIO_HELP);
        return;
      }
      setError(
        audioSource === 'system'
          ? `アプリ / システム音声を取得できませんでした。${SYSTEM_AUDIO_HELP}`
          : 'マイクにアクセスできませんでした。ブラウザのマイク許可を確認してください。'
      );
      return;
    }

    streamRef.current = stream;
    mimeTypeRef.current = pickMimeType();
    wantRecordingRef.current = true;
    rotateAfterStopRef.current = false;

    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (!wantRecordingRef.current) return;
        wantRecordingRef.current = false;
        rotateAfterStopRef.current = false;
        clearSegmentTimer();
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state !== 'inactive') {
          recorder.stop();
        } else {
          stopTracks();
          setIsRecording(false);
        }
        setError('画面共有が終了したため録音を停止しました。');
      };
    });

    startRecorderOnStream();
    setIsRecording(true);

    clearSegmentTimer();
    const ms =
      audioSourceRef.current === 'system'
        ? SEGMENT_MS_SYSTEM
        : SEGMENT_MS_MIC;
    segmentTimerRef.current = setInterval(() => {
      rotateSegment();
    }, ms);
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

  const speakerDisplayName = (speakerId?: number) => {
    if (speakerId == null) return '—';
    const custom = speakerLabels[String(speakerId)];
    if (custom?.trim()) return custom.trim();
    const mic = micRoleLabel(speakerId);
    // Prefer mic role names when those ids were used as mic roles (no custom rename)
    if (mic && audioSource === 'mic') return mic;
    return defaultSpeakerLabel(speakerId);
  };

  const formatEntryForCopy = (e: TranscriptEntry) => {
    const label = e.speakerId != null ? `[${speakerDisplayName(e.speakerId)}] ` : '';
    const body = e.textJa ? `${e.text}\n\n（日本語）\n${e.textJa}` : e.text;
    return `${label}${body}`;
  };

  const renameSpeaker = (speakerId: number, name: string) => {
    const trimmed = name.trim();
    setSpeakerLabels((prev) => {
      const next = { ...prev };
      if (!trimmed) delete next[String(speakerId)];
      else next[String(speakerId)] = trimmed;
      return next;
    });
    setRenamingEntryId(null);
    setRenameDraft('');
  };


  const setEntrySpeaker = (entryId: string, speakerId: number, label?: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === entryId ? { ...e, speakerId } : e))
    );
    if (label) {
      setSpeakerLabels((prev) => {
        if (prev[String(speakerId)]?.trim()) return prev;
        return { ...prev, [String(speakerId)]: label };
      });
    }
  };

  const reassignAllByPitch = async () => {
    if (autoAssignBusy) return;
    setAutoAssignBusy(true);
    setError('');
    try {
      pitchCentroidsRef.current = [];
      const chronological = [...entries].sort((a, b) => a.note - b.note);
      const nextEntries = [...entries];
      for (const entry of chronological) {
        const seg = await getAudioSegment(entry.id);
        if (!seg) continue;
        const analysis = await analyzeBlobPitch(seg.blob);
        if (analysis.medianHz == null) continue;
        const assigned = assignSpeakerByPitch(
          analysis.medianHz,
          pitchCentroidsRef.current
        );
        pitchCentroidsRef.current = assigned.centroids;
        const idx = nextEntries.findIndex((e) => e.id === entry.id);
        if (idx >= 0) {
          nextEntries[idx] = {
            ...nextEntries[idx]!,
            speakerId: assigned.speakerId,
          };
        }
      }
      setEntries(nextEntries);
      lastSpeakerRef.current =
        pitchCentroidsRef.current[pitchCentroidsRef.current.length - 1]
          ?.speakerId ?? null;
    } catch (e) {
      console.error('reassign pitch failed:', e);
      setError('ピッチによる自動話者分けに失敗しました。');
    } finally {
      setAutoAssignBusy(false);
    }
  };

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
    setSummary('');
    setCopiedId(null);
    setAudioIds(new Set());
    setSpeakerLabels({});
    lastSpeakerRef.current = null;
    pitchCentroidsRef.current = [];
    clearStoredEntries();
    clearStoredSummary();
    clearStoredSpeakerLabels();
    void clearAllAudio().catch((err) => console.error('audio clear failed:', err));
  };

  const downloadSegmentAudio = async (entryId: string) => {
    setAudioBusyId(entryId);
    setError('');
    try {
      const seg = await getAudioSegment(entryId);
      if (!seg) {
        setError('このセグメントの録音データがありません。');
        return;
      }
      triggerBlobDownload(seg.blob, filenameForSegment(seg));
    } catch (e) {
      console.error('segment download failed:', e);
      setError('録音のダウンロードに失敗しました。');
    } finally {
      setAudioBusyId(null);
    }
  };

  const downloadAllAudioZip = async () => {
    setAudioBusyId('__all__');
    setError('');
    try {
      const segs = await listAudioSegments();
      if (segs.length === 0) {
        setError('ダウンロードできる録音がありません。');
        return;
      }
      const files = await Promise.all(
        segs.map(async (seg) => ({
          name: filenameForSegment(seg),
          data: new Uint8Array(await seg.blob.arrayBuffer()),
        }))
      );
      const zip = buildStoreZip(files);
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19);
      triggerBlobDownload(zip, `minutes-audio-${stamp}.zip`);
    } catch (e) {
      console.error('zip download failed:', e);
      setError('録音ZIPのダウンロードに失敗しました。');
    } finally {
      setAudioBusyId(null);
    }
  };

  const clearSummaryOnly = () => {
    setSummary('');
    clearStoredSummary();
  };

  const buildTranscriptForSummary = () => {
    const chronological = [...entries].sort((a, b) => a.note - b.note);
    return chronological
      .map((e) => {
        const sp =
          e.speakerId != null ? ` ${speakerDisplayName(e.speakerId)}` : '';
        const header = `#${e.note}${sp} [${e.lang}] ${e.at}`;
        if (e.textJa) {
          return `${header}\n${e.text}\n(日本語訳)\n${e.textJa}`;
        }
        return `${header}\n${e.text}`;
      })
      .join('\n\n');
  };

  const runSummary = async () => {
    if (entries.length === 0 || isSummarizing) return;
    setIsSummarizing(true);
    setError('');
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: buildTranscriptForSummary(),
          genre: genre.trim() || undefined,
          context: genre.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { summary?: string; error?: string };
      if (!res.ok) {
        setError(data.error || `要約に失敗しました (${res.status})`);
        return;
      }
      const next = data.summary?.trim() ?? '';
      if (!next) {
        setError('要約結果が空でした。');
        return;
      }
      setSummary(next);
    } catch (e) {
      console.error('summarize failed:', e);
      setError('要約リクエストに失敗しました。');
    } finally {
      setIsSummarizing(false);
    }
  };

  const openSummaryPanel = () => {
    setSummaryOpen(true);
    setMenuOpen(false);
    window.setTimeout(() => {
      summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const renderSummaryPanel = () => (
    <section
      ref={summaryRef}
      className={
        summaryOpen ? styles.summaryPanelExpanded : styles.summaryPanelCollapsed
      }
    >
      {!summaryOpen ? (
        <button
          type="button"
          className={styles.summaryChip}
          onClick={openSummaryPanel}
          aria-expanded={false}
        >
          <span className={styles.summaryChipLabel}>要約</span>
          <span className={styles.summaryChipMeta}>
            {isSummarizing
              ? '生成中…'
              : summary
                ? '保存済み · タップで展開'
                : 'たたみ表示 · タップで開く'}
          </span>
          <span className={styles.summaryChipChevron} aria-hidden="true" />
        </button>
      ) : (
        <>
          <div className={styles.summaryTopRow}>
            <button
              type="button"
              className={styles.summaryCollapseBar}
              onClick={() => setSummaryOpen(false)}
              aria-expanded={true}
              aria-label="要約を閉じる"
            >
              <span className={styles.summaryChipLabel}>要約</span>
              <span className={styles.summaryChipMeta}>
                {isSummarizing
                  ? '生成中…'
                  : 'タップで閉じる'}
              </span>
              <span
                className={styles.summaryChipChevronUp}
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              className={styles.summaryCloseButton}
              onClick={() => setSummaryOpen(false)}
              aria-label="要約を閉じる"
            >
              ×
            </button>
          </div>
          <div className={styles.summaryHeader}>
            <p className={styles.feedCount}>
              Ollama · 決定 / アクション / トピック
              {genre.trim() ? ` · 文脈: ${genre.trim()}` : ''}
            </p>
            <div className={styles.feedActions}>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={runSummary}
                disabled={entries.length === 0 || isSummarizing}
              >
                {isSummarizing ? '要約中…' : '要約を生成'}
              </button>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => summary && copyText('__summary__', summary)}
                disabled={!summary}
              >
                {copiedId === '__summary__' ? 'Copied' : '要約をコピー'}
              </button>
              <button
                type="button"
                className={styles.ghostButtonDanger}
                onClick={clearSummaryOnly}
                disabled={!summary}
              >
                要約クリア
              </button>
            </div>
          </div>
          {summary ? (
            <pre className={styles.summaryBody}>{summary}</pre>
          ) : (
            <p className={styles.summaryEmpty}>
              {entries.length === 0
                ? '文字起こしがあると要約できます。'
                : '「要約を生成」で会議の決定・アクションをまとめます。'}
            </p>
          )}
        </>
      )}
    </section>
  );

  const translateEntry = async (entry: TranscriptEntry) => {
    if (!isEnglishEntry(entry) || entry.textJa) return;

    setTranslatingIds((prev) => new Set(prev).add(entry.id));
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: entry.text,
          genre: genre.trim() || undefined,
          context: genre.trim() || undefined,
        }),
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
    const speakerId = entry.speakerId;
    const isRenaming = renamingEntryId === entry.id && speakerId != null;
    const showZoomSpeakerUi = audioSource === 'system';
    const showMicRoleUi = audioSource === 'mic';
    return (
      <li key={entry.id} className={styles.entry}>
        <div className={styles.entryMeta}>
          <div className={styles.entryMetaLeft}>
            {/* Index chrome only — no speaker controls on #N */}
            <span className={styles.entryIndex} aria-hidden="false">
              #{entry.note}
            </span>
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
                {translating ? 'Ollama翻訳中…' : 'Ollamaでローカル翻訳'}
              </button>
            )}
            {audioIds.has(entry.id) && (
              <button
                type="button"
                className={styles.copyButton}
                disabled={audioBusyId === entry.id}
                onClick={() => downloadSegmentAudio(entry.id)}
              >
                {audioBusyId === entry.id ? '準備中…' : '録音をダウンロード'}
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

        {(showMicRoleUi || showZoomSpeakerUi) && (
          <div className={styles.speakerRow} aria-label="話者">
            {showMicRoleUi && (
              <div className={styles.roleToggle} role="group" aria-label="マイク役割">
                {MIC_ROLES.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    className={
                      speakerId === role.id
                        ? styles.roleButtonActive
                        : styles.roleButton
                    }
                    aria-pressed={speakerId === role.id}
                    onClick={() =>
                      setEntrySpeaker(entry.id, role.id, role.label)
                    }
                  >
                    {role.label}
                  </button>
                ))}
              </div>
            )}
            {showZoomSpeakerUi && (
              <>
                {isRenaming && speakerId != null ? (
                  <form
                    className={styles.speakerRenameForm}
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      renameSpeaker(speakerId, renameDraft);
                    }}
                  >
                    <input
                      className={styles.speakerRenameInput}
                      value={renameDraft}
                      onChange={(ev) => setRenameDraft(ev.target.value)}
                      placeholder={letterForSpeakerId(speakerId)}
                      aria-label="話者名（改名）"
                      autoFocus
                    />
                    <button type="submit" className={styles.copyButton}>
                      保存
                    </button>
                    <button
                      type="button"
                      className={styles.copyButton}
                      onClick={() => {
                        setRenamingEntryId(null);
                        setRenameDraft('');
                      }}
                    >
                      取消
                    </button>
                  </form>
                ) : (
                  <div className={styles.letterToggle} role="group" aria-label="話者 A〜G">
                    {SPEAKER_LETTERS.map((letter, idx) => {
                      const id = idx + 1;
                      return (
                        <button
                          key={letter}
                          type="button"
                          className={
                            speakerId === id
                              ? styles.letterButtonActive
                              : styles.letterButton
                          }
                          aria-pressed={speakerId === id}
                          onClick={() => setEntrySpeaker(entry.id, id)}
                          onDoubleClick={() => {
                            setRenamingEntryId(entry.id);
                            setRenameDraft(speakerLabels[String(id)] || '');
                          }}
                          title="クリックで選択 / ダブルクリックで改名"
                        >
                          {speakerId === id
                            ? speakerDisplayName(id)
                            : letter}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <pre className={styles.transcript}>{entry.text}</pre>
        {entry.textJa && (
          <div className={styles.translationBlock}>
            <div className={styles.translationLabel}>日本語訳（ローカル）</div>
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

      {renderSummaryPanel()}

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
                  ? `Ollamaで全て翻訳 (${untranslatedEn.length})`
                  : 'Ollamaで全て翻訳'}
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
              className={styles.ghostButton}
              onClick={downloadAllAudioZip}
              disabled={audioIds.size === 0 || audioBusyId === '__all__'}
            >
              {audioBusyId === '__all__'
                ? 'ZIP準備中…'
                : '録音をまとめてダウンロード'}
            </button>
            <button
              type="button"
              className={styles.ghostButtonDanger}
              onClick={clearAll}
              disabled={entries.length === 0 && !summary}
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
        <button
          type="button"
          className={styles.menuButton}
          aria-label="メニュー"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <span className={styles.menuIcon} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true" />
          <div className={styles.brandText}>
            <h1 className={styles.title}>Minutes</h1>
            <p className={styles.subtitle}>Local Whisper meeting notes</p>
          </div>
        </div>
        <div className={styles.topMeta}>
          <span className={styles.metaChip}>約{segmentMs / 1000}秒区切り</span>
          <span className={styles.metaChip}>{entries.length}件</span>
        </div>
      </header>

      <div className={styles.noteEntryBar}>
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
      </div>

      {menuOpen && (
        <div className={styles.menuRoot}>
          <button
            type="button"
            className={styles.menuBackdrop}
            aria-label="メニューを閉じる"
            onClick={() => setMenuOpen(false)}
          />
          <aside className={styles.menuDrawer} role="dialog" aria-modal="true" aria-label="メニュー">
            <div className={styles.menuDrawerHeader}>
              <h2 className={styles.menuDrawerTitle}>メニュー</h2>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => setMenuOpen(false)}
              >
                閉じる
              </button>
            </div>
            <nav className={styles.menuNav}>
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  setScreen('note1');
                }}
              >
                <span className={styles.menuItemTitle}>Note 1 · 古い順</span>
                <span className={styles.menuItemDesc}>タイムラインを最初から読む</span>
              </button>
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  setScreen('note2');
                }}
              >
                <span className={styles.menuItemTitle}>Note 2 · 新しい順</span>
                <span className={styles.menuItemDesc}>最新セグメントを上に表示</span>
              </button>
              <button
                type="button"
                className={styles.menuItem}
                onClick={openSummaryPanel}
              >
                <span className={styles.menuItemTitle}>要約</span>
                <span className={styles.menuItemDesc}>
                  {summary ? '保存済み要約を展開' : '要約パネルを開く'}
                </span>
              </button>
            </nav>
            <div className={styles.menuGenre}>
              <label htmlFor="meeting-genre" className={styles.dockLabel}>
                ジャンル / 文脈
              </label>
              <input
                id="meeting-genre"
                ref={genreInputRef}
                className={styles.genreInput}
                type="text"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder="例: 週次エンジニア定例 / 採用面接"
                autoComplete="off"
              />
              <p className={styles.genreHint}>
                翻訳・要約の精度向上（任意）
              </p>
            </div>
            <button
              type="button"
              className={styles.menuDanger}
              onClick={() => {
                clearAll();
                setMenuOpen(false);
              }}
              disabled={entries.length === 0 && !summary}
            >
              履歴をクリア
            </button>
          </aside>
        </div>
      )}

      <aside className={styles.controlDock}>
        <div className={styles.dockInner}>
          <div className={styles.dockGroup}>
            <span className={styles.dockLabel}>音声ソース</span>
            <div
              className={styles.langToggle}
              role="group"
              aria-label="音声ソース"
            >
              <button
                type="button"
                className={
                  audioSource === 'mic'
                    ? styles.langButtonActive
                    : styles.langButton
                }
                disabled={isRecording}
                aria-pressed={audioSource === 'mic'}
                onClick={() => setAudioSource('mic')}
              >
                マイク
              </button>
              <button
                type="button"
                className={
                  audioSource === 'system'
                    ? styles.langButtonActive
                    : styles.langButton
                }
                disabled={isRecording}
                aria-pressed={audioSource === 'system'}
                onClick={() => setAudioSource('system')}
              >
                Zoom・LINE・他
              </button>
            </div>
          </div>

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

        {audioSource === 'system' && !isRecording && (
          <p className={styles.audioSourceHint}>
            Zoom・LINE・その他アプリのウィンドウ / タブ / 画面を共有し、「システム音声を共有」をオンにします。取れないときは BlackHole 等でマイクへ迂回。
          </p>
        )}

        {audioSource === 'mic' && (
          <div className={styles.speakerModeBar}>
            <span className={styles.dockLabel}>役割（マイク）</span>
            <div className={styles.roleToggle} role="group" aria-label="録音中の役割">
              {MIC_ROLES.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  className={
                    activeSpeakerId === role.id
                      ? styles.roleButtonActive
                      : styles.roleButton
                  }
                  aria-pressed={activeSpeakerId === role.id}
                  onClick={() => setActiveSpeakerId(role.id)}
                >
                  {role.label}
                </button>
              ))}
            </div>
            <p className={styles.diarizeHint} role="status">
              マイクはシンプルな役割のみ。新しい文字起こしは選択中の役割に付きます。
            </p>
          </div>
        )}

        {audioSource === 'system' && (
          <>
            <div className={styles.speakerModeBar}>
              <span className={styles.dockLabel}>話者分け（Zoom）</span>
              <div
                className={styles.langToggle}
                role="group"
                aria-label="話者分けモード"
              >
                <button
                  type="button"
                  className={
                    speakerMode === 'manual'
                      ? styles.langButtonActive
                      : styles.langButton
                  }
                  aria-pressed={speakerMode === 'manual'}
                  onClick={() => setSpeakerMode('manual')}
                >
                  手動
                </button>
                <button
                  type="button"
                  className={
                    speakerMode === 'auto'
                      ? styles.langButtonActive
                      : styles.langButton
                  }
                  aria-pressed={speakerMode === 'auto'}
                  onClick={() => setSpeakerMode('auto')}
                >
                  自動
                </button>
              </div>
              {speakerMode === 'auto' && (
                <button
                  type="button"
                  className={styles.ghostButton}
                  disabled={autoAssignBusy || entries.length === 0}
                  onClick={() => void reassignAllByPitch()}
                >
                  {autoAssignBusy ? '推定中…' : 'ピッチで付け直す'}
                </button>
              )}
            </div>

            {speakerMode === 'manual' && (
              <div className={styles.activeSpeakerBar}>
                <span className={styles.dockLabel}>
                  {isRecording ? 'いま話す人' : '次の話者'}
                </span>
                <div
                  className={styles.letterToggle}
                  role="group"
                  aria-label="アクティブ話者 A〜G"
                >
                  {SPEAKER_LETTERS.map((letter, idx) => {
                    const id = idx + 1;
                    return (
                      <button
                        key={letter}
                        type="button"
                        className={
                          activeSpeakerId === id
                            ? styles.letterButtonActive
                            : styles.letterButton
                        }
                        aria-pressed={activeSpeakerId === id}
                        onClick={() => setActiveSpeakerId(id)}
                      >
                        {letterForSpeakerId(id)}
                      </button>
                    );
                  })}
                </div>
                <p className={styles.diarizeHint} role="status">
                  話者を選んでから話します。途中で切替可。Zoom は約60秒区切りで、その間の文字は選択中話者に付きます。
                </p>
              </div>
            )}

            {speakerMode === 'auto' && (
              <p className={styles.diarizeHint} role="status">
                {diarizeStatus?.active
                  ? `自動: whisper ${diarizeStatus.mode} を優先。なければピッチで仮の A/B…。`
                  : '自動: tinydiarize 未使用のためピッチで仮の A/B…（目安）。'}
                {diarizeStatus?.setupHint ? ` ${diarizeStatus.setupHint}` : ''}
              </p>
            )}
          </>
        )}

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </aside>

      {renderSummaryPanel()}

      <section className={styles.feed}>
        <div className={styles.feedToolbar}>
          <div className={styles.feedActions}>
            {untranslatedEn.length > 0 && (
              <button
                type="button"
                className={styles.ghostButton}
                onClick={translateAllEnglish}
                disabled={translatingIds.size > 0}
              >
                {translateConfigured
                  ? `Ollamaで全て翻訳 (${untranslatedEn.length})`
                  : 'Ollamaで全て翻訳'}
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
              className={styles.ghostButton}
              onClick={downloadAllAudioZip}
              disabled={audioIds.size === 0 || audioBusyId === '__all__'}
            >
              {audioBusyId === '__all__'
                ? 'ZIP準備中…'
                : '録音をまとめてダウンロード'}
            </button>
            <button
              type="button"
              className={styles.ghostButtonDanger}
              onClick={clearAll}
              disabled={entries.length === 0 && !summary}
            >
              Clear
            </button>
          </div>
        </div>

        {entries.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyOrb} aria-hidden="true" />
            <h3 className={styles.emptyTitle}>
              {isTranscribing ? '最初の文字起こしを待っています' : '録音の準備ができました'}
            </h3>
            <p className={styles.emptyBody}>
              {isTranscribing
                ? '音声を Whisper に送っています。結果がここに表示されます。'
                : '音声ソース（マイク / Zoom・LINE・他アプリ）を選び、Record を押してください。上の Note 1 / Note 2 で履歴を閲覧できます。'}
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
