'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import styles from './page.module.css';
import gd from './gd.module.css';
import { GdLive } from './gd-live';
import { haltLiveCapture, useLiveCaptureOn } from '@/lib/live-capture';
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

function GdKicker() {
  const shareOn = useLiveCaptureOn();
  if (shareOn) {
    return (
      <button
        type="button"
        className="haltShare"
        aria-label="録音と画面共有を停止"
        onClick={() => haltLiveCapture()}
      >
        停止
      </button>
    );
  }
  return <p className={gd.lobbyKicker}>GDモード</p>;
}

function entryText(entry: GdHistoryEntry): string {
  const ja = entry.textJa?.trim();
  if (ja) return ja;
  return entry.text.trim();
}


const SESSION_GAP_MS = 30 * 60 * 1000;

type VoyageSession = {
  id: string;
  entries: GdHistoryEntry[];
  start: number;
  end: number;
};

function groupSessions(ordered: GdHistoryEntry[]): VoyageSession[] {
  const timed = [...ordered].sort((a, b) => {
    const ta = Date.parse(a.at);
    const tb = Date.parse(b.at);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return a.note - b.note;
  });
  const sessions: VoyageSession[] = [];
  for (const entry of timed) {
    const t = Date.parse(entry.at);
    const stamp = Number.isFinite(t) ? t : 0;
    const last = sessions[sessions.length - 1];
    if (!last || (stamp > 0 && last.end > 0 && stamp - last.end > SESSION_GAP_MS)) {
      sessions.push({ id: entry.id, entries: [entry], start: stamp, end: stamp });
    } else {
      last.entries.push(entry);
      if (stamp > last.end) last.end = stamp;
      if (last.start === 0 && stamp > 0) last.start = stamp;
    }
  }
  for (const session of sessions) {
    session.entries.sort((a, b) => a.note - b.note);
  }
  return sessions.reverse();
}

function formatWhen(ms: number): string {
  if (!ms) return '時刻不明';
  return new Date(ms).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ticket(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= 36) return flat || '（空）';
  return `${flat.slice(0, 36)}…`;
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

function DockedVoyage({ crates }: { crates: number }) {
  const rawId = useId().replace(/:/g, '');
  const skyId = `${rawId}-lobby-sky`;
  const seaId = `${rawId}-lobby-sea`;
  const woodId = `${rawId}-lobby-wood`;
  const shown = Math.min(Math.max(crates, 0), 4);

  return (
    <svg
      className={`${gd.sea} ${gd.lobbySea}`}
      viewBox="0 0 960 280"
      role="img"
      aria-label="港に停泊した船。点線の航路の先に、まだ霧の中の島があります。"
    >
      <defs>
        <linearGradient id={skyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a102c" />
          <stop offset="0.55" stopColor="#101a24" />
          <stop offset="1" stopColor="#0a1218" />
        </linearGradient>
        <linearGradient id={seaId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#143044" />
          <stop offset="0.45" stopColor="#0c1a28" />
          <stop offset="1" stopColor="#070d12" />
        </linearGradient>
        <linearGradient id={woodId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c9a06a" />
          <stop offset="1" stopColor="#7a4e1e" />
        </linearGradient>
      </defs>
      <rect width="960" height="280" fill={`url(#${skyId})`} />
      <circle cx="820" cy="48" r="26" fill="#f6d48a" opacity="0.22" />
      <circle cx="820" cy="48" r="16" fill="#f6d48a" opacity="0.85" />
      <g fill="#f8f1e3" opacity="0.18">
        <ellipse cx="180" cy="42" rx="26" ry="11" />
        <ellipse cx="204" cy="38" rx="18" ry="12" />
        <ellipse cx="160" cy="40" rx="14" ry="9" />
        <ellipse cx="520" cy="30" rx="30" ry="12" />
        <ellipse cx="548" cy="26" rx="18" ry="12" />
      </g>
      <rect y="118" width="960" height="162" fill={`url(#${seaId})`} />
      <g className={gd.waveDrift} fill="none">
        <path
          d="M-320 150 Q-240 136 -160 150 T0 150 T160 150 T320 150 T480 150 T640 150 T800 150 T960 150 T1120 150 T1280 150"
          stroke="rgba(246,212,138,0.28)"
          strokeWidth="2"
        />
        <path
          className={gd.waveFill}
          d="M-320 210 Q-240 196 -160 210 T0 210 T160 210 T320 210 T480 210 T640 210 T800 210 T960 210 T1120 210 T1280 210 V280 H-320 Z"
        />
      </g>
      <path
        d="M250 168 C 390 168, 520 150, 760 156"
        fill="none"
        stroke="rgba(246,212,138,0.7)"
        strokeDasharray="8 9"
        strokeLinecap="round"
        strokeWidth="2.4"
      />
      <g opacity="0.72">
        <ellipse cx="860" cy="176" rx="52" ry="10" fill="#f6d48a" opacity="0.35" />
        <path d="M826 166 Q852 142 888 162 Q908 148 920 168 Q892 160 860 166 Q838 172 826 166 Z" fill="#14532d" />
        <rect x="838" y="148" width="36" height="16" rx="4" fill="#1a1208" stroke="#f6d48a" strokeWidth="1" />
        <text x="856" y="160" textAnchor="middle" fill="#f6d48a" fontSize="9" fontWeight="700">
          島
        </text>
      </g>
      <g>
        <rect x="28" y="150" width="168" height="16" rx="3" fill={`url(#${woodId})`} />
        <rect x="40" y="166" width="10" height="46" rx="2" fill="#78350f" />
        <rect x="168" y="166" width="10" height="46" rx="2" fill="#78350f" />
        <path d="M186 158 C 210 150, 214 142, 228 146" fill="none" stroke="#f6d48a" strokeWidth="1.6" opacity="0.7" />
      </g>
      {Array.from({ length: shown }, (_, i) => (
        <g key={i} transform={`translate(${46 + i * 28} 128)`}>
          <rect width="22" height="18" rx="3" fill="#f6d48a" stroke="#a16207" strokeWidth="1.2" />
          <path d="M0 6 H22" stroke="#a16207" strokeWidth="1" />
        </g>
      ))}
      <g className={gd.shipBob}>
        <path d="M214 156 Q250 168 292 154" fill="none" stroke="rgba(246,212,138,0.45)" strokeWidth="1.5" />
        <path d="M230 150 L292 144 L278 164 L222 164 Z" fill="#f8f1e3" stroke="#1a1208" strokeWidth="1.2" />
        <path d="M248 150 L256 142 L266 150 Z" fill="#fb7185" />
        <path d="M258 148 L258 112" stroke="#f8f1e3" strokeWidth="2" strokeLinecap="round" />
        <path d="M259 116 L259 146 L286 132 Z" fill="#fff8ea" stroke="#a16207" strokeWidth="0.9" />
        <path d="M259 116 L276 124 L259 132 Z" fill="#e11d48" />
      </g>
      <text
        x="78"
        y="108"
        fill="#f6d48a"
        fontSize="14"
        fontWeight="700"
        stroke="#0a1018"
        strokeWidth="4"
        paintOrder="stroke"
        strokeLinejoin="round"
      >
        停泊中
      </text>
    </svg>
  );
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
          <stop offset="0" stopColor="#1a102c" />
          <stop offset="0.55" stopColor="#101a24" />
          <stop offset="1" stopColor="#0a1218" />
        </linearGradient>
        <linearGradient id={seaId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#143044" />
          <stop offset="0.35" stopColor="#0f2434" />
          <stop offset="0.72" stopColor="#0a1520" />
          <stop offset="1" stopColor="#070d12" />
        </linearGradient>
        <linearGradient id={sandId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6d48a" />
          <stop offset="1" stopColor="#c9a06a" />
        </linearGradient>
        <filter id={softId} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1.2" stdDeviation="1.4" floodColor="#070d12" floodOpacity="0.45" />
        </filter>
      </defs>

      <rect width="960" height="360" fill={`url(#${skyId})`} />
      <circle cx="118" cy="52" r="34" fill="#f6d48a" opacity="0.2" />
      <circle cx="118" cy="52" r="20" fill="#f6d48a" opacity="0.85" />
      <g fill="#f8f1e3" opacity="0.16">
        <ellipse cx="250" cy="48" rx="28" ry="12" />
        <ellipse cx="274" cy="44" rx="20" ry="14" />
        <ellipse cx="228" cy="46" rx="16" ry="10" />
        <ellipse cx="620" cy="36" rx="34" ry="13" />
        <ellipse cx="650" cy="32" rx="22" ry="14" />
        <ellipse cx="592" cy="34" rx="18" ry="11" />
      </g>
      <g fill="none" stroke="#f6d48a" strokeWidth="1.4" strokeLinecap="round" opacity="0.35">
        <path d="M400 58 l8 6 l8 -6" />
        <path d="M438 44 l7 5 l7 -5" />
      </g>

      <rect y="128" width="960" height="232" fill={`url(#${seaId})`} />
      <g className={gd.waveDrift} fill="none">
        <path
          d="M-320 168 Q-240 150 -160 168 T0 168 T160 168 T320 168 T480 168 T640 168 T800 168 T960 168 T1120 168 T1280 168"
          stroke="rgba(246,212,138,0.28)"
          strokeWidth="2"
        />
        <path
          className={gd.waveFill}
          d="M-320 250 Q-240 232 -160 250 T0 250 T160 250 T320 250 T480 250 T640 250 T800 250 T960 250 T1120 250 T1280 250 V360 H-320 Z"
        />
        <path
          d="M-320 286 Q-240 270 -160 286 T0 286 T160 286 T320 286 T480 286 T640 286 T800 286 T960 286 T1120 286 T1280 286"
          stroke="rgba(125,211,252,0.28)"
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
        stroke="rgba(246,212,138,0.7)"
        strokeDasharray="7 8"
        strokeLinecap="round"
      />
      {markers.length > 0 && (
        <>
          <path d={sailed} fill="none" stroke="rgba(7,13,18,0.55)" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" />
          <path d={sailed} fill="none" stroke="#f8f1e3" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        </>
      )}

      <g filter={`url(#${softId})`}>
        <ellipse cx="878" cy="236" rx="78" ry="18" fill="#f6d48a" opacity="0.18" />
        <ellipse cx="878" cy="228" rx="74" ry="16" fill={`url(#${sandId})`} />
        <path d="M824 214 Q858 176 902 208 Q934 186 952 220 Q918 208 878 216 Q846 222 824 214 Z" fill="#14532d" />
        <path d="M846 218 Q872 192 904 214 Q880 206 858 216 Z" fill="#166534" />
        <path d="M812 228 H846" stroke="#f8f1e3" strokeWidth="4" strokeLinecap="round" opacity="0.55" />
        <path d="M908 216 C918 192 898 168 916 146" fill="none" stroke="#a16207" strokeWidth="4" strokeLinecap="round" />
        <g fill="none" stroke="#5eead4" strokeWidth="2.6" strokeLinecap="round" opacity="0.75">
          <path d="M916 148 C900 132 882 146 874 134" />
          <path d="M916 148 C932 128 954 138 958 122" />
          <path d="M916 148 C936 150 952 166 944 178" />
          <path d="M916 148 C898 160 884 150 874 164" />
        </g>
        <path d="M846 226 V168" stroke="#f6d48a" strokeWidth="3" strokeLinecap="round" />
        <rect x="812" y="150" width="70" height="28" rx="6" fill="#1a1208" stroke="#f6d48a" strokeWidth="1.6" />
        <text x="847" y="170" textAnchor="middle" fill="#f6d48a" fontSize="15" fontWeight="700">
          結論
        </text>
      </g>

      <g>
        <circle cx={X0} cy={Y0} r="9" fill="#f8f1e3" stroke="#f6d48a" strokeWidth="3" />
        <circle cx={X0} cy={Y0} r="3" fill="#f6d48a" />
        <text
          x="36"
          y="188"
          fill="#f6d48a"
          fontSize="14"
          fontWeight="700"
          stroke="#0a1018"
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
                fill="#f8f1e3"
                fontSize="11"
                fontWeight="700"
                stroke="#0a1018"
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
        <path d="M-26 8 Q-10 14 2 8 Q14 16 28 6" fill="none" stroke="rgba(246,212,138,0.45)" strokeWidth="1.6" />
        <path d="M-18 4 L22 0 L14 12 L-12 12 Z" fill="#f8f1e3" stroke="#1a1208" strokeWidth="1.1" />
        <path d="M-4 4 L2 -2 L8 4 Z" fill="#fb7185" />
        <path d="M2 2 L2 -20" stroke="#f8f1e3" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M3 -18 L3 0 L20 -7 Z" fill="#fff8ea" stroke="#a16207" strokeWidth="0.9" />
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
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<GdAnalysis | null>(null);
  const [snapshot, setSnapshot] = useState<GdHistoryEntry[]>([]);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [deck, setDeck] = useState<'live' | 'harbor'>('live');

  const sessions = useMemo(() => groupSessions(ordered), [ordered]);
  const activeSession =
    sessions.find((session) => session.id === sessionId) ?? sessions[0] ?? null;
  const sessionEntries = activeSession?.entries ?? [];

  useEffect(() => {
    if (picked) return;
    const newest = sessions[0];
    setSessionId(newest?.id ?? null);
    setSelected(new Set(newest ? newest.entries.map((entry) => entry.id) : []));
  }, [sessions, picked]);

  const selectedCount = sessionEntries.filter((entry) => selected.has(entry.id)).length;
  const allOn = sessionEntries.length > 0 && selectedCount === sessionEntries.length;

  function chooseSession(session: VoyageSession) {
    setPicked(true);
    setSessionId(session.id);
    setSelected(new Set(session.entries.map((entry) => entry.id)));
    setError('');
  }

  function toggleCargo(id: string) {
    setPicked(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

  if (result) {
    return (
      <div className={`${styles.app} ${styles.appGd} ${gd.resultShell}`}>
        <header className={gd.lobbyBar}>
          <button type="button" className={gd.home} onClick={onBack}>
            <span className={gd.chevron} aria-hidden="true" />
            Home
          </button>
          <div className={gd.lobbyHeading}>
            <GdKicker />
            <h1 className={gd.lobbyTitle}>分析結果</h1>
            <p className={gd.lobbyLead}>航海図と論点の木。ライブ盤と同じ海の色で、静かに読みます。</p>
          </div>
        </header>
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
      </div>
    );
  }

  if (deck === 'live') {
    return <GdLive onBack={onBack} onHarbor={() => setDeck('harbor')} />;
  }

  return (
    <div className={`${styles.app} ${styles.appGd} ${gd.lobbyShell}`}>
      <header className={gd.lobbyBar}>
        <button type="button" className={gd.home} onClick={onBack}>
          <span className={gd.chevron} aria-hidden="true" />
          Home
        </button>
        <div className={gd.lobbyHeading}>
          <GdKicker />
          <h1 className={gd.lobbyTitle}>出航準備</h1>
          <p className={gd.lobbyLead}>
            港で航海ログを選び、積み荷カードを積んでから出航します。分析と航海図・木は、出航のあとです。
          </p>
        </div>
        <button type="button" className={gd.liveJump} onClick={() => setDeck('live')}>
          ライブ
        </button>
      </header>

      <section className={gd.lobby} aria-label="出航ロビー">
        <DockedVoyage crates={selectedCount} />
        <p className={gd.lobbyCaption}>
          {historyReady
            ? selectedCount > 0
              ? `船はまだ桟橋です。積み荷 ${selectedCount} 枚。点線の先が、これからの島です。`
              : '船は桟橋にいます。積み荷を選ぶと出航できます。'
            : '航海ログを探しています…'}
        </p>
        <p className={gd.lobbyNote}>
          ライブの議論は別画面です。終了から自動でこの港へ進む動線は、まだ繋いでいません。
        </p>

        {historyReady && ordered.length === 0 ? (
          <div className={gd.emptyHarbor}>
            <h2>港はまだ静かです</h2>
            <p>Homeで録音すると、ここに航海ログが着岸します。</p>
            <button type="button" className={gd.sailButton} onClick={onBack}>
              <span className={gd.sailKicker}>戻る</span>
              <span>Homeへ</span>
            </button>
          </div>
        ) : (
          <>
            <div className={gd.lobbyBlock}>
              <div className={gd.lobbyBlockHead}>
                <h2>過去の航海</h2>
                <p>30分以上あいた記録は、別の航海として並びます。文字起こしの一覧ではありません。</p>
              </div>
              <div className={gd.sessionRow} role="radiogroup" aria-label="過去の航海を選ぶ">
                {sessions.map((session) => {
                  const active = activeSession?.id === session.id;
                  return (
                    <button
                      key={session.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={active ? `${gd.sessionChip} ${gd.sessionChipOn}` : gd.sessionChip}
                      onClick={() => chooseSession(session)}
                    >
                      <span className={gd.sessionWhen}>{formatWhen(session.start)}</span>
                      <span className={gd.sessionCount}>{session.entries.length}枚</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={gd.lobbyBlock}>
              <div className={gd.lobbyBlockHead}>
                <h2>積み荷カード</h2>
                <p>
                  {activeSession
                    ? `${formatWhen(activeSession.start)} の航海から、船に積むカードを選びます。`
                    : 'カードを選んでください。'}
                </p>
              </div>
              <div className={gd.cargoGrid}>
                {sessionEntries.map((entry) => {
                  const on = selected.has(entry.id);
                  const role = gdSpeakerFromId(entry.speakerId);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={on ? `${gd.cargo} ${gd.cargoOn}` : gd.cargo}
                      aria-pressed={on}
                      onClick={() => toggleCargo(entry.id)}
                    >
                      <span className={gd.cargoTop}>
                        <span className={gd.cargoNote}>#{formatGdNote(entry.note)}</span>
                        <span className={role === '自分' ? gd.selfTag : gd.otherTag}>
                          {speakerCaption(entry)}
                        </span>
                      </span>
                      <span className={gd.cargoExcerpt}>{ticket(entryText(entry))}</span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className={gd.ghost}
                onClick={() => {
                  setPicked(true);
                  setSelected(
                    allOn ? new Set() : new Set(sessionEntries.map((entry) => entry.id))
                  );
                }}
                disabled={!historyReady || sessionEntries.length === 0}
              >
                {allOn ? '積み荷をすべて降ろす' : 'この航海をすべて積む'}
              </button>
            </div>

            {error && (
              <p className={gd.error} role="alert">
                {error}
              </p>
            )}

            <div className={gd.sailDock}>
              <p className={gd.sailStatus}>
                {selectedCount > 0
                  ? `${selectedCount}枚を船に積みました`
                  : '積み荷が空です'}
              </p>
              <button
                type="button"
                className={gd.sailButton}
                disabled={busy || !historyReady || selectedCount === 0}
                onClick={() => void runAnalysis()}
              >
                <span className={gd.sailKicker}>{busy ? '航路を描いています' : '分析する'}</span>
                <span>{busy ? '出航中…' : '出航'}</span>
              </button>
            </div>
          </>
        )}
        {historyReady && ordered.length === 0 && error && (
          <p className={gd.error} role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
