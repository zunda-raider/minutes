'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './page.module.css';
import gd from './gd.module.css';
import {
  coerceGdAnalysis,
  formatGdNote,
  gdSpeakerFromId,
  layoutVoyage,
  sameGdNote,
  topicForest,
  type GdAnalysis,
  type GdEffect,
  type GdTopicNode,
  type VoyageMarker,
} from '@/lib/gd-analyze';
import { quietSpeakerTag } from '@/lib/speaker-letters';

export type GdHistoryEntry = {
  id: string;
  note: number;
  text: string;
  textJa?: string;
  at: string;
  speakerId?: number;
  source?: 'mic' | 'system';
};

type Props = {
  entries: GdHistoryEntry[];
  genre: string;
  historyReady: boolean;
  onBack: () => void;
};

const EFFECT_FILL: Record<GdEffect, string> = {
  前進: '#34d399',
  脱線: '#fbbf24',
  停滞: '#cbd5e1',
};

function entryText(entry: GdHistoryEntry): string {
  const ja = entry.textJa?.trim();
  if (ja) return ja;
  return entry.text.trim();
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= 90) return flat || '（空）';
  return `${flat.slice(0, 90)}…`;
}

function speakerCaption(entry: GdHistoryEntry): string {
  const role = gdSpeakerFromId(entry.speakerId);
  const quiet = quietSpeakerTag(entry.speakerId, entry.source);
  if (quiet && quiet !== role) return `${role}（${quiet}）`;
  return role;
}

function isAnalysis(value: unknown): value is GdAnalysis {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.conclusion === 'string' &&
    Array.isArray(rec.topics) &&
    Array.isArray(rec.mappings)
  );
}

function Voyage({
  markers,
  conclusion,
}: {
  markers: VoyageMarker[];
  conclusion: string;
}) {
  const X0 = 78;
  const X1 = 800;
  const Y0 = 168;
  const sx = (m: VoyageMarker) => {
    const base = X0 + m.x * (X1 - X0);
    if (m.effect === '前進') return base;
    // A few px so 停滞 / 脱線 are not hidden under the previous 前進 dot.
    return Math.min(base + 16, X1 - 4);
  };
  const sy = (m: VoyageMarker) => Y0 + m.y * 78;
  const points = [
    `${X0},${Y0}`,
    ...markers.map((m) => `${sx(m)},${sy(m)}`),
  ].join(' ');
  const last = markers[markers.length - 1];
  const ship = last ? { x: sx(last), y: sy(last) } : { x: X0, y: Y0 };
  const showLabels = markers.length > 0 && markers.length <= 18;

  return (
    <svg
      className={gd.sea}
      viewBox="0 0 960 300"
      role="img"
      aria-label={
        conclusion
          ? `航海。結論は${conclusion}`
          : '航海。左が出発、右が結論の島です。'
      }
    >
      <defs>
        <linearGradient id="gdSea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0c4a6e" />
          <stop offset="1" stopColor="#082032" />
        </linearGradient>
      </defs>
      <rect width="960" height="300" fill="url(#gdSea)" />
      <path
        d="M0 214 Q 60 198 120 214 T 240 214 T 360 214 T 480 214 T 600 214 T 720 214 T 840 214 T 960 214"
        fill="none"
        stroke="rgba(186, 230, 253, 0.28)"
        strokeWidth="2"
      />
      <path
        d="M0 236 Q 70 224 140 236 T 280 236 T 420 236 T 560 236 T 700 236 T 840 236 T 980 236"
        fill="none"
        stroke="rgba(125, 211, 252, 0.18)"
        strokeWidth="2"
      />
      <line
        x1={X0}
        y1={Y0}
        x2="860"
        y2={Y0}
        stroke="rgba(255,255,255,0.38)"
        strokeDasharray="6 7"
      />
      <circle cx={X0} cy={Y0} r="7" fill="#e2e8f0" />
      <text x="24" y="196" fill="#e2e8f0" fontSize="13">
        出発
      </text>
      <ellipse cx="890" cy="196" rx="54" ry="18" fill="#3f6b45" />
      <path d="M858 188 L890 138 L922 188 Z" fill="#86efac" />
      <text x="868" y="230" fill="#ecfdf5" fontSize="13">
        結論
      </text>
      {markers.length > 0 && (
        <polyline
          points={points}
          fill="none"
          stroke="rgba(224, 242, 254, 0.85)"
          strokeWidth="2"
        />
      )}
      {markers.map((m) => {
        const x = sx(m);
        const y = sy(m);
        const label = `#${formatGdNote(m.note)} ${m.effect}${m.self ? ' 自分' : ''}`;
        return (
          <g key={`${formatGdNote(m.note)}-${m.effect}`}>
            <circle cx={x} cy={y} r="6.5" fill={EFFECT_FILL[m.effect] ?? EFFECT_FILL['停滞']}>
              <title>{label}</title>
            </circle>
            {m.self && (
              <g>
                <path d={`M${x} ${y - 8} L${x} ${y - 24}`} stroke="#ffe4e6" strokeWidth="1.4" />
                <path
                  d={`M${x} ${y - 24} L${x + 12} ${y - 19} L${x} ${y - 14} Z`}
                  fill="#fb7185"
                />
              </g>
            )}
            {showLabels && (
              <text x={x + 8} y={y + 16} fill="#e2e8f0" fontSize="10">
                {`#${formatGdNote(m.note)}`}
              </text>
            )}
          </g>
        );
      })}
      <g transform={`translate(${ship.x} ${ship.y - 18})`} aria-hidden="true">
        <path d="M-16 8 L16 8 L10 16 L-10 16 Z" fill="#f8fafc" />
        <path d="M0 8 L0 -6" stroke="#e2e8f0" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

function Branch({
  node,
  depth,
  activeId,
  mappings,
  selfByNote,
  onSelect,
}: {
  node: GdTopicNode;
  depth: number;
  activeId: string | null;
  mappings: GdAnalysis['mappings'];
  selfByNote: Map<string, boolean>;
  onSelect: (id: string) => void;
}) {
  if (depth > 12) return null;
  const leaves = mappings.filter((m) => m.topicId === node.topic.id);
  const active = activeId === node.topic.id;
  return (
    <li className={gd.branch}>
      <button
        type="button"
        className={active ? `${gd.branchButton} ${gd.branchButtonActive}` : gd.branchButton}
        aria-pressed={active}
        onClick={() => onSelect(node.topic.id)}
      >
        {node.topic.label || '論点'}
      </button>
      {leaves.length > 0 && (
        <ul className={gd.leaves}>
          {leaves.map((leaf) => (
            <li key={formatGdNote(leaf.note)}>
              <Leaf
                note={leaf.note}
                self={selfByNote.get(formatGdNote(leaf.note)) ?? false}
                effect={leaf.effect}
              />
            </li>
          ))}
        </ul>
      )}
      {node.children.length > 0 && (
        <ul className={gd.branchList}>
          {node.children.map((child) => (
            <Branch
              key={child.topic.id}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              mappings={mappings}
              selfByNote={selfByNote}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function Leaf({
  note,
  self,
  effect,
}: {
  note: number;
  self: boolean;
  effect: GdEffect;
}) {
  return (
    <span className={self ? gd.fruit : gd.leaf} title={`${effect}${self ? ' · 自分' : ' · 他者'}`}>
      #{formatGdNote(note)}
    </span>
  );
}

export function GdScreen({ entries, genre, historyReady, onBack }: Props) {
  const ordered = useMemo(
    () => [...entries].sort((a, b) => a.note - b.note),
    [entries]
  );
  const [picked, setPicked] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<GdAnalysis | null>(null);
  const [snapshot, setSnapshot] = useState<GdHistoryEntry[]>([]);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);

  useEffect(() => {
    if (picked) return;
    setSelected(new Set(ordered.map((entry) => entry.id)));
  }, [ordered, picked]);

  const allOn = ordered.length > 0 && ordered.every((entry) => selected.has(entry.id));

  async function runAnalysis() {
    const chosen = ordered.filter((entry) => selected.has(entry.id));
    if (chosen.length === 0) {
      setError('分析する発言を1件以上選んでください。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/gd-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          genre: genre.trim() || undefined,
          utterances: chosen.map((entry) => ({
            note: entry.note,
            text: entryText(entry),
            speaker: gdSpeakerFromId(entry.speakerId),
          })),
        }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          data &&
          typeof data === 'object' &&
          'error' in data &&
          typeof (data as { error?: unknown }).error === 'string'
            ? (data as { error: string }).error
            : '分析に失敗しました。';
        setError(message);
        return;
      }
      const notes = chosen.map((entry) => entry.note);
      const analysis = isAnalysis(data)
        ? data
        : coerceGdAnalysis(data, notes, data != null && typeof data === 'object');
      setSnapshot(chosen);
      setResult({
        conclusion: typeof analysis.conclusion === 'string' ? analysis.conclusion : '',
        topics: Array.isArray(analysis.topics) ? analysis.topics : [],
        mappings: Array.isArray(analysis.mappings) ? analysis.mappings : [],
        warning: analysis.warning,
      });
      setActiveTopic(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '分析に失敗しました。');
    } finally {
      setBusy(false);
    }
  }

  const selfByNote = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const entry of snapshot) {
      map.set(formatGdNote(entry.note), gdSpeakerFromId(entry.speakerId) === '自分');
    }
    return map;
  }, [snapshot]);

  const forest = useMemo(() => {
    try {
      return topicForest(result?.topics ?? []);
    } catch {
      return [];
    }
  }, [result]);

  const markers = useMemo(() => {
    if (!result) return [];
    try {
      return layoutVoyage(
        result.mappings.map((mapping) => ({
          note: mapping.note,
          effect: mapping.effect,
          self: selfByNote.get(formatGdNote(mapping.note)) ?? false,
        }))
      );
    } catch {
      return [];
    }
  }, [result, selfByNote]);

  const activeNode = result?.topics.find((topic) => topic.id === activeTopic) ?? null;
  const activeUtterances =
    result && activeTopic
      ? result.mappings.filter((mapping) => mapping.topicId === activeTopic)
      : [];

  return (
    <div className={`${styles.app} ${styles.appGd}`}>
      <div className={styles.bgGlow} aria-hidden="true" />
      <header className={styles.noteTopBar}>
        <button type="button" className={styles.backButton} onClick={onBack}>
          <span className={styles.backChevron} aria-hidden="true" />
          Home
        </button>
        <div className={styles.noteHeading}>
          <h1 className={styles.title}>GD議事録</h1>
          <p className={styles.subtitle}>グループディスカッション</p>
        </div>
      </header>

      {result ? (
        <div className={gd.stack}>
          <div className={gd.resultBar}>
            <p className={gd.pickerHelp}>
              保存済みの{snapshot.length}件を1回だけ分析しました。話者（自分 / 他者）はアプリのラベルです。
            </p>
            <button
              type="button"
              className={gd.ghost}
              onClick={() => {
                setResult(null);
                setActiveTopic(null);
              }}
            >
              履歴を選び直す
            </button>
          </div>
          {result.warning && (
            <p className={gd.warn} role="status">
              {result.warning}
            </p>
          )}

          <section className={gd.panel} aria-label="航海">
            <h2 className={gd.panelTitle}>航海</h2>
            {result.conclusion ? (
              <p className={gd.conclusion}>{result.conclusion}</p>
            ) : (
              <p className={gd.conclusionEmpty}>結論は返りませんでした。</p>
            )}
            <Voyage markers={markers} conclusion={result.conclusion} />
            <ul className={gd.legend}>
              <li>
                <span>
                  <i className={`${gd.swatch} ${gd.swatchForward}`} aria-hidden="true" />
                  前進（島へ進む）
                </span>
              </li>
              <li>
                <span>
                  <i className={`${gd.swatch} ${gd.swatchDerail}`} aria-hidden="true" />
                  脱線（航路から外れる）
                </span>
              </li>
              <li>
                <span>
                  <i className={`${gd.swatch} ${gd.swatchStall}`} aria-hidden="true" />
                  停滞（その場）
                </span>
              </li>
              <li>
                <span>
                  <i className={`${gd.swatch} ${gd.swatchFlag}`} aria-hidden="true" />
                  旗は自分の発言
                </span>
              </li>
            </ul>
          </section>

          <section className={gd.panel} aria-label="木">
            <h2 className={gd.panelTitle}>木</h2>
            {forest.length === 0 ? (
              <p className={gd.hint}>論点は返りませんでした。</p>
            ) : (
              <div className={gd.treeWrap}>
                <div className={gd.trunk} aria-hidden="true" />
                <ul className={gd.roots}>
                  {forest.map((node) => (
                    <Branch
                      key={node.topic.id}
                      node={node}
                      depth={0}
                      activeId={activeTopic}
                      mappings={result.mappings}
                      selfByNote={selfByNote}
                      onSelect={setActiveTopic}
                    />
                  ))}
                </ul>
              </div>
            )}
            {!activeNode && forest.length > 0 && (
              <p className={gd.hint}>枝をクリックすると、その論点の発言を表示します。</p>
            )}
            {activeNode && (
              <div className={gd.topicPanel}>
                <h3>{activeNode.label}</h3>
                {activeUtterances.length === 0 ? (
                  <p className={gd.hint}>この論点に直接紐づく発言はありません。</p>
                ) : (
                  <ul className={gd.topicUtterances}>
                    {activeUtterances.map((mapping) => {
                      const entry = snapshot.find((item) => sameGdNote(item.note, mapping.note));
                      const self = entry ? gdSpeakerFromId(entry.speakerId) === '自分' : false;
                      return (
                        <li key={formatGdNote(mapping.note)} className={gd.topicUtterance}>
                          <div className={gd.historyMeta}>
                            <span className={gd.note}>#{formatGdNote(mapping.note)}</span>
                            <span className={self ? gd.selfTag : gd.otherTag}>
                              {self ? '自分' : '他者'}
                            </span>
                            <span>{mapping.effect}</span>
                          </div>
                          <p>{entry ? entryText(entry) || '（空）' : '（本文なし）'}</p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </section>
        </div>
      ) : (
        <section className={gd.picker}>
          <p className={gd.stub}>
            GDを終了して自動で結果を開く動線は準備中です。このブラウザに保存されている文字起こしを選んで「分析する」と、同じ結果画面を試せます。
          </p>
          <div className={gd.pickerHead}>
            <div>
              <h2 className={gd.pickerTitle}>過去の文字起こし</h2>
              <p className={gd.pickerHelp}>
                {historyReady
                  ? `保存済み ${ordered.length} 件。チェックした発言だけを、終了時の1回の分析に使います。`
                  : '履歴を読み込んでいます…'}
              </p>
            </div>
          </div>

          {historyReady && ordered.length === 0 ? (
            <div className={styles.emptyState}>
              <h3 className={styles.emptyTitle}>保存済みの文字起こしがありません</h3>
              <p className={styles.emptyBody}>
                Homeで録音すると、この画面に履歴が出ます。ライブのGD終了はまだ接続していません。
              </p>
              <button type="button" className={styles.recordButton} onClick={onBack}>
                Home に戻る
              </button>
            </div>
          ) : (
            <>
              <ul className={gd.historyList}>
                {ordered.map((entry) => {
                  const role = gdSpeakerFromId(entry.speakerId);
                  return (
                    <li key={entry.id} className={gd.historyItem}>
                      <input
                        type="checkbox"
                        checked={selected.has(entry.id)}
                        aria-label={`#${formatGdNote(entry.note)} を分析に含める`}
                        onChange={() => {
                          setPicked(true);
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(entry.id)) next.delete(entry.id);
                            else next.add(entry.id);
                            return next;
                          });
                        }}
                      />
                      <div>
                        <div className={gd.historyMeta}>
                          <span className={gd.note}>#{formatGdNote(entry.note)}</span>
                          <span className={role === '自分' ? gd.selfTag : gd.otherTag}>
                            {speakerCaption(entry)}
                          </span>
                        </div>
                        <p className={gd.historyText}>{excerpt(entryText(entry))}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className={gd.pickerActions}>
                <button
                  type="button"
                  className={gd.ghost}
                  onClick={() => {
                    setPicked(true);
                    setSelected(allOn ? new Set() : new Set(ordered.map((entry) => entry.id)));
                  }}
                  disabled={!historyReady || ordered.length === 0}
                >
                  {allOn ? 'すべて解除' : 'すべて選択'}
                </button>
                <button
                  type="button"
                  className={gd.analyzeButton}
                  disabled={busy || !historyReady || ordered.length === 0}
                  onClick={() => void runAnalysis()}
                >
                  {busy ? '分析中…' : '分析する'}
                </button>
              </div>
            </>
          )}
          {error && (
            <p className={gd.error} role="alert">
              {error}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
