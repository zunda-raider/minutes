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
  loadLastCopyAt,
  loadSpeakerMode,
  saveLastCopyAt,
  type SpeakerLabels,
  type SpeakerMode,
} from '@/lib/history-storage';
import { remapSpeakersContinuity, type DiarizeTurn } from '@/lib/diarize-parse';
import {
  letterForSpeakerId,
  ASSIGN_BUCKETS,
  cardSpeakerBadge,
  type CardSpeakerTone,
  SPEAKER_LETTERS,
  ZOOM_CATEGORIES,
  zoomCategoryForSpeaker,
  zoomLetterButtonLabel,
  type ZoomCategoryId,
} from '@/lib/speaker-letters';
import { applySpeakerSplit, type TextSpan } from '@/lib/split-speaker';
import { mergeSelectedCards } from '@/lib/merge-entries';
import { coalesceHomeCaptureChunks } from '@/lib/coalesce-home-chunks';
import { newestFirstReadingOrder } from '@/lib/home-feed-order';
import { MIC_ROLES, micRoleLabel } from '@/lib/mic-roles';
import {
  analyzeBlobPitch,
  assignSpeakerByPitch,
  provisionalTurnsFromPitch,
  type PitchCentroid,
} from '@/lib/pitch-diarize';
import {
  speakersFromMicEnergy,
  type EnergyWindow,
} from '@/lib/self-energy';
import type { WhisperSegment } from '@/lib/diarize-parse';
import {
  clearAllAudio,
  deleteAudioSegments,
  filenameForSegment,
  getAudioSegment,
  listAudioIds,
  listAudioSegments,
  saveAudioSegment,
  triggerBlobDownload,
} from '@/lib/audio-storage';
import { buildStoreZip } from '@/lib/zip-store';
import { GdScreen } from './gd-screen';
import {
  SYSTEM_AUDIO_HELP,
  acquireSystemAudio,
  beginCaptureSession,
  captureSessionCount,
  hasLiveAudio,
  isCaptureStale,
  markCaptureStale,
  openRecordedSlice,
  openSelfMic,
  primeCaptureTap,
  reviveHeldCapture,
  pickRecorderMimeType,
  stopMediaTracks,
  watchDeadSystemCapture,
} from '@/lib/zoom-capture';
import {
  captureGeneration,
  clearTrackedInterval,
  ensureRecorderStops,
  registerHaltHook,
  rememberStream,
  trackAbort,
  trackInterval,
  trackRecorder,
} from '@/lib/capture-resources';
import { watchLiveCapture } from '@/lib/live-capture';
import { postTranscribe } from '@/lib/transcribe-fetch';
import { StopShareButton } from './stop-share';

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
  /** mic vs Zoom/system, so meta labels can tell 質問者 from セミナー */
  source?: 'mic' | 'system';
};


type Screen = 'home' | 'note1' | 'note2' | 'gd';

type TranslateResultItem = {
  id: string;
  note: number;
  text: string;
  textJa: string;
};

/** Ollama 後翻訳の進行 / 結果ポップアップ */
type TranslateModalState = {
  phase: 'running' | 'done' | 'error' | 'view';
  total: number;
  finished: number;
  currentNote?: number;
  items: TranslateResultItem[];
  errors: string[];
};
type AudioSource = 'mic' | 'system';

/** Minutes / Home: Zoom and mic both rotate about once a minute.
 * Mid-cut Whisper / pitch / diarize turns are folded back into one card. */
const HOME_SEGMENT_MS = 60_000;

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

const CARD_TONE_CLASS: Record<CardSpeakerTone, string> = {
  self: styles.entrySelf,
  seminar: styles.entrySeminar,
  other: styles.entryOther,
  letter: styles.entryLetter,
  questioner: styles.entryOther,
};

const BADGE_TONE_CLASS: Record<CardSpeakerTone, string> = {
  self: styles.entrySpeakerBadgeSelf,
  seminar: styles.entrySpeakerBadgeSeminar,
  other: styles.entrySpeakerBadgeOther,
  letter: styles.entrySpeakerBadgeLetter,
  questioner: styles.entrySpeakerBadgeQuestioner,
};

function isEnglishEntry(entry: TranscriptEntry): boolean {
  return entry.lang === 'en' || entry.lang.startsWith('en-');
}

/** Zoom speaker B. Mic id 2 is 質問者, not セミナー. */
function isSeminarUtterance(entry: TranscriptEntry): boolean {
  return entry.speakerId === 2 && entry.source !== 'mic';
}

/** Speaker A (自分) plus C–G (それ以外 and leftover letters). Excludes B and unlabeled. */
function isSelfOrOtherUtterance(entry: TranscriptEntry): boolean {
  const id = entry.speakerId;
  if (id == null) return false;
  if (id === 1) return true;
  return id >= 3 && id <= SPEAKER_LETTERS.length;
}

function entryIdFromNode(node: EventTarget | Node | null): string | null {
  const el =
    node instanceof Element
      ? node
      : node instanceof Node
        ? node.parentElement
        : null;
  const li = el?.closest('[data-entry-id]');
  return li?.getAttribute('data-entry-id') ?? null;
}

function formatNote(note: number): string {
  if (!Number.isFinite(note)) return '?';
  if (Math.abs(note - Math.round(note)) < 1e-6) return String(Math.round(note));
  return note.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** Offsets of a DOM range inside a transcript node. null if the range misses it. */
function textSpanIn(root: HTMLElement, range: Range): TextSpan | null {
  if (!root.textContent) return null;
  let hits = false;
  try {
    hits = range.intersectsNode(root);
  } catch {
    return null;
  }
  if (!hits) return null;
  const content = document.createRange();
  content.selectNodeContents(root);
  const startRange = document.createRange();
  startRange.setStart(content.startContainer, content.startOffset);
  if (range.compareBoundaryPoints(Range.START_TO_START, content) <= 0) {
    startRange.setEnd(content.startContainer, content.startOffset);
  } else {
    startRange.setEnd(range.startContainer, range.startOffset);
  }
  const endRange = document.createRange();
  endRange.setStart(content.startContainer, content.startOffset);
  if (range.compareBoundaryPoints(Range.END_TO_END, content) >= 0) {
    endRange.setEnd(content.endContainer, content.endOffset);
  } else {
    endRange.setEnd(range.endContainer, range.endOffset);
  }
  const start = startRange.toString().length;
  const end = endRange.toString().length;
  if (end <= start) return null;
  return { start, end };
}

function rangeIds(listIds: string[], anchor: string, current: string): string[] {
  const ia = listIds.indexOf(anchor);
  const ib = listIds.indexOf(current);
  if (ia < 0 || ib < 0) return [current];
  const lo = Math.min(ia, ib);
  const hi = Math.max(ia, ib);
  return listIds.slice(lo, hi + 1);
}

/** Live DOM selection inside transcript cards. null when nothing is selected. */
function readTextSelection(): { hits: string[]; spans: Map<string, TextSpan> } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  if (!entryIdFromNode(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0);
  const hits: string[] = [];
  const spans = new Map<string, TextSpan>();
  document.querySelectorAll('[data-entry-id]').forEach((node) => {
    try {
      if (!range.intersectsNode(node)) return;
    } catch {
      return;
    }
    const id = node.getAttribute('data-entry-id');
    if (!id) return;
    hits.push(id);
    const root = node.querySelector('[data-transcript]');
    if (root instanceof HTMLElement) {
      const span = textSpanIn(root, range);
      if (span) spans.set(id, span);
    }
  });
  if (hits.length === 0) return null;
  return { hits, spans };
}

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState('');
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(new Set());
  const [translateModal, setTranslateModal] = useState<TranslateModalState | null>(null);
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
  const [autoAssignBusy, setAutoAssignBusy] = useState(false);
  const [audioIds, setAudioIds] = useState<Set<string>>(() => new Set());
  const [audioBusyId, setAudioBusyId] = useState<string | null>(null);
  /** Active speaker while recording (Zoom A–G or mic role). Optional; sort afterward. */
  const [activeSpeakerId, setActiveSpeakerId] = useState<number>(1);
  /** Set when Zoom mic permission is denied; energy tagging stays off. */
  const [selfMicNote, setSelfMicNote] = useState('');
  /** Cards chosen for post-hoc 自分 / セミナー / それ以外. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  /** Ids waiting for a second click to confirm delete. */
  const [armedDelete, setArmedDelete] = useState<string[] | null>(null);
  /**
   * cards: drag highlighted whole cards (entrySelected).
   * text: DOM text selection — do not toggle entrySelected or the browser
   * collapses the range mid-drag / on commit.
   */
  const [selectionKind, setSelectionKind] = useState<'cards' | 'text'>('cards');
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const selectionKindRef = useRef(selectionKind);
  selectionKindRef.current = selectionKind;
  /** Card-drag pointerup must not also commit a text selection. */
  const suppressTextCommitRef = useRef(false);
  const selectAnchorRef = useRef<string | null>(null);
  /** Partial transcript offsets captured while the text selection is still live. */
  const textSpansRef = useRef<Map<string, TextSpan>>(new Map());
  const visibleIdsRef = useRef<string[]>([]);
  const dragSelectRef = useRef<{
    pointerId: number;
    anchor: string;
    listIds: string[];
    base: Set<string>;
  } | null>(null);
  const summaryRef = useRef<HTMLElement | null>(null);
  const genreInputRef = useRef<HTMLInputElement | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** Source that owns streamRef, so a later Record can reuse it. */
  const heldSourceRef = useRef<AudioSource | null>(null);
  const releaseLiveRef = useRef<(() => void) | null>(null);
  const releasingRef = useRef(false);
  const stopTracksRef = useRef<() => void>(() => {});
  const stopRecordingRef = useRef<() => void>(() => {});
  /** Parallel mic used only in Zoom/system mode, for 自分 energy — not STT. */
  const micStreamRef = useRef<MediaStream | null>(null);
  const micRecorderRef = useRef<MediaRecorder | null>(null);
  /** User picked a Zoom speaker during the current segment (overrides energy). */
  const segmentManualRef = useRef(false);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef('audio/webm');
  const langRef = useRef(lang);
  langRef.current = lang;

  const wantRecordingRef = useRef(false);
  const rotateAfterStopRef = useRef(false);
  const segmentTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Bumped on soft stop and hard halt so a stale rotate interval clears itself. */
  const timerSessionRef = useRef(0);
  const startingRef = useRef(false);

  type UploadJob = {
    blob: Blob;
    /** Speaker selected when the segment was cut */
    speakerId: number | null;
    source: AudioSource;
    /** Parallel mic capture. Zoom/system only; never set for mic-only jobs. */
    micBlob?: Blob | null;
    /** True when the user changed the Zoom picker during this segment. */
    manualLock?: boolean;
  };
  const uploadQueueRef = useRef<UploadJob[]>([]);
  const queueRunningRef = useRef(false);
  /** Bumped on hard halt so a late segment cannot enqueue or rotate. */
  const queueEpochRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  /** Highest note number issued. Not a length, so deletes keep gaps. */
  const entriesLenRef = useRef(0);
  const lastSpeakerRef = useRef<number | null>(null);
  const speakerModeRef = useRef<SpeakerMode>('manual');
  const pitchCentroidsRef = useRef<PitchCentroid[]>([]);
  const audioSourceRef = useRef<AudioSource>('mic');
  const activeSpeakerRef = useRef<number>(1);
  const copyHintTimerRef = useRef<number | null>(null);

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
    return registerHaltHook(() => {
      queueEpochRef.current += 1;
      uploadQueueRef.current = [];
      abortRef.current?.abort();
      abortRef.current = null;
      queueRunningRef.current = false;
      wantRecordingRef.current = false;
      rotateAfterStopRef.current = false;
      timerSessionRef.current += 1;
      clearSegmentTimer();
      setIsRecording(false);
      setPendingCount(0);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (segmentTimerRef.current) clearTrackedInterval(segmentTimerRef.current);
      wantRecordingRef.current = false;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          /* already stopped */
        }
      }
      stopTracksRef.current();
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
    const maxNote = entries.reduce((max, entry) => Math.max(max, entry.note), 0);
    // Ceil so a split fragment (2.5) does not make the next recording note fractional.
    const ceiling = Math.ceil(maxNote - 1e-9);
    if (ceiling > entriesLenRef.current) entriesLenRef.current = ceiling;
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

  const segmentMs = HOME_SEGMENT_MS;

  const stopTracks = () => {
    releasingRef.current = true;
    releaseLiveRef.current?.();
    releaseLiveRef.current = null;
    const micRec = micRecorderRef.current;
    micRecorderRef.current = null;
    if (micRec && micRec.state !== 'inactive') {
      try {
        micRec.stop();
      } catch {
        /* already stopped */
      }
    }
    const sysRec = mediaRecorderRef.current;
    if (sysRec && sysRec.state !== 'inactive') {
      try {
        sysRec.stop();
      } catch {
        /* already stopped */
      }
    }
    stopMediaTracks(streamRef.current, micStreamRef.current);
    streamRef.current = null;
    micStreamRef.current = null;
    heldSourceRef.current = null;
    releasingRef.current = false;
  };
  stopTracksRef.current = stopTracks;

  const clearSegmentTimer = () => {
    clearTrackedInterval(segmentTimerRef.current);
    segmentTimerRef.current = null;
  };

  const processQueue = useCallback(async () => {
    if (queueRunningRef.current) return;
    queueRunningRef.current = true;
    const epoch = queueEpochRef.current;

    while (uploadQueueRef.current.length > 0) {
      if (queueEpochRef.current !== epoch) break;
      const job = uploadQueueRef.current.shift()!;
      const blob = job.blob;
      const controller = trackAbort(new AbortController());
      abortRef.current = controller;
      try {
        const formData = new FormData();
        formData.append(
          'file',
          new File([blob], 'audio.webm', { type: blob.type || mimeTypeRef.current })
        );
        formData.append('lang', langRef.current);
        formData.append('modelKey', '1');

        const res = await postTranscribe(formData, controller.signal);
        if (
          queueEpochRef.current !== epoch ||
          controller.signal.aborted ||
          res.status === 499
        ) {
          break;
        }

        let data: {
          text?: string;
          error?: string;
          lang?: string;
          turns?: DiarizeTurn[];
          segments?: WhisperSegment[];
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

        const useMicEnergy =
          job.source === 'system' &&
          !job.manualLock &&
          job.micBlob != null &&
          job.micBlob.size > 0 &&
          text.length > 0;

        if (useMicEnergy) {
          // Zoom only: one energy window for the whole Home cut (~60s).
          // Per-Whisper-row cards stay on GD live (transcribe-zoom).
          // Mic-only jobs never carry micBlob, so they stay on the manual role.
          try {
            if (controller.signal.aborted || queueEpochRef.current !== epoch) break;
            const timed: EnergyWindow[] = [
              { text, startSec: 0, endSec: Number.POSITIVE_INFINITY },
            ];
            const tagged = await speakersFromMicEnergy(
              blob,
              job.micBlob!,
              timed,
              controller.signal
            );
            if (queueEpochRef.current !== epoch || controller.signal.aborted) break;
            chunks = tagged.map((row) => ({
              text: row.text,
              speaker: row.speakerId,
            }));
          } catch (energyErr) {
            console.warn('mic energy self-tag failed:', energyErr);
            chunks = [{ text, speaker: undefined }];
          }
        } else if (mode === 'auto' && hasWhisperDiarize) {
          const { turns, lastSpeaker } = remapSpeakersContinuity(
            data.turns!,
            lastSpeakerRef.current
          );
          if (lastSpeaker != null) lastSpeakerRef.current = lastSpeaker;
          chunks = turns;
        } else if (mode === 'auto' && text) {
          // Pitch / voice-height heuristic when tinydiarize unavailable
          try {
            if (controller.signal.aborted || queueEpochRef.current !== epoch) break;
            const analysis = await analyzeBlobPitch(blob, controller.signal);
            if (queueEpochRef.current !== epoch || controller.signal.aborted) break;
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

        // One Home capture ≈ HOME_SEGMENT_MS; do not keep Whisper-fine cards.
        chunks = coalesceHomeCaptureChunks(chunks);

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
              source: job.source,
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
        if (queueEpochRef.current !== epoch || controller.signal.aborted) break;
        console.error('送信エラー:', fetchErr);
        setError('文字起こしリクエストに失敗しました。');
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (queueEpochRef.current === epoch) {
          setPendingCount((n) => Math.max(0, n - 1));
        }
      }
    }

    if (queueEpochRef.current === epoch) queueRunningRef.current = false;
  }, []);

  const enqueueTranscribe = useCallback(
    (
      blob: Blob,
      extra?: { micBlob?: Blob | null; manualLock?: boolean }
    ) => {
      if (blob.size === 0) return;
      const source = audioSourceRef.current;
      uploadQueueRef.current.push({
        blob,
        speakerId: activeSpeakerRef.current,
        source,
        // Energy comparison is Zoom/system only.
        micBlob: source === 'system' ? extra?.micBlob ?? null : null,
        manualLock: source === 'system' ? Boolean(extra?.manualLock) : false,
      });
      setPendingCount((n) => n + 1);
      void processQueue();
    },
    [processQueue]
  );

  const startRecorderOnStream = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    reviveHeldCapture(stream);
    reviveHeldCapture(micStreamRef.current);
    const epoch = queueEpochRef.current;

    const mimeType = mimeTypeRef.current;
    chunksRef.current = [];
    const systemSlice = openRecordedSlice(stream);
    let recorder: MediaRecorder;
    try {
      recorder = trackRecorder(new MediaRecorder(systemSlice?.stream ?? stream, { mimeType }));
    } catch (err) {
      console.warn('system recorder failed:', err);
      systemSlice?.release();
      setError('録音を開始できませんでした。');
      wantRecordingRef.current = false;
      setIsRecording(false);
      return;
    }

    const micStream = micStreamRef.current;
    let micRecorder: MediaRecorder | null = null;
    const micChunks: Blob[] = [];
    const micLive =
      micStream != null &&
      audioSourceRef.current === 'system' &&
      micStream.getAudioTracks().some((t) => t.readyState === 'live');
    const micSlice = micLive && micStream ? openRecordedSlice(micStream) : null;
    if (micLive && micStream) {
      try {
        micRecorder = trackRecorder(
          new MediaRecorder(micSlice?.stream ?? micStream, { mimeType })
        );
        micRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) micChunks.push(e.data);
        };
      } catch (err) {
        console.warn('self mic recorder failed:', err);
        micSlice?.release();
        micRecorder = null;
      }
    } else {
      micSlice?.release();
    }
    micRecorderRef.current = micRecorder;
    segmentManualRef.current = false;

    let systemBlob: Blob | null = null;
    let micBlob: Blob | null = null;
    let systemDone = false;
    let micDone = micRecorder == null;
    let settled = false;

    const finishSegment = () => {
      if (!systemDone || !micDone || settled) return;
      settled = true;
      if (mediaRecorderRef.current === recorder) mediaRecorderRef.current = null;
      if (micRecorderRef.current === micRecorder) micRecorderRef.current = null;
      if (epoch !== queueEpochRef.current) return;
      const manualLock = segmentManualRef.current;
      if (systemBlob && systemBlob.size > 0) {
        enqueueTranscribe(systemBlob, {
          micBlob: manualLock ? null : micBlob,
          manualLock,
        });
      }

      if (wantRecordingRef.current && rotateAfterStopRef.current && streamRef.current) {
        rotateAfterStopRef.current = false;
        startRecorderOnStream();
        return;
      }

      if (!wantRecordingRef.current) {
        setIsRecording(false);
      }
    };

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onerror = () => {
      setError('録音中にエラーが発生しました。');
      wantRecordingRef.current = false;
      timerSessionRef.current += 1;
      clearSegmentTimer();
      stopTracks();
      setIsRecording(false);
    };

    const endWatch =
      audioSourceRef.current === 'system'
        ? watchDeadSystemCapture(stream, () => {
            if (epoch !== queueEpochRef.current) return;
            setError(
              'システム音声が無音のままです。停止してからもう一度録音すると、共有を取り直します。'
            );
          })
        : null;

    recorder.onstop = () => {
      systemSlice?.release();
      endWatch?.();
      systemBlob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      systemDone = true;
      if (micRecorder && micRecorder.state === 'recording') {
        try {
          micRecorder.stop();
        } catch {
          micDone = true;
        }
      } else if (!micDone) {
        micDone = true;
      }
      finishSegment();
    };

    if (micRecorder) {
      micRecorder.onstop = () => {
        micSlice?.release();
        micBlob = micChunks.length > 0 ? new Blob(micChunks, { type: mimeType }) : null;
        micDone = true;
        finishSegment();
      };
      micRecorder.onerror = () => {
        console.warn('self mic recorder error; continuing without auto 自分');
        micSlice?.release();
        micBlob = null;
        micDone = true;
        finishSegment();
      };
    }

    try {
      recorder.start(1000);
    } catch (err) {
      console.warn('system recorder start failed:', err);
      systemSlice?.release();
      micSlice?.release();
      endWatch?.();
      setError('録音を開始できませんでした。');
      wantRecordingRef.current = false;
      setIsRecording(false);
      return;
    }
    mediaRecorderRef.current = recorder;
    if (micRecorder && micRecorder.state === 'inactive') {
      try {
        micRecorder.start(1000);
      } catch (err) {
        console.warn('self mic start failed:', err);
        micSlice?.release();
        micRecorderRef.current = null;
        micDone = true;
      }
    } else if (!micRecorder) {
      micSlice?.release();
    }
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      rememberStream(stream);
      return stream;
    }
    return acquireSystemAudio();
  };

  const bindLiveWatch = (stream: MediaStream) => {
    releaseLiveRef.current?.();
    const watched = [stream, micStreamRef.current].filter(
      (item): item is MediaStream => item != null
    );
    releaseLiveRef.current = watchLiveCapture(() => {
      stopRecordingRef.current();
      stopTracks();
    }, watched);
  };

  const startRecording = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    try {
    setError('');

    const source = audioSource;
    const generation = captureGeneration();
    let stream = streamRef.current;
    // A previous halt may have left the held share live but disabled.
    reviveHeldCapture(stream);
    reviveHeldCapture(micStreamRef.current);
    const reuse =
      hasLiveAudio(stream) &&
      heldSourceRef.current === source &&
      !isCaptureStale(stream);

    if (!reuse || !stream) {
      if (streamRef.current || micStreamRef.current) stopTracks();
      const wantSelfMic = source === 'system';
      const selfMicPromise = wantSelfMic ? openSelfMic() : Promise.resolve(null);
      try {
        stream = await acquireAudioStream(source);
      } catch (e) {
        const leftover = await selfMicPromise;
        stopMediaTracks(leftover);
        const err = e as DOMException | Error;
        console.error('音声ソース取得エラー:', err);
        if (err.name === 'AbortError' || err.name === 'NotAllowedError') {
          setError(
            source === 'system'
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
          source === 'system'
            ? `アプリ / システム音声を取得できませんでした。${SYSTEM_AUDIO_HELP}`
            : 'マイクにアクセスできませんでした。ブラウザのマイク許可を確認してください。'
        );
        return;
      }

      const selfMic = await selfMicPromise;
      if (generation !== captureGeneration()) {
        stopMediaTracks(stream, selfMic);
        return;
      }
      if (wantSelfMic) {
        micStreamRef.current = selfMic;
        setSelfMicNote(
          selfMic ? '' : 'マイクが使えないため、「自分」の自動判定はオフです。'
        );
      } else {
        stopMediaTracks(selfMic);
        micStreamRef.current = null;
        setSelfMicNote('');
      }
      heldSourceRef.current = source;
    } else if (source === 'system' && !hasLiveAudio(micStreamRef.current)) {
      // A muted or ended mic still holds the device. Leaving it up makes the
      // next getUserMedia come back silent.
      stopMediaTracks(micStreamRef.current);
      micStreamRef.current = null;
      const selfMic = await openSelfMic();
      if (generation !== captureGeneration()) {
        stopMediaTracks(selfMic);
        return;
      }
      micStreamRef.current = selfMic;
      setSelfMicNote(
        selfMic ? '' : 'マイクが使えないため、「自分」の自動判定はオフです。'
      );
    }

    streamRef.current = stream;
    mimeTypeRef.current = pickRecorderMimeType();
    if (source === 'system') {
      const primed = await primeCaptureTap(stream);
      if (
        captureSessionCount(stream) >= 1 &&
        (primed !== 'ok' || isCaptureStale(stream))
      ) {
        if (!isCaptureStale(stream)) markCaptureStale(stream, `prime-${primed}`);
        stopTracks();
        setError('システム音声を取り直します。もう一度録音を押してください。');
        return;
      }
      if (micStreamRef.current) await primeCaptureTap(micStreamRef.current);
      beginCaptureSession(stream);
    }
    wantRecordingRef.current = true;
    bindLiveWatch(stream);
    rotateAfterStopRef.current = false;

    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (releasingRef.current) return;
        const wasRecording = wantRecordingRef.current;
        const source = heldSourceRef.current ?? audioSourceRef.current;
        wantRecordingRef.current = false;
        rotateAfterStopRef.current = false;
        timerSessionRef.current += 1;
        clearSegmentTimer();
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state !== 'inactive') {
          try {
            recorder.stop();
          } catch {
            /* ignore */
          }
        }
        stopTracks();
        setIsRecording(false);
        if (!wasRecording) return;
        setError(
          source === 'system'
            ? '画面共有が終了したため録音を停止しました。'
            : 'マイクが止まったため録音を停止しました。'
        );
      };
    });

    startRecorderOnStream();
    setIsRecording(true);

    clearSegmentTimer();
    const timerSession = ++timerSessionRef.current;
    const timerId = trackInterval(
      setInterval(() => {
        if (timerSession !== timerSessionRef.current || !wantRecordingRef.current) {
          clearTrackedInterval(timerId);
          if (segmentTimerRef.current === timerId) segmentTimerRef.current = null;
          return;
        }
        rotateSegment();
      }, HOME_SEGMENT_MS)
    );
    segmentTimerRef.current = timerId;
    } finally {
      startingRef.current = false;
    }
  };

  // Soft stop. Share (display + self mic) stays. Rotate timer is cleared so it
  // cannot enqueue another chunk. Already queued Whisper jobs still finish.
  const stopRecording = () => {
    wantRecordingRef.current = false;
    rotateAfterStopRef.current = false;
    timerSessionRef.current += 1;
    clearSegmentTimer();

    const recorder = mediaRecorderRef.current;
    const micRec = micRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      if (micRec && micRec.state !== 'inactive') {
        try {
          micRec.stop();
        } catch {
          /* already stopped */
        }
      }
      ensureRecorderStops(micRec);
      setIsRecording(false);
      return;
    }
    try {
      recorder.stop();
    } catch {
      if (micRec && micRec.state !== 'inactive') {
        try {
          micRec.stop();
        } catch {
          /* already stopped */
        }
      }
      setIsRecording(false);
    }
    ensureRecorderStops(recorder);
    ensureRecorderStops(micRec);
  };
  stopRecordingRef.current = stopRecording;

  const flashCopyHint = (message: string) => {
    setCopyHint(message);
    if (copyHintTimerRef.current != null) {
      window.clearTimeout(copyHintTimerRef.current);
    }
    copyHintTimerRef.current = window.setTimeout(() => {
      setCopyHint('');
      copyHintTimerRef.current = null;
    }, 1800);
  };

  const copyText = async (id: string, text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setCopyHint('');
      window.setTimeout(() => {
        setCopiedId((cur) => (cur === id ? null : cur));
      }, 1500);
      return true;
    } catch (e) {
      console.error('copy failed:', e);
      setError('クリップボードへのコピーに失敗しました。');
      return false;
    }
  };

  const chooseZoomSpeaker = (id: number) => {
    if (audioSourceRef.current === 'system') {
      segmentManualRef.current = true;
    }
    setActiveSpeakerId(id);
  };

  const speakerDisplayName = (speakerId?: number) => {
    if (speakerId == null) return '—';
    const custom = speakerLabels[String(speakerId)];
    if (custom?.trim()) return custom.trim();
    const mic = micRoleLabel(speakerId);
    // Prefer mic role names when those ids were used as mic roles (no custom rename)
    if (mic && audioSource === 'mic') return mic;
    if (speakerId >= 1 && speakerId <= SPEAKER_LETTERS.length) {
      return zoomLetterButtonLabel(speakerId);
    }
    return letterForSpeakerId(speakerId);
  };

  const categoryButtonClass = (id: ZoomCategoryId, active: boolean) => {
    if (id === 'self') {
      return active ? styles.categorySelfActive : styles.categorySelf;
    }
    if (id === 'seminar') {
      return active ? styles.categorySeminarActive : styles.categorySeminar;
    }
    return active ? styles.categoryOtherActive : styles.categoryOther;
  };

  const letterRoleClass = (speakerId: number, active: boolean) => {
    if (!active) return styles.letterRoleButton;
    if (speakerId === 1) return styles.letterRoleSelfActive;
    if (speakerId === 2) return styles.letterRoleSeminarActive;
    return styles.letterRoleOtherActive;
  };

  const formatEntryForCopy = (e: TranscriptEntry) => {
    const label = e.speakerId != null ? `[${speakerDisplayName(e.speakerId)}] ` : '';
    const body = e.textJa ? `${e.text}\n\n（日本語）\n${e.textJa}` : e.text;
    return `${label}${body}`;
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

  /**
   * Oldest → newest, independent of which Note screen is open.
   * A successful copy (any of these buttons) stores the click time so
   * 「前回の続き」 can return only utterances created after that.
   */
  const copySelection = async (
    id: string,
    list: TranscriptEntry[],
    emptyHint: string
  ) => {
    if (list.length === 0) {
      flashCopyHint(emptyHint);
      return;
    }
    const chronological = [...list].sort((a, b) => a.note - b.note);
    const text = chronological.map(formatEntryForCopy).join('\n\n---\n\n');
    const copiedAt = Date.now();
    const ok = await copyText(id, text);
    if (ok) saveLastCopyAt(copiedAt);
  };

  /** 全部コピー — full transcript (formerly すべてコピー; same text). */
  const copyAll = () => {
    void copySelection('__all__', entries, 'コピーする発言がありません');
  };

  /** セミナーだけ — speaker B, not mic 質問者. */
  const copySeminarOnly = () => {
    void copySelection(
      '__seminar__',
      entries.filter(isSeminarUtterance),
      'セミナーなし'
    );
  };

  /** 自分＋その他 — speaker A and C–G, not B. */
  const copySelfAndOthers = () => {
    void copySelection(
      '__self__',
      entries.filter(isSelfOrOtherUtterance),
      '該当なし'
    );
  };

  /** 前回の続き — items newer than the last successful copy. */
  const copySinceLast = () => {
    const cursor = loadLastCopyAt();
    const newer =
      cursor == null
        ? entries
        : entries.filter((e) => {
            const t = Date.parse(e.at);
            return Number.isFinite(t) && t > cursor;
          });
    void copySelection('__since__', newer, '新しい発言なし');
  };

  const note1Entries = [...entries].sort((a, b) => a.note - b.note); // oldest → newest
  const note2Entries = [...entries].sort((a, b) => b.note - a.note); // newest → oldest
  // Home only: newer segments on top, split pieces of one segment still read downward.
  const homeEntries = newestFirstReadingOrder(entries);

  const clearAll = () => {
    setEntries([]);
    entriesLenRef.current = 0;
    setSummary('');
    setCopiedId(null);
    setAudioIds(new Set());
    setSpeakerLabels({});
    setSelectedIds(new Set());
    setArmedDelete(null);
    selectAnchorRef.current = null;
    textSpansRef.current = new Map();
    lastSpeakerRef.current = null;
    pitchCentroidsRef.current = [];
    clearStoredEntries();
    clearStoredSummary();
    clearStoredSpeakerLabels();
    void clearAllAudio().catch((err) => console.error('audio clear failed:', err));
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

  const closeSummaryPanel = () => setSummaryOpen(false);

  const openSummaryPanel = () => {
    setSummaryOpen(true);
    setMenuOpen(false);
    // Stay anchored to the chip — do not scroll the page away from the toggle.
  };

  const toggleSummaryPanel = () => {
    if (summaryOpen) closeSummaryPanel();
    else openSummaryPanel();
  };

  useEffect(() => {
    if (!summaryOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSummaryPanel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [summaryOpen]);

  const renderSummaryPanel = () => (
    <section ref={summaryRef} className={styles.summaryAnchor}>
      <div className={styles.summaryToggleRow}>
        <button
          type="button"
          className={styles.summaryChip}
          onClick={toggleSummaryPanel}
          aria-expanded={summaryOpen}
          aria-controls="summary-popover"
        >
          <span className={styles.summaryChipLabel}>要約</span>
          <span className={styles.summaryChipMeta}>
            {isSummarizing
              ? '生成中…'
              : summaryOpen
                ? '開いています · タップ / Esc で閉じる'
                : summary
                  ? '保存済み · タップで開く'
                  : 'たたみ表示 · タップで開く'}
          </span>
          <span
            className={
              summaryOpen ? styles.summaryChipChevronUp : styles.summaryChipChevron
            }
            aria-hidden="true"
          />
        </button>
        {summaryOpen && (
          <button
            type="button"
            className={styles.summaryCloseButton}
            onClick={closeSummaryPanel}
            aria-label="要約を閉じる"
          >
            ×
          </button>
        )}
      </div>

      {summaryOpen && (
        <>
          <button
            type="button"
            className={styles.summaryBackdrop}
            aria-label="要約を閉じる"
            onClick={closeSummaryPanel}
          />
          <div
            id="summary-popover"
            className={styles.summaryPopover}
            role="dialog"
            aria-modal="true"
            aria-label="要約"
          >
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
            <div className={styles.summaryPopoverBody}>
              {summary ? (
                <pre className={styles.summaryBody}>{summary}</pre>
              ) : (
                <p className={styles.summaryEmpty}>
                  {entries.length === 0
                    ? '文字起こしがあると要約できます。'
                    : '「要約を生成」で会議の決定・アクションをまとめます。'}
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );

  /** Returns { textJa } on success, { error } on failure, null when skipped. */
  const translateEntry = async (
    entry: TranscriptEntry
  ): Promise<{ textJa: string } | { error: string } | null> => {
    if (wantRecordingRef.current || !isEnglishEntry(entry) || entry.textJa) return null;

    setTranslatingIds((prev) => new Set(prev).add(entry.id));
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: entry.text,
          genre: genre.trim() || undefined,
          context: genre.trim() || undefined,
          recording: wantRecordingRef.current,
        }),
      });
      const data = (await res.json()) as { textJa?: string; error?: string };
      if (!res.ok) {
        const msg = data.error || `翻訳に失敗しました (${res.status})`;
        setError(msg);
        return { error: msg };
      }
      const textJa = data.textJa?.trim();
      if (!textJa) {
        setError('翻訳結果が空でした。');
        return { error: '翻訳結果が空でした。' };
      }
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, textJa } : e))
      );
      setError('');
      return { textJa };
    } catch (e) {
      console.error('translate failed:', e);
      setError('翻訳リクエストに失敗しました。');
      return { error: '翻訳リクエストに失敗しました。' };
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
    if (targets.length === 0) return;
    const items: TranslateResultItem[] = [];
    const errors: string[] = [];
    setTranslateModal({
      phase: 'running',
      total: targets.length,
      finished: 0,
      currentNote: targets[0]!.note,
      items: [],
      errors: [],
    });
    for (let i = 0; i < targets.length; i++) {
      const entry = targets[i]!;
      setTranslateModal((prev) =>
        prev ? { ...prev, currentNote: entry.note } : prev
      );
      // Sequential to avoid rate limits
      const result = await translateEntry(entry);
      if (result && 'textJa' in result) {
        items.push({ id: entry.id, note: entry.note, text: entry.text, textJa: result.textJa });
      } else if (result && 'error' in result) {
        errors.push(`#${formatNote(entry.note)}: ${result.error}`);
      }
      setTranslateModal((prev) =>
        prev
          ? { ...prev, finished: i + 1, items: [...items], errors: [...errors] }
          : prev
      );
    }
    setTranslateModal((prev) =>
      prev
        ? {
            ...prev,
            phase: items.length === 0 && errors.length > 0 ? 'error' : 'done',
            currentNote: undefined,
          }
        : prev
    );
  };

  const openTranslationView = (entry: TranscriptEntry) => {
    if (!entry.textJa) return;
    setTranslateModal({
      phase: 'view',
      total: 1,
      finished: 1,
      items: [{ id: entry.id, note: entry.note, text: entry.text, textJa: entry.textJa }],
      errors: [],
    });
  };

  const closeTranslateModal = () => {
    setTranslateModal((prev) => (prev?.phase === 'running' ? prev : null));
  };


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTranslateModal((prev) => (prev?.phase === 'running' ? prev : null));
        setSelectedIds(new Set());
        setSelectionKind('cards');
        setArmedDelete(null);
        selectAnchorRef.current = null;
        textSpansRef.current = new Map();
        window.getSelection()?.removeAllRanges();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const commitTextSelection = () => {
    const read = readTextSelection();
    if (!read) return false;
    textSpansRef.current = read.spans;
    selectAnchorRef.current = read.hits[0] ?? null;
    const next = new Set(read.hits);
    selectedIdsRef.current = next;
    selectionKindRef.current = 'text';
    setSelectionKind('text');
    setSelectedIds((prev) => {
      if (prev.size === next.size && read.hits.every((id) => prev.has(id))) return prev;
      return next;
    });
    return true;
  };

  const clearCardSelection = () => {
    if (selectedIdsRef.current.size === 0 && selectionKindRef.current === 'cards') return;
    selectedIdsRef.current = new Set();
    selectionKindRef.current = 'cards';
    selectAnchorRef.current = null;
    textSpansRef.current = new Map();
    setSelectionKind('cards');
    setSelectedIds(new Set());
  };

  useEffect(() => {
    // Refs only. setState here re-renders the card (entrySelected) and Chrome
    // drops the text range before the user finishes dragging.
    const onSelectionChange = () => {
      if (dragSelectRef.current) return;
      const read = readTextSelection();
      if (!read) return;
      textSpansRef.current = read.spans;
      selectAnchorRef.current = read.hits[0] ?? null;
      selectedIdsRef.current = new Set(read.hits);
    };
    const onPointerUp = (e: PointerEvent) => {
      // Chrome fires pointercancel instead of pointerup when a re-render
      // moves the card mid-drag. Still commit, or the Home toolbar never appears.
      if (e.type !== 'pointercancel' && e.button !== 0) return;
      if (suppressTextCommitRef.current) {
        suppressTextCommitRef.current = false;
        return;
      }
      if (dragSelectRef.current) return;
      if (commitTextSelection()) return;
      // Clicking transcript text with no range used to clear a card selection
      // on pointerdown. Do it after pointerup so the drag is not re-rendered.
      if (e.type === 'pointercancel') return;
      const target = e.target;
      if (!(target instanceof Element) || !target.closest('[data-transcript], pre')) return;
      if (selectedIdsRef.current.size === 0) return;
      clearCardSelection();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Shift') return;
      if (dragSelectRef.current) return;
      const target = e.target;
      if (target instanceof Element && target.closest('input, textarea')) return;
      commitTextSelection();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const entryIdAtPoint = (x: number, y: number, listIds: string[]) => {
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      const id = entryIdFromNode(el);
      if (id && listIds.includes(id)) return id;
    }
    let best: { id: string; dist: number } | null = null;
    for (const id of listIds) {
      const el = document.querySelector(`[data-entry-id="${CSS.escape(id)}"]`);
      if (!(el instanceof HTMLElement)) continue;
      const rect = el.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom && x >= rect.left && x <= rect.right) {
        return id;
      }
      const dist = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
      if (!best || dist < best.dist) best = { id, dist };
    }
    return best && best.dist < 48 ? best.id : null;
  };

  const applyCardRange = (
    anchor: string,
    current: string,
    listIds: string[],
    base: Set<string>
  ) => {
    const next = new Set(base);
    for (const id of rangeIds(listIds, anchor, current)) next.add(id);
    setSelectedIds((prev) => {
      if (prev.size === next.size && [...next].every((id) => prev.has(id))) return prev;
      return next;
    });
  };

  const onListPointerDown = (e: React.PointerEvent<HTMLUListElement>) => {
    if (e.button !== 0) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.closest('button, a, input, textarea')) return;
    // Text inside the transcript must stay selectable. preventDefault on
    // pointerdown (and entrySelected during the drag) cancels the range.
    if (target.closest('[data-transcript], pre')) {
      // Let the browser keep the range. setState on pointerdown re-renders
      // the Home tree and Chrome drops the selection before pointerup.
      suppressTextCommitRef.current = false;
      return;
    }
    const id = entryIdFromNode(target);
    if (!id) return;
    e.preventDefault();
    suppressTextCommitRef.current = true;
    textSpansRef.current = new Map();
    window.getSelection()?.removeAllRanges();
    selectionKindRef.current = 'cards';
    setSelectionKind('cards');
    const listIds = visibleIdsRef.current;
    const additive = e.metaKey || e.ctrlKey;
    const base = additive ? new Set(selectedIdsRef.current) : new Set<string>();
    const anchor =
      e.shiftKey && selectAnchorRef.current ? selectAnchorRef.current : id;
    if (!e.shiftKey) selectAnchorRef.current = id;
    dragSelectRef.current = { pointerId: e.pointerId, anchor, listIds, base };
    e.currentTarget.setPointerCapture(e.pointerId);
    applyCardRange(anchor, id, listIds, base);
  };

  const onListPointerMove = (e: React.PointerEvent<HTMLUListElement>) => {
    const drag = dragSelectRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const id = entryIdAtPoint(e.clientX, e.clientY, drag.listIds);
    if (!id) return;
    applyCardRange(drag.anchor, id, drag.listIds, drag.base);
  };

  const onListPointerUp = (e: React.PointerEvent<HTMLUListElement>) => {
    const drag = dragSelectRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    dragSelectRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const idsMatch = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const set = new Set(a);
    return b.every((id) => set.has(id));
  };

  const removeEntries = (ids: string[]) => {
    if (ids.length === 0) return;
    const drop = new Set(ids);
    setEntries((prev) => prev.filter((entry) => !drop.has(entry.id)));
    setSelectedIds((prev) => {
      if (![...prev].some((id) => drop.has(id))) return prev;
      const next = new Set(prev);
      for (const id of drop) next.delete(id);
      return next;
    });
    if (selectAnchorRef.current && drop.has(selectAnchorRef.current)) {
      selectAnchorRef.current = null;
    }
    setAudioIds((prev) => {
      if (![...prev].some((id) => drop.has(id))) return prev;
      const next = new Set(prev);
      for (const id of drop) next.delete(id);
      return next;
    });
    setArmedDelete(null);
    void deleteAudioSegments(ids).catch((err) =>
      console.error('audio delete failed:', err)
    );
  };

  const requestDelete = (ids: string[]) => {
    if (ids.length === 0) return;
    if (armedDelete && idsMatch(armedDelete, ids)) {
      removeEntries(ids);
      return;
    }
    setArmedDelete(ids);
  };

  const mergeSelected = () => {
    const ids = selectedIdsRef.current;
    if (ids.size < 2) return;
    const next = mergeSelectedCards(entries, ids);
    if (next === entries) return;
    const keep = new Set(next.map((entry) => entry.id));
    const dropped = [...ids].filter((id) => !keep.has(id));
    setEntries(next);
    setSelectedIds(new Set());
    setSelectionKind('cards');
    setArmedDelete(null);
    selectAnchorRef.current = null;
    textSpansRef.current = new Map();
    window.getSelection()?.removeAllRanges();
    if (dropped.length === 0) return;
    setAudioIds((prev) => {
      if (![...prev].some((id) => dropped.includes(id))) return prev;
      const audio = new Set(prev);
      for (const id of dropped) audio.delete(id);
      return audio;
    });
    void deleteAudioSegments(dropped).catch((err) =>
      console.error('audio delete failed:', err)
    );
  };

  const assignSelectedBucket = (speakerId: number) => {
    const ids = selectedIdsRef.current;
    if (ids.size === 0) return;
    const spans = textSpansRef.current;
    let seq = 0;
    setEntries((prev) =>
      applySpeakerSplit(prev, ids, spans, speakerId, () => {
        seq += 1;
        return `${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
      })
    );
    setSelectedIds(new Set());
    setSelectionKind('cards');
    setArmedDelete(null);
    selectAnchorRef.current = null;
    textSpansRef.current = new Map();
    window.getSelection()?.removeAllRanges();
  };

  const renderEntryCard = (entry: TranscriptEntry) => {
    const badge = cardSpeakerBadge(entry.speakerId, entry.source);
    const selected = selectionKind === 'cards' && selectedIds.has(entry.id);
    const tone = badge
      ? `${styles.entry} ${CARD_TONE_CLASS[badge.tone]}`
      : styles.entry;
    const isTranslating = translatingIds.has(entry.id);
    return (
      <li
        key={entry.id}
        data-entry-id={entry.id}
        className={selected ? `${tone} ${styles.entrySelected}` : tone}
      >
        <div className={styles.entryMetaMinimal}>
          <span className={styles.entryMetaLead}>
            <span className={styles.entryIndex}>#{formatNote(entry.note)}</span>
            {badge && (
              <span
                className={`${styles.entrySpeakerBadge} ${BADGE_TONE_CLASS[badge.tone]}`}
                aria-label={`話者: ${badge.label}`}
              >
                {badge.label}
              </span>
            )}
            {isTranslating && (
              <span className={styles.entryTranslatingHint} role="status">
                翻訳中…
              </span>
            )}
          </span>
          <time className={styles.entryTime} dateTime={entry.at}>
            {formatTime(entry.at)}
          </time>
          <button
            type="button"
            className={
              armedDelete?.length === 1 && armedDelete[0] === entry.id
                ? `${styles.entryDelete} ${styles.entryDeleteArmed}`
                : styles.entryDelete
            }
            aria-label={
              armedDelete?.length === 1 && armedDelete[0] === entry.id
                ? '削除を確定'
                : 'この発言を削除'
            }
            onClick={() => requestDelete([entry.id])}
          >
            {armedDelete?.length === 1 && armedDelete[0] === entry.id ? '削除' : '×'}
          </button>
        </div>
        <pre className={styles.transcript} data-transcript="">{entry.text}</pre>
        {entry.textJa && (
          <div
            className={styles.translationBlock}
            role="button"
            tabIndex={0}
            aria-label="日本語訳を大きく表示"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              if (window.getSelection()?.toString()) return;
              e.stopPropagation();
              openTranslationView(entry);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openTranslationView(entry);
              }
            }}
          >
            <div className={styles.translationLabel}>
              <span>日本語訳（Ollama後翻訳）</span>
              <span className={styles.translationLabelHint}>タップで拡大</span>
            </div>
            <pre className={styles.transcriptJa}>{entry.textJa}</pre>
          </div>
        )}
      </li>
    );
  };

  const renderAssignBar = () => {
    if (selectedIds.size === 0) return null;
    return (
      <div className={styles.assignBar} role="toolbar" aria-label="選択した発言の話者">
        <span className={styles.assignCount}>{selectedIds.size}件を</span>
        {ASSIGN_BUCKETS.map((bucket) => (
          <button
            key={bucket.id}
            type="button"
            className={categoryButtonClass(bucket.id, false)}
            onClick={() => assignSelectedBucket(bucket.speakerId)}
          >
            {bucket.label}
          </button>
        ))}
        <button
          type="button"
          className={styles.assignMerge}
          onClick={mergeSelected}
          disabled={selectedIds.size < 2}
        >
          結合
        </button>
        <button
          type="button"
          className={
            armedDelete && idsMatch(armedDelete, [...selectedIds])
              ? `${styles.assignDelete} ${styles.assignDeleteArmed}`
              : styles.assignDelete
          }
          onClick={() => requestDelete([...selectedIds])}
        >
          {armedDelete && idsMatch(armedDelete, [...selectedIds]) ? '削除する' : '削除'}
        </button>
        <button
          type="button"
          className={styles.assignClear}
          onClick={() => {
            setSelectedIds(new Set());
            setSelectionKind('cards');
            setArmedDelete(null);
            selectAnchorRef.current = null;
            textSpansRef.current = new Map();
            window.getSelection()?.removeAllRanges();
          }}
        >
          解除
        </button>
      </div>
    );
  };

  const renderEntryList = (list: TranscriptEntry[]) => {
    visibleIdsRef.current = list.map((entry) => entry.id);
    return (
      <>
        {selectedIds.size > 0 && (
          <div className={styles.assignSlot}>{renderAssignBar()}</div>
        )}
        <ul
          className={styles.entryList}
          onPointerDown={onListPointerDown}
          onPointerMove={onListPointerMove}
          onPointerUp={onListPointerUp}
          onPointerCancel={onListPointerUp}
        >
          {list.map(renderEntryCard)}
        </ul>
      </>
    );
  };

  const renderFeedActions = () => (
    <div className={styles.copyActionRow}>
      {untranslatedEn.length > 0 && (
        <button
          type="button"
          className={styles.ghostButton}
          onClick={translateAllEnglish}
          disabled={translatingIds.size > 0 || isRecording}
        >
          {translatingIds.size > 0
            ? 'Ollama翻訳中…'
            : translateConfigured
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
        {copiedId === '__all__' ? 'コピー済み' : '全部コピー'}
      </button>
      <button
        type="button"
        className={styles.ghostButton}
        onClick={copySeminarOnly}
        disabled={entries.length === 0}
      >
        {copiedId === '__seminar__' ? 'コピー済み' : 'セミナーだけ'}
      </button>
      <button
        type="button"
        className={styles.ghostButton}
        onClick={copySelfAndOthers}
        disabled={entries.length === 0}
      >
        {copiedId === '__self__' ? 'コピー済み' : '自分＋その他'}
      </button>
      <button
        type="button"
        className={styles.ghostButton}
        onClick={copySinceLast}
        disabled={entries.length === 0}
      >
        {copiedId === '__since__' ? 'コピー済み' : '前回の続き'}
      </button>
      <button
        type="button"
        className={`${styles.ghostButton} ${styles.copyClusterTail}`}
        onClick={downloadAllAudioZip}
        disabled={audioIds.size === 0 || audioBusyId === '__all__'}
      >
        {audioBusyId === '__all__' ? 'ZIP準備中…' : '録音をまとめてダウンロード'}
      </button>
      <button
        type="button"
        className={styles.ghostButtonDanger}
        onClick={clearAll}
        disabled={entries.length === 0 && !summary}
      >
        Clear
      </button>
      {copyHint ? (
        <span className={styles.copyHint} role="status">
          {copyHint}
        </span>
      ) : null}
    </div>
  );

  const renderTranslateModal = () => {
    if (!translateModal) return null;
    const m = translateModal;
    const running = m.phase === 'running';
    const pct = m.total > 0 ? Math.round((m.finished / m.total) * 100) : 0;
    const title = m.phase === 'view' ? '日本語訳' : 'Ollama後翻訳';
    const statusText = running
      ? `翻訳中… ${m.finished} / ${m.total}${
          m.currentNote != null ? `（#${formatNote(m.currentNote)} を処理中）` : ''
        }`
      : m.phase === 'error'
        ? '翻訳に失敗しました'
        : m.phase === 'done'
          ? `翻訳完了 · ${m.items.length}件${m.errors.length ? ` · 失敗 ${m.errors.length}件` : ''}`
          : `#${formatNote(m.items[0]?.note ?? 0)} の訳`;
    const statusClass = running
      ? styles.translateModalStatusRunning
      : m.phase === 'error'
        ? styles.translateModalStatusError
        : styles.translateModalStatusDone;
    return (
      <div className={styles.translateModalRoot}>
        <button
          type="button"
          className={styles.translateModalBackdrop}
          aria-label="翻訳を閉じる"
          onClick={closeTranslateModal}
          disabled={running}
        />
        <div
          className={styles.translateModal}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <div className={styles.translateModalHeader}>
            <div>
              <h2 className={styles.translateModalTitle}>{title}</h2>
              <p
                className={`${styles.translateModalStatus} ${statusClass}`}
                role="status"
                aria-live="polite"
              >
                {statusText}
              </p>
            </div>
            <button
              type="button"
              className={styles.translateModalClose}
              onClick={closeTranslateModal}
              disabled={running}
              aria-label="翻訳を閉じる"
            >
              ×
            </button>
          </div>
          {m.phase !== 'view' && (
            <div className={styles.translateProgressTrack} aria-hidden="true">
              <div
                className={styles.translateProgressFill}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          <div className={styles.translateModalBody}>
            {m.items.length === 0 && m.errors.length === 0 && (
              <p className={styles.translateModalEmpty}>
                {running ? 'Ollama で英語の発言を日本語に翻訳しています…' : '翻訳結果はありません。'}
              </p>
            )}
            {m.items.map((item) => (
              <div key={item.id} className={styles.translateResultCard}>
                <div className={styles.translateResultMeta}>#{formatNote(item.note)}</div>
                <pre className={styles.translateResultJa}>{item.textJa}</pre>
                <p className={styles.translateResultEn}>{item.text}</p>
              </div>
            ))}
            {m.errors.map((msg) => (
              <p key={msg} className={`${styles.translateModalEmpty} ${styles.translateModalStatusError}`}>
                {msg}
              </p>
            ))}
          </div>
          {!running && (
            <div className={styles.translateModalFooter}>
              {m.items.length > 0 && (
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() =>
                    copyText(
                      '__translate__',
                      m.items.map((it) => it.textJa).join('\n\n')
                    )
                  }
                >
                  {copiedId === '__translate__' ? 'コピー済み' : '訳をコピー'}
                </button>
              )}
              <button type="button" className={styles.ghostButton} onClick={closeTranslateModal}>
                閉じる
              </button>
            </div>
          )}
        </div>
      </div>
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
          <StopShareButton />
          <span className={styles.metaChip}>{entries.length} segments</span>
          <span className={styles.metaChip}>Copy all = 古い順</span>
        </div>
      </header>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {renderSummaryPanel()}
      {renderTranslateModal()}

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
          {renderFeedActions()}
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
          renderEntryList(list)
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

  if (screen === 'gd') {
    return (
      <GdScreen
        entries={entries}
        genre={genre}
        historyReady={historyReady}
        onBack={() => setScreen('home')}
      />
    );
  }

  // Home = PR #6 polished control UI + compact Note entry points
  return (
    <div className={`${styles.app} ${styles.homeScreen}`}>
      <div className={styles.bgGlow} aria-hidden="true" />
      {renderTranslateModal()}

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
          <StopShareButton />
          <button
            type="button"
            className={styles.gdEntry}
            onClick={() => setScreen('gd')}
          >
            <span className={styles.gdEntryBadge}>出航</span>
            GDモード
          </button>
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
        <div className={styles.statusGenreRow}>
          <label htmlFor="meeting-genre-dock" className={styles.genreInlineLabel}>
            文脈
          </label>
          <input
            id="meeting-genre-dock"
            className={styles.genreInputCompact}
            type="text"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            placeholder="ジャンル / 文脈"
            aria-label="ジャンル / 文脈"
            autoComplete="off"
          />
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
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  setScreen('gd');
                }}
              >
                <span className={styles.menuItemTitle}>GDモード · 出航</span>
                <span className={styles.menuItemDesc}>
                  航海の準備画面。分析は出航のあと
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
            {audioSource === 'system' && selfMicNote ? (
              <p className={styles.genreHint}>{selfMicNote}</p>
            ) : null}
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

        </div>


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
              <button
                type="button"
                className={styles.gdEntry}
                aria-label="GDモード"
                onClick={() => setScreen('gd')}
              >
                <span className={styles.gdEntryBadge}>出航</span>
                GDモード
              </button>
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
                <div className={styles.speakerPicker}>
                  <div
                    className={styles.categoryToggle}
                    role="group"
                    aria-label="話者カテゴリ"
                  >
                    {ZOOM_CATEGORIES.map((cat) => {
                      const active =
                        zoomCategoryForSpeaker(activeSpeakerId) === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          className={categoryButtonClass(cat.id, active)}
                          aria-pressed={active}
                          onClick={() => chooseZoomSpeaker(cat.speakerId)}
                        >
                          {cat.label}
                        </button>
                      );
                    })}
                  </div>
                  <div
                    className={styles.letterToggle}
                    role="group"
                    aria-label="発言者 A〜G"
                  >
                    {SPEAKER_LETTERS.map((letter, idx) => {
                      const id = idx + 1;
                      const active = activeSpeakerId === id;
                      return (
                        <button
                          key={letter}
                          type="button"
                          className={letterRoleClass(id, active)}
                          aria-pressed={active}
                          onClick={() => chooseZoomSpeaker(id)}
                        >
                          {zoomLetterButtonLabel(id)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
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
          {renderFeedActions()}
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
          renderEntryList(homeEntries)
        )}
      </section>
    </div>
  );
}
