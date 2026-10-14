import assert from 'node:assert/strict';
import { deleteSpanInList, removeSpanFromText } from './delete-selection';

assert.equal(removeSpanFromText('hello big world', { start: 6, end: 9 }), 'hello world');
assert.equal(removeSpanFromText('hello big world', { start: 5, end: 9 }), 'hello world');
assert.equal(removeSpanFromText('今日はとても暑い', { start: 3, end: 6 }), '今日は暑い');
assert.equal(removeSpanFromText('abc', { start: 0, end: 3 }), '');

const list = [
  { id: 'a', note: 1, text: 'one two three', textJa: '訳', at: 'x' },
  { id: 'b', note: 2, text: 'keep', at: 'y' },
];
{
  const r = deleteSpanInList(list, 'a', { start: 3, end: 7 });
  assert.equal(r.emptied, false);
  assert.deepEqual(r.list[0], { id: 'a', note: 1, text: 'one three', textJa: undefined, at: 'x' });
  assert.equal(r.list[1], list[1]);
}
{
  const r = deleteSpanInList(list, 'b', { start: 0, end: 4 });
  assert.equal(r.emptied, true);
  assert.equal(r.list, list);
}
console.log('delete-selection ok');
