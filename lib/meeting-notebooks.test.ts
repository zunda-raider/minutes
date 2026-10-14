import assert from 'node:assert/strict';
import {
  appendCardsToMeeting,
  applyAutoFilePlan,
  moveCardToMeeting,
  planAutoFile,
  closestMeetingFor,
  removeCardFromMeetings,
  createMeeting,
  formatMeetingDateLabel,
  meetingDisplayName,
  migrateBlocksToMeetings,
  sortMeetings,
  todayTokyo,
  type MeetingNotebook,
} from './meeting-notebooks';
import type { MinutesBlock } from './minutes-blocks';
import type { StoredTranscriptEntry } from './history-storage';

const card = (
  id: string,
  note: number,
  text = 'hi'
): StoredTranscriptEntry => ({
  id,
  note,
  text,
  lang: 'ja',
  at: '2026-10-03T01:00:00.000Z',
});

{
  const d = new Date('2026-10-03T15:30:00+09:00');
  assert.equal(todayTokyo(d), '2026-10-03');
}

assert.equal(formatMeetingDateLabel('2026-10-03'), '10月3日');
assert.equal(formatMeetingDateLabel('2026-01-15'), '1月15日');

assert.equal(
  meetingDisplayName({ date: '2026-10-03', title: '人材ミーティング' }),
  '10月3日 人材ミーティング'
);
assert.equal(meetingDisplayName({ date: '2026-10-05', title: '  ' }), '10月5日');

{
  const base = createMeeting('人材ミーティング', '2026-10-03');
  const once = appendCardsToMeeting(base, [card('a', 1), card('b', 2)]);
  assert.equal(once.entries.length, 2);
  const twice = appendCardsToMeeting(once, [card('b', 2), card('c', 3)]);
  assert.deepEqual(
    twice.entries.map((e) => e.id),
    ['a', 'b', 'c']
  );
}

{
  const list: MeetingNotebook[] = [
    { ...createMeeting('A', '2026-10-03'), createdAt: '2026-10-03T01:00:00.000Z' },
    { ...createMeeting('B', '2026-10-05'), createdAt: '2026-10-05T02:00:00.000Z' },
    { ...createMeeting('C', '2026-10-05'), createdAt: '2026-10-05T09:00:00.000Z' },
  ];
  const sorted = sortMeetings(list);
  assert.deepEqual(
    sorted.map((m) => m.title),
    ['C', 'B', 'A']
  );
}

{
  const blocks: MinutesBlock[] = [
    {
      id: 'blk-1',
      index: 1,
      startNote: 0,
      endNote: 2,
      createdAt: '2026-10-03T02:00:00.000Z',
      title: '人材ミーティング',
    },
    {
      id: 'blk-2',
      index: 2,
      startNote: 2,
      endNote: 4,
      createdAt: '2026-10-05T04:00:00.000Z',
    },
  ];
  const home = [card('a', 1), card('b', 1.5), card('c', 2), card('d', 3)];
  const meetings = migrateBlocksToMeetings(blocks, home);
  assert.equal(meetings.length, 2);
  assert.equal(meetings[0]!.title, 'ブロック #2');
  assert.equal(meetings[0]!.entries.map((e) => e.id).join(','), 'c,d');
  assert.equal(meetings[1]!.title, '人材ミーティング');
  assert.equal(meetings[1]!.entries.map((e) => e.id).join(','), 'a,b');
}

{
  const now = new Date('2026-10-07T12:00:00+09:00');
  const m = createMeeting('週次定例', '', now);
  assert.equal(m.title, '週次定例');
  assert.equal(m.date, '2026-10-07');
  const namedOnly = createMeeting('人材ミーティング');
  assert.equal(namedOnly.title, '人材ミーティング');
  assert.equal(namedOnly.date, todayTokyo());
}

console.log('meeting-notebooks ok');

// --- auto-file / move ---
{
  const at = (id: string, iso: string): StoredTranscriptEntry => ({ ...card(id, 1), at: iso });
  const m1: MeetingNotebook = {
    ...createMeeting('A', '2026-10-11'),
    id: 'a',
    startAt: '2026-10-11T01:00:00.000Z',
    endAt: '2026-10-11T02:00:00.000Z',
  };
  const m2: MeetingNotebook = { ...createMeeting('B', '2026-10-11'), id: 'b', entries: [at('x', '2026-10-11T05:00:00.000Z')] };
  const cards = [at('c1', '2026-10-11T01:30:00.000Z'), at('c2', '2026-10-11T03:00:00.000Z'), at('x', '2026-10-11T05:00:00.000Z')];
  const plan = planAutoFile(cards, [m1, m2]);
  assert.equal(plan.total, 1);
  assert.deepEqual(plan.byMeeting.get('a')?.map((c) => c.id), ['c1']);
  const applied = applyAutoFilePlan([m1, m2], plan);
  const moved = moveCardToMeeting(applied, 'c1', 'b');
  assert.equal(moved.find((m) => m.id === 'a')!.entries.length, 0);
  assert.equal(moved.find((m) => m.id === 'b')!.entries.length, 2);
  const { meetings: r, card: got } = removeCardFromMeetings(moved, 'c1');
  assert.equal(got?.id, 'c1');
  assert.equal(r.find((m) => m.id === 'b')!.entries.length, 1);
  console.log('auto-file/move ok');
}

{
  const mk = (id: string, s?: string, e?: string): MeetingNotebook => ({
    id, date: '2026-01-01', title: id, createdAt: '2026-01-01T00:00:00Z', entries: [], startAt: s, endAt: e,
  });
  const a = mk('a', '2026-01-01T00:00:00Z', '2026-01-01T10:00:00Z');
  const b = mk('b', '2026-01-01T01:00:00Z', '2026-01-01T02:00:00Z');
  const c = mk('c', '2026-01-01T12:00:00Z', '2026-01-01T13:00:00Z');
  assert.equal(closestMeetingFor('2026-01-01T01:30:00Z', [a, b, c])?.id, 'b');
  assert.equal(closestMeetingFor('2026-01-01T11:30:00Z', [a, b, c])?.id, 'c');
  assert.equal(closestMeetingFor('2026-01-01T11:30:00Z', []), null);
}
