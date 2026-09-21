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
//
// Voices that speak with a bank (voice.bank = 'name') need the bank itself:
//   createSpeaker(ctx, { banks: { name: decodeBank(bytes) } })   or   say(text, voice, { bank })

import { render, revealAt } from './index.mjs';

export function createSpeaker(audioContext, defaults = {}) {
  if (!audioContext || typeof audioContext.createBuffer !== 'function') throw new Error('babble: createSpeaker needs an AudioContext');
  const cache = new Map();
  const maxCached = defaults.maxCached ?? 64;
  let current = null;

  function prepare(text, voice, opts = {}) {
    const bank = opts.bank ?? null;
    const key = JSON.stringify([text, voice, opts.seed ?? 0, bank?.name ?? null]);
    let hit = cache.get(key);
    if (!hit) {
      const { samples, plan } = render(text, voice, { sampleRate: audioContext.sampleRate, seed: opts.seed ?? 0, weights: opts.weights ?? defaults.weights, bank, banks: defaults.banks });
      const buffer = audioContext.createBuffer(1, samples.length, audioContext.sampleRate);
      buffer.getChannelData(0).set(samples);
      hit = { buffer, plan };
      cache.set(key, hit);
      if (cache.size > maxCached) cache.delete(cache.keys().next().value);
    }
    return hit;
  }

  function say(text, voice, opts = {}) {
    if (current && !opts.overlap) current.stop();
    const { buffer, plan } = prepare(text, voice, opts);
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    gain.gain.value = opts.volume ?? defaults.volume ?? 1;
    source.buffer = buffer;
    source.connect(gain).connect(opts.destination ?? defaults.destination ?? audioContext.destination);

    let finished = false;
    let shown = -1;
    let raf = 0;
    const startAt = audioContext.currentTime + 0.02;
    const reveal = (chars) => { if (chars !== shown) { shown = chars; opts.onReveal?.(chars, text.slice(0, chars), plan); } };
    // The reveal reads the AUDIO clock and is pumped two ways. requestAnimationFrame
    // alone is not safe: it silently never fires in background tabs, some embedded
    // webviews and headless captures — even while document.hidden says false (seen
    // in this project's own preview pane: text sat at 0 for 4.6 s, then jumped to
    // the end). A timer keeps the text moving there; rAF keeps it smooth elsewhere.
    const pump = () => { if (!finished) reveal(revealAt(plan, audioContext.currentTime - startAt)); };
    const frame = () => { if (finished) return; pump(); raf = requestAnimationFrame(frame); };
    const timer = setInterval(pump, 33);

    let resolve;
    const done = new Promise((r) => { resolve = r; });
    const finish = (how) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      clearInterval(timer);
      reveal(text.length); // and never leave a line half-shown, however it ended
      if (current === handle) current = null;
      opts.onEnd?.(how);
      resolve(how);
    };
    source.onended = () => finish('ended');
    const handle = {
      plan, done,
      get time() { return Math.max(0, audioContext.currentTime - startAt); },
      stop() { try { source.stop(); } catch { /* already stopped */ } finish('stopped'); },
      skip() { this.stop(); },
    };
    current = handle;
    source.start(startAt);
    reveal(0);
    raf = requestAnimationFrame(frame);
    return handle;
  }

  return {
    say, prepare,
    stop() { current?.stop(); },
    get speaking() { return current !== null; },
    clearCache() { cache.clear(); },
  };
}
