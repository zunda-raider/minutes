'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './page.module.css';
import gd from './gd.module.css';
import { GdLive, type GdLiveEnd } from './gd-live';
import { GdResult } from './gd-result';
import { StopShareButton } from './stop-share';
import { formatGdNote, gdSpeakerFromId } from '@/lib/gd-analyze';
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


export function GdScreen({ entries, genre, historyReady, onBack }: Props) {
  const ordered = useMemo(
    () => [...entries].sort((a, b) => a.note - b.note),
    [entries]
  );
  const [picked, setPicked] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');
  const [deck, setDeck] = useState<'live' | 'harbor' | 'voyage' | 'score'>('live');
  const [scoreSession, setScoreSession] = useState<GdLiveEnd | null>(null);
  const [shownScore, setShownScore] = useState<GdLiveEnd | null>(null);
  const scoreRef = useRef<GdLiveEnd | null>(null);

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


  if (deck === 'score' && shownScore) {
    const isMock = shownScore.transcript === '' || shownScore.lineCount === 0;
    return (
      <GdResult
        goal={shownScore.goal}
        transcript={shownScore.transcript}
        genre={genre}
        selfCount={shownScore.selfCount}
        lineCount={shownScore.lineCount}
        forceMock={isMock}
        onBack={onBack}
        onLive={() => setDeck('live')}
      />
    );
  }

  if (deck === 'voyage') {
    return (
      <div className={`${styles.app} ${gd.scoreStage}`}>
        <header className={gd.scoreHud}>
          <button type="button" className={gd.scoreHome} onClick={onBack}>
            <span className={gd.scoreChevron} aria-hidden="true" />
            Home
          </button>
          <div>
            <p className={gd.scoreKicker}>GDモード</p>
            <h1 className={gd.scoreTitle}>航海</h1>
          </div>
          <StopShareButton />
          <button type="button" className={gd.scoreLive} onClick={() => setDeck('live')}>
            ライブ
          </button>
        </header>
        <div className={gd.scoreBody}>
          <section className={gd.scoreRoot} aria-label="航海">
            <p className={gd.scoreRole}>案内</p>
            <p className={gd.scoreSummary}>航海の図はいま出していません。</p>
            <p className={gd.scoreMuted}>ライブのボードに戻れます。</p>
          </section>
        </div>
      </div>
    );
  }

  if (deck === 'live') {
    return (
      <GdLive
        onBack={onBack}
        onHarbor={() => setDeck('harbor')}
        onVoyage={() => setDeck('voyage')}
        resultReady={scoreSession != null}
        onResult={() => {
          const session = scoreRef.current ?? {
            goal: 'リモートワークは生産性を上げるか？',
            transcript: '',
            selfCount: 0,
            lineCount: 0,
          };
          setShownScore(session);
          setDeck('score');
        }}
        onSessionStart={() => {
          scoreRef.current = null;
          setScoreSession(null);
        }}
        onSessionEnd={(session) => {
          scoreRef.current = session;
          setScoreSession(session);
        }}
      />
    );
  }

  return (
    <div className={`${styles.app} ${styles.appGd} ${gd.lobbyShell}`}>
      <header className={gd.lobbyBar}>
        <button type="button" className={gd.home} onClick={onBack}>
          <span className={gd.chevron} aria-hidden="true" />
          Home
        </button>
        <div className={gd.lobbyHeading}>
          <p className={gd.lobbyKicker}>GDモード</p>
          <StopShareButton />
          <h1 className={gd.lobbyTitle}>出航準備</h1>
          <p className={gd.lobbyLead}>
            過去の文字起こしを眺められます。5軸の評価は、ライブを終了したときだけです。
          </p>
        </div>
        <button type="button" className={gd.liveJump} onClick={() => setDeck('live')}>
          ライブ
        </button>
      </header>

      <section className={gd.lobby} aria-label="出航ロビー">
        <p className={gd.stub} role="status">
          航海の図と、保存カードからの一括分析は止めています。自分の5軸評価はライブの終了時だけです。
        </p>
        <p className={gd.lobbyCaption}>
          {historyReady
            ? selectedCount > 0
              ? `選んだカードは ${selectedCount} 枚です。5軸の評価はここでは走りません。`
              : 'カードを選ぶと内容を眺められます。評価はライブの終了時です。'
            : '記録を探しています…'}
        </p>
        <p className={gd.lobbyNote}>
          ライブを終了したあと、リザルトから自分の5軸評価へ進みます。この画面では評価しません。
        </p>

        {historyReady && ordered.length === 0 ? (
          <div className={gd.emptyHarbor}>
            <h2>港はまだ静かです</h2>
            <p>Homeで録音すると、ここに記録が並びます。</p>
            <button type="button" className={gd.sailButton} onClick={onBack}>
              <span className={gd.sailKicker}>戻る</span>
              <span>Homeへ</span>
            </button>
          </div>
        ) : (
          <>
            <div className={gd.lobbyBlock}>
              <div className={gd.lobbyBlockHead}>
                <h2>過去の記録</h2>
                <p>30分以上あいた記録は、別のまとまりとして並びます。</p>
              </div>
              <div className={gd.sessionRow} role="radiogroup" aria-label="過去の記録を選ぶ">
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
                <h2>カード</h2>
                <p>
                  {activeSession
                    ? `${formatWhen(activeSession.start)} の記録から、見るカードを選びます。`
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
                {allOn ? '選択をすべて外す' : 'この記録をすべて選ぶ'}
              </button>
            </div>

            {error && (
              <p className={gd.error} role="alert">
                {error}
              </p>
            )}

            <p className={gd.lobbyNote}>
              {selectedCount > 0
                ? `選択中 ${selectedCount} 枚。5軸の評価はライブの終了時だけです。`
                : '5軸の評価はライブの終了時だけです。'}
            </p>
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
