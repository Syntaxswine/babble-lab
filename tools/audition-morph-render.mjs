// Runs in an embedded worker so a local-file audition needs no audio fetches
// and the scene controls remain responsive while the morph is calculated.
import { morphTimbre, padMorphSources } from './morph-audio.mjs';
import { mixSliceLayer } from './mix-slice-layer.mjs';
import { encodeWav } from '../src/wav.mjs';
import { db } from './analyze.mjs';

function decodeTrack(encoded) {
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  if (!bytes.length || bytes.length % 4) throw new Error('Invalid embedded morph source');
  const view = new DataView(bytes.buffer);
  return Float32Array.from({ length: bytes.length / 4 }, (_, i) => view.getFloat32(i * 4, true));
}

export function renderMorphTake({ recipe, sources, preRoll, sceneSeconds, morphCache }) {
  if (![1, 2].includes(recipe.babbleMorph) || recipe.algorithm !== 'cepstral-envelope-v1') throw new Error('Unsupported morph recipe');
  if (recipe.babbleMorph === 2 && recipe.sliceLayer?.algorithm !== 'rms-overlay-v1') throw new Error('Unsupported slice layer recipe');
  const tracks = recipe.sources.map((s) => decodeTrack(sources[s.id]));
  const [speech, slices] = recipe.sourceAlignment === 'pad-end-with-silence' ? padMorphSources(...tracks) : tracks;
  const { sampleRate } = recipe;
  if (!Number.isFinite(preRoll) || preRoll < 0 || !Number.isFinite(sceneSeconds) || sceneSeconds <= 0) throw new Error('Invalid scene timing');
  // The expensive colour transform is independent of the added layer's volume.
  // Retain one full-precision result per voice; changing only volume reuses it.
  const key = JSON.stringify([recipe.algorithm, sampleRate, recipe.settings, recipe.timing, recipe.sourceAlignment, recipe.sources]);
  const morph = morphCache?.key === key && morphCache.samples instanceof Float32Array && morphCache.samples.length === speech.length
    ? { samples: morphCache.samples, metrics: morphCache.metrics }
    : morphTimbre(speech, slices, sampleRate, { ...recipe.settings, cues: recipe.timing.cues });
  const level = recipe.babbleMorph === 2 ? recipe.sliceLayer.level : 0;
  const { samples, metrics } = mixSliceLayer(morph.samples, slices, level, recipe.settings.peakLimit ?? 0.9);
  const offset = Math.round(preRoll * sampleRate);
  const scene = new Float32Array(Math.max(Math.ceil(sceneSeconds * sampleRate), offset + samples.length));
  scene.set(samples, offset);
  return { clip: encodeWav(samples, sampleRate), sceneClip: encodeWav(scene, sampleRate),
    morphMetrics: morph.metrics, sliceLayerMetrics: metrics,
    morphCache: { key, samples: morph.samples, metrics: morph.metrics },
    peakDbFS: db(metrics.peak), rmsDbFS: db(metrics.outputRms) };
}

export function handleMorphMessage(data, reply) {
  try {
    const result = renderMorphTake(data);
    reply({ result }, [result.clip.buffer, result.sceneClip.buffer, result.morphCache.samples.buffer]);
  } catch (error) { reply({ error: error.message }); }
}
