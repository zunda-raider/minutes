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
