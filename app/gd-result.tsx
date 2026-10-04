'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import shell from './gd.module.css';
import styles from './gd-result.module.css';
import { StopShareButton } from './stop-share';
import {
  GD_SCORE_AXES,
  averageAxisScore,
  buildClearTitle,
  deriveClearStats,
  formatDurationJa,
  loadPrevAxisScores,
  mockClearView,
  parseTranscriptLines,
  pickBestQuote,
  placeholderEval,
  rankFromAverage,
  savePrevAxisScores,
  type GdAxisScore,
  type GdClearUtterance,
  type GdClearView,
  type GdSelfEval,
} from '@/lib/gd-score';

type Props = {
  goal: string;
  transcript: string;
  genre: string;
  selfCount: number;
  lineCount: number;
  /** Prefer mock clear UI (design preview). Default true when transcript empty. */
  forceMock?: boolean;
  onBack: () => void;
  onLive: () => void;
};

const REVEAL_STEPS = 8;

function RadarChart({ axes }: { axes: GdAxisScore[] }) {
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = 78;
  const n = GD_SCORE_AXES.length;

  function point(i: number, score: number) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const r = (Math.max(0, Math.min(5, score)) / 5) * maxR;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;
  }

  const rings = [1, 2, 3, 4, 5];
  const gridPolys = rings.map((level) =>
    GD_SCORE_AXES.map((_, i) => {
      const [x, y] = point(i, level);
      return `${x},${y}`;
    }).join(' ')
  );

  const valuePoly = axes
    .map((axis, i) => {
      const [x, y] = point(i, axis.score ?? 0);
      return `${x},${y}`;
    })
    .join(' ');

  const spokes = GD_SCORE_AXES.map((_, i) => {
    const [x, y] = point(i, 5);
    return { x, y };
  });

  const labels = GD_SCORE_AXES.map((name, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const r = maxR + 22;
    return {
      name,
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  });

  return (
    <svg
      className={styles.radar}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label="5軸レーダーチャート"
    >
      {gridPolys.map((pts, i) => (
        <polygon
          key={rings[i]}
          points={pts}
          className={i === rings.length - 1 ? styles.radarRingOuter : styles.radarRing}
        />
      ))}
      {spokes.map((s, i) => (
        <line key={i} x1={cx} y1={cy} x2={s.x} y2={s.y} className={styles.radarSpoke} />
      ))}
      <polygon points={valuePoly} className={styles.radarFill} />
      <polygon points={valuePoly} className={styles.radarStroke} />
      {axes.map((axis, i) => {
        const [x, y] = point(i, axis.score ?? 0);
        return <circle key={axis.axis} cx={x} cy={y} r={3.5} className={styles.radarDot} />;
      })}
      {labels.map((lab) => (
        <text
          key={lab.name}
          x={lab.x}
          y={lab.y}
          className={styles.radarLabel}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {lab.name}
        </text>
      ))}
    </svg>
  );
}

function ChartPreview({
  utterances,
  durationSec,
  activeId,
  onPick,
}: {
  utterances: GdClearUtterance[];
  durationSec: number;
  activeId: string | null;
  onPick: (id: string) => void;
}) {
  const span = Math.max(60, durationSec);
  return (
    <div className={styles.chartPreview} aria-label="デュアルレーン縮小プレビュー">
      <div className={styles.chartHeads}>
        <span>他者</span>
        <span className={styles.chartAxis}>時間</span>
        <span className={styles.chartSelfHead}>自分</span>
      </div>
      <div className={styles.chartTrack}>
        <div className={styles.chartMast} aria-hidden="true" />
        {utterances.map((u) => {
          const top = `${(u.atSec / span) * 100}%`;
          const isSelf = u.speaker === '自分';
          const cls = isSelf
            ? activeId === u.id
              ? `${styles.noteSelf} ${styles.noteActive}`
              : styles.noteSelf
            : styles.noteOther;
          return (
            <button
              key={u.id}
              type="button"
              className={cls}
              style={{ top }}
              title={u.text}
              aria-label={`${u.speaker} ${formatDurationJa(u.atSec)}: ${u.text}`}
              onClick={() => onPick(u.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

export function GdResult({
  goal,
  transcript,
  genre,
  selfCount,
  lineCount,
  forceMock,
  onBack,
  onLive,
}: Props) {
  const preferMock = forceMock ?? !transcript.trim();
  const [loading, setLoading] = useState(!preferMock);
  const [evalResult, setEvalResult] = useState<GdSelfEval | null>(
    preferMock ? null : null
  );
  const [reveal, setReveal] = useState(0);
  const [openAxis, setOpenAxis] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [prevAxes, setPrevAxes] = useState<Partial<Record<string, number>>>({});
  const listRef = useRef<HTMLUListElement>(null);
  const savedRef = useRef(false);

  useEffect(() => {
    const stored = loadPrevAxisScores();
    if (Object.keys(stored).length > 0) {
      setPrevAxes(stored);
      return;
    }
    // Mock previous so the clear screen can show NEW RECORD on first preview.
    if (preferMock) {
      setPrevAxes({
        論点整理: 3,
        リーダーシップ: 3,
        論理性: 3,
        協調性: 3,
        付加価値: 2,
      });
    }
  }, [preferMock]);

  useEffect(() => {
    if (preferMock) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let dead = false;
    (async () => {
      if (!transcript.trim()) {
        if (!dead) {
          setEvalResult(placeholderEval('文字起こしが空なので、評価は仮表示です。'));
          setLoading(false);
        }
        return;
      }
      try {
        const res = await fetch('/api/gd-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            theme: goal,
            genre,
            transcript,
          }),
        });
        const data = (await res.json()) as GdSelfEval & { error?: string };
        if (dead) return;
        if (!res.ok || !Array.isArray(data.axes)) {
          setEvalResult(placeholderEval(data.error || '評価に失敗しました。'));
        } else {
          setEvalResult(data);
        }
      } catch (err) {
        if (dead || controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : '評価に失敗しました。';
        setEvalResult(placeholderEval(message));
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => {
      dead = true;
      controller.abort();
    };
  }, [preferMock, goal, genre, transcript]);

  const view: GdClearView = useMemo(() => {
    if (preferMock) return mockClearView();
    const utterances = parseTranscriptLines(transcript);
    const stats = deriveClearStats(
      utterances,
      12 * 60,
      Math.max(2, Math.min(8, Math.round(lineCount > 0 ? lineCount / Math.max(1, selfCount) + 1 : 5)))
    );
    const axes =
      evalResult?.axes ??
      GD_SCORE_AXES.map((axis) => ({ axis, score: null as number | null, comment: '' }));
    const avg = averageAxisScore(axes);
    return {
      mock: Boolean(evalResult?.placeholder),
      goal: goal.trim() || 'お題は未記入',
      rank: rankFromAverage(avg),
      title: buildClearTitle(axes, stats),
      summary: evalResult?.summary || '',
      bestQuote: pickBestQuote(
        evalResult ?? placeholderEval(''),
        utterances,
        '（ベスト発言はまだありません）'
      ),
      axes,
      stats: {
        ...stats,
        // Prefer live counters when transcript parse is thin.
        speakRatio:
          lineCount > 0 ? selfCount / lineCount : stats.speakRatio,
      },
      utterances:
        utterances.length > 0
          ? utterances
          : mockClearView().utterances.map((u) => ({ ...u, id: `fb-${u.id}` })),
      warning: evalResult?.warning,
    };
  }, [preferMock, goal, transcript, evalResult, selfCount, lineCount]);

  useEffect(() => {
    if (loading) return;
    setReveal(0);
    let step = 0;
    const id = window.setInterval(() => {
      step += 1;
      setReveal(step);
      if (step >= REVEAL_STEPS) window.clearInterval(id);
    }, 140);
    return () => window.clearInterval(id);
  }, [loading, view.goal, view.rank]);

  useEffect(() => {
    if (loading || savedRef.current) return;
    if (view.axes.every((a) => a.score == null)) return;
    savedRef.current = true;
    // Persist after paint so NEW RECORD compares against the previous visit.
    const t = window.setTimeout(() => savePrevAxisScores(view.axes), 800);
    return () => window.clearTimeout(t);
  }, [loading, view.axes]);

  function pickUtterance(id: string) {
    setActiveId(id);
    const el = listRef.current?.querySelector(`[data-uid="${id}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  const shown = (step: number) => (reveal >= step ? styles.revealIn : styles.revealWait);

  return (
    <div className={`${shell.scoreStage} ${styles.clearStage}`}>
      <header className={shell.scoreHud}>
        <button type="button" className={shell.scoreHome} onClick={onBack}>
          <span className={shell.scoreChevron} aria-hidden="true" />
          Home
        </button>
        <div>
          <p className={shell.scoreKicker}>GDモード</p>
          <h1 className={shell.scoreTitle}>リザルト</h1>
        </div>
        <StopShareButton />
        <button type="button" className={shell.scoreLive} onClick={onLive}>
          ライブ
        </button>
      </header>

      <div className={`${shell.scoreBody} ${styles.clearBody}`}>
        {loading ? (
          <p className={styles.loading}>クリア評価を集計しています…</p>
        ) : (
          <>
            <section className={`${styles.songBlock} ${shown(1)}`} aria-label="お題">
              <p className={styles.songLabel}>TRACK</p>
              <h2 className={styles.songTitle}>{view.goal}</h2>
              <p className={styles.songMeta}>
                <span>{formatDurationJa(view.stats.durationSec)}</span>
                <span aria-hidden="true">·</span>
                <span>{view.stats.participantCount}人</span>
                {view.mock ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className={styles.mockTag}>モック</span>
                  </>
                ) : null}
              </p>
            </section>

            <section className={`${styles.rankBlock} ${shown(2)}`} aria-label="総合ランク">
              <p className={styles.rankLabel}>RANK</p>
              <p className={`${styles.rankStamp} ${styles[`rank${view.rank}`]}`} data-rank={view.rank}>
                {view.rank}
              </p>
            </section>

            <section className={`${styles.titleBlock} ${shown(3)}`} aria-label="称号">
              <p className={styles.titleLabel}>称号</p>
              <p className={styles.titleValue}>{view.title}</p>
            </section>

            <section className={`${styles.radarBlock} ${shown(4)}`} aria-label="5軸レーダー">
              <RadarChart axes={view.axes} />
              <ul className={styles.radarScores}>
                {view.axes.map((axis) => {
                  const prev = prevAxes[axis.axis];
                  const isNew =
                    axis.score != null && prev != null && axis.score > prev;
                  return (
                    <li key={axis.axis}>
                      <span>{axis.axis}</span>
                      <strong>{axis.score ?? '—'}</strong>
                      {isNew ? <em className={styles.newRecord}>NEW RECORD</em> : null}
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className={`${styles.previewBlock} ${shown(5)}`} aria-label="チャートプレビュー">
              <p className={styles.sectionLabel}>CHART</p>
              <ChartPreview
                utterances={view.utterances}
                durationSec={view.stats.durationSec}
                activeId={activeId}
                onPick={pickUtterance}
              />
              <ul className={styles.utterList} ref={listRef} aria-label="発言リスト">
                {view.utterances.map((u) => (
                  <li
                    key={u.id}
                    data-uid={u.id}
                    className={[
                      styles.utterItem,
                      u.speaker === '自分' ? styles.utterSelf : styles.utterOther,
                      activeId === u.id ? styles.utterActive : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <button type="button" onClick={() => pickUtterance(u.id)}>
                      <span className={styles.utterClock}>{formatDurationJa(u.atSec)}</span>
                      <span className={styles.utterWho}>{u.speaker}</span>
                      <span className={styles.utterText}>{u.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className={`${styles.quoteBlock} ${shown(6)}`} aria-label="ベスト発言">
              <p className={styles.sectionLabel}>BEST</p>
              <blockquote className={styles.quote}>「{view.bestQuote}」</blockquote>
              {view.summary ? <p className={styles.summary}>{view.summary}</p> : null}
            </section>

            <section className={`${styles.axisSections} ${shown(7)}`} aria-label="軸別コメント">
              <p className={styles.sectionLabel}>DETAIL</p>
              {view.axes.map((axis) => {
                const open = openAxis === axis.axis;
                const prev = prevAxes[axis.axis];
                const isNew =
                  axis.score != null && prev != null && axis.score > prev;
                return (
                  <details
                    key={axis.axis}
                    className={styles.axisDetails}
                    open={open}
                    onToggle={(e) => {
                      const el = e.currentTarget;
                      setOpenAxis(el.open ? axis.axis : null);
                    }}
                  >
                    <summary>
                      <span>{axis.axis}</span>
                      <span className={styles.axisScoreInline}>
                        {axis.score ?? '—'}/5
                        {isNew ? <em className={styles.newRecord}>NEW RECORD</em> : null}
                      </span>
                    </summary>
                    <p className={styles.axisComment}>{axis.comment || 'コメントはありません。'}</p>
                    <p className={styles.axisStats}>
                      発言比率 {(view.stats.speakRatio * 100).toFixed(0)}% · 応答{' '}
                      {view.stats.responseCount}回
                      {prev != null ? ` · 前回 ${prev}` : ''}
                    </p>
                  </details>
                );
              })}
            </section>

            {view.warning ? (
              <p className={`${styles.warn} ${shown(8)}`} role="status">
                {view.warning}
              </p>
            ) : (
              <p className={`${styles.footerNote} ${shown(8)}`}>
                {preferMock
                  ? 'モックUIです。本番では終了後の文字起こしからLLMが5軸と総評を埋めます。'
                  : 'コンボ表示はありません。黒×金のクリア画面です。'}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
