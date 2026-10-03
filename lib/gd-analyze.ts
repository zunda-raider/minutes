/**
 * GD end-of-discussion analysis: prompt, hardened JSON parse, voyage + tree layout.
 * Pure module (no Node APIs) so the UI can reuse the same guards.
 */

export type GdEffect = '前進' | '脱線' | '停滞';

export type GdSpeaker = '自分' | '他者';

export type GdUtteranceInput = {
  note: number;
  text: string;
  speaker: GdSpeaker;
};

export type GdTopic = {
  id: string;
  label: string;
  parentId: string | null;
};

export type GdMapping = {
  note: number;
  topicId: string;
  effect: GdEffect;
};

export type GdAnalysis = {
  conclusion: string;
  topics: GdTopic[];
  mappings: GdMapping[];
  /** Set when the model output was partial or unreadable. Never throw for this. */
  warning?: string;
};

export const UNCLASSIFIED_TOPIC_ID = 'unclassified';

export type GdTopicNode = {
  topic: GdTopic;
  children: GdTopicNode[];
};

export type VoyageMarker = {
  note: number;
  effect: GdEffect;
  self: boolean;
  /** 0 = start, 1 = conclusion island. Only 前進 increases this. */
  x: number;
  /** 0 = on the route. 脱線 is far off; 停滞 stays near the route. */
  y: number;
};

const EFFECTS: readonly GdEffect[] = ['前進', '脱線', '停滞'];

export function formatGdNote(note: number): string {
  if (!Number.isFinite(note)) return '?';
  if (Math.abs(note - Math.round(note)) < 1e-6) return String(Math.round(note));
  return note.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function sameGdNote(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6;
}

/** App data decides 自分. Speaker id 1 is 自分 (mic メイン / Zoom A). */
export function gdSpeakerFromId(speakerId: number | undefined | null): GdSpeaker {
  return speakerId === 1 ? '自分' : '他者';
}

export function asGdEffect(value: unknown): GdEffect | null {
  if (typeof value !== 'string') return null;
  const s = value.trim().toLowerCase();
  if (s === '前進' || s === 'forward' || s === 'advance' || s === 'progress') return '前進';
  if (s === '脱線' || s === 'derail' || s === 'off' || s === 'offpath' || s === 'tangent') {
    return '脱線';
  }
  if (s === '停滞' || s === 'stall' || s === 'stay' || s === 'stuck' || s === 'pause') {
    return '停滞';
  }
  const raw = value.trim();
  if ((EFFECTS as readonly string[]).includes(raw)) return raw as GdEffect;
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in obj && obj[key] != null) return obj[key];
  }
  return undefined;
}

export function extractJsonObject(raw: string): string | null {
  const trimmed = raw.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return null;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence ? fence[1] : trimmed).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return body.slice(start, end + 1);
}

export function parseLooseJson(raw: string): unknown | null {
  const extracted = extractJsonObject(raw);
  if (!extracted) return null;
  try {
    return JSON.parse(extracted);
  } catch {
    // trailing commas are a common small-model failure
  }
  try {
    const repaired = extracted.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const cut = flat.search(/[。！？]/);
  const sentence = cut >= 0 ? flat.slice(0, cut + 1) : flat;
  return sentence.slice(0, 280);
}

function readTopics(value: unknown, warnings: string[]): GdTopic[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    warnings.push('論点の一覧を読み取れませんでした。');
    return [];
  }
  const topics: GdTopic[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    if (typeof item === 'string') {
      const label = item.trim().slice(0, 80);
      if (!label) return;
      const id = `t${index + 1}`;
      if (seen.has(id)) return;
      seen.add(id);
      topics.push({ id, label, parentId: null });
      return;
    }
    const rec = asRecord(item);
    if (!rec) return;
    const idRaw = pick(rec, ['id', 'topicId', 'ID']);
    const id =
      typeof idRaw === 'string' || typeof idRaw === 'number'
        ? String(idRaw).trim().slice(0, 40)
        : `t${index + 1}`;
    if (!id || seen.has(id)) return;
    const labelRaw = pick(rec, ['label', 'name', 'title', 'text', '論点']);
    const label =
      typeof labelRaw === 'string' && labelRaw.trim()
        ? labelRaw.trim().slice(0, 80)
        : `論点${index + 1}`;
    const parentRaw = pick(rec, ['parentId', 'parent', '親', 'parent_id']);
    let parentId: string | null = null;
    if (typeof parentRaw === 'string' && parentRaw.trim()) parentId = parentRaw.trim();
    else if (typeof parentRaw === 'number' && Number.isFinite(parentRaw)) {
      parentId = String(parentRaw);
    }
    seen.add(id);
    topics.push({ id, label, parentId });
  });
  return topics;
}

function noteOf(rec: Record<string, unknown>): number | null {
  const raw = pick(rec, ['note', 'n', 'number', 'card', '#', 'id']);
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw.replace(/^#/, '').trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function readMappings(
  value: unknown,
  topics: GdTopic[],
  warnings: string[]
): GdMapping[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    warnings.push('発言と論点の対応を読み取れませんでした。');
    return [];
  }
  const ids = new Set(topics.map((t) => t.id));
  const byLabel = new Map(topics.map((t) => [t.label, t.id]));
  const mappings: GdMapping[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const rec = asRecord(item);
    if (!rec) continue;
    const note = noteOf(rec);
    if (note == null) continue;
    const key = formatGdNote(note);
    if (seen.has(key)) continue;
    const effect = asGdEffect(pick(rec, ['effect', '効果', 'move', 'type'])) ?? '停滞';
    let topicId = '';
    const topicRaw = pick(rec, ['topicId', 'topic', '論点', 'parentId']);
    if (typeof topicRaw === 'string' || typeof topicRaw === 'number') {
      const token = String(topicRaw).trim();
      if (ids.has(token)) topicId = token;
      else if (byLabel.has(token)) topicId = byLabel.get(token) ?? '';
    }
    if (!topicId) topicId = UNCLASSIFIED_TOPIC_ID;
    seen.add(key);
    mappings.push({ note, topicId, effect });
  }
  return mappings;
}

/**
 * Turn model JSON (or garbage) into a safe analysis.
 * `parsedOk` false → empty voyage, warning, no invented 停滞 trail.
 * Missing notes on an otherwise valid result are filled as 停滞 / 未分類.
 */
export function coerceGdAnalysis(
  input: unknown,
  notes: number[],
  parsedOk: boolean
): GdAnalysis {
  const warnings: string[] = [];
  if (!parsedOk || !asRecord(input)) {
    return {
      conclusion: '',
      topics: [],
      mappings: [],
      warning: 'モデルのJSONを解釈できませんでした。画面はそのまま使えます。',
    };
  }
  const obj = asRecord(input) as Record<string, unknown>;
  const conclusionRaw = pick(obj, ['conclusion', '結論', 'summary']);
  let conclusion = '';
  if (typeof conclusionRaw === 'string') conclusion = firstSentence(conclusionRaw);
  else if (conclusionRaw != null) warnings.push('結論を一文として読めませんでした。');

  const topics = readTopics(pick(obj, ['topics', '論点', 'points']), warnings);
  let mappings = readMappings(
    pick(obj, ['utterances', 'mappings', '発言', 'cards']),
    topics,
    warnings
  );

  const known = new Set(notes.map((n) => formatGdNote(n)));
  mappings = mappings.filter((m) => known.has(formatGdNote(m.note)));

  const have = new Set(mappings.map((m) => formatGdNote(m.note)));
  let missing = 0;
  for (const note of notes) {
    if (have.has(formatGdNote(note))) continue;
    missing += 1;
    mappings.push({
      note,
      topicId: UNCLASSIFIED_TOPIC_ID,
      effect: '停滞',
    });
  }
  if (missing > 0) {
    warnings.push(`${missing}件の発言は対応が無いので停滞・未分類にしました。`);
  }

  const usedUnclassified = mappings.some((m) => m.topicId === UNCLASSIFIED_TOPIC_ID);
  const topicIds = new Set(topics.map((t) => t.id));
  for (const m of mappings) {
    if (!topicIds.has(m.topicId)) m.topicId = UNCLASSIFIED_TOPIC_ID;
  }
  if (usedUnclassified || mappings.some((m) => m.topicId === UNCLASSIFIED_TOPIC_ID)) {
    if (!topicIds.has(UNCLASSIFIED_TOPIC_ID)) {
      topics.push({
        id: UNCLASSIFIED_TOPIC_ID,
        label: '未分類',
        parentId: null,
      });
    }
  }

  for (const topic of topics) {
    if (topic.parentId && !topicIds.has(topic.parentId) && topic.parentId !== UNCLASSIFIED_TOPIC_ID) {
      topic.parentId = null;
    }
    if (topic.parentId === topic.id) topic.parentId = null;
  }

  mappings.sort((a, b) => a.note - b.note);

  return {
    conclusion,
    topics,
    mappings,
    warning: warnings.length ? warnings.join(' ') : undefined,
  };
}

export function contentToAnalysis(content: string, notes: number[]): GdAnalysis {
  const parsed = parseLooseJson(content);
  return coerceGdAnalysis(parsed, notes, parsed != null && typeof parsed === 'object');
}

export function topicForest(topics: GdTopic[]): GdTopicNode[] {
  if (!Array.isArray(topics) || topics.length === 0) return [];
  try {
    const parentOf = new Map<string, string | null>();
    const byId = new Map<string, GdTopic>();
    for (const topic of topics) {
      if (!topic || typeof topic.id !== 'string') continue;
      byId.set(topic.id, topic);
    }
    for (const topic of byId.values()) {
      const parent = topic.parentId;
      if (parent && parent !== topic.id && byId.has(parent)) parentOf.set(topic.id, parent);
      else parentOf.set(topic.id, null);
    }
    for (const id of byId.keys()) {
      const seen = new Set<string>();
      let cur: string | null = id;
      while (cur) {
        if (seen.has(cur)) {
          parentOf.set(cur, null);
          break;
        }
        seen.add(cur);
        cur = parentOf.get(cur) ?? null;
      }
    }
    const children = new Map<string, GdTopic[]>();
    const roots: GdTopic[] = [];
    for (const topic of byId.values()) {
      const parent = parentOf.get(topic.id);
      if (!parent) roots.push(topic);
      else {
        const list = children.get(parent) ?? [];
        list.push(topic);
        children.set(parent, list);
      }
    }
    const toNode = (topic: GdTopic, guard: Set<string>): GdTopicNode => {
      if (guard.has(topic.id)) return { topic, children: [] };
      const next = new Set(guard);
      next.add(topic.id);
      return {
        topic,
        children: (children.get(topic.id) ?? []).map((child) => toNode(child, next)),
      };
    };
    return roots.map((topic) => toNode(topic, new Set()));
  } catch {
    return [];
  }
}

/**
 * X moves toward the island only on 前進 (step = 1/N).
 * 脱線 keeps that x but leaves the route. 停滞 stays on the route at the same x.
 */
export function layoutVoyage(
  items: { note: number; effect: GdEffect; self: boolean }[]
): VoyageMarker[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const step = 1 / items.length;
  let progress = 0;
  let stallPile = 0;
  let derailPile = 0;
  const markers: VoyageMarker[] = [];
  for (const item of items) {
    const effect = asGdEffect(item.effect) ?? '停滞';
    let y = 0;
    if (effect === '前進') {
      progress += step;
      stallPile = 0;
      derailPile = 0;
      y = 0;
    } else if (effect === '脱線') {
      derailPile += 1;
      const sign = derailPile % 2 === 0 ? 1 : -1;
      y = sign * 0.78;
    } else {
      stallPile += 1;
      const sign = stallPile % 2 === 0 ? 1 : -1;
      y = sign * Math.min(stallPile, 3) * 0.12;
    }
    markers.push({
      note: item.note,
      effect,
      self: Boolean(item.self),
      x: Math.max(0, Math.min(1, progress)),
      y,
    });
  }
  return markers;
}

export function buildGdSystemPrompt(genre?: string): string {
  const g = genre?.trim();
  const genreLine = g
    ? `\n議論のジャンル/文脈: 「${g}」。この分野の言葉で論点名を付けてください。`
    : '';
  return `あなたはグループディスカッションの分析係です。出力はJSONオブジェクト1つだけです。前置き・Markdown・コードフェンスは禁止。話者は入力を信じ、話者は出力しないでください。${genreLine}

次の3つだけを返してください。
1. conclusion: 議論の結論を日本語でちょうど一文。
2. topics: 論点の配列。要素は {"id":"t1","label":"短い論点名","parentId":null} 。子論点は parentId に親の id を入れる。id は t1, t2, ... の一意な文字列。
3. utterances: 入力されたカード番号を1回ずつすべて含む配列。要素は {"note":1,"topicId":"t1","effect":"前進"} 。effect は "前進" "脱線" "停滞" のいずれか。

effect の意味:
- 前進: 結論に近づく発言
- 脱線: 論点がそれる発言
- 停滞: 議論が前に進まない発言`;
}

export function buildGdUserContent(utterances: GdUtteranceInput[], genre?: string): string {
  const notes = utterances.map((u) => formatGdNote(u.note)).join(', ');
  const lines = utterances.map(
    (u) => `#${formatGdNote(u.note)} ${u.speaker}: ${u.text.replace(/\s+/g, ' ').trim() || '（空）'}`
  );
  const g = genre?.trim();
  return `${g ? `ジャンル/文脈: ${g}\n\n` : ''}カード番号は次だけです: ${notes}

${lines.join('\n')}`;
}
