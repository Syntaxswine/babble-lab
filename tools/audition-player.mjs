// A silent WAV keeps the native audio element as the scene clock/transport.
// Sound comes from Web Audio buffers at that position, with brief crossfades.
// Changing sound never reloads the transport or assigns its currentTime.
export function createAuditionPlayer({ audio, createContext = () => new AudioContext() }) {
  let context, volume, payload, buffer, anchor, disposed = false;
  const playing = new Set();
  const rampSeconds = 0.02;
  function ramp(param, value, now, duration = rampSeconds) {
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else { const held = param.value; param.cancelScheduledValues(now); param.setValueAtTime(held, now); }
    param.linearRampToValueAtTime(value, now + duration);
  }
  function makeBuffer() {
    if (!payload || !context) return;
    const { samples, sampleRate, preRoll, sceneSeconds } = payload;
    const offset = Math.round(preRoll * sampleRate);
    buffer = context.createBuffer(1, Math.max(Math.ceil(sceneSeconds * sampleRate), offset + samples.length), sampleRate);
    buffer.copyToChannel(samples, 0, offset);
  }
  function ensure() {
    if (disposed) throw new Error('Audio player is closed');
    if (context) return context;
    context = createContext();
    volume = context.createGain(); volume.gain.value = audio.muted ? 0 : audio.volume;
    volume.connect(context.destination); makeBuffer();
    return context;
  }
  function stop() {
    for (const entry of playing) {
      entry.source.onended = null; entry.source.stop(); entry.source.disconnect(); entry.gain.disconnect();
    }
    playing.clear();
    anchor = undefined;
  }
  function swap() {
    if (!context || !buffer || audio.paused || audio.ended || audio.seeking || disposed) return;
    const rate = audio.playbackRate || 1, now = context.currentTime, when = now + 0.005;
    // Anchor once on play/seek, then use the audio clock for all replacements.
    // Rounded media-element timestamps must not shift the waveform's phase.
    anchor ??= { time: now, offset: audio.currentTime, rate };
    const offset = anchor.offset + (when - anchor.time) * anchor.rate;
    if (offset >= buffer.duration) return;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; source.playbackRate.value = rate;
    source.connect(gain); gain.connect(volume);
    gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(1, when + rampSeconds);
    for (const entry of playing) if (!entry.fading) {
      entry.fading = true;
      ramp(entry.gain.gain, 0, when);
      entry.source.stop(when + rampSeconds);
    }
    const entry = { source, gain, fading: false }; playing.add(entry);
    source.onended = () => { source.disconnect(); gain.disconnect(); playing.delete(entry); };
    source.start(when, offset);
  }
  return {
    ensure,
    select() { stop(); payload = buffer = undefined; },
    update(next) {
      if (payload === next) return;
      payload = next; makeBuffer(); swap();
    },
    async play() {
      await ensure().resume();
      if (!audio.paused && !disposed) { stop(); swap(); }
    },
    pause: stop,
    seek() { stop(); swap(); },
    volume() { if (volume) ramp(volume.gain, audio.muted ? 0 : audio.volume, context.currentTime); },
    async suspend() { stop(); if (context && !disposed) await context.suspend(); },
    async dispose() {
      stop(); disposed = true; payload = buffer = undefined;
      volume?.disconnect();
      if (context) await context.close();
    },
  };
}
