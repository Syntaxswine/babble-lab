// Runs in an embedded worker so a local-file audition needs no audio fetches
// and the scene controls remain responsive while the morph is calculated.
import { prepareTimbreMorph, renderPreparedMorph, padMorphSources } from './morph-audio.mjs';
import { mixSliceLayer } from './mix-slice-layer.mjs';
import { encodeWav } from '../src/wav.mjs';
import { db } from './analyze.mjs';

export function decodeTrack(encoded) {
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  if (!bytes.length || bytes.length % 4) throw new Error('Invalid embedded morph source');
  const view = new DataView(bytes.buffer);
  return Float32Array.from({ length: bytes.length / 4 }, (_, i) => view.getFloat32(i * 4, true));
}

export function morphKey(recipe) {
  return JSON.stringify([recipe.algorithm, recipe.sampleRate, recipe.settings, recipe.timing, recipe.sourceAlignment, recipe.sources]);
}

// Also used on the UI thread: mixing an already-rendered voice is inexpensive,
// so the beeps slider does not have to wait for spectral work in the worker.
export function mixMorphTake({ recipe, preRoll, sceneSeconds, morphCache }) {
  const { sampleRate } = recipe, level = recipe.babbleMorph === 2 ? recipe.sliceLayer.level : 0;
  if (!Number.isFinite(preRoll) || preRoll < 0 || !Number.isFinite(sceneSeconds) || sceneSeconds <= 0) throw new Error('Invalid scene timing');
  const { samples, metrics } = mixSliceLayer(morphCache.samples, morphCache.colour, level, recipe.settings.peakLimit ?? 0.9);
  const offset = Math.round(preRoll * sampleRate);
  const scene = new Float32Array(Math.max(Math.ceil(sceneSeconds * sampleRate), offset + samples.length));
  scene.set(samples, offset);
  return { clip: encodeWav(samples, sampleRate), sceneClip: encodeWav(scene, sampleRate),
    playback: { samples, sampleRate, preRoll, sceneSeconds },
    morphMetrics: morphCache.metrics, sliceLayerMetrics: metrics, morphCache,
    peakDbFS: db(metrics.peak), rmsDbFS: db(metrics.outputRms) };
}

export function renderMorphTake({ recipe, sources, preRoll, sceneSeconds, morphCache }, analysisCache = {}) {
  if (![1, 2].includes(recipe.babbleMorph) || recipe.algorithm !== 'cepstral-envelope-v1') throw new Error('Unsupported morph recipe');
  if (recipe.babbleMorph === 2 && recipe.sliceLayer?.algorithm !== 'rms-overlay-v1') throw new Error('Unsupported slice layer recipe');
  const { sampleRate } = recipe;
  const key = morphKey(recipe);
  if (morphCache?.key === key && morphCache.samples instanceof Float32Array && morphCache.colour instanceof Float32Array) {
    return mixMorphTake({ recipe, preRoll, sceneSeconds, morphCache });
  }
  const { amount, ...fixedSettings } = recipe.settings;
  const analysisKey = morphKey({ ...recipe, settings: fixedSettings });
  if (analysisCache.key !== analysisKey) {
    const tracks = recipe.sources.map((s) => decodeTrack(sources[s.id]));
    const [speech, slices] = recipe.sourceAlignment === 'pad-end-with-silence' ? padMorphSources(...tracks) : tracks;
    analysisCache.prepared = prepareTimbreMorph(speech, slices, sampleRate, { ...recipe.settings, cues: recipe.timing.cues });
    analysisCache.colour = slices; analysisCache.key = analysisKey;
  }
  const morph = renderPreparedMorph(analysisCache.prepared, amount);
  return mixMorphTake({ recipe, preRoll, sceneSeconds,
    morphCache: { key, samples: morph.samples, colour: analysisCache.colour.slice(), metrics: morph.metrics } });
}

export function handleMorphMessage(data, reply, analysisCache) {
  try {
    const result = renderMorphTake(data, analysisCache);
    reply({ result }, [result.clip.buffer, result.sceneClip.buffer, result.playback.samples.buffer, result.morphCache.samples.buffer, result.morphCache.colour.buffer]);
  } catch (error) { reply({ error: error.message }); }
}
