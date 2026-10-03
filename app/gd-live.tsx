'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import styles from './gd-live.module.css';
import {
  GD_DEMO_LINES,
  GD_LIVE_DURATION_MS,
  GD_MAX_CARD_PX,
  GD_PX_PER_SEC,
  GD_SILENCE_MS,
  type DemoLine,
} from '@/lib/gd-live-demo';

type Speed = 1 | 2 | 4;
type Phase = 'idle' | 'live' | 'ended';

type TopicMark = {
  id: string;
  name: string;
  /** Null until the clock is running. Stamped at the switch. */
  atMs: number | null;
};

type Props = {
  onBack: () => void;
  onHarbor: () => void;
};

const SPEEDS: Speed[] = [1, 2, 4];

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
function sameLaneSlot(index: number): number {
  const line = GD_DEMO_LINES[index];
  let older = -1;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (GD_DEMO_LINES[i].speaker === line.speaker) {
      older = GD_DEMO_LINES[i].atSec;
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

export function GdLive({ onBack, onHarbor }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [speed, setSpeed] = useState<Speed>(1);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [goal, setGoal] = useState('');
  const [topicDraft, setTopicDraft] = useState('');
  const [topics, setTopics] = useState<TopicMark[]>([]);

  const baseRef = useRef(0);
  const originRef = useRef(0);
  const speedRef = useRef<Speed>(1);
  const elapsedRef = useRef(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const topicSeq = useRef(1);

  useEffect(() => {
    if (phase !== 'live') return;
    let frame = 0;
    const loop = () => {
      const ms =
        baseRef.current + (performance.now() - originRef.current) * speedRef.current;
      if (ms >= GD_LIVE_DURATION_MS) {
        baseRef.current = GD_LIVE_DURATION_MS;
        elapsedRef.current = GD_LIVE_DURATION_MS;
        setElapsedMs(GD_LIVE_DURATION_MS);
        setPhase('ended');
        return;
      }
      elapsedRef.current = ms;
      setElapsedMs(ms);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  function start() {
    if (phase === 'live') return;
    baseRef.current = 0;
    originRef.current = performance.now();
    elapsedRef.current = 0;
    setElapsedMs(0);
    setTopics((prev) => {
      if (prev.length === 0) return prev;
      return prev.map((topic, index) => ({
        ...topic,
        atMs: index === prev.length - 1 ? 0 : null,
      }));
    });
    scrollerRef.current?.scrollTo(0, 0);
    setPhase('live');
  }

  function stop() {
    if (phase !== 'live') return;
    const ms = Math.min(
      GD_LIVE_DURATION_MS,
      baseRef.current + (performance.now() - originRef.current) * speedRef.current
    );
    baseRef.current = ms;
    elapsedRef.current = ms;
    setElapsedMs(ms);
    setPhase('ended');
  }

  function chooseSpeed(next: Speed) {
    if (next === speedRef.current) return;
    if (phase === 'live') {
      const now = performance.now();
      const ms = Math.min(
        GD_LIVE_DURATION_MS,
        baseRef.current + (now - originRef.current) * speedRef.current
      );
      baseRef.current = ms;
      originRef.current = now;
      elapsedRef.current = ms;
      setElapsedMs(ms);
    }
    speedRef.current = next;
    setSpeed(next);
  }

  function addTopic(event: FormEvent) {
    event.preventDefault();
    const name = topicDraft.trim();
    if (!name) return;
    const atMs = phase === 'idle' ? null : elapsedRef.current;
    const id = `topic-${topicSeq.current}`;
    topicSeq.current += 1;
    setTopics((prev) => [...prev, { id, name, atMs }]);
    setTopicDraft('');
  }

  const remainMs = Math.max(0, GD_LIVE_DURATION_MS - elapsedMs);
  const running = phase === 'live';
  const trackPx =
    phase === 'idle' ? 0 : (elapsedMs / 1000) * GD_PX_PER_SEC + GD_MAX_CARD_PX + 28;

  const shown = GD_DEMO_LINES.map((line, index) => ({ line, index })).filter(
    ({ line }) => phase !== 'idle' && line.atSec * 1000 <= elapsedMs + 0.5
  );

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
      pushBand(0, selfTimes[0], false);
      for (let i = 1; i < selfTimes.length; i += 1) {
        pushBand(selfTimes[i - 1], selfTimes[i], false);
      }
      pushBand(selfTimes[selfTimes.length - 1], elapsedMs, true);
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

  const phaseLabel = phase === 'live' ? '議論中' : phase === 'ended' ? '終了' : '待機';

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
          <div className={styles.transport}>
            <button type="button" className={styles.go} onClick={start} disabled={running}>
              開始
            </button>
            <button type="button" className={styles.stop} onClick={stop} disabled={!running}>
              終了
            </button>
          </div>
          <button type="button" className={styles.harbor} onClick={onHarbor}>
            出航準備
          </button>
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

        <div className={styles.flowRow}>
          <p className={styles.flowLabel}>論の流れ</p>
          <ol className={styles.flow} aria-label="論の流れ">
            {topics.length === 0 ? <li className={styles.flowEmpty}>まだありません</li> : null}
            {topics.map((topic, index) => {
              const current = index === topics.length - 1;
              return (
                <li
                  key={topic.id}
                  className={current ? `${styles.flowItem} ${styles.flowItemCurrent}` : styles.flowItem}
                  aria-current={current ? 'true' : undefined}
                >
                  {index > 0 ? (
                    <span className={styles.flowArrow} aria-hidden="true">
                      →
                    </span>
                  ) : null}
                  <span className={styles.flowChip}>{topic.name}</span>
                </li>
              );
            })}
          </ol>
          <form className={styles.topicForm} onSubmit={addTopic}>
            <input
              value={topicDraft}
              onChange={(event) => setTopicDraft(event.target.value)}
              placeholder="論点の名前"
              maxLength={18}
              aria-label="新しい論点の名前"
            />
            <button type="submit">論点切替</button>
          </form>
        </div>

        <div className={styles.metaRow}>
          <div className={styles.speeds} role="group" aria-label="ダミーの速度">
            {SPEEDS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={speed === value}
                className={speed === value ? styles.speedOn : styles.speed}
                onClick={() => chooseSpeed(value)}
              >
                {value}x
              </button>
            ))}
          </div>
          <p className={styles.dummyNote}>ダミーの発言です。音声はまだ繋がっていません。</p>
        </div>
      </header>

      <div className={styles.board}>
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
            {topics.map((topic) => {
              if (topic.atMs == null || topic.atMs > elapsedMs) return null;
              const top = ((elapsedMs - topic.atMs) / 1000) * GD_PX_PER_SEC;
              return (
                <div key={topic.id} className={styles.divider} style={{ top }}>
                  <span>{topic.name}</span>
                </div>
              );
            })}
            <div className={styles.laneOther}>
              {shown
                .filter(({ line }) => line.speaker === '他者')
                .map(({ line, index }) => (
                  <SpeechCard
                    key={`${line.speaker}-${line.atSec}`}
                    line={line}
                    top={((elapsedMs - line.atSec * 1000) / 1000) * GD_PX_PER_SEC}
                    maxPx={sameLaneSlot(index)}
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
                    key={`${line.speaker}-${line.atSec}`}
                    line={line}
                    top={((elapsedMs - line.atSec * 1000) / 1000) * GD_PX_PER_SEC}
                    maxPx={sameLaneSlot(index)}
                  />
                ))}
            </div>
            {phase === 'idle' ? (
              <p className={styles.idleHint}>
                開始すると、ダミーの発言が実時間で上に出ます。左が他者、右が自分。無言は空白のまま残り、自分の長い無言だけ、すこしずつ色が濃くなります。
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
