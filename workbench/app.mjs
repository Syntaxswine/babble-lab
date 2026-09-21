// The workbench. Type a line, shape a voice, watch and hear what the engine does
// with it. Everything audible comes from ../src — this file only draws and plays.

import { render, resolveVoice, randomVoice, compactVoice, encodeWav, makeBank, encodeBank, decodeBank, recut, PRESETS, PARAMS, FX_PARAMS, MODES, WAVES } from '../src/index.mjs';
import { createSpeaker } from '../src/runtime.mjs';
import { spectrogram } from './spectro.mjs';

const $ = (id) => document.getElementById(id);
const CAST_KEY = 'babble-lab:cast:v1';
const SAMPLES = ['Welcome to the village, stranger!', 'Really?', 'Really.', 'No way. NO WAY!', 'Hmm... let me think.', 'Pay 300 gold, or leave.', 'I used to be an adventurer like you.', 'Sooooo... what now?', 'Zarkoth the Undying demands tribute!'];

let voice = resolveVoice('narrator');
let rendered = null; // { samples, sampleRate, plan }
let grid = null; // spectrogram of `rendered`, at the canvas's current width
let ctx = null;
let speaker = null;
let playing = null;
let take = 0;
let timer = 0;
let bank = null; // a decoded voice bank, if one is loaded
const bankInUse = () => (bank && $('bankOn').checked ? bank : undefined);

// ------------------------------------------------------------------ audio
function audio() {
  if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); speaker = createSpeaker(ctx); rendered = null; }
  if (ctx.state === 'suspended') ctx.resume();
  return speaker;
}
const sampleRate = () => (ctx ? ctx.sampleRate : 44100);

function refresh() {
  const text = $('line').value;
  const t0 = performance.now();
  rendered = render(text, voice, { sampleRate: sampleRate(), seed: take, bank: bankInUse() });
  grid = null;
  const ms = performance.now() - t0;
  const units = rendered.plan.units.filter((u) => u.kind !== 'rest');
  $('status').textContent = units.length
    ? `${units.length} ${voice.mode === 'syllable' ? 'syllables' : 'letters'} · ${(rendered.samples.length / rendered.sampleRate).toFixed(2)} s · rendered in ${ms.toFixed(0)} ms${take ? ` · take ${take}` : ''}`
    : 'nothing to say';
  if (units.length && bankInUse()) $('status').textContent += ` · bank ${bank.name}, tape ×${(voice.pitch / 140).toFixed(2)}`;
  showReveal(text.length);
  draw();
}

function speak(fromTime = 0) {
  const sp = audio();
  if (!rendered || rendered.sampleRate !== ctx.sampleRate) refresh();
  if (!rendered.plan.units.some((u) => u.kind !== 'rest')) return;
  stop();
  const text = $('line').value;
  if (fromTime > 0) {
    // play from a click on the score: a plain buffer source, no reveal
    const buf = ctx.createBuffer(1, rendered.samples.length, rendered.sampleRate);
    buf.getChannelData(0).set(rendered.samples);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const startAt = ctx.currentTime + 0.02;
    src.start(startAt, fromTime);
    playing = { stop: () => { try { src.stop(); } catch { /* done */ } }, get time() { return ctx.currentTime - startAt + fromTime; } };
    src.onended = () => { if (playing && playing.stop) playing = null; draw(); };
  } else {
    playing = sp.say(text, voice, { seed: take, bank: bankInUse(), onReveal: (chars) => showReveal(chars), onEnd: () => { playing = null; draw(); } });
  }
  requestAnimationFrame(animate);
}

function stop() { if (playing) { const p = playing; playing = null; p.stop(); } speaker?.stop(); }
// the playhead: rAF when the browser grants it, a slow timer when it does not (see runtime.mjs)
let lastFrame = 0;
function animate() { if (!playing) return; lastFrame = performance.now(); draw(); requestAnimationFrame(animate); }
setInterval(() => { if (playing && performance.now() - lastFrame > 120) draw(); }, 100);

function showReveal(chars) {
  const text = $('line').value;
  $('shown').textContent = text.slice(0, chars);
  $('hidden').textContent = text.slice(chars);
}

function changed({ speakNow = true } = {}) {
  clearTimeout(timer);
  timer = setTimeout(() => { refresh(); syncJson(); if (speakNow && $('auto').checked && ctx) speak(); }, 140);
}

// ------------------------------------------------------------------ the score
function palette() {
  const s = getComputedStyle(document.documentElement);
  const hex = (name) => { const v = s.getPropertyValue(name).trim(); const n = parseInt(v.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  return { paper: hex('--panel'), ink: hex('--ink'), dim: s.getPropertyValue('--dim').trim(), rule: s.getPropertyValue('--rule').trim(), accent: s.getPropertyValue('--accent').trim(), mark: s.getPropertyValue('--mark').trim(), inkCss: s.getPropertyValue('--ink').trim() };
}

const SPEC_H = 190; // css px of spectrogram; the rest of the canvas is the lane
let image = null;

function draw() {
  const canvas = $('score');
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(200, Math.floor(canvas.clientWidth));
  const Hh = 330;
  if (canvas.width !== W * dpr || canvas.height !== Hh * dpr) { canvas.width = W * dpr; canvas.height = Hh * dpr; grid = null; }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pal = palette();
  g.fillStyle = `rgb(${pal.paper})`;
  g.fillRect(0, 0, W, Hh);
  if (!rendered) return;
  const { samples, plan } = rendered;
  const dur = samples.length / rendered.sampleRate;
  const X = (t) => (t / dur) * W;

  if (!grid && samples.length) {
    const cols = W * dpr, rows = SPEC_H * dpr;
    grid = spectrogram(samples, rendered.sampleRate, cols, rows);
    image = g.createImageData(cols, rows);
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
      const v = Math.pow(grid[x * rows + y], 1.35);
      const o = ((rows - 1 - y) * cols + x) * 4;
      for (let c = 0; c < 3; c++) image.data[o + c] = pal.paper[c] + (pal.ink[c] - pal.paper[c]) * v;
      image.data[o + 3] = 255;
    }
  }
  if (image) g.putImageData(image, 0, 0);

  g.font = '10px ui-monospace, Consolas, monospace';
  g.textBaseline = 'top';
  g.fillStyle = pal.dim;
  for (let hz = 2000; hz < 8000; hz += 2000) { const y = SPEC_H * (1 - hz / 8000); g.globalAlpha = 0.35; g.fillRect(0, y, W, 1); g.globalAlpha = 1; g.fillText(`${hz / 1000}k`, 3, y + 2); }
  g.fillStyle = pal.rule;
  g.fillRect(0, SPEC_H, W, 1);

  // syllables / letters as said
  const laneTop = SPEC_H + 6;
  for (const u of plan.units) {
    if (u.kind === 'rest') continue;
    const a = X(u.t0), b = X(u.t1);
    g.fillStyle = pal.rule;
    g.fillRect(a, SPEC_H, 1, Hh - SPEC_H);
    g.fillStyle = u.silent ? pal.rule : u.stress && !u.reduced ? pal.inkCss : pal.dim;
    g.fillRect(a + 1, laneTop + 13, Math.max(1, b - a - 2), u.stress && !u.reduced ? 2 : 1);
    if (b - a > 9) g.fillText(u.label ?? '', a + 2, laneTop, Math.max(8, b - a - 3));
  }
  g.fillStyle = pal.mark;
  for (const w of plan.words) { const a = X(w.t0), b = X(w.t1); if (b - a > 14) g.fillText(w.text, a + 2, laneTop + 19, b - a - 3); }

  // pitch, in semitones around the voice's own pitch
  const mid = laneTop + 84, px = 3.2;
  g.fillStyle = pal.rule;
  for (const st of [-12, 0, 12]) g.fillRect(0, mid - st * px, W, 1);
  g.fillStyle = pal.dim;
  g.fillText(`${Math.round(voice.pitch)} Hz`, 3, mid + 2);
  g.fillText('+12', 3, mid - 12 * px + 2);
  g.strokeStyle = pal.accent;
  g.lineWidth = 1.5;
  g.beginPath();
  plan.pitch.forEach((p, k) => { const y = mid - Math.max(-14, Math.min(14, p.st)) * px; if (k) g.lineTo(X(p.t), y); else g.moveTo(X(p.t), y); });
  g.stroke();

  if (playing) { const x = X(Math.min(dur, playing.time ?? 0)); g.fillStyle = pal.accent; g.fillRect(x, 0, 1, Hh); }
}

function readout(ev) {
  if (!rendered) return;
  const r = $('score').getBoundingClientRect();
  const t = ((ev.clientX - r.left) / r.width) * (rendered.samples.length / rendered.sampleRate);
  const u = rendered.plan.units.find((q) => t >= q.t0 && t < q.t1);
  const took = u && rendered.used ? rendered.used.find((q) => q.unit === rendered.plan.units.indexOf(u)) : null;
  const from = took ? ` · ${took.look} piece from ${Math.floor(took.time / 60)}:${(took.time % 60).toFixed(2).padStart(5, '0')} of the recording${took.pieces > 1 ? `, reading on through ${took.pieces} pieces` : ''}` : '';
  const hz = ev.clientY - r.top < SPEC_H ? ` · ${Math.round(8000 * (1 - (ev.clientY - r.top) / SPEC_H))} Hz` : '';
  $('readout').textContent = u ? `${t.toFixed(2)} s${hz} · ${u.kind === 'rest' ? `pause (${u.mark})` : `"${u.label}"  [${(u.phones ?? []).join(' ')}]  ${u.p0 >= 0 ? '+' : ''}${u.p0.toFixed(1)} → ${u.p1 >= 0 ? '+' : ''}${u.p1.toFixed(1)} st${u.reduced ? ' · swallowed' : ''}${u.stress ? ' · stressed' : ''}${from}`}` : `${t.toFixed(2)} s${hz}`;
}

// ------------------------------------------------------------------ knobs
const toSlider = (p, v) => (p.log ? Math.round((1000 * Math.log(v / p.min)) / Math.log(p.max / p.min)) : v);
const fromSlider = (p, s) => (p.log ? +(p.min * Math.pow(p.max / p.min, s / 1000)).toFixed(0) : +s);
const fmt = (p, v) => `${p.int || p.log ? Math.round(v) : (+v).toFixed(p.step < 0.01 ? 3 : 2)}${p.unit && p.unit !== '#' ? ' ' + p.unit : ''}`;
const knobEls = [];

function buildKnobs() {
  const groups = {};
  for (const p of PARAMS) (groups[p.group] ??= []).push({ p, get: () => voice[p.key], set: (v) => { voice[p.key] = v; } });
  groups.effects = FX_PARAMS.map((p) => ({ p, get: () => voice.fx[p.key], set: (v) => { voice.fx[p.key] = v; } }));
  for (const [name, list] of Object.entries(groups)) {
    const fs = document.createElement('fieldset');
    fs.innerHTML = `<legend>${name}</legend>`;
    for (const k of list) {
      const { p } = k;
      const label = document.createElement('label');
      label.className = 'knob';
      label.title = p.hint || '';
      const input = Object.assign(document.createElement('input'), { type: 'range', min: p.log ? 0 : p.min, max: p.log ? 1000 : p.max, step: p.log ? 1 : p.step });
      const out = document.createElement('output');
      const span = document.createElement('span');
      span.textContent = p.label;
      label.append(span, input, out);
      input.addEventListener('input', () => { k.set(fromSlider(p, input.value)); out.textContent = fmt(p, k.get()); label.classList.toggle('changed', k.get() !== p.def); changed({ speakNow: false }); });
      input.addEventListener('change', () => changed());
      knobEls.push({ k, input, out, label });
      fs.append(label);
    }
    $('knobs').append(fs);
  }
}

function syncKnobs() {
  for (const { k, input, out, label } of knobEls) { input.value = toSlider(k.p, k.get()); out.textContent = fmt(k.p, k.get()); label.classList.toggle('changed', k.get() !== k.p.def); }
  for (const b of $('modes').children) b.setAttribute('aria-pressed', String(b.dataset.mode === voice.mode));
  $('wave').value = voice.wave;
  $('blipRow').hidden = voice.mode !== 'blip';
  $('blipLen').value = voice.blip.len; $('blipLenOut').textContent = `${voice.blip.len.toFixed(3)} s`;
  $('blipEvery').value = voice.blip.every; $('blipEveryOut').textContent = `${voice.blip.every}`;
}

function syncJson() { if (document.activeElement !== $('json')) $('json').value = JSON.stringify(compactVoice(voice), null, 1); }

function setVoice(v, note = '') {
  voice = resolveVoice(v);
  $('note').textContent = note;
  syncKnobs();
  changed();
}

// ------------------------------------------------------------------ cast (kept in this browser)
function loadCast() { try { const c = JSON.parse(localStorage.getItem(CAST_KEY) || '{}'); return c && typeof c === 'object' && !Array.isArray(c) ? c : {}; } catch { return {}; } }
function saveCast(cast) { try { localStorage.setItem(CAST_KEY, JSON.stringify(cast)); return true; } catch { return false; } }

function drawCast() {
  const cast = loadCast();
  const ul = $('cast');
  ul.textContent = '';
  const names = Object.keys(cast).sort();
  if (!names.length) { const li = document.createElement('li'); li.className = 'dim'; li.textContent = 'nobody yet — shape a voice, name it, keep it.'; ul.append(li); return; }
  for (const name of names) {
    const li = document.createElement('li');
    const label = Object.assign(document.createElement('span'), { className: 'name', textContent: name });
    const meta = Object.assign(document.createElement('span'), { className: 'dim', textContent: `${cast[name].mode ?? 'syllable'} · ${cast[name].pitch ?? 140} Hz` });
    const load = Object.assign(document.createElement('button'), { className: 'chip', textContent: 'load' });
    const del = Object.assign(document.createElement('button'), { className: 'chip', textContent: 'forget' });
    load.addEventListener('click', () => { $('preset').value = ''; $('castName').value = name; setVoice(cast[name], 'from the cast'); });
    del.addEventListener('click', () => { const c = loadCast(); delete c[name]; saveCast(c); drawCast(); });
    li.append(label, meta, load, del);
    ul.append(li);
  }
}

function download(name, bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'line';

// ------------------------------------------------------------------ bank
async function loadBankFile(file) {
  const note = $('bankNote');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let loaded = null;
    try { loaded = decodeBank(bytes); } catch { /* not a bank: treat it as plain audio below */ }
    if (!loaded) {
      note.textContent = `cutting ${file.name} into pieces and looking at each one…`;
      audio();
      const decoded = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      const mono = new Float32Array(decoded.length);
      for (let c = 0; c < decoded.numberOfChannels; c++) { const ch = decoded.getChannelData(c); for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / decoded.numberOfChannels; }
      await new Promise((r) => setTimeout(r, 30)); // let the note paint before the long think
      loaded = makeBank(mono, decoded.sampleRate, { name: file.name.replace(/[.][^.]+$/, ''), source: file.name, segmentSeconds: Number($('bankCut').value) });
    }
    useBank(loaded);
  } catch (e) { note.textContent = `could not use ${file.name}: ${e.message}`; }
}

function useBank(loaded) {
  bank = loaded;
  for (const id of ['bankCut', 'bankCutLabel', 'bankUse', 'bankSave']) $(id).hidden = false;
  // a bank cut at some other length than the three on offer still shows truthfully
  if (![...$('bankCut').options].some((o) => Number(o.value) === bank.segmentSeconds)) $('bankCut').append(new Option(`${bank.segmentSeconds} s`, String(bank.segmentSeconds)));
  $('bankCut').value = String(bank.segmentSeconds);
  $('bankOn').checked = true;
  $('bankNote').textContent = `${bank.name}: ${bank.segments.length} pieces of ${bank.segmentSeconds} s — ${Object.entries(bank.looks).map(([k, v]) => `${v.length} ${k}`).join(', ')}. pitch is now tape speed (140 = as recorded).`;
  changed();
}

// ------------------------------------------------------------------ wiring
function init() {
  const preset = $('preset');
  preset.append(new Option('(custom)', ''));
  for (const name of Object.keys(PRESETS)) preset.append(new Option(name, name));
  preset.value = 'narrator';
  preset.addEventListener('change', () => { if (preset.value) { take = 0; setVoice(preset.value, PRESETS[preset.value].note ?? ''); } });

  for (const m of MODES) { const b = Object.assign(document.createElement('button'), { textContent: m }); b.dataset.mode = m; b.addEventListener('click', () => { voice.mode = m; syncKnobs(); changed(); }); $('modes').append(b); }
  for (const w of WAVES) $('wave').append(new Option(w, w));
  $('wave').addEventListener('change', () => { voice.wave = $('wave').value; changed(); });
  $('blipLen').addEventListener('input', () => { voice.blip.len = +$('blipLen').value; syncKnobs(); changed({ speakNow: false }); });
  $('blipLen').addEventListener('change', () => changed());
  $('blipEvery').addEventListener('input', () => { voice.blip.every = +$('blipEvery').value; syncKnobs(); changed({ speakNow: false }); });
  $('blipEvery').addEventListener('change', () => changed());
  buildKnobs();

  for (const s of SAMPLES) { const b = Object.assign(document.createElement('button'), { className: 'chip', textContent: s.length > 26 ? s.slice(0, 24) + '…' : s, title: s }); b.addEventListener('click', () => { $('line').value = s; take = 0; audio(); changed(); }); $('samples').append(b); }

  $('line').addEventListener('input', () => { take = 0; changed({ speakNow: false }); });
  $('line').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); speak(); } });
  $('speak').addEventListener('click', () => speak());
  $('stop').addEventListener('click', () => { stop(); draw(); });
  $('take').addEventListener('click', () => { take++; audio(); refresh(); speak(); });
  $('wav').addEventListener('click', () => { if (!rendered) refresh(); download(`${slug($('line').value)}.${slug(voice.name)}.wav`, encodeWav(rendered.samples, rendered.sampleRate), 'audio/wav'); });
  $('bankPick').addEventListener('click', () => $('bankFile').click());
  $('bankFile').addEventListener('change', () => { const f = $('bankFile').files[0]; if (f) loadBankFile(f); $('bankFile').value = ''; });
  $('bankOn').addEventListener('change', () => changed());
  $('bankCut').addEventListener('change', () => {
    if (!bank) return;
    const want = Number($('bankCut').value);
    if (want === bank.segmentSeconds) return;
    $('bankNote').textContent = 'un-arranging the recording and cutting it again…';
    setTimeout(() => { try { useBank(recut(bank, want)); } catch (e) { $('bankNote').textContent = e.message; $('bankCut').value = String(bank.segmentSeconds); } }, 30);
  });
  $('bankSave').addEventListener('click', () => { if (bank) download(`${slug(bank.name)}.bank.wav`, encodeBank(bank), 'audio/wav'); });
  $('roll').addEventListener('click', () => { const seed = Math.floor(Math.random() * 100000); $('preset').value = ''; audio(); setVoice(randomVoice(seed), `rolled from ${seed}`); });

  $('copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('json').value); $('jsonmsg').textContent = 'copied'; } catch { $('json').select(); $('jsonmsg').textContent = 'select-all done; press Ctrl+C'; } });
  $('apply').addEventListener('click', () => { try { const v = JSON.parse($('json').value); $('preset').value = ''; setVoice(v, 'from JSON'); $('jsonmsg').textContent = 'applied'; } catch (e) { $('jsonmsg').textContent = e.message; } });

  $('castSave').addEventListener('click', () => { const name = $('castName').value.trim(); if (!name) { $('castName').focus(); return; } const c = loadCast(); c[name] = compactVoice({ ...voice, name }); if (!saveCast(c)) $('note').textContent = 'this browser refused to store it'; voice.name = name; syncJson(); drawCast(); });
  $('castExport').addEventListener('click', () => download('cast.json', JSON.stringify(loadCast(), null, 1), 'application/json'));

  $('score').addEventListener('mousemove', readout);
  $('score').addEventListener('mouseleave', () => { $('readout').textContent = ''; });
  $('score').addEventListener('click', (ev) => { if (!rendered) return; const r = $('score').getBoundingClientRect(); speak(Math.max(0, ((ev.clientX - r.left) / r.width) * (rendered.samples.length / rendered.sampleRate) - 0.02)); });
  window.addEventListener('resize', () => draw());
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { grid = null; draw(); });

  syncKnobs();
  drawCast();
  refresh();
  syncJson();
}

init();

// for driving the page from a test harness
window.babbleLab = { get voice() { return voice; }, get rendered() { return rendered; }, get bank() { return bank; }, setVoice, refresh, speak, stop, loadBankFile };
