'use client';

import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import styles from './gd-live.module.css';
import {
  LOGIC_TREE_STORAGE_KEY,
  applyOrganize,
  emptyLogicTree,
  logicTreeHasContent,
  newLogicId,
  parseStoredLogicTree,
  type LogicTreeDoc,
  type OrganizeResponse,
} from '@/lib/gd-organize';

type Props = {
  theme: string;
  transcript: string;
};

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function isOrganizeResponse(value: unknown): value is OrganizeResponse {
  if (!value || typeof value !== 'object') return false;
  const row = value as OrganizeResponse;
  return typeof row.comment === 'string' && Array.isArray(row.statuses);
}

export function GdLogicTree({ theme, transcript }: Props) {
  const [doc, setDoc] = useState<LogicTreeDoc>(emptyLogicTree);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const docRef = useRef(doc);
  const transcriptRef = useRef(transcript);
  const themeRef = useRef(theme);
  docRef.current = doc;
  transcriptRef.current = transcript;
  themeRef.current = theme;

  useEffect(() => {
    try {
      setDoc(parseStoredLogicTree(window.localStorage.getItem(LOGIC_TREE_STORAGE_KEY)));
    } catch {
      setDoc(emptyLogicTree());
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(LOGIC_TREE_STORAGE_KEY, JSON.stringify(doc));
    } catch {
      /* private mode / quota */
    }
  }, [doc, ready]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function patch(updater: (prev: LogicTreeDoc) => LogicTreeDoc) {
    setDoc((prev) => updater(prev));
  }

  function addGoal() {
    const id = newLogicId('g');
    patch((prev) => ({
      ...prev,
      goals: [...prev.goals, { id, label: '', hint: '', points: [] }],
    }));
  }

  function renameGoal(id: string, label: string) {
    patch((prev) => ({
      ...prev,
      goals: prev.goals.map((goal) => (goal.id === id ? { ...goal, label } : goal)),
    }));
  }

  function removeGoal(id: string) {
    patch((prev) => {
      const goal = prev.goals.find((item) => item.id === id);
      const drop = new Set<string>([id, ...(goal?.points.map((point) => point.id) ?? [])]);
      return {
        ...prev,
        goals: prev.goals.filter((item) => item.id !== id),
        talkingId: prev.talkingId && drop.has(prev.talkingId) ? null : prev.talkingId,
      };
    });
  }

  function addPoint(goalId: string) {
    const id = newLogicId('p');
    patch((prev) => ({
      ...prev,
      goals: prev.goals.map((goal) =>
        goal.id === goalId
          ? { ...goal, points: [...goal.points, { id, label: '', hint: '' }] }
          : goal
      ),
    }));
  }

  function renamePoint(goalId: string, pointId: string, label: string) {
    patch((prev) => ({
      ...prev,
      goals: prev.goals.map((goal) =>
        goal.id === goalId
          ? {
              ...goal,
              points: goal.points.map((point) =>
                point.id === pointId ? { ...point, label } : point
              ),
            }
          : goal
      ),
    }));
  }

  function removePoint(goalId: string, pointId: string) {
    patch((prev) => ({
      ...prev,
      goals: prev.goals.map((goal) =>
        goal.id === goalId
          ? { ...goal, points: goal.points.filter((point) => point.id !== pointId) }
          : goal
      ),
      talkingId: prev.talkingId === pointId ? null : prev.talkingId,
    }));
  }

  function markTalking(id: string) {
    patch((prev) => ({ ...prev, talkingId: prev.talkingId === id ? null : id }));
  }

  function onRowClick(id: string, event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, button, textarea')) return;
    markTalking(id);
  }

  async function organize() {
    if (busy) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setStatus('整理中…');
    try {
      const res = await fetch('/api/gd-organize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          theme: themeRef.current,
          transcript: transcriptRef.current,
          tree: docRef.current,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | (OrganizeResponse & { error?: string })
        | null;
      if (!res.ok) {
        throw new Error(data?.error || '論点整理に失敗しました。');
      }
      if (!isOrganizeResponse(data)) {
        throw new Error('整理結果の形が違います。');
      }
      setDoc((prev) => applyOrganize(prev, data));
      setStatus(data.warning || '整理しました。木の名前はそのままです。');
    } catch (err) {
      if (isAbort(err)) {
        setStatus('中止しました。');
        return;
      }
      setStatus(err instanceof Error ? err.message : '論点整理に失敗しました。');
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(false);
    }
  }

  function cancelOrganize() {
    abortRef.current?.abort();
  }

  const themeText = theme.trim();
  const canOrganize = Boolean(transcript.trim()) || logicTreeHasContent(doc);

  return (
    <aside className={styles.tree} aria-label="論理の木">
      <div className={styles.treeHead}>
        <p className={styles.treeKicker}>論理の木</p>
        <button type="button" className={styles.treeMini} onClick={addGoal}>
          ＋大論点
        </button>
      </div>

      <div className={styles.treeScroll}>
        <div className={styles.treeRoot}>
          <p className={styles.treeRole}>目的</p>
          <p className={themeText ? styles.treeGoal : styles.treeMuted}>
            {themeText || 'お題はまだありません'}
          </p>
        </div>

        {!ready ? <p className={styles.treeEmpty}>読み込み中</p> : null}
        {ready && doc.goals.length === 0 ? (
          <p className={styles.treeEmpty}>大論点はまだありません</p>
        ) : null}

        {doc.goals.map((goal) => {
          const goalOn = doc.talkingId === goal.id;
          return (
            <section
              key={goal.id}
              className={goalOn ? `${styles.treeRoot} ${styles.treeRootCurrent}` : styles.treeRoot}
              onClick={(event) => onRowClick(goal.id, event)}
              aria-current={goalOn ? 'true' : undefined}
            >
              <div className={styles.treeEditRow}>
                <p className={styles.treeRole}>大論点</p>
                {goal.hint ? <span className={styles.treeHint}>{goal.hint}</span> : null}
                <button
                  type="button"
                  className={goalOn ? styles.treeMiniOn : styles.treeMini}
                  aria-pressed={goalOn}
                  onClick={() => markTalking(goal.id)}
                >
                  {goalOn ? 'いま話してる' : 'いま'}
                </button>
                <button
                  type="button"
                  className={styles.treeMini}
                  aria-label="この大論点を削除"
                  onClick={() => removeGoal(goal.id)}
                >
                  削除
                </button>
              </div>
              <input
                className={styles.treeName}
                value={goal.label}
                maxLength={80}
                placeholder="大論点の名前"
                aria-label="大論点の名前"
                onChange={(event) => renameGoal(goal.id, event.target.value)}
              />
              <ul className={styles.treeList}>
                {goal.points.length === 0 ? (
                  <li className={styles.treeEmpty}>論点はまだありません</li>
                ) : null}
                {goal.points.map((point) => {
                  const on = doc.talkingId === point.id;
                  return (
                    <li
                      key={point.id}
                      className={on ? `${styles.treeNode} ${styles.treeNodeCurrent}` : styles.treeNode}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRowClick(point.id, event);
                      }}
                      aria-current={on ? 'true' : undefined}
                    >
                      <div className={styles.treeEditRow}>
                        <span className={styles.treeRole}>論点</span>
                        {point.hint ? <span className={styles.treeHint}>{point.hint}</span> : null}
                        <button
                          type="button"
                          className={on ? styles.treeMiniOn : styles.treeMini}
                          aria-pressed={on}
                          onClick={() => markTalking(point.id)}
                        >
                          {on ? 'いま話してる' : 'いま'}
                        </button>
                        <button
                          type="button"
                          className={styles.treeMini}
                          aria-label="この論点を削除"
                          onClick={() => removePoint(goal.id, point.id)}
                        >
                          削除
                        </button>
                      </div>
                      <input
                        className={styles.treeName}
                        value={point.label}
                        maxLength={80}
                        placeholder="論点の名前"
                        aria-label="論点の名前"
                        onChange={(event) => renamePoint(goal.id, point.id, event.target.value)}
                      />
                    </li>
                  );
                })}
              </ul>
              <button type="button" className={styles.treeMini} onClick={() => addPoint(goal.id)}>
                ＋論点
              </button>
            </section>
          );
        })}
      </div>

      <div className={styles.treeFoot}>
        <div className={styles.treeEditRow}>
          <label className={styles.treeRole} htmlFor="gd-ai-comment">
            AIコメント
          </label>
          <button
            type="button"
            className={styles.treeOrganize}
            onClick={() => void organize()}
            disabled={busy || !canOrganize}
            title={canOrganize ? 'いまの文字起こしと木を整理' : '文字起こしか大論点を入れてから'}
          >
            {busy ? '整理中' : '論点整理'}
          </button>
          {busy ? (
            <button type="button" className={styles.treeMini} onClick={cancelOrganize}>
              中止
            </button>
          ) : null}
        </div>
        <textarea
          id="gd-ai-comment"
          className={styles.treeComment}
          value={doc.comment}
          maxLength={1200}
          placeholder="論点整理の結果がここに出ます。手でも直せます。"
          onChange={(event) =>
            patch((prev) => ({
              ...prev,
              comment: event.target.value,
            }))
          }
        />
        <p
          className={status && !busy && status !== '整理しました。木の名前はそのままです。' ? styles.treeStatusAlert : styles.treeStatus}
          role="status"
        >
          {status}
        </p>
      </div>
    </aside>
  );
}
