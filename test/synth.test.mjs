// These tests listen for me. Each one renders audio and MEASURES the claim the
// engine makes about it. Wherever a knob is supposed to cause an effect, the
// test also renders with the knob at neutral and demands the effect be ABSENT —
// a measurement that cannot come out the other way is not a measurement.

import test from 'node:test';
import assert from 'node:assert/strict';
import { render, plan, PRESETS, resolveVoice, encodeWav, decodeWav, revealAt, revealSchedule, PHONEMES } from '../src/index.mjs';
import { VOICED_RMS } from '../src/synth.mjs';
import { softLimit, applyFx } from '../src/fx.mjs';
import { rms, db, pitch, formants, nearestRatio, centroid, bandRatioDb } from '../tools/analyze.mjs';

const SR = 44100;
const LINES = ['Welcome to the village, stranger!', "Hmm... I don't know. Have you seen my little brother anywhere?", 'NO! Get out, get OUT!'];
// a flat, clean voice: nothing moves unless the test moves it
const FLAT = { range: 0, lilt: 0, rough: 0, growl: 0, breath: 0, vibDepth: 0, pitch: 110 };
const unitsOf = (p, kind = 'syl') => p.units.filter((u) => u.kind === kind);
const mid = (u, frac = 0.5, half = 0.03) => [u.t0 + (u.t1 - u.t0) * frac - half, u.t0 + (u.t1 - u.t0) * frac + half];
const nucleus = (p, unitIndex) => { const segs = p.segs.filter((s) => s.unit === unitIndex && s.nucleusSeg); return [segs[0].t0, segs[segs.length - 1].t0 + segs[segs.length - 1].dur]; };
const unitIndexOf = (p, u) => p.units.indexOf(u);

test('hygiene: every preset renders finite, unclipped, DC-free audio that starts and ends at rest', () => {
  for (const name of Object.keys(PRESETS)) {
    for (const line of LINES) {
      const { samples, plan: p } = render(line, name);
      let peak = 0, sum = 0;
      for (const s of samples) { assert.ok(Number.isFinite(s), `${name}: non-finite sample`); peak = Math.max(peak, Math.abs(s)); sum += s; }
      assert.ok(peak < 1, `${name}: peak ${peak}`);
      assert.ok(peak > 0.05, `${name}: nearly silent (peak ${peak}) on "${line}"`);
      assert.ok(Math.abs(sum / samples.length) < 0.005, `${name}: DC offset ${sum / samples.length}`);
      assert.ok(Math.abs(samples[0]) < 1e-3 && Math.abs(samples[samples.length - 1]) < 1e-3, `${name}: does not start/end at rest`);
      assert.ok(samples.length >= Math.floor(p.duration * SR), `${name}: audio shorter than its plan`);
    }
  }
});

test('determinism: same (text, voice, seed) is the same samples; a different take is not', () => {
  const a = render(LINES[1], 'gruff').samples;
  const b = render(LINES[1], 'gruff').samples;
  assert.equal(a.length, b.length);
  assert.ok(a.every((s, i) => s === b[i]), 'two renders of the same line differ');
  const c = render(LINES[1], 'gruff', { seed: 2 }).samples;
  assert.ok(c.length !== a.length || c.some((s, i) => s !== a[i]), 'a different take seed changed nothing');
  // the plan does not depend on the sample rate
  assert.deepEqual(plan(LINES[0], 'pixie'), render(LINES[0], 'pixie', { sampleRate: 22050 }).plan);
});

test('pitch: a flat voice sits on the pitch it was given', () => {
  for (const hz of [90, 140, 220, 330]) {
    const { samples, plan: p } = render('mama', { ...FLAT, pitch: hz });
    const [t0, t1] = nucleus(p, unitIndexOf(p, unitsOf(p)[0]));
    const got = pitch(samples, SR, t0 + 0.01, t1 - 0.005);
    assert.ok(got.clarity > 0.8, `${hz} Hz: not periodic (clarity ${got.clarity.toFixed(2)})`);
    assert.ok(Math.abs(got.f0 / hz - 1) < 0.015, `${hz} Hz: measured ${got.f0.toFixed(1)}`);
  }
});

test('formants: vowels land on their targets, and `tract` scales the whole mouth', () => {
  // low pitch on purpose: LPC cannot outline a formant from widely spaced harmonics
  const cases = [['ee', 'IY'], ['ah', 'AA'], ['oo', 'UW']];
  for (const tract of [0.8, 1, 1.25]) {
    for (const [word, ph] of cases) {
      const { samples, plan: p } = render(word, { ...FLAT, pitch: 100, tract, oq: 0.5, tilt: 0.7 });
      const u = unitsOf(p)[0];
      assert.deepEqual(u.phones, [ph], `"${word}" was expected to be the bare vowel ${ph}`);
      const [t0, t1] = nucleus(p, unitIndexOf(p, u));
      const peaks = formants(samples, SR, t0 + 0.02, t1 - 0.01);
      const want = PHONEMES[ph].F.map((f) => f * tract);
      const r1 = nearestRatio(peaks, want[0]);
      const r2 = nearestRatio(peaks, want[1]);
      assert.ok(Math.abs(r1 - 1) < 0.15, `${ph} tract ${tract}: F1 want ${want[0].toFixed(0)} got ${(r1 * want[0]).toFixed(0)} (peaks ${peaks.join(' ')})`);
      assert.ok(Math.abs(r2 - 1) < 0.15, `${ph} tract ${tract}: F2 want ${want[1].toFixed(0)} got ${(r2 * want[1]).toFixed(0)} (peaks ${peaks.join(' ')})`);
    }
  }
});

function endRatio(text, voice) {
  const { samples, plan: p } = render(text, voice);
  const syl = unitsOf(p);
  const [t0, t1] = nucleus(p, unitIndexOf(p, syl[syl.length - 1]));
  const w = Math.min(0.045, (t1 - t0) / 3);
  const early = pitch(samples, SR, t0 + 0.005, t0 + 0.005 + w);
  const late = pitch(samples, SR, t1 - 0.005 - w, t1 - 0.005);
  return late.f0 / early.f0;
}

test('a question rises, a statement falls — and with range 0 neither does', () => {
  const v = { ...FLAT, range: 7 };
  const q = endRatio('Really?', v);
  const s = endRatio('Really.', v);
  assert.ok(q > 1.12, `question end/start f0 ratio ${q.toFixed(3)}`);
  assert.ok(s < 0.93, `statement end/start f0 ratio ${s.toFixed(3)}`);
  // the falsifier: same measurement, knob at neutral, effect must vanish
  for (const text of ['Really?', 'Really.']) {
    const flat = endRatio(text, FLAT);
    assert.ok(Math.abs(flat - 1) < 0.02, `range 0 but "${text}" still moved: ${flat.toFixed(3)}`);
  }
});

function wordRms(text, voice, wordText) {
  const { samples, plan: p } = render(text, voice);
  const w = p.words.filter((x) => x.text === wordText).pop();
  return rms(samples, w.t0 * SR, w.t1 * SR);
}

test('! and CAPS are louder — and with emphasis 0 they are not', () => {
  const v = { ...FLAT, range: 6 };
  const bang = db(wordRms('Stop!', v, 'Stop') / wordRms('Stop.', v, 'Stop'));
  assert.ok(bang > 1, `"Stop!" is only ${bang.toFixed(2)} dB over "Stop."`);
  const caps = db(wordRms('I said NO.', v, 'NO') / wordRms('I said no.', v, 'no'));
  assert.ok(caps > 1.5, `"NO" is only ${caps.toFixed(2)} dB over "no"`);
  const v0 = { ...v, emphasis: 0 };
  const bang0 = db(wordRms('Stop!', v0, 'Stop') / wordRms('Stop.', v0, 'Stop'));
  const caps0 = db(wordRms('I said NO.', v0, 'NO') / wordRms('I said no.', v0, 'no'));
  assert.ok(Math.abs(bang0) < 0.6, `emphasis 0 but "!" still changed level by ${bang0.toFixed(2)} dB`);
  assert.ok(Math.abs(caps0) < 0.6, `emphasis 0 but CAPS still changed level by ${caps0.toFixed(2)} dB`);
});

test('the plan and the audio agree in time: syllables sound, pauses are silent', () => {
  for (const name of ['narrator', 'gruff', 'pixie', 'villager', 'blip']) {
    const { samples, plan: p } = render('Wait. I found it, the key! Go now.', name);
    for (const u of p.units) {
      if (u.kind === 'rest') {
        if (u.t1 - u.t0 >= 0.12) { const q = rms(samples, (u.t0 + 0.06) * SR, (u.t1 - 0.02) * SR); assert.ok(q < 0.012, `${name}: pause "${u.mark}" at ${u.t0.toFixed(2)}s is not silent (rms ${q.toFixed(4)})`); }
      } else if (!u.silent) {
        const q = rms(samples, u.t0 * SR, u.t1 * SR);
        assert.ok(q > 0.015, `${name}: unit "${u.label}" at ${u.t0.toFixed(2)}s is inaudible (rms ${q.toFixed(4)})`);
      }
    }
  }
});

test('consonants: /s/ is high hiss, /sh/ sits lower, and both stay under the vowel', () => {
  const v = { ...FLAT };
  const measure = (word) => {
    const { samples, plan: p } = render(word, v);
    const ui = unitIndexOf(p, unitsOf(p)[0]);
    const fr = p.segs.find((s) => s.unit === ui && s.af > 0);
    const [v0, v1] = nucleus(p, ui);
    return {
      centroid: centroid(samples, SR, fr.t0 + 0.01, fr.t0 + fr.dur - 0.01),
      level: db(rms(samples, (fr.t0 + 0.015) * SR, (fr.t0 + fr.dur - 0.015) * SR) / rms(samples, (v0 + 0.02) * SR, (v1 - 0.02) * SR)),
    };
  };
  const s = measure('see');
  const sh = measure('she');
  assert.ok(s.centroid > 4500, `/s/ centroid ${s.centroid.toFixed(0)} Hz`);
  assert.ok(sh.centroid < s.centroid - 1200, `/sh/ centroid ${sh.centroid.toFixed(0)} is not clearly below /s/ ${s.centroid.toFixed(0)}`);
  for (const [name, m] of [['s', s], ['sh', sh]]) assert.ok(m.level < -5 && m.level > -24, `/${name}/ is ${m.level.toFixed(1)} dB re its vowel`);
});

test('articulation 0 removes the hiss; articulation 1 has it', () => {
  const hiss = (a) => {
    const { samples, plan: p } = render('see', { ...FLAT, articulation: a });
    const ui = unitIndexOf(p, unitsOf(p)[0]);
    const fr = p.segs.find((s) => s.unit === ui && s.cons);
    return centroid(samples, SR, fr.t0 + 0.01, fr.t0 + fr.dur - 0.01);
  };
  assert.ok(hiss(1) > 4500);
  assert.ok(hiss(0) < 1500, `articulation 0 still hisses: centroid ${hiss(0).toFixed(0)} Hz`);
});

test('whisper has no pitch; the same vowel voiced does', () => {
  const clarity = (voice) => { const { samples, plan: p } = render('ah', voice); const [t0, t1] = nucleus(p, unitIndexOf(p, unitsOf(p)[0])); return pitch(samples, SR, t0 + 0.01, t1 - 0.01).clarity; };
  assert.ok(clarity({ ...FLAT }) > 0.85);
  assert.ok(clarity({ ...FLAT, wave: 'whisper' }) < 0.45, `whisper is periodic: clarity ${clarity({ ...FLAT, wave: 'whisper' }).toFixed(2)}`);
});

test('rough and growl do what they say, and are absent at 0', () => {
  const probe = (voice) => {
    const { samples, plan: p } = render('ahhh', { ...FLAT, pitch: 120, ...voice });
    const [t0, t1] = nucleus(p, unitIndexOf(p, unitsOf(p)[0]));
    return { clarity: pitch(samples, SR, t0 + 0.02, t1 - 0.02, 90, 400).clarity, sub: bandRatioDb(samples, SR, t0 + 0.02, t1 - 0.02, 60, 120) };
  };
  const clean = probe({});
  const rough = probe({ rough: 0.9 });
  const growl = probe({ growl: 0.8 });
  assert.ok(clean.clarity - rough.clarity > 0.03, `rough did not reduce periodicity: ${clean.clarity.toFixed(3)} -> ${rough.clarity.toFixed(3)}`);
  assert.ok(clean.sub < -25, `clean voice already has a subharmonic: ${clean.sub.toFixed(1)} dB`);
  assert.ok(growl.sub > clean.sub + 15, `growl subharmonic ${growl.sub.toFixed(1)} dB vs clean ${clean.sub.toFixed(1)} dB`);
});

test('calibration: vowels average the same loudness whatever the body of the voice', () => {
  // The claim in synth.mjs's header, measured where it is made — and it is a claim
  // about the AVERAGE over vowels and pitch movement. A single vowel at a single
  // pitch swings several dB on harmonic/formant alignment; that is physics, and
  // the first version of this test (one "ah", fixed pitch) measured the lottery:
  // 11 dB of spread. So: several vowels, a moving pitch, power-mean over nuclei.
  const levels = [];
  for (const body of [{ pitch: 70, tract: 0.7 }, { pitch: 110 }, { pitch: 220, tract: 1.2 }, { pitch: 420, tract: 1.45 }, { pitch: 150, wave: 'saw' }, { pitch: 150, wave: 'square' }, { pitch: 150, tilt: 0.1 }, { pitch: 150, tilt: 0.95 }, { pitch: 150, oq: 0.35 }]) {
    const { samples, plan: p } = render('ah, ee, oo, eh, oh, eye, ow, you.', { ...FLAT, range: 6, lilt: 0.4, ...body });
    let power = 0, n = 0;
    for (const u of unitsOf(p)) {
      const [t0, t1] = nucleus(p, unitIndexOf(p, u));
      const r = rms(samples, (t0 + 0.015) * SR, (t1 - 0.015) * SR) / u.amp;
      power += r * r; n++;
    }
    levels.push(db(Math.sqrt(power / n) / VOICED_RMS));
  }
  const spread = Math.max(...levels) - Math.min(...levels);
  assert.ok(spread < 4, `mean vowel level varies ${spread.toFixed(1)} dB across voice bodies: ${levels.map((l) => l.toFixed(1)).join(', ')}`);
  assert.ok(levels.every((l) => Math.abs(l) < 3.5), `mean vowel level is off target: ${levels.map((l) => l.toFixed(1)).join(', ')} dB re VOICED_RMS`);
});

test('letter mode keeps an even patter; blip.every thins the blips', () => {
  const p = plan('hello there', 'villager');
  const letters = unitsOf(p, 'letter');
  const step = letters[0].t1 - letters[0].t0;
  for (const u of letters) { const d = u.t1 - u.t0; assert.ok(Math.abs(d - step) < 1e-9 || Math.abs(d - step * 1.4) < 1e-9, `letter "${u.label}" lasts ${d}, step is ${step}`); }
  assert.equal(letters.length, 9); // h e l l o  th e r e
  const every2 = unitsOf(plan('abcdef', { preset: 'blip', blip: { every: 2 } }), 'blip');
  assert.deepEqual(every2.map((u) => u.silent), [false, true, false, true, false, true]);
});

test('reveal: monotone, complete, and consistent between the two forms', () => {
  for (const name of ['narrator', 'villager', 'blip']) {
    const text = "Wait... I found it — the key! Pay 42 gold, okay?";
    const p = plan(text, name);
    let prev = 0;
    for (let t = -0.1; t <= p.duration + 0.1; t += 0.004) { const c = revealAt(p, t); assert.ok(c >= prev, `${name}: reveal went backwards at t=${t.toFixed(3)}`); prev = c; }
    assert.equal(revealAt(p, -1), 0);
    assert.equal(revealAt(p, p.duration), text.length);
    const sched = revealSchedule(p);
    assert.equal(sched[sched.length - 1].chars, text.length);
    for (let k = 1; k < sched.length; k++) { assert.ok(sched[k].t >= sched[k - 1].t); assert.ok(sched[k].chars > sched[k - 1].chars); }
    for (const step of sched) assert.ok(revealAt(p, step.t + 1e-6) >= step.chars, `${name}: schedule says ${step.chars} chars at ${step.t} but revealAt disagrees`);
    // every unit's characters belong to the text, in order, with no gaps
    let pos = 0;
    for (const u of p.units) { assert.equal(u.c0, pos, `${name}: unit starts at char ${u.c0}, expected ${pos}`); pos = u.c1; }
    assert.equal(pos, text.length);
  }
});

test('nothing is baked in after the last sound; inner pauses are kept', () => {
  const a = plan('Go.', 'narrator');
  const b = plan('Go', 'narrator');
  assert.ok(Math.abs(a.duration - b.duration) < 1e-9, 'a final full stop added silence to the clip');
  assert.ok(plan('Go. Now.', 'narrator').duration > plan('Go now.', 'narrator').duration + 0.2);
  assert.ok(plan('Go, now.', { pauses: 2 }).duration > plan('Go, now.', { pauses: 0 }).duration + 0.2);
});

test('function words are swallowed; a tts-weights table overrides the built-in list', () => {
  const durOf = (p, word) => { const w = p.words.find((x) => x.text === word); return w.t1 - w.t0; };
  const base = plan('the dragon', 'narrator');
  const full = plan('the dragon', 'narrator', { weights: { words: [{ word: 'the', dur: 1, centralize: 0 }, { word: 'dragon', dur: 1, centralize: 0 }] } });
  const cut = plan('the dragon', 'narrator', { weights: { words: [{ word: 'the', dur: 0.6, centralize: 0.4 }, { word: 'dragon', dur: 1, centralize: 0 }] } });
  assert.ok(durOf(base, 'the') < durOf(full, 'the') * 0.9, 'built-in function-word reduction did not shorten "the"');
  assert.ok(durOf(cut, 'the') < durOf(full, 'the') * 0.8, 'weights dur 0.6 did not shorten "the"');
  assert.ok(Math.abs(durOf(cut, 'dragon') - durOf(full, 'dragon')) < 1e-9);
  // a table whose dur column was dropped (abbreviation law did not hold) licenses nothing: fall back
  assert.deepEqual(plan('the dragon', 'narrator', { weights: { words: [{ word: 'the', count: 9 }] } }), base);
  assert.throws(() => plan('x', 'narrator', { weights: { nope: true } }), /tts-weights/);
});

test('wav: round trip within one LSB, header says what it holds', () => {
  const { samples } = render('Testing.', 'narrator');
  const bytes = encodeWav(samples, SR);
  assert.equal(bytes.length, 44 + samples.length * 2);
  const back = decodeWav(bytes);
  assert.equal(back.sampleRate, SR);
  assert.equal(back.samples.length, samples.length);
  for (let i = 0; i < samples.length; i += 97) assert.ok(Math.abs(back.samples[i] - samples[i]) <= 1 / 32767 + 1e-7);
});

test('fx: limiter bounds, crush quantises, echo grows the clip, band cuts the lows', () => {
  for (const x of [-50, -1, -0.7, 0, 0.5, 0.7, 0.9, 3, 1e6]) { const y = softLimit(x); assert.ok(Math.abs(y) < 1 || Math.abs(x) < 1); if (Math.abs(x) <= 0.7) assert.equal(y, x); }
  const crushed = render('ahhh', { ...FLAT, fx: { crush: 4 } }).samples;
  assert.ok(new Set(crushed).size <= 40, `4-bit crush left ${new Set(crushed).size} distinct levels`); // 16 levels, plus edge fades
  assert.ok(render('Go.', { fx: { echo: 0.5, echoTime: 0.2 } }).samples.length > render('Go.', {}).samples.length + SR * 0.5);
  const tone = (hz) => { const x = new Float32Array(SR); for (let i = 0; i < SR; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / SR); return x; };
  const base = { ring: 0, band: 1, tremolo: 0, echo: 0, hold: 1, crush: 0 };
  assert.ok(db(rms(applyFx(tone(80), base, SR), SR / 2) / rms(applyFx(tone(1000), base, SR), SR / 2)) < -30, 'radio band passes 80 Hz');
});

test('a voice is validated: unknown names refuse, numbers clamp', () => {
  assert.throws(() => resolveVoice('nobody'), /unknown preset/);
  assert.throws(() => resolveVoice({ mode: 'opera' }), /unknown mode/);
  assert.throws(() => resolveVoice({ wave: 'wobble' }), /unknown wave/);
  assert.equal(resolveVoice({ pitch: 99999 }).pitch, 700);
  assert.equal(resolveVoice({ pitch: 'loud' }).pitch, 140);
  assert.equal(resolveVoice({ preset: 'gruff', pitch: 70 }).pitch, 70);
  assert.equal(resolveVoice({ preset: 'gruff', pitch: 70 }).growl, PRESETS.gruff.growl);
});
