import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeaker } from '../src/runtime.mjs';
import { makeBank } from '../src/index.mjs';

function fakeAudio() {
  const sources = [], gains = [];
  return { currentTime: 0, sampleRate: 16000, destination: {}, sources, gains,
    createBuffer(ch, n, sr) { const data = new Float32Array(n); return { getChannelData: () => data, duration: n / sr }; },
    createGain() { const g = { gain: { value: 1 }, connect(x) { return x; }, disconnect() { this.disconnected = true; } }; gains.push(g); return g; },
    createBufferSource() {
      const s = { connect(x) { return x; }, disconnect() { this.disconnected = true; }, start(t) { this.started = t; }, stop() { this.stopped = true; } };
      sources.push(s); return s;
    },
  };
}
function bankAt(hz) {
  return makeBank(Float32Array.from({ length: 16000 * 4 }, (_, i) => 0.2 * Math.sin(2 * Math.PI * hz * i / 16000)), 16000, { name: 'same-name' });
}

test('runtime cache distinguishes timing, weight Maps, gain and bank identity, including default banks', () => {
  const a = bankAt(180), b = bankAt(320), banks = { animal: a };
  const speaker = createSpeaker(fakeAudio(), { banks });
  const original = speaker.prepare('Hello', 'hen');
  assert.equal(speaker.prepare('Hello', 'hen'), original);
  const fitted = speaker.prepare('Hello', 'hen', { timing: { duration: 1 } });
  assert.notEqual(fitted, original); assert.equal(fitted.plan.duration, 1);
  assert.notEqual(speaker.prepare('Hello', 'hen', { gain: 0.5 }), original);
  const weights = new Map([['hello', { dur: 0.5, centralize: 0 }]]);
  const weighted = speaker.prepare('Hello', 'hen', { weights });
  weights.set('hello', { dur: 1, centralize: 0 });
  assert.notEqual(speaker.prepare('Hello', 'hen', { weights }), weighted);
  const firstBank = speaker.prepare('Hello', null, { bank: a });
  const secondBank = speaker.prepare('Hello', null, { bank: b });
  assert.notDeepEqual(firstBank.buffer.getChannelData(0), secondBank.buffer.getChannelData(0));
  const firstDefault = speaker.prepare('Hello', { bank: 'animal' });
  banks.animal = b;
  assert.notEqual(speaker.prepare('Hello', { bank: 'animal' }), firstDefault);
  const uncached = createSpeaker(fakeAudio(), { maxCached: 0 });
  assert.notEqual(uncached.prepare('Hi'), uncached.prepare('Hi'));
  assert.throws(() => createSpeaker(fakeAudio(), { maxCached: -1 }), /maxCached/);
});

test('stop releases every overlapping line; scheduled starts and mouth callbacks use the audio clock', async () => {
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  const ctx = fakeAudio(), speaker = createSpeaker(ctx), mouth = [];
  try {
    const a = speaker.say('Hello', 'hen', { when: 2, onMouth: (open) => mouth.push(open) });
    const b = speaker.say('Hello', 'hen', { overlap: true });
    assert.equal(a.startAt, 2); assert.equal(ctx.sources[0].started, 2);
    ctx.currentTime = 2.12;
    await new Promise((resolve) => setTimeout(resolve, 45));
    assert.ok(mouth.some((x) => x > 0), 'mouth never followed the audio clock');
    ctx.sources[1].onended();
    assert.equal(await b.done, 'ended'); assert.equal(speaker.speaking, true, 'older overlap is still speaking');
    const c = speaker.say('Hello', 'hen', { overlap: true });
    speaker.stop();
    assert.equal(await a.done, 'stopped'); assert.equal(await c.done, 'stopped');
    assert.equal(mouth.at(-1), 0); assert.equal(speaker.speaking, false);
    assert.ok(ctx.sources.every((s) => s.disconnected)); assert.ok(ctx.gains.every((g) => g.disconnected));
    const d = speaker.say('Hi', 'hen'); const e = speaker.say('Hi', 'hen', { overlap: true });
    const f = speaker.say('Stop!', 'hen');
    assert.equal(await d.done, 'stopped'); assert.equal(await e.done, 'stopped');
    f.stop(); await f.done;
    assert.throws(() => speaker.say('Hi', 'hen', { when: NaN }), /when/);
  } finally { speaker.stop(); delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; }
});
