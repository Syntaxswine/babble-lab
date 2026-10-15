// The part a game embeds. Browser only (WebAudio).
//
//   import { createSpeaker } from 'babble-lab/runtime';
//   const speaker = createSpeaker(audioContext);          // make the context inside a user gesture
//   const line = speaker.say('Who goes there?', 'gruff', {
//     onReveal: (chars, shown) => { textBox.textContent = shown; },
//   });
//   await line.done;          // resolves when the voice stops — or line.skip() to jump to the end
//
// A line is rendered once and cached, so a repeated bark costs nothing, and
// speaker.prepare() lets a scene warm its lines up before they are needed.
// `timing` fits the score before synthesis. `when` schedules on the AudioContext
// clock; onMouth(open, clipTime, plan) follows the same clock as text reveals.
// stop() stops all overlaps. Banks are cached by identity: replace a bank object
// (or clearCache) after editing its samples in place.
//
// Voices that speak with a bank (voice.bank = 'name') need the bank itself:
//   createSpeaker(ctx, { banks: { name: decodeBank(bytes) } })   or   say(text, voice, { bank })

import { render, revealAt, resolveVoice, mouthAt } from './index.mjs';

export function createSpeaker(audioContext, defaults = {}) {
  if (!audioContext || typeof audioContext.createBuffer !== 'function') throw new Error('babble: createSpeaker needs an AudioContext');
  const cache = new Map();
  const maxCached = defaults.maxCached ?? 64;
  if (!Number.isInteger(maxCached) || maxCached < 0) throw new Error('babble: maxCached must be a non-negative integer');
  const active = new Set();
  const bankIds = new WeakMap();
  let nextBankId = 1;

  function prepare(text, voice, opts = {}) {
    const resolved = resolveVoice(voice);
    const bank = opts.bank ?? defaults.bank ?? (resolved.bank ? defaults.banks?.[resolved.bank] : null);
    if (bank && !bankIds.has(bank)) bankIds.set(bank, nextBankId++);
    const weights = opts.weights ?? defaults.weights;
    const settings = { seed: opts.seed ?? defaults.seed ?? 0, timing: opts.timing ?? defaults.timing, gain: opts.gain ?? defaults.gain, fx: opts.fx ?? defaults.fx };
    const key = JSON.stringify([String(text ?? ''), resolved, settings, weights instanceof Map ? [...weights] : weights, bank ? bankIds.get(bank) : null]);
    let hit = cache.get(key);
    if (!hit) {
      const { samples, plan } = render(text, resolved, { ...settings, sampleRate: audioContext.sampleRate, weights, bank });
      const buffer = audioContext.createBuffer(1, samples.length, audioContext.sampleRate);
      buffer.getChannelData(0).set(samples);
      hit = { buffer, plan };
      if (maxCached > 0) {
        cache.set(key, hit);
        if (cache.size > maxCached) cache.delete(cache.keys().next().value);
      }
    } else {
      cache.delete(key);
      cache.set(key, hit);
    }
    return hit;
  }

  function say(text, voice, opts = {}) {
    if (opts.when !== undefined && (!Number.isFinite(opts.when) || opts.when < 0)) throw new Error('babble: when must be a non-negative AudioContext time');
    const { buffer, plan } = prepare(text, voice, opts);
    text = plan.text;
    if (!opts.overlap) stop();
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    gain.gain.value = opts.volume ?? defaults.volume ?? 1;
    source.buffer = buffer;
    source.connect(gain).connect(opts.destination ?? defaults.destination ?? audioContext.destination);

    let finished = false;
    let shown = -1;
    let raf = 0;
    const startAt = Math.max(audioContext.currentTime, opts.when ?? audioContext.currentTime + 0.02);
    const reveal = (chars) => { if (chars !== shown) { shown = chars; opts.onReveal?.(chars, text.slice(0, chars), plan); } };
    // The reveal reads the AUDIO clock and is pumped two ways. requestAnimationFrame
    // alone is not safe: it silently never fires in background tabs, some embedded
    // webviews and headless captures — even while document.hidden says false (seen
    // in this project's own preview pane: text sat at 0 for 4.6 s, then jumped to
    // the end). A timer keeps the text moving there; rAF keeps it smooth elsewhere.
    const pump = () => {
      if (finished) return;
      const time = audioContext.currentTime - startAt;
      reveal(revealAt(plan, time));
      opts.onMouth?.(mouthAt(plan, time), time, plan);
    };
    const frame = () => { if (finished) return; pump(); raf = requestAnimationFrame(frame); };
    const timer = setInterval(pump, 33);

    let resolve;
    const done = new Promise((r) => { resolve = r; });
    const finish = (how) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      clearInterval(timer);
      active.delete(handle);
      source.onended = null;
      source.disconnect?.();
      gain.disconnect?.();
      try {
        reveal(text.length); // never leave a line half-shown, however it ended
        opts.onMouth?.(0, handle.time, plan);
        opts.onEnd?.(how);
      } finally { resolve(how); }
    };
    source.onended = () => finish('ended');
    const handle = {
      plan, done, startAt,
      get time() { return Math.max(0, audioContext.currentTime - startAt); },
      stop() { try { source.stop(); } catch { /* already stopped */ } finish('stopped'); },
      skip() { this.stop(); },
    };
    active.add(handle);
    try { source.start(startAt); } catch (error) { finish('stopped'); throw error; }
    reveal(0);
    raf = requestAnimationFrame(frame);
    return handle;
  }

  function stop() { for (const handle of [...active]) handle.stop(); }

  return {
    say, prepare,
    stop,
    get speaking() { return active.size > 0; },
    clearCache() { cache.clear(); },
  };
}
