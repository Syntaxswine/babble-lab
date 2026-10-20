import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditionPlayer } from '../tools/audition-player.mjs';
import { AudioContext } from './helpers/audio.mjs';

test('live updates crossfade at the advancing transport position without restarting it', async () => {
  const context = new AudioContext();
  const audio = { paused: false, ended: false, currentTime: 1.4, volume: 0.6, muted: false, playbackRate: 1 };
  const player = createAuditionPlayer({ audio, createContext: () => context });
  const take = (value) => ({ samples: new Float32Array(8000).fill(value), sampleRate: 8000, preRoll: 1, sceneSeconds: 3 });
  try {
    player.select(); player.update(take(0.2)); await player.play();
    assert.equal(context.sources.length, 1);
    const first = context.sources[0];
    assert.ok(Math.abs(first.starts[0][1] - 1.405) < 1e-10);
    assert.ok(first.buffer.samples.subarray(0, 8000).every((x) => x === 0));
    audio.currentTime = 1.702; context.currentTime = 10.3; // simulate rounded media timestamps
    player.update(take(0.3));
    const second = context.sources[1];
    assert.equal(audio.currentTime, 1.702);
    assert.equal(audio.paused, false);
    assert.ok(Math.abs(second.starts[0][1] - 1.705) < 1e-10);
    assert.ok(first.stops[0][0] > second.starts[0][0]);
    assert.equal(first.output.gain.events.at(-1)[1], 0);
    assert.equal(second.output.gain.events.at(-1)[1], 1);
    const scheduledStop = first.stops.length;
    player.update(take(0.4)); // rapid input must not keep old fading nodes alive
    assert.equal(first.stops.length, scheduledStop);
    first.onended(); assert.equal(first.disconnected, true);
    audio.volume = 0.2; player.volume();
    assert.equal(context.gains[0].gain.value, 0.2);
    audio.muted = true; player.volume(); assert.equal(context.gains[0].gain.value, 0);
    audio.paused = true; player.pause();
    const count = context.sources.length;
    player.update(take(0.1)); assert.equal(context.sources.length, count);
    audio.currentTime = 0.8; player.seek(); assert.equal(context.sources.length, count);
    audio.paused = false; await player.play();
    assert.ok(Math.abs(context.sources.at(-1).starts[0][1] - 0.805) < 1e-10);
    audio.currentTime = 2; player.seek();
    assert.ok(Math.abs(context.sources.at(-1).starts[0][1] - 2.005) < 1e-10);
    await player.suspend(); assert.equal(context.state, 'suspended');
    assert.ok(context.sources.every((s) => s.disconnected));
  } finally { await player.dispose(); }
  assert.equal(context.state, 'closed');
});
