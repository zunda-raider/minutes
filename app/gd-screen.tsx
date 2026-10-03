'use client';

import { useEffect, useId, useMemo, useState } from 'react';
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

function smoothDetour(
  d: string,
  fromX: number,
  fromY: number,
  x: number,
  y: number,
  backToRoute: boolean,
  routeY: number,
): string {
  const midY = (fromY + y) / 2;
  let next = `${d} C ${fromX + (x - fromX) * 0.4} ${fromY}, ${x - 20} ${midY}, ${x} ${y}`;
  if (backToRoute) {
    next += ` C ${x + 22} ${midY}, ${x + 8} ${routeY}, ${x} ${routeY}`;
  }
  return next;
}

function Voyage({
  markers,
  conclusion,
}: {
  markers: VoyageMarker[];
  conclusion: string;
}) {
  const rawId = useId().replace(/:/g, '');
  const X0 = 72;
  const X1 = 736;
  const Y0 = 214;
  const sx = (m: VoyageMarker) => {
    const base = X0 + m.x * (X1 - X0);
    if (m.effect === '前進') return base;
    return Math.min(base + 14, X1 - 8);
  };
  const sy = (m: VoyageMarker) => {
    if (m.effect === '脱線') return Y0 + (m.y < 0 ? -78 : 78);
    if (m.effect === '停滞') return Y0 + m.y * 46;
    return Y0;
  };
  const last = markers[markers.length - 1];
  const ship = !last
    ? { x: X0, y: Y0 }
    : last.effect === '脱線'
      ? { x: sx(last), y: sy(last) }
      : { x: sx(last), y: Y0 };

  let sailed = `M ${X0} ${Y0}`;
  let cx = X0;
  let cy = Y0;
  markers.forEach((m, i) => {
    const x = sx(m);
    const y = sy(m);
    if (m.effect === '脱線') {
      const back = i !== markers.length - 1;
      sailed = smoothDetour(sailed, cx, cy, x, y, back, Y0);
      cx = x;
      cy = back ? Y0 : y;
    } else {
      sailed += ` L ${x.toFixed(1)} ${Y0}`;
      cx = x;
      cy = Y0;
    }
  });

  const showLabels = markers.length > 0 && markers.length <= 18;
  const skyId = `${rawId}-sky`;
  const seaId = `${rawId}-sea`;
  const sandId = `${rawId}-sand`;
  const softId = `${rawId}-soft`;

  return (
    <svg
      className={gd.sea}
      viewBox="0 0 960 360"
      role="img"
      aria-label={
        conclusion
          ? `航海。結論は${conclusion}`
          : '航海。左が出発、右が結論の島です。'
      }
    >
      <defs>
        <linearGradient id={skyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7dd3fc" />
          <stop offset="0.55" stopColor="#e0f2fe" />
          <stop offset="1" stopColor="#fef3c7" />
        </linearGradient>
        <linearGradient id={seaId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="0.35" stopColor="#0284c7" />
          <stop offset="0.72" stopColor="#075985" />
          <stop offset="1" stopColor="#082f49" />
        </linearGradient>
        <linearGradient id={sandId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="1" stopColor="#f6d7a7" />
        </linearGradient>
        <filter id={softId} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1.2" stdDeviation="1.4" floodColor="#0f172a" floodOpacity="0.35" />
        </filter>
      </defs>

      <rect width="960" height="360" fill={`url(#${skyId})`} />
      <circle cx="118" cy="52" r="34" fill="#fde68a" opacity="0.35" />
      <circle cx="118" cy="52" r="20" fill="#facc15" />
      <g fill="#ffffff" opacity="0.9">
        <ellipse cx="250" cy="48" rx="28" ry="12" />
        <ellipse cx="274" cy="44" rx="20" ry="14" />
        <ellipse cx="228" cy="46" rx="16" ry="10" />
        <ellipse cx="620" cy="36" rx="34" ry="13" />
        <ellipse cx="650" cy="32" rx="22" ry="14" />
        <ellipse cx="592" cy="34" rx="18" ry="11" />
      </g>
      <g fill="none" stroke="#0f172a" strokeWidth="1.4" strokeLinecap="round" opacity="0.45">
        <path d="M400 58 l8 6 l8 -6" />
        <path d="M438 44 l7 5 l7 -5" />
      </g>

      <rect y="128" width="960" height="232" fill={`url(#${seaId})`} />
      <g className={gd.waveDrift} fill="none">
        <path
          d="M-320 168 Q-240 150 -160 168 T0 168 T160 168 T320 168 T480 168 T640 168 T800 168 T960 168 T1120 168 T1280 168"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth="2"
        />
        <path
          className={gd.waveFill}
          d="M-320 250 Q-240 232 -160 250 T0 250 T160 250 T320 250 T480 250 T640 250 T800 250 T960 250 T1120 250 T1280 250 V360 H-320 Z"
        />
        <path
          d="M-320 286 Q-240 270 -160 286 T0 286 T160 286 T320 286 T480 286 T640 286 T800 286 T960 286 T1120 286 T1280 286"
          stroke="rgba(224,242,254,0.45)"
          strokeWidth="2"
        />
        <path
          className={gd.waveFillDeep}
          d="M-320 312 Q-240 298 -160 312 T0 312 T160 312 T320 312 T480 312 T640 312 T800 312 T960 312 T1120 312 T1280 312 V360 H-320 Z"
        />
      </g>

      <line
        x1={X0}
        y1={Y0}
        x2="860"
        y2={Y0}
        stroke="rgba(255,255,255,0.72)"
        strokeDasharray="7 8"
        strokeLinecap="round"
      />
      {markers.length > 0 && (
        <>
          <path d={sailed} fill="none" stroke="rgba(15,23,42,0.35)" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" />
          <path d={sailed} fill="none" stroke="#f8fafc" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        </>
      )}

      <g filter={`url(#${softId})`}>
        <ellipse cx="878" cy="236" rx="78" ry="18" fill="#c2410c" opacity="0.25" />
        <ellipse cx="878" cy="228" rx="74" ry="16" fill={`url(#${sandId})`} />
        <path d="M824 214 Q858 176 902 208 Q934 186 952 220 Q918 208 878 216 Q846 222 824 214 Z" fill="#16a34a" />
        <path d="M846 218 Q872 192 904 214 Q880 206 858 216 Z" fill="#4ade80" />
        <path d="M812 228 H846" stroke="#d6d3d1" strokeWidth="4" strokeLinecap="round" />
        <path d="M908 216 C918 192 898 168 916 146" fill="none" stroke="#92400e" strokeWidth="4" strokeLinecap="round" />
        <g fill="none" stroke="#15803d" strokeWidth="2.6" strokeLinecap="round">
          <path d="M916 148 C900 132 882 146 874 134" />
          <path d="M916 148 C932 128 954 138 958 122" />
          <path d="M916 148 C936 150 952 166 944 178" />
          <path d="M916 148 C898 160 884 150 874 164" />
        </g>
        <path d="M846 226 V168" stroke="#78350f" strokeWidth="3" strokeLinecap="round" />
        <rect x="812" y="150" width="70" height="28" rx="6" fill="#fffbeb" stroke="#78350f" strokeWidth="1.6" />
        <text x="847" y="170" textAnchor="middle" fill="#78350f" fontSize="15" fontWeight="700">
          結論
        </text>
      </g>

      <g>
        <circle cx={X0} cy={Y0} r="9" fill="#f8fafc" stroke="#0369a1" strokeWidth="3" />
        <circle cx={X0} cy={Y0} r="3" fill="#0369a1" />
        <text
          x="36"
          y="188"
          fill="#0f172a"
          fontSize="14"
          fontWeight="700"
          stroke="#f8fafc"
          strokeWidth="4"
          paintOrder="stroke"
          strokeLinejoin="round"
        >
          出発
        </text>
      </g>

      {markers.map((m, i) => {
        const x = sx(m);
        const y = sy(m);
        const label = `#${formatGdNote(m.note)} ${m.effect}${m.self ? ' 自分' : ''}`;
        const flagDown = y < 96;
        const selfSlot = markers.slice(0, i + 1).filter((item) => item.self).length - 1;
        const flagLift = m.self ? (selfSlot % 4) * 16 : 0;
        const anchorY = Math.abs(y - Y0) < 40 ? Y0 : y;
        const poleY = flagDown ? anchorY + 30 + flagLift : anchorY - 34 - flagLift;
        const flagOnLeft = i === markers.length - 1 || x > 680 || (m.self && selfSlot % 2 === 1);
        const noteX =
          m.effect === '脱線' ? x - 14 : m.effect === '停滞' ? x + (m.y >= 0 ? 16 : -16) : x;
        const noteY =
          m.effect === '脱線' ? y + 4 : m.effect === '停滞' ? (m.y >= 0 ? y + 16 : y - 12) : y + 18;
        const noteAnchor = m.effect === '前進' ? 'middle' : m.y >= 0 && m.effect === '停滞' ? 'start' : 'end';
        return (
          <g key={`${formatGdNote(m.note)}-${m.effect}-${i}`}>
            <circle
              cx={x}
              cy={y}
              r="7"
              fill={EFFECT_FILL[m.effect] ?? EFFECT_FILL['停滞']}
              stroke="#ffffff"
              strokeWidth="1.6"
            >
              <title>{label}</title>
            </circle>
            {m.self && (
              <g>
                <path
                  d={`M${x} ${flagDown ? y + 8 : y - 8} L${x} ${poleY}`}
                  stroke="#fff1f2"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
                <path
                  d={
                    flagDown
                      ? `M${x} ${poleY} L${x + (flagOnLeft ? -18 : 18)} ${poleY - 6} L${x} ${poleY - 12} Z`
                      : `M${x} ${poleY} L${x + (flagOnLeft ? -18 : 18)} ${poleY + 6} L${x} ${poleY + 12} Z`
                  }
                  fill="#fb7185"
                  stroke="#fff1f2"
                  strokeWidth="0.8"
                />
                {showLabels && (
                  <text
                    x={flagOnLeft ? x - 22 : x + 22}
                    y={poleY + 4}
                    textAnchor={flagOnLeft ? 'end' : 'start'}
                    fill="#fff1f2"
                    fontSize="12"
                    fontWeight="700"
                    stroke="#9f1239"
                    strokeWidth="3.5"
                    paintOrder="stroke"
                    strokeLinejoin="round"
                  >
                    自分
                  </text>
                )}
              </g>
            )}
            {showLabels && (
              <text
                x={noteX}
                y={noteY}
                textAnchor={noteAnchor}
                fill="#f8fafc"
                fontSize="11"
                fontWeight="700"
                stroke="#0f172a"
                strokeWidth="3.5"
                paintOrder="stroke"
                strokeLinejoin="round"
              >
                {`#${formatGdNote(m.note)}`}
              </text>
            )}
          </g>
        );
      })}

      <g transform={`translate(${ship.x} ${ship.y - 16})`} filter={`url(#${softId})`} aria-hidden="true">
        <path d="M-26 8 Q-10 14 2 8 Q14 16 28 6" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.6" />
        <path d="M-18 4 L22 0 L14 12 L-12 12 Z" fill="#f8fafc" stroke="#0f172a" strokeWidth="1.1" />
        <path d="M-4 4 L2 -2 L8 4 Z" fill="#fb7185" />
        <path d="M2 2 L2 -20" stroke="#1e293b" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M3 -18 L3 0 L20 -7 Z" fill="#fff7ed" stroke="#9a3412" strokeWidth="0.9" />
        <path d="M3 -18 L14 -13 L3 -9 Z" fill="#e11d48" />
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
