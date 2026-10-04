'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styles from './gd-live.module.css';
import {
  GD_LIVE_DURATION_MS,
  GD_MAX_CARD_PX,
  GD_PX_PER_SEC,
  GD_SILENCE_MS,
  type DemoLine,
} from '@/lib/gd-live-demo';
import { formatGdTranscript } from '@/lib/gd-score';
import { transcribeZoomChunk } from '@/lib/transcribe-zoom';
import {
  SYSTEM_AUDIO_HELP,
  acquireSystemAudio,
  captureSessionCount,
  hasLiveAudio,
  isCaptureStale,
  markCaptureStale,
  openSelfMic,
  primeCaptureTap,
  reviveHeldCapture,
  startZoomSegmentRecorder,
  stopMediaTracks,
  type ZoomChunk,
  type ZoomRecorder,
} from '@/lib/zoom-capture';
import { captureGeneration, registerHaltHook, trackAbort, trackClock } from '@/lib/capture-resources';
import { watchLiveCapture } from '@/lib/live-capture';
import { StopShareButton } from './stop-share';
import { GdLogicTree } from './gd-logic-tree';

/** Real Zoom capture only. Home / minutes stays at about 60s. */
const GD_LIVE_SEGMENT_MS = 20_000;

type Phase = 'idle' | 'live' | 'paused' | 'ended';

type BoardLine = DemoLine & { id: string };

export type GdLiveEnd = {
  goal: string;
  transcript: string;
  lineCount: number;
  selfCount: number;
};

function storedDurationMs(): number {
  try {
    const raw = window.localStorage.getItem(DURATION_STORAGE);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= 60_000 && n <= 180 * 60_000) return Math.round(n);
  } catch {
    /* private mode */
  }
  return GD_LIVE_DURATION_MS;
}

type Props = {
  onBack: () => void;
  onHarbor: () => void;
  onVoyage: () => void;
  onResult: () => void;
  /** True when a finished session can still be opened, even after this board remounts. */
  resultReady: boolean;
  onSessionStart: () => void;
  onSessionEnd: (session: GdLiveEnd) => void;
};

const MIC_WARN = 'マイクが使えないため、発言はすべて他者側に載ります。';
const MODEL_KEY_STORAGE = 'minutes.gd.whisperModelKey.v1';
const STAGE_STORAGE = 'minutes.gd.stage.v1';
const DURATION_STORAGE = 'minutes.gd.durationMs.v1';

/** Manual GD phases. Order and labels are the product contract. */
const GD_STAGES = [
  '前提確認',
  '現状認識',
  '顧客課題',
  'リサーチ',
  '課題発散',
  '収束',
  '競合・市場分析',
  'ソリューションの深掘り',
  '資料作成',
] as const;

type GdStage = (typeof GD_STAGES)[number];

function isGdStage(value: string | null): value is GdStage {
  return value != null && (GD_STAGES as readonly string[]).includes(value);
}

function storedStage(): GdStage {
  try {
    const raw = window.localStorage.getItem(STAGE_STORAGE);
    if (isGdStage(raw)) return raw;
  } catch {
    /* private mode */
  }
  return GD_STAGES[0];
}

type WhisperModelKey = 1 | 2;

function storedModelKey(): WhisperModelKey {
  try {
    return window.localStorage.getItem(MODEL_KEY_STORAGE) === '1' ? 1 : 2;
  } catch {
    return 2;
  }
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000 - 1e-9));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Longer blanks are warmer. Color only — no duration digits. */
function silenceColor(gapMs: number): string {
  const t = Math.max(0, Math.min(1, (gapMs - GD_SILENCE_MS) / 140_000));
  const alpha = 0.16 + t * 0.58;
  const r = Math.round(252 - t * 120);
  const g = Math.round(196 - t * 160);
  const b = Math.round(64 + t * 48);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

/** Room below this card before it hits the previous line in the same lane. */
function sameLaneSlot(lines: BoardLine[], index: number): number {
  const line = lines[index];
  if (!line) return GD_MAX_CARD_PX;
  let older = -1;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (lines[i]!.speaker === line.speaker) {
      older = lines[i]!.atSec;
      break;
    }
  }
  if (older < 0) return GD_MAX_CARD_PX;
  const gapPx = (line.atSec - older) * GD_PX_PER_SEC;
  return Math.max(44, Math.min(GD_MAX_CARD_PX, gapPx - 6));
}

function SpeechCard({
  line,
  top,
  maxPx,
}: {
  line: DemoLine;
  top: number;
  maxPx: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = el.scrollHeight > el.clientHeight + 2;
    setClipped((prev) => (prev === next ? prev : next));
  }, [line.text, maxPx]);

  const self = line.speaker === '自分';
  return (
    <article
      ref={ref}
      className={self ? `${styles.card} ${styles.cardSelf}` : `${styles.card} ${styles.cardOther}`}
      style={{ top, maxHeight: maxPx }}
      title={line.text}
    >
      <p>{line.text}</p>
      {clipped ? <span className={styles.edgeWarn}>長文</span> : null}
    </article>
  );
}

function captureErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : '';
  if (name === 'AbortError' || name === 'NotAllowedError') {
    return '画面共有がキャンセルされたか、許可されませんでした。';
  }
  if (name === 'NoSystemAudioError' || message === 'NO_SYSTEM_AUDIO') {
    return SYSTEM_AUDIO_HELP;
  }
  return `アプリ / システム音声を取得できませんでした。${SYSTEM_AUDIO_HELP}`;
}

export function GdLive({ onBack, onHarbor, onVoyage, onResult, resultReady, onSessionStart, onSessionEnd }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [durationMs, setDurationMs] = useState(GD_LIVE_DURATION_MS);
  const [goal, setGoal] = useState('');
  const [utterances, setUtterances] = useState<BoardLine[]>([]);
  const [pending, setPending] = useState(0);
  const [arming, setArming] = useState(false);
  const armingRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [shareStale, setShareStale] = useState(false);
  const [micWarn, setMicWarn] = useState('');
  const [modelKey, setModelKey] = useState<WhisperModelKey>(2);
  const [gdStage, setGdStage] = useState<GdStage>(GD_STAGES[0]);
  const [modelLabels, setModelLabels] = useState<{ 1: string; 2: string; fallback: boolean }>({
    1: '',
    2: '',
    fallback: false,
  });

  const baseRef = useRef(0);
  const originRef = useRef(0);
  const elapsedRef = useRef(0);
  const durationRef = useRef(GD_LIVE_DURATION_MS);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<ZoomRecorder | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const systemRef = useRef<MediaStream | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const releasingRef = useRef(false);
  const aliveRef = useRef(true);
  const cancelClockRef = useRef<(() => void) | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const queueEpochRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const phaseRef = useRef(phase);
  const modelKeyRef = useRef<WhisperModelKey>(2);
  const stageStripRef = useRef<HTMLDivElement>(null);
  const utterancesRef = useRef<BoardLine[]>([]);
  const goalRef = useRef('');
  const onSessionEndRef = useRef(onSessionEnd);
  const onSessionStartRef = useRef(onSessionStart);
  const endSessionRef = useRef<() => void>(() => {});
  const flushRef = useRef<Promise<void>>(Promise.resolve());
  const resolveFlushRef = useRef<(() => void) | null>(null);
  const endingRef = useRef(false);
  const publishedRef = useRef(false);
  const sessionGenRef = useRef(0);
  phaseRef.current = phase;
  modelKeyRef.current = modelKey;
  goalRef.current = goal;
  onSessionEndRef.current = onSessionEnd;
  onSessionStartRef.current = onSessionStart;
  durationRef.current = durationMs;

  useEffect(() => {
    const saved = storedModelKey();
    setModelKey(saved);
    modelKeyRef.current = saved;
    setGdStage(storedStage());
    const duration = storedDurationMs();
    durationRef.current = duration;
    setDurationMs(duration);
  }, []);

  useEffect(() => {
    const root = stageStripRef.current;
    if (!root) return;
    const lit = root.querySelector<HTMLElement>('[data-lit="true"]');
    if (!lit) return;
    const pad = 8;
    const left = lit.offsetLeft;
    const right = left + lit.offsetWidth;
    if (left < root.scrollLeft + pad) {
      root.scrollLeft = Math.max(0, left - pad);
    } else if (right > root.scrollLeft + root.clientWidth - pad) {
      root.scrollLeft = right - root.clientWidth + pad;
    }
  }, [gdStage]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/config');
        if (!res.ok) return;
        const data = (await res.json()) as {
          whisperModels?: {
            '1'?: { label?: string };
            '2'?: { label?: string; fallback?: boolean };
          };
        };
        if (cancelled || !data.whisperModels) return;
        setModelLabels({
          1: data.whisperModels['1']?.label?.trim() || '',
          2: data.whisperModels['2']?.label?.trim() || '',
          fallback: Boolean(data.whisperModels['2']?.fallback),
        });
      } catch (err) {
        console.error('gd model config failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return registerHaltHook(() => {
      queueEpochRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      queueRef.current = Promise.resolve();
      setPending(0);
    });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      releaseRef.current?.();
      releaseRef.current = null;
      captureRef.current?.stop();
      captureRef.current = null;
      stopMediaTracks(systemRef.current, micRef.current);
      systemRef.current = null;
      micRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'live') return;
    let frame = 0;
    let dead = false;
    const cancel = () => {
      dead = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    const untrack = trackClock(cancel);
    cancelClockRef.current = cancel;
    const loop = () => {
      if (dead) return;
      const ms = baseRef.current + (performance.now() - originRef.current);
      if (ms >= durationRef.current) {
        cancel();
        endSessionRef.current();
        return;
      }
      elapsedRef.current = ms;
      setElapsedMs(ms);
      if (dead) return;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      if (cancelClockRef.current === cancel) cancelClockRef.current = null;
      cancel();
      untrack();
    };
  }, [phase]);

  useEffect(() => {
    if (phase === 'live') return;
    captureRef.current?.stop();
    captureRef.current = null;
  }, [phase]);

  function beginClock() {
    baseRef.current = 0;
    originRef.current = performance.now();
    elapsedRef.current = 0;
    setElapsedMs(0);
    scrollerRef.current?.scrollTo(0, 0);
    onSessionStartRef.current();
    setPhase('live');
  }

  /** Continue the paused session. Elapsed stays where 中断 froze it. */
  function resumeClock() {
    originRef.current = performance.now();
    scrollerRef.current?.scrollTo(0, 0);
    setPhase('live');
  }

  function pause() {
    if (phaseRef.current !== 'live' || endingRef.current) return;
    cancelClockRef.current?.();
    const ms = Math.min(
      durationRef.current,
      baseRef.current + (performance.now() - originRef.current)
    );
    baseRef.current = ms;
    originRef.current = performance.now();
    elapsedRef.current = ms;
    setElapsedMs(ms);
    const recorder = captureRef.current;
    captureRef.current = null;
    // Soft stop: recorder and its rotate timer die, share and watch stay.
    if (recorder) recorder.stop();
    setPhase('paused');
  }

  function enqueueChunk(chunk: ZoomChunk, epoch: number) {
    if (queueEpochRef.current !== epoch) return;
    const sessionGen = sessionGenRef.current;
    setPending((count) => count + 1);
    const controller = trackAbort(new AbortController());
    abortRef.current = controller;
    queueRef.current = queueRef.current.then(async () => {
      if (queueEpochRef.current !== epoch) return;
      try {
        if (sessionGenRef.current !== sessionGen) return;
        const found = await transcribeZoomChunk(
          chunk.systemBlob,
          chunk.micBlob,
          'ja',
          controller.signal,
          modelKeyRef.current
        );
        if (
          queueEpochRef.current !== epoch ||
          sessionGenRef.current !== sessionGen ||
          !aliveRef.current ||
          found.length === 0
        ) {
          return;
        }
        setUtterances((prev) => {
          const next = [
            ...prev,
            ...found.map((line, index) => ({
              id: `${chunk.offsetSec.toFixed(3)}-${line.startSec.toFixed(3)}-${index}-${Math.random().toString(36).slice(2, 6)}`,
              atSec: chunk.offsetSec + line.startSec,
              speaker: line.speaker,
              text: line.text,
            })),
          ];
          utterancesRef.current = next;
          return next;
        });
      } catch (err) {
        if (queueEpochRef.current !== epoch || controller.signal.aborted) return;
        console.error('gd live transcribe failed:', err);
        if (!aliveRef.current) return;
        setNotice(err instanceof Error ? err.message : '文字起こしに失敗しました。');
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (aliveRef.current && queueEpochRef.current === epoch) {
          setPending((count) => Math.max(0, count - 1));
        }
      }
    });
  }

  function holdShare(stream: MediaStream, mic: MediaStream | null) {
    systemRef.current = stream;
    micRef.current = mic;
    const watched = [stream, mic].filter((item): item is MediaStream => item != null);
    releaseRef.current?.();
    releaseRef.current = watchLiveCapture(() => {
      releasingRef.current = true;
      const current = captureRef.current;
      captureRef.current = null;
      if (current) current.stop();
      stopMediaTracks(stream, mic);
      if (systemRef.current === stream) systemRef.current = null;
      if (micRef.current === mic) micRef.current = null;
      releasingRef.current = false;
      if (!aliveRef.current) return;
      setPhase((currentPhase) =>
        currentPhase === 'live' || currentPhase === 'paused' ? 'ended' : currentPhase
      );
    }, watched);
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (releasingRef.current || systemRef.current !== stream) return;
        if (hasLiveAudio(stream)) return;
        releaseRef.current?.();
        releaseRef.current = null;
        captureRef.current = null;
        stopMediaTracks(stream, micRef.current);
        systemRef.current = null;
        micRef.current = null;
        if (!aliveRef.current) return;
        if (phaseRef.current === 'live' || phaseRef.current === 'paused') {
          setNotice('画面共有が終了したため録音を停止しました。');
          endSessionRef.current();
        }
      };
    });
  }

  function armCapture(stream: MediaStream, mic: MediaStream | null, timeOffsetSec: number) {
    systemRef.current = stream;
    micRef.current = mic;
    flushRef.current = new Promise<void>((resolve) => {
      resolveFlushRef.current = resolve;
    });
    const watched = [stream, mic].filter((item): item is MediaStream => item != null);
    let handle: ZoomRecorder | null = null;
    releaseRef.current?.();
    releaseRef.current = watchLiveCapture(() => {
      releasingRef.current = true;
      const current = handle ?? captureRef.current;
      handle = null;
      captureRef.current = null;
      if (current) current.stop();
      stopMediaTracks(stream, mic);
      if (systemRef.current === stream) systemRef.current = null;
      if (micRef.current === mic) micRef.current = null;
      releasingRef.current = false;
      if (!aliveRef.current) return;
      if (phaseRef.current === 'live') {
        const ms = Math.min(
          durationRef.current,
          baseRef.current + (performance.now() - originRef.current)
        );
        baseRef.current = ms;
        elapsedRef.current = ms;
        setElapsedMs(ms);
      }
      // Hard halt kills the share. The board stays until the next 開始, which
      // is a new GD — same as halting mid-recording.
      setPhase((currentPhase) =>
        currentPhase === 'live' || currentPhase === 'paused' ? 'ended' : currentPhase
      );
    }, watched);

    let failedSync = false;
    const epoch = queueEpochRef.current;
    handle = startZoomSegmentRecorder({
      system: stream,
      mic,
      segmentMs: GD_LIVE_SEGMENT_MS,
      timeOffsetSec,
      onChunk: (chunk) => enqueueChunk(chunk, epoch),
      onSilentCapture: () => {
        if (!aliveRef.current) return;
        setShareStale(true);
        setNotice('システム音声が無音のままです。共有し直すで取り直してください。');
      },
      onEnded: (reason) => {
        resolveFlushRef.current?.();
        resolveFlushRef.current = null;
        failedSync = true;
        handle = null;
        captureRef.current = null;
        if (reason === 'stopped') return;
        releaseRef.current?.();
        releaseRef.current = null;
        if (systemRef.current === stream) systemRef.current = null;
        if (micRef.current === mic) micRef.current = null;
        if (!aliveRef.current) return;
        if (reason === 'share-ended') {
          setNotice('画面共有が終了したため録音を停止しました。');
        } else if (reason === 'error') {
          setNotice('録音中にエラーが発生しました。');
        }
        endSessionRef.current();
      },
    });
    stream.getAudioTracks().forEach((track) => {
      const prev = track.onended;
      track.onended = (event) => {
        prev?.call(track, event);
        if (releasingRef.current || systemRef.current !== stream) return;
        if (hasLiveAudio(stream)) return;
        releaseRef.current?.();
        releaseRef.current = null;
        captureRef.current = null;
        stopMediaTracks(stream, micRef.current);
        systemRef.current = null;
        micRef.current = null;
        if (!aliveRef.current) return;
        if (phaseRef.current === 'live' || phaseRef.current === 'paused') {
          setNotice('画面共有が終了したため録音を停止しました。');
          endSessionRef.current();
        }
      };
    });
    return { handle, failedSync };
  }

  async function acquireFresh(
    generation: number
  ): Promise<{ stream: MediaStream; mic: MediaStream | null } | null> {
    const selfMicPromise = openSelfMic();
    let stream: MediaStream;
    try {
      stream = await acquireSystemAudio();
    } catch (err) {
      const leftover = await selfMicPromise;
      stopMediaTracks(leftover);
      console.error('GD live capture failed:', err);
      if (aliveRef.current) setNotice(captureErrorMessage(err));
      return null;
    }
    const mic = await selfMicPromise;
    if (!aliveRef.current || generation !== captureGeneration()) {
      stopMediaTracks(stream, mic);
      return null;
    }
    return { stream, mic };
  }

  /**
   * Reuse a held share only when it still has audible tracks and the hot tap
   * is running. A stale or silent-reuse share is stopped (tracks and
   * AudioContext) and getDisplayMedia runs again — still inside this click.
   */
  async function resolveShare(
    generation: number
  ): Promise<{ stream: MediaStream; mic: MediaStream | null } | null> {
    const stream = systemRef.current;
    let mic = micRef.current;
    reviveHeldCapture(stream);
    reviveHeldCapture(mic);
    let reuse = hasLiveAudio(stream) && !isCaptureStale(stream);
    if (reuse && stream) {
      const primed = await primeCaptureTap(stream);
      const broken =
        isCaptureStale(stream) ||
        (primed !== 'ok' && captureSessionCount(stream) >= 1);
      if (broken) {
        if (!isCaptureStale(stream)) markCaptureStale(stream, `prime-${primed}`);
        reuse = false;
      }
    }
    if (reuse && stream) {
      if (!hasLiveAudio(mic)) {
        stopMediaTracks(mic);
        micRef.current = null;
        mic = await openSelfMic();
        if (!aliveRef.current || generation !== captureGeneration()) {
          stopMediaTracks(mic);
          return null;
        }
      }
      if (mic) await primeCaptureTap(mic);
      return { stream, mic };
    }
    // One picker per click. A brand-new share is kept even if the hot tap
    // could not start; the raw track still records the first session.
    stopMediaTracks(stream, mic);
    systemRef.current = null;
    micRef.current = null;
    const fresh = await acquireFresh(generation);
    if (!fresh) return null;
    await primeCaptureTap(fresh.stream);
    if (fresh.mic) await primeCaptureTap(fresh.mic);
    return fresh;
  }

  async function start() {
    if (phaseRef.current === 'live' || armingRef.current) return;
    const resuming = phaseRef.current === 'paused';
    setNotice('');
    if (!resuming) {
      sessionGenRef.current += 1;
      endingRef.current = false;
      publishedRef.current = false;
    }
    const generation = captureGeneration();
    armingRef.current = true;
    setArming(true);
    setMicWarn('');

    try {
      const held = await resolveShare(generation);
      if (!held) return;
      const { stream, mic } = held;
      const aborted =
        !aliveRef.current ||
        endingRef.current ||
        (resuming && phaseRef.current !== 'paused');
      if (aborted) {
        // Drop a capturer this attempt just opened. A held share stays.
        if (systemRef.current !== stream) stopMediaTracks(stream);
        if (micRef.current !== mic) stopMediaTracks(mic);
        return;
      }
      setShareStale(false);
      setMicWarn(mic ? '' : MIC_WARN);
      const offsetSec = resuming ? elapsedRef.current / 1000 : 0;
      const armed = armCapture(stream, mic, offsetSec);
      if (!aliveRef.current || armed.failedSync) {
        armed.handle?.stop();
        return;
      }
      captureRef.current = armed.handle;
      if (resuming) {
        resumeClock();
        return;
      }
      utterancesRef.current = [];
      setUtterances([]);
      beginClock();
    } finally {
      armingRef.current = false;
      if (aliveRef.current) setArming(false);
    }
  }

  async function reshare() {
    if (armingRef.current) return;
    const generation = captureGeneration();
    const wasLive = phaseRef.current === 'live';
    armingRef.current = true;
    setArming(true);
    setNotice('');
    try {
      if (wasLive) {
        const flush = flushRef.current;
        captureRef.current?.stop();
        captureRef.current = null;
        await Promise.race([
          flush,
          new Promise<void>((resolve) => {
            window.setTimeout(resolve, 2000);
          }),
        ]);
      }
      if (!aliveRef.current || generation !== captureGeneration()) return;
      stopMediaTracks(systemRef.current, micRef.current);
      systemRef.current = null;
      micRef.current = null;
      const fresh = await acquireFresh(generation);
      if (!fresh) return;
      await primeCaptureTap(fresh.stream);
      if (fresh.mic) await primeCaptureTap(fresh.mic);
      if (!aliveRef.current || generation !== captureGeneration() || endingRef.current) {
        stopMediaTracks(fresh.stream, fresh.mic);
        return;
      }
      setShareStale(false);
      setMicWarn(fresh.mic ? '' : MIC_WARN);
      if (wasLive && phaseRef.current === 'live') {
        const armed = armCapture(fresh.stream, fresh.mic, elapsedRef.current / 1000);
        if (!aliveRef.current || armed.failedSync) {
          armed.handle?.stop();
          return;
        }
        captureRef.current = armed.handle;
        return;
      }
      holdShare(fresh.stream, fresh.mic);
    } finally {
      armingRef.current = false;
      if (aliveRef.current) setArming(false);
    }
  }

  function stop() {
    endSessionRef.current();
  }

  function applyDurationMinutes(minutes: number) {
    if (!Number.isFinite(minutes)) return;
    const next = Math.max(1, Math.min(180, Math.round(minutes))) * 60_000;
    durationRef.current = next;
    setDurationMs(next);
    try {
      window.localStorage.setItem(DURATION_STORAGE, String(next));
    } catch {
      /* private mode */
    }
    if (
      (phaseRef.current === 'live' || phaseRef.current === 'paused') &&
      elapsedRef.current >= next
    ) {
      endSessionRef.current();
    }
  }

  endSessionRef.current = () => {
    const current = phaseRef.current;
    if ((current !== 'live' && current !== 'paused') || endingRef.current) return;
    endingRef.current = true;
    if (current === 'live') {
      cancelClockRef.current?.();
      const cap = durationRef.current;
      const ms = Math.min(cap, baseRef.current + (performance.now() - originRef.current));
      baseRef.current = ms;
      originRef.current = performance.now();
      elapsedRef.current = ms;
      setElapsedMs(ms);
      const recorder = captureRef.current;
      captureRef.current = null;
      if (recorder) recorder.stop();
      else {
        resolveFlushRef.current?.();
        resolveFlushRef.current = null;
      }
    }
    setPhase('ended');
    const publish = () => {
      const lines = utterancesRef.current;
      onSessionEndRef.current({
        goal: goalRef.current,
        transcript: formatGdTranscript(lines),
        lineCount: lines.length,
        selfCount: lines.filter((line) => line.speaker === '自分').length,
      });
    };
    publish();
    if (publishedRef.current) return;
    publishedRef.current = true;
    const gen = sessionGenRef.current;
    void (async () => {
      const capWait = new Promise<void>((resolve) => {
        window.setTimeout(resolve, 8000);
      });
      try {
        await Promise.race([flushRef.current, capWait]);
        await queueRef.current;
      } catch {
        /* publish what has already landed */
      }
      if (!aliveRef.current || gen !== sessionGenRef.current) return;
      publish();
    })();
  };

  const remainMs = Math.max(0, durationMs - elapsedMs);
  const running = phase === 'live';
  const trackPx =
    phase === 'idle' ? 0 : (elapsedMs / 1000) * GD_PX_PER_SEC + GD_MAX_CARD_PX + 28;

  const script: BoardLine[] = [...utterances].sort(
    (a, b) => a.atSec - b.atSec || a.id.localeCompare(b.id)
  );

  const timeSlack = 2000;
  const shown = script
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => phase !== 'idle' && line.atSec * 1000 <= elapsedMs + timeSlack);

  const selfTimes = shown
    .filter(({ line }) => line.speaker === '自分')
    .map(({ line }) => line.atSec * 1000);

  const silence: { key: string; top: number; height: number; gapMs: number; open: boolean }[] =
    [];
  if (phase !== 'idle') {
    const pushBand = (from: number, to: number, open: boolean) => {
      const gapMs = to - from;
      if (gapMs < GD_SILENCE_MS) return;
      silence.push({
        key: `${Math.round(from)}-${Math.round(to)}`,
        top: ((elapsedMs - to) / 1000) * GD_PX_PER_SEC,
        height: (gapMs / 1000) * GD_PX_PER_SEC,
        gapMs,
        open,
      });
    };
    if (selfTimes.length === 0) {
      pushBand(0, elapsedMs, true);
    } else {
      pushBand(0, selfTimes[0]!, false);
      for (let i = 1; i < selfTimes.length; i += 1) {
        pushBand(selfTimes[i - 1]!, selfTimes[i]!, false);
      }
      pushBand(selfTimes[selfTimes.length - 1]!, elapsedMs, true);
    }
  }

  const minuteCount = Math.floor(elapsedMs / 60_000);
  const ticks =
    phase === 'idle'
      ? []
      : Array.from({ length: minuteCount + 1 }, (_, minute) => ({
          minute,
          top: ((elapsedMs - minute * 60_000) / 1000) * GD_PX_PER_SEC,
        }));

  const transcript = (
    phase === 'idle'
      ? []
      : script.filter((line) => line.atSec * 1000 <= elapsedMs + 2000)
  )
    .slice(-40)
    .map((line) => {
      const sec = Math.max(0, Math.floor(line.atSec));
      const clock = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      const text = line.text.replace(/\s+/g, ' ').trim();
      return `[${clock}] ${line.speaker}: ${text}`;
    })
    .join('\n')
    .slice(-4000);
  const phaseLabel =
    phase === 'live' ? '議論中' : phase === 'paused' ? '中断' : phase === 'ended' ? '終了' : '待機';
  const statusText = notice || micWarn;
  // Ended session, retained score, or mock preview from idle/live.
  const canOpenResult = phase === 'ended' || resultReady || phase === 'idle' || phase === 'live';

  const idleHint =
    '開始すると、画面共有でZoomなどの音声を取ります。Whisperの区間が、左は他者・右は自分で載ります。無言は空白のまま残り、自分の長い無言だけ、すこしずつ色が濃くなります。';

  function chooseStage(next: GdStage) {
    setGdStage(next);
    try {
      window.localStorage.setItem(STAGE_STORAGE, next);
    } catch {
      /* private mode */
    }
  }

  function chooseModel(next: WhisperModelKey) {
    modelKeyRef.current = next;
    setModelKey(next);
    try {
      window.localStorage.setItem(MODEL_KEY_STORAGE, String(next));
    } catch {
      /* private mode */
    }
  }

  const activeModelLabel =
    modelKey === 2 && modelLabels.fallback
      ? modelLabels[1]
        ? `${modelLabels[1]}と同じ`
        : ''
      : modelKey === 2
        ? modelLabels[2]
        : modelLabels[1];

  return (
    <div className={styles.stage}>
      <header className={styles.hud}>
        <div className={styles.hudRow}>
          <button type="button" className={styles.home} onClick={onBack}>
            <span className={styles.chevron} aria-hidden="true" />
            Home
          </button>
          <div className={styles.brand}>
            <p className={styles.kicker}>GDモード</p>
            <h1 className={styles.title}>ライブ</h1>
          </div>
          <StopShareButton />
          <p className={styles.phase} data-phase={phase}>
            {phaseLabel}
          </p>
          <p
            className={remainMs <= 60_000 && running ? `${styles.remain} ${styles.remainHot}` : styles.remain}
            aria-label={`残り ${formatClock(remainMs)}`}
          >
            <span className={styles.remainLabel}>残り</span>
            <span className={styles.remainTime}>{formatClock(remainMs)}</span>
          </p>
          <label className={styles.limit}>
            <span>制限</span>
            <input
              type="number"
              min={1}
              max={180}
              step={1}
              inputMode="numeric"
              aria-label="制限時間（分）"
              value={Math.max(1, Math.round(durationMs / 60_000))}
              onChange={(event) => applyDurationMinutes(event.target.valueAsNumber)}
            />
            <span>分</span>
          </label>
          <button type="button" className={styles.harbor} onClick={onHarbor}>
            出航準備
          </button>
          <div className={styles.transport}>
            <button
              type="button"
              className={styles.go}
              onClick={() => void start()}
              disabled={running || arming}
            >
              {arming ? '許可待ち' : phase === 'paused' ? '再開' : '開始'}
            </button>
            {shareStale ? (
              <button
                type="button"
                className={styles.reshare}
                onClick={() => void reshare()}
                disabled={arming}
              >
                共有し直す
              </button>
            ) : null}
            <button type="button" className={styles.pause} onClick={pause} disabled={!running}>
              中断
            </button>
            <button
              type="button"
              className={styles.stop}
              onClick={stop}
              disabled={phase !== 'live' && phase !== 'paused'}
            >
              終了
            </button>
            <button
              type="button"
              className={styles.navBtn}
              onClick={onResult}
              disabled={!canOpenResult}
            >
              リザルト
            </button>
            <button type="button" className={styles.navBtn} onClick={onVoyage}>
              航海
            </button>
          </div>
          <p className={styles.pending} role="status" aria-live="polite">
            {pending > 0 ? `文字起こし中 ${pending}件` : ''}
          </p>
        </div>

        <label className={styles.goal}>
          <span>お題</span>
          <input
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="目指す結論を一行で"
            maxLength={80}
            readOnly={running}
            enterKeyHint="done"
          />
        </label>

        <div className={styles.stageStrip} ref={stageStripRef} role="group" aria-label="議論の段階と文字起こし">
          {GD_STAGES.map((name) => {
            const lit = name === gdStage;
            return (
              <button
                key={name}
                type="button"
                data-lit={lit ? 'true' : undefined}
                className={lit ? styles.stageOn : styles.stageChip}
                aria-pressed={lit}
                onClick={() => chooseStage(name)}
              >
                {name}
              </button>
            );
          })}
          <div className={styles.stageModel} role="group" aria-label="文字起こし">
            <span className={styles.modelTag}>文字起こし</span>
            <button
              type="button"
              className={modelKey === 2 ? styles.speedOn : styles.speed}
              aria-pressed={modelKey === 2}
              title={
                modelLabels.fallback ? 'WHISPER_MODEL2 未設定' : modelLabels[2] || 'WHISPER_MODEL2'
              }
              onClick={() => chooseModel(2)}
            >
              速い
            </button>
            <button
              type="button"
              className={modelKey === 1 ? styles.speedOn : styles.speed}
              aria-pressed={modelKey === 1}
              title={modelLabels[1] || 'WHISPER_MODEL'}
              onClick={() => chooseModel(1)}
            >
              精密
            </button>
            {activeModelLabel ? <span className={styles.modelName}>{activeModelLabel}</span> : null}
          </div>
        </div>

        {statusText ? (
          <p className={notice ? styles.captureError : styles.dummyNote} role={notice ? 'alert' : undefined}>
            {statusText}
          </p>
        ) : null}
      </header>

      <div className={styles.board}>
        <GdLogicTree theme={goal} onThemeChange={setGoal} transcript={transcript} />
        <div className={styles.scroller} ref={scrollerRef}>
          <div className={styles.laneHeads}>
            <p>他者</p>
            <p className={styles.axisName}>時間</p>
            <p className={styles.selfName}>自分</p>
          </div>
          <div className={styles.track} style={trackPx > 0 ? { height: trackPx } : undefined}>
            <div className={styles.mast} aria-hidden="true" />
            <div className={styles.nowGem} aria-hidden="true" />
            {ticks.map((tick) => (
              <div key={tick.minute} className={styles.tick} style={{ top: tick.top }}>
                <span>{tick.minute}:00</span>
              </div>
            ))}
            <div className={styles.laneOther}>
              {shown
                .filter(({ line }) => line.speaker === '他者')
                .map(({ line, index }) => (
                  <SpeechCard
                    key={line.id}
                    line={line}
                    top={((elapsedMs - line.atSec * 1000) / 1000) * GD_PX_PER_SEC}
                    maxPx={sameLaneSlot(script, index)}
                  />
                ))}
            </div>
            <div className={styles.laneSelf}>
              {silence.map((band) => (
                <div
                  key={band.key}
                  className={band.open ? `${styles.silence} ${styles.silenceOpen}` : styles.silence}
                  style={{
                    top: band.top,
                    height: band.height,
                    backgroundColor: silenceColor(band.gapMs),
                  }}
                  aria-hidden="true"
                />
              ))}
              {shown
                .filter(({ line }) => line.speaker === '自分')
                .map(({ line, index }) => (
                  <SpeechCard
                    key={line.id}
                    line={line}
                    top={((elapsedMs - line.atSec * 1000) / 1000) * GD_PX_PER_SEC}
                    maxPx={sameLaneSlot(script, index)}
                  />
                ))}
            </div>
            {phase === 'idle' ? <p className={styles.idleHint}>{idleHint}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
