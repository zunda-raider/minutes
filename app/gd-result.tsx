'use client';

import { useEffect, useState } from 'react';
import styles from './gd.module.css';
import { StopShareButton } from './stop-share';
import {
  GD_SCORE_AXES,
  placeholderEval,
  type GdSelfEval,
} from '@/lib/gd-score';

type Props = {
  goal: string;
  transcript: string;
  genre: string;
  selfCount: number;
  lineCount: number;
  onBack: () => void;
  onLive: () => void;
};

function Pips({ score }: { score: number | null }) {
  return (
    <span className={styles.pips} aria-hidden="true">
      {GD_SCORE_AXES.map((_, index) => (
        <i
          key={index}
          className={score != null && index < score ? styles.pipOn : styles.pip}
        />
      ))}
    </span>
  );
}

export function GdResult({
  goal,
  transcript,
  genre,
  selfCount,
  lineCount,
  onBack,
  onLive,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<GdSelfEval | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let dead = false;
    (async () => {
      if (!transcript.trim()) {
        if (!dead) {
          setResult(placeholderEval('文字起こしが空なので、評価は仮表示です。'));
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
          setResult(placeholderEval(data.error || '評価に失敗しました。'));
        } else {
          setResult(data);
        }
      } catch (err) {
        if (dead || controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : '評価に失敗しました。';
        setResult(placeholderEval(message));
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => {
      dead = true;
      controller.abort();
    };
  }, [goal, genre, transcript]);

  const selfLines = transcript
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('] 自分:'));

  return (
    <div className={styles.scoreStage}>
      <header className={styles.scoreHud}>
        <button type="button" className={styles.scoreHome} onClick={onBack}>
          <span className={styles.scoreChevron} aria-hidden="true" />
          Home
        </button>
        <div>
          <p className={styles.scoreKicker}>GDモード</p>
          <h1 className={styles.scoreTitle}>結果</h1>
        </div>
        <StopShareButton />
        <button type="button" className={styles.scoreLive} onClick={onLive}>
          ライブ
        </button>
      </header>

      <div className={styles.scoreBody}>
        <section className={styles.scoreRoot} aria-label="総評">
          <p className={styles.scoreRole}>自分</p>
          <p className={styles.scoreGoal}>{goal.trim() || 'お題は未記入'}</p>
          {loading ? (
            <p className={styles.scoreMuted}>全文を1回だけ評価しています…</p>
          ) : (
            <p className={styles.scoreSummary}>{result?.summary || '総評はありません。'}</p>
          )}
          <p className={styles.scoreMeta}>
            発言 {lineCount} 件 / 自分 {selfCount} 件
            {result?.placeholder ? ' · 仮表示' : ''}
          </p>
          {result?.warning ? (
            <p className={styles.scoreWarn} role="status">
              {result.warning}
            </p>
          ) : null}
        </section>

        <ul className={styles.scoreTree} aria-label="自分の5軸">
          {(result?.axes ?? GD_SCORE_AXES.map((axis) => ({ axis, score: null, comment: '' }))).map(
            (axis) => (
              <li key={axis.axis}>
                <article className={styles.axisNode}>
                  <div className={styles.axisTop}>
                    <h2>{axis.axis}</h2>
                    <p className={styles.axisScore}>
                      <span className={styles.axisScoreNum}>
                        {loading ? '…' : axis.score == null ? '—' : axis.score}
                      </span>
                      <span className={styles.axisScoreDen}>/5</span>
                    </p>
                  </div>
                  <Pips score={loading ? null : axis.score} />
                  <p className={styles.axisComment}>
                    {loading ? ' ' : axis.comment || 'コメントはありません。'}
                  </p>
                </article>
              </li>
            )
          )}
        </ul>

        <section className={styles.scoreRoot} aria-label="自分の発言">
          <p className={styles.scoreRole}>発言</p>
          {selfLines.length === 0 ? (
            <p className={styles.scoreMuted}>自分の発言はありません。</p>
          ) : (
            <ul className={styles.selfLines}>
              {selfLines.map((line, index) => (
                <li key={`${index}-${line.slice(0, 24)}`} className={styles.selfLine}>
                  {line}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
