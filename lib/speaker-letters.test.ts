import assert from 'node:assert/strict';
import {
  SEMINAR_SPEAKER_ID,
  SELF_SPEAKER_ID,
  cardSpeakerBadge,
  micGdSpeakerBadge,
  quietSpeakerTag,
} from './speaker-letters';

assert.equal(quietSpeakerTag(SEMINAR_SPEAKER_ID, 'mic'), 'セミナー');
assert.equal(quietSpeakerTag(SEMINAR_SPEAKER_ID, 'system'), 'セミナー');
assert.deepEqual(cardSpeakerBadge(SEMINAR_SPEAKER_ID, 'mic'), {
  tone: 'seminar',
  label: 'セミナー',
});
assert.deepEqual(cardSpeakerBadge(SEMINAR_SPEAKER_ID, 'system'), {
  tone: 'seminar',
  label: 'セミナー',
});
assert.equal(quietSpeakerTag(SELF_SPEAKER_ID, 'mic'), '自分');
assert.equal(quietSpeakerTag(SELF_SPEAKER_ID, 'system'), '自分');
assert.deepEqual(cardSpeakerBadge(SELF_SPEAKER_ID, 'mic'), {
  tone: 'self',
  label: '自分',
});
assert.equal(quietSpeakerTag(null, 'mic'), null);
assert.equal(cardSpeakerBadge(undefined, 'system'), null);
console.log('speaker-letters ok');

assert.deepEqual(micGdSpeakerBadge(1), { tone: 'self', label: 'A' });
assert.deepEqual(micGdSpeakerBadge(2), { tone: 'seminar', label: 'B' });
assert.deepEqual(micGdSpeakerBadge(5), { tone: 'letter', label: 'E' });
assert.equal(micGdSpeakerBadge(6), null);
assert.equal(micGdSpeakerBadge(null), null);
