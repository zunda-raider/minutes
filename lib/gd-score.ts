/**
 * End-of-session eval of the user's own speech (自分).
 * One Ollama call. Voyage analysis is not this path.
 */
import { parseLooseJson } from '@/lib/gd-analyze';

export const GD_SCORE_AXES = [
  '論点整理',
  'リーダーシップ',
  '論理性',
  '協調性',
  '付加価値',
] as const;

export type GdScoreAxis = (typeof GD_SCORE_AXES)[number];

export type GdAxisScore = {
  axis: GdScoreAxis;
  /** 1–5, or null when 自分 could not be scored. */
  score: number | null;
  comment: string;
};

export type GdSelfEval = {
  placeholder: boolean;
  warning?: string;
  summary: string;
  axes: GdAxisScore[];
};

export type GdTranscriptLine = {
  atSec: number;
  speaker: string;
  text: string;
};

const AXIS_SET = new Set<string>(GD_SCORE_AXES);

export function formatGdTranscript(lines: GdTranscriptLine[]): string {
  return [...lines]
    .sort((a, b) => a.atSec - b.atSec)
    .map((line) => {
      const sec = Math.max(0, Math.floor(line.atSec));
      const clock = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      const text = line.text.replace(/\s+/g, ' ').trim() || '（空）';
      const speaker = line.speaker === '自分' ? '自分' : '他者';
      return `[${clock}] ${speaker}: ${text}`;
    })
    .join('\n');
}

export function placeholderEval(warning: string): GdSelfEval {
  return {
    placeholder: true,
    warning,
    summary: 'Ollamaの評価を取得できなかったため、仮の表示です。点数は付けていません。',
    axes: GD_SCORE_AXES.map((axis) => ({
      axis,
      score: null,
      comment: '仮表示です。',
    })),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function asScore(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 5) return null;
  return rounded;
}

function axisFrom(value: unknown): GdScoreAxis | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return AXIS_SET.has(name) ? (name as GdScoreAxis) : null;
}

/**
 * Safe eval from model text. Unreadable JSON becomes a placeholder with no invented scores.
 */
export function coerceGdSelfEval(raw: string): GdSelfEval {
  const parsed = parseLooseJson(raw);
  const obj = asRecord(parsed);
  if (!obj) {
    return placeholderEval('モデルのJSONを解釈できませんでした。');
  }
  const summary = clip(obj.summary ?? obj.総評 ?? obj.comment, 400);
  const byAxis = new Map<GdScoreAxis, GdAxisScore>();
  const list = obj.axes ?? obj.scores ?? obj.評価;
  if (Array.isArray(list)) {
    for (const item of list) {
      const rec = asRecord(item);
      if (!rec) continue;
      const axis = axisFrom(rec.axis ?? rec.name ?? rec.軸 ?? rec.id);
      if (!axis || byAxis.has(axis)) continue;
      byAxis.set(axis, {
        axis,
        score: asScore(rec.score ?? rec.点 ?? rec.点数),
        comment: clip(rec.comment ?? rec.理由 ?? rec.reason, 280),
      });
    }
  } else {
    const rec = asRecord(list);
    if (rec) {
      for (const axis of GD_SCORE_AXES) {
        const cell = rec[axis];
        const cellRec = asRecord(cell);
        if (cellRec) {
          byAxis.set(axis, {
            axis,
            score: asScore(cellRec.score ?? cellRec.点),
            comment: clip(cellRec.comment ?? cellRec.理由, 280),
          });
        } else if (cell != null) {
          byAxis.set(axis, { axis, score: asScore(cell), comment: '' });
        }
      }
    }
  }
  const axes = GD_SCORE_AXES.map(
    (axis) => byAxis.get(axis) ?? { axis, score: null, comment: '' }
  );
  const missing = axes.filter((axis) => axis.score == null && !axis.comment).length;
  const warning =
    missing === GD_SCORE_AXES.length
      ? '5軸の点数を読み取れませんでした。'
      : missing > 0
        ? `${missing}軸は点数がありません。`
        : undefined;
  return {
    placeholder: missing === GD_SCORE_AXES.length,
    warning,
    summary: summary || (missing === GD_SCORE_AXES.length ? '評価の本文がありません。' : ''),
    axes,
  };
}

/** Product rubric for 自分 only. Other speakers are context, not the score. */
export function buildGdScorePrompt(input: {
  theme: string;
  transcript: string;
  genre?: string;
}): { system: string; user: string } {
  const theme = input.theme.trim();
  const genre = input.genre?.trim();
  const system = `あなたはグループディスカッションの評価者です。採点するのは話者「自分」の発言だけです。他者は文脈であり、他者の良し悪しは点数に入れません。出力はJSONオブジェクト1つだけ。前置き・Markdown・コードフェンスは禁止。

採点基準（各軸 1〜5 の整数。自分の発言が無い、または評価できない軸は score を null）:
1. 論点整理
- 5: 目的・前提・いま決める問いを分け、論点を構造として言語化している
- 3: 論点には触れるが、前提と論点が混ざる、または一部しか整理していない
- 1: 論点を言語化せず、感想や個別の話だけになっている
2. リーダーシップ
- 5: 進行、時間、次の問い、役割のどれかを示し、場を結論へ動かしている
- 3: 進行への寄与が断片的で、場を動かし切っていない
- 1: 進行に関与しない、または自分の話だけで場を止めている
3. 論理性
- 5: 主張・根拠・結論がつながり、飛躍や条件を自分で扱っている
- 3: 筋は通るが根拠が薄い、または一部に飛躍がある
- 1: 根拠なく断定する、または話がつながらない
4. 協調性
- 5: 他者の意見を受け、確認・統合・発展させ、否定だけで終わらない
- 3: 同意や相槌はあるが、相手の論点を先に進めていない
- 1: 相手を無視する、遮る、または一方的である
5. 付加価値
- 5: 新しい切り口、具体、数字、代替案など、既出にない材料を結論に効く形で足している
- 3: 具体や例はあるが、議論の前進には弱い
- 1: 既出の繰り返しだけで、新しい材料がない

自分の実質的な発言が一つも無いときは、summary でその旨を書き、全軸の score を null、comment は「自分の発言がありません。」にする。

JSONの形:
{"summary":"自分についての総評を日本語で1〜2文","axes":[{"axis":"論点整理","score":3,"comment":"根拠を2文以内"},{"axis":"リーダーシップ","score":3,"comment":""},{"axis":"論理性","score":3,"comment":""},{"axis":"協調性","score":3,"comment":""},{"axis":"付加価値","score":3,"comment":""}]}
axis の文字列は上記5つをちょうど1回ずつ。comment は自分の発言に根拠を置く。`;

  const head = [
    theme ? `お題: ${theme}` : 'お題: （未記入）',
    genre ? `ジャンル/文脈: ${genre}` : '',
    '次の全文を使い、自分の発言だけを5軸で採点してください。',
    '',
    input.transcript.trim() || '（文字起こしなし）',
  ]
    .filter((line) => line !== '')
    .join('\n');

  return { system, user: head };
}

/** localStorage key for previous clear-screen axis scores (NEW RECORD). */
export const GD_PREV_AXES_STORAGE = 'minutes.gd.result.prevAxes.v1';

export type GdRank = 'S' | 'A' | 'B' | 'C';

export const GD_ROLE_BY_AXIS: Record<GdScoreAxis, string> = {
  論点整理: '論点メーカー',
  リーダーシップ: 'ファシリテーター',
  論理性: 'ロジシャン',
  協調性: '調整役',
  付加価値: 'アイデアマン',
};

export type GdClearStats = {
  /** 自分発言数 / 全発言数 (0–1) */
  speakRatio: number;
  /** 他者の直後に返した回数（ざっくり） */
  responseCount: number;
  /** 前半に自分発言が偏っている */
  earlyFocus: boolean;
  /** 後半に自分発言が偏っている */
  lateFocus: boolean;
  durationSec: number;
  participantCount: number;
};

export type GdClearUtterance = {
  id: string;
  atSec: number;
  speaker: '自分' | '他者';
  text: string;
};

export type GdClearView = {
  mock: boolean;
  goal: string;
  rank: GdRank;
  title: string;
  summary: string;
  bestQuote: string;
  axes: GdAxisScore[];
  stats: GdClearStats;
  utterances: GdClearUtterance[];
  warning?: string;
};

export function averageAxisScore(axes: GdAxisScore[]): number {
  const nums = axes.map((a) => a.score).filter((n): n is number => n != null);
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function rankFromAverage(avg: number): GdRank {
  if (avg >= 4.5) return 'S';
  if (avg >= 3.5) return 'A';
  if (avg >= 2.5) return 'B';
  return 'C';
}

/**
 * 称号 = 修飾語＋役割。役割は最高点の軸。修飾は発言統計。
 * 全軸が低い（平均 < 2.5 かつ最高 ≤ 2）ときは「見習い〇〇」。
 */
export function buildClearTitle(axes: GdAxisScore[], stats: GdClearStats): string {
  const scores = axes.map((a) => a.score ?? 0);
  const max = Math.max(0, ...scores);
  const avg = averageAxisScore(axes);
  const best =
    axes.find((a) => (a.score ?? 0) === max)?.axis ?? GD_SCORE_AXES[0];
  const role = GD_ROLE_BY_AXIS[best];

  if (max <= 2 && avg < 2.5) {
    return `見習い${role}`;
  }

  if (stats.speakRatio >= 0.35) return `前線の${role}`;
  if (stats.speakRatio < 0.15 && max >= 4) return `寡黙な${role}`;
  if (stats.responseCount >= 5) return `打てば響く${role}`;
  if (stats.earlyFocus) return `切り込み隊長の${role}`;
  if (stats.lateFocus) return `最後に締める${role}`;
  return `前線の${role}`;
}

export function parseTranscriptLines(transcript: string): GdClearUtterance[] {
  const out: GdClearUtterance[] = [];
  const lines = transcript.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const m = raw.match(/^\[(\d+):(\d+)\]\s*(自分|他者):\s*(.*)$/);
    if (!m) continue;
    const atSec = Number(m[1]) * 60 + Number(m[2]);
    out.push({
      id: `u-${i}-${atSec}`,
      atSec,
      speaker: m[3] as '自分' | '他者',
      text: m[4].trim() || '（空）',
    });
  }
  return out;
}

export function deriveClearStats(
  utterances: GdClearUtterance[],
  fallbackDurationSec = 12 * 60,
  participantCount = 5
): GdClearStats {
  const total = utterances.length;
  const self = utterances.filter((u) => u.speaker === '自分');
  const speakRatio = total > 0 ? self.length / total : 0;
  let responseCount = 0;
  for (let i = 1; i < utterances.length; i++) {
    if (utterances[i].speaker === '自分' && utterances[i - 1].speaker === '他者') {
      responseCount += 1;
    }
  }
  const durationSec = Math.max(
    fallbackDurationSec,
    utterances.reduce((m, u) => Math.max(m, u.atSec), 0) + 30
  );
  const mid = durationSec / 2;
  const early = self.filter((u) => u.atSec < mid).length;
  const late = self.length - early;
  return {
    speakRatio,
    responseCount,
    earlyFocus: self.length > 0 && early >= late + 2,
    lateFocus: self.length > 0 && late >= early + 2,
    durationSec,
    participantCount,
  };
}

export function pickBestQuote(
  evalResult: GdSelfEval,
  utterances: GdClearUtterance[],
  fallback: string
): string {
  const fromSummary = evalResult.summary?.trim();
  const selfLines = utterances.filter((u) => u.speaker === '自分');
  const longest = [...selfLines].sort((a, b) => b.text.length - a.text.length)[0];
  if (longest && longest.text.length >= 12) return longest.text;
  if (fromSummary) return fromSummary;
  return fallback;
}

/** Hardcoded Japanese mock for the rhythm-game clear screen preview. */
export function mockClearView(): GdClearView {
  const axes: GdAxisScore[] = [
    {
      axis: '論点整理',
      score: 4,
      comment: '前提と「いま決める問い」を早めに分け、議論の地図を示せていた。',
    },
    {
      axis: 'リーダーシップ',
      score: 5,
      comment: '時間配分と次の問いで場を前進させ、結論へ寄せる動きが目立った。',
    },
    {
      axis: '論理性',
      score: 4,
      comment: '主張と根拠のつながりは安定。条件の明示がもう一歩あるとさらに強い。',
    },
    {
      axis: '協調性',
      score: 3,
      comment: '相手の論点を受け止める場面はあるが、統合まで踏み込む余地がある。',
    },
    {
      axis: '付加価値',
      score: 4,
      comment: '具体例と代替案で議論に新しい材料を足せていた。',
    },
  ];
  const utterances: GdClearUtterance[] = [
    { id: 'm1', atSec: 12, speaker: '他者', text: 'まず前提から揃えませんか。' },
    {
      id: 'm2',
      atSec: 28,
      speaker: '自分',
      text: '論点は「生産性の定義」と「測り方」を分けた方がいいと思います。',
    },
    { id: 'm3', atSec: 55, speaker: '他者', text: '在宅だと集中できる人もいますよね。' },
    {
      id: 'm4',
      atSec: 78,
      speaker: '自分',
      text: 'その意見、前提にすると「誰にとって」が抜けそうなので、対象を決めませんか。',
    },
    { id: 'm5', atSec: 120, speaker: '他者', text: '通勤時間が消えるのは大きい。' },
    {
      id: 'm6',
      atSec: 145,
      speaker: '自分',
      text: '数字で言うと、週あたり往復2時間が浮く想定で議論しましょう。',
    },
    { id: 'm7', atSec: 210, speaker: '他者', text: 'でもコミュニケーションの遅れも心配です。' },
    {
      id: 'm8',
      atSec: 240,
      speaker: '自分',
      text: 'じゃあ「非同期で足りる作業」と「同期が必要な作業」を先に切り分けませんか。',
    },
    { id: 'm9', atSec: 310, speaker: '他者', text: '結論はハイブリッドが無難では。' },
    {
      id: 'm10',
      atSec: 340,
      speaker: '自分',
      text: '最後に、評価指標をアウトプット量と満足度の二軸にして締めましょう。',
    },
  ];
  const stats = deriveClearStats(utterances, 12 * 60, 5);
  const rank = rankFromAverage(averageAxisScore(axes));
  return {
    mock: true,
    goal: 'リモートワークは生産性を上げるか？',
    rank,
    title: buildClearTitle(axes, stats),
    summary: '場を動かす問いと具体が効き、議論を前進させられていた。',
    bestQuote: 'じゃあ「非同期で足りる作業」と「同期が必要な作業」を先に切り分けませんか。',
    axes,
    stats,
    utterances,
  };
}

export function loadPrevAxisScores(): Partial<Record<GdScoreAxis, number>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(GD_PREV_AXES_STORAGE);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<GdScoreAxis, number>> = {};
    for (const axis of GD_SCORE_AXES) {
      const n = parsed[axis];
      if (typeof n === 'number' && n >= 1 && n <= 5) out[axis] = n;
    }
    return out;
  } catch {
    return {};
  }
}

export function savePrevAxisScores(axes: GdAxisScore[]): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: Record<string, number> = {};
    for (const axis of axes) {
      if (axis.score != null) payload[axis.axis] = axis.score;
    }
    window.localStorage.setItem(GD_PREV_AXES_STORAGE, JSON.stringify(payload));
  } catch {
    /* private mode */
  }
}

export function formatDurationJa(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
