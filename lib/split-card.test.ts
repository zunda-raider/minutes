import assert from 'node:assert/strict';
import { splitCard, splitCardInList, splitPieces } from './split-card';

let n = 0;
const id = () => `n${++n}`;
const card = (i: string, note: number, at: string, text: string) => ({
  id: i, note, at, text, lang: 'ja', speakerId: 2, source: 'mic' as const, textJa: '訳',
});

assert.deepEqual(splitPieces('あいうえお', { start: 1, end: 3 }), ['あ', 'いう', 'えお']);
assert.deepEqual(splitPieces('あいうえお', { start: 0, end: 2 }), ['あい', 'うえお']);
assert.deepEqual(splitPieces('あいうえお', { start: 0, end: 5 }), ['あいうえお']);

{
  const a = card('a', 1, '2026-01-01T00:00:00.000Z', '0123456789');
  const b = card('b', 2, '2026-01-01T00:00:10.000Z', 'next');
  const out = splitCardInList([a, b], 'a', { start: 3, end: 6 }, id);
  assert.deepEqual(out.map((e) => e.text), ['012', '345', '6789', 'next']);
  assert.equal(out[0]!.id, 'a');
  assert.deepEqual(out.map((e) => e.at), [
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:03.000Z',
    '2026-01-01T00:00:06.000Z',
    '2026-01-01T00:00:10.000Z',
  ]);
  const notes = out.map((e) => e.note);
  assert.deepEqual([...notes].sort((x, y) => x - y), notes);
  assert.ok(notes[2]! < 2);
  for (const e of out.slice(0, 3)) {
    assert.equal(e.speakerId, 2);
    assert.equal(e.source, 'mic');
    assert.equal(e.lang, 'ja');
    assert.equal(e.textJa, undefined);
  }
}

{
  // Last card: no next card, uses default span; whole selection is a no-op.
  const a = card('a', 5, '2026-01-01T00:00:00.000Z', 'abcd');
  assert.equal(splitCard(a, { start: 0, end: 4 }, null, id).length, 1);
  const out = splitCard(a, { start: 2, end: 4 }, null, id);
  assert.deepEqual(out.map((e) => e.text), ['ab', 'cd']);
  assert.ok(Date.parse(out[1]!.at) > Date.parse(out[0]!.at));
  assert.ok(out[1]!.note > 5 && out[1]!.note < 6);
}
console.log('split-card ok');
