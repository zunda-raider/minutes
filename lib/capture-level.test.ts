import assert from 'node:assert/strict';
import { classifyCapturePeak, DEAD_TRACK_PEAK, HEARD_PEAK } from './capture-level';

assert.equal(classifyCapturePeak(0, false), 'quiet');
assert.equal(classifyCapturePeak(0, true), 'dead');
assert.equal(classifyCapturePeak(DEAD_TRACK_PEAK - 1e-8, true), 'dead');
assert.equal(classifyCapturePeak(DEAD_TRACK_PEAK, true), 'quiet');
assert.equal(classifyCapturePeak(0.001, true), 'quiet');
assert.equal(classifyCapturePeak(HEARD_PEAK, false), 'heard');
assert.equal(classifyCapturePeak(Number.NaN, true), 'quiet');
assert.equal(classifyCapturePeak(-1, true), 'quiet');
console.log('capture-level ok');
