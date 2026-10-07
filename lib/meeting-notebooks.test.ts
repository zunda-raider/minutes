import assert from 'node:assert/strict';
import {
  appendCardsToMeeting,
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
  const base = createMeeting('2026-10-03', '人材ミーティング');
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
    { ...createMeeting('2026-10-03', 'A'), createdAt: '2026-10-03T01:00:00.000Z' },
    { ...createMeeting('2026-10-05', 'B'), createdAt: '2026-10-05T02:00:00.000Z' },
    { ...createMeeting('2026-10-05', 'C'), createdAt: '2026-10-05T09:00:00.000Z' },
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

console.log('meeting-notebooks ok');
