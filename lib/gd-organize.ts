/**
 * GD live 「論点整理」: tree shape, prompt, and a hardened read of Ollama JSON.
 * Pure module (no Node APIs) so the live panel can apply the same guards.
 * Does not rebuild the user's tree. Comment + light status only.
 */

import { parseLooseJson } from '@/lib/gd-analyze';

export const LOGIC_TREE_STORAGE_KEY = 'minutes.gd.logicTree.v1';

/** Short mark the model may put on a node the user already created. */
export const LOGIC_HINTS = ['薄い', '十分', '脱線', '停滞'] as const;
export type LogicHint = (typeof LOGIC_HINTS)[number];

export type LogicPoint = {
  id: string;
  label: string;
  hint: string;
};

export type LogicGoal = {
  id: string;
  label: string;
  hint: string;
  points: LogicPoint[];
};

export type LogicTreeDoc = {
  goals: LogicGoal[];
  talkingId: string | null;
  comment: string;
};

export type OrganizeResponse = {
  comment: string;
  /** Null means "don't change the user's current mark". */
  talking: string | null;
  statuses: { id: string; note: LogicHint }[];
  missing: string[];
  designNote: string;
  warning?: string;
};

const MAX_GOALS = 16;
const MAX_POINTS = 12;
const MAX_LABEL = 80;
const MAX_COMMENT = 1200;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function emptyLogicTree(): LogicTreeDoc {
  return { goals: [], talkingId: null, comment: '' };
}

export function newLogicId(prefix: 'g' | 'p'): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function clipBlock(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').trim().slice(0, max);
}

export function lightHint(value: unknown): LogicHint | '' {
  if (typeof value !== 'string') return '';
  const s = value.replace(/\s+/g, '').trim();
  if (!s) return '';
  if (s.includes('薄い') || s.includes('不足')) return '薄い';
  if (s.includes('十分')) return '十分';
  if (s.includes('脱線')) return '脱線';
  if (s.includes('停滞')) return '停滞';
  return '';
}

function cleanId(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const s = String(value);
    return ID_RE.test(s) ? s : '';
  }
  if (typeof value !== 'string') return '';
  const s = value.trim();
  return ID_RE.test(s) ? s : '';
}

export function idsOf(doc: LogicTreeDoc): Set<string> {
  const ids = new Set<string>();
  for (const goal of doc.goals) {
    ids.add(goal.id);
    for (const point of goal.points) ids.add(point.id);
  }
  return ids;
}

export function sanitizeLogicTree(input: unknown): LogicTreeDoc {
  const rec = asRecord(input);
  if (!rec) return emptyLogicTree();
  const goalsRaw = Array.isArray(rec.goals) ? rec.goals : [];
  const seen = new Set<string>();
  const goals: LogicGoal[] = [];
  for (const item of goalsRaw) {
    if (goals.length >= MAX_GOALS) break;
    const row = asRecord(item);
    if (!row) continue;
    const id = cleanId(row.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const points: LogicPoint[] = [];
    const pointsRaw = Array.isArray(row.points) ? row.points : [];
    for (const child of pointsRaw) {
      if (points.length >= MAX_POINTS) break;
      const point = asRecord(child);
      if (!point) continue;
      const pid = cleanId(point.id);
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      points.push({
        id: pid,
        label: clip(point.label, MAX_LABEL),
        hint: lightHint(point.hint),
      });
    }
    goals.push({
      id,
      label: clip(row.label, MAX_LABEL),
      hint: lightHint(row.hint),
      points,
    });
  }
  const talking = cleanId(rec.talkingId);
  return {
    goals,
    talkingId: talking && seen.has(talking) ? talking : null,
    comment: clipBlock(rec.comment, MAX_COMMENT),
  };
}

export function parseStoredLogicTree(raw: string | null): LogicTreeDoc {
  if (!raw) return emptyLogicTree();
  try {
    return sanitizeLogicTree(JSON.parse(raw));
  } catch {
    return emptyLogicTree();
  }
}

export function logicTreeHasContent(doc: LogicTreeDoc): boolean {
  return doc.goals.some(
    (goal) => goal.label.trim() || goal.points.some((point) => point.label.trim())
  );
}

/** Recent excerpt only, so a small Ollama context can still see the tail. */
export function tailTranscript(text: string, max = 4000): string {
  const flat = text.replace(/\r\n/g, '\n').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(-max);
  const nl = cut.indexOf('\n');
  return (nl >= 0 && nl < 120 ? cut.slice(nl + 1) : cut).trim();
}

export function buildOrganizePrompt(input: {
  theme: string;
  transcript: string;
  tree: LogicTreeDoc;
}): { system: string; user: string } {
  const tree = sanitizeLogicTree(input.tree);
  const lines: string[] = [];
  if (tree.goals.length === 0) {
    lines.push('（大論点なし）');
  }
  for (const goal of tree.goals) {
    const mark = tree.talkingId === goal.id ? ' いま話してる' : '';
    const hint = goal.hint ? ` [${goal.hint}]` : '';
    lines.push(`- ${goal.id} 大論点「${goal.label || '（無名）'}」${hint}${mark}`);
    for (const point of goal.points) {
      const pmark = tree.talkingId === point.id ? ' いま話してる' : '';
      const phint = point.hint ? ` [${point.hint}]` : '';
      lines.push(`  - ${point.id} 論点「${point.label || '（無名）'}」${phint}${pmark}`);
    }
  }
  const transcript = tailTranscript(input.transcript);
  const prior = clipBlock(tree.comment, 400);
  const system = `あなたはグループディスカッションの論点整理役です。日本語で、JSONだけを返してください。
ユーザーが手で作った木は、追加・削除・改名してはいけません。コメントと、既存idへの短い印だけです。

返すJSONの形:
{"comment":"200字程度の整理","talking":"既存idか空文字","statuses":[{"id":"既存id","note":"薄い"}],"missing":["木に無い短い観点"],"designNote":"組み方への一言。木は書き換えない"}

note は次のどれかだけ: 薄い / 十分 / 脱線 / 停滞
talking と statuses の id は、渡された木に実在するidだけ。分からなければ talking は空、statuses は空配列。
missing は最大4つ。各12字程度。
余計な前置きやMarkdownは出さない。`;

  const user = `お題: ${clip(input.theme, MAX_LABEL) || '（なし）'}

論理の木:
${lines.join('\n')}

これまでのAIコメント:
${prior || '（なし）'}

直近の文字起こし:
${transcript || '（まだありません）'}`;

  return { system, user };
}

function stringList(value: unknown, limit: number, each: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = clip(item, each);
    if (!text || out.includes(text)) continue;
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

export function composeOrganizeComment(parts: {
  comment: string;
  missing: string[];
  designNote: string;
}): string {
  const blocks: string[] = [];
  const comment = parts.comment.trim();
  if (comment) blocks.push(comment.slice(0, 800));
  if (parts.missing.length) {
    blocks.push(['足りないかも:', ...parts.missing.map((item) => `・${item}`)].join('\n'));
  }
  const design = parts.designNote.trim();
  if (design && !comment.includes(design)) blocks.push(`組み方: ${design.slice(0, 160)}`);
  return blocks.join('\n\n').slice(0, MAX_COMMENT);
}

/**
 * Model text → safe organize payload.
 * Unreadable JSON falls back to prose in `comment` and does not touch nodes.
 */
export function coerceOrganize(raw: string, knownIds: ReadonlySet<string>): OrganizeResponse {
  const trimmed = raw.replace(/^\uFEFF/, '').trim();
  const parsed = parseLooseJson(trimmed);
  const obj = asRecord(parsed);
  if (!obj) {
    const prose = clipBlock(trimmed, 800);
    return {
      comment: prose,
      talking: null,
      statuses: [],
      missing: [],
      designNote: '',
      warning: prose
        ? 'JSONとして読めなかったので、本文だけコメントに入れました。木は変えていません。'
        : 'モデルの返答が空でした。木は変えていません。',
    };
  }

  const commentRaw = obj.comment ?? obj.aiComment ?? obj['コメント'] ?? obj.summary;
  const talkingRaw = obj.talking ?? obj.talkingId ?? obj.currentId ?? obj['いま'];
  const statusRaw = obj.statuses ?? obj.status ?? obj.hints ?? obj['印'];
  const missingRaw = obj.missing ?? obj.gaps ?? obj['不足'];
  const designRaw = obj.designNote ?? obj.suggestion ?? obj['提案'];

  const talkingId = cleanId(talkingRaw);
  const talking = talkingId && knownIds.has(talkingId) ? talkingId : null;

  const statuses: { id: string; note: LogicHint }[] = [];
  const seen = new Set<string>();
  if (Array.isArray(statusRaw)) {
    for (const item of statusRaw) {
      const row = asRecord(item);
      if (!row) continue;
      const id = cleanId(row.id ?? row.nodeId);
      const note = lightHint(row.note ?? row.hint ?? row.status ?? row.label);
      if (!id || !note || !knownIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      statuses.push({ id, note });
    }
  } else {
    const map = asRecord(statusRaw);
    if (map) {
      for (const [key, value] of Object.entries(map)) {
        const id = cleanId(key);
        const note = lightHint(value);
        if (!id || !note || !knownIds.has(id) || seen.has(id)) continue;
        seen.add(id);
        statuses.push({ id, note });
      }
    }
  }

  const missing = stringList(missingRaw, 4, 24);
  const designNote = clip(designRaw, 160);
  const comment = composeOrganizeComment({
    comment: clipBlock(commentRaw, 800),
    missing,
    designNote,
  });

  const response: OrganizeResponse = {
    comment,
    talking,
    statuses,
    missing,
    designNote,
  };
  if (!comment) {
    response.warning = 'コメントが空でした。木は変えていません。';
  }
  return response;
}

/** Apply a response onto the tree the user has *now* (they may have edited mid-flight). */
export function applyOrganize(doc: LogicTreeDoc, res: OrganizeResponse): LogicTreeDoc {
  const ids = idsOf(doc);
  const hints = new Map<string, LogicHint>();
  for (const row of res.statuses) {
    if (ids.has(row.id) && row.note) hints.set(row.id, row.note);
  }
  const talking =
    res.talking && ids.has(res.talking) ? res.talking : doc.talkingId;
  return {
    goals: doc.goals.map((goal) => ({
      ...goal,
      hint: hints.get(goal.id) ?? goal.hint,
      points: goal.points.map((point) => ({
        ...point,
        hint: hints.get(point.id) ?? point.hint,
      })),
    })),
    talkingId: talking,
    comment: res.comment.trim() ? res.comment : doc.comment,
  };
}
