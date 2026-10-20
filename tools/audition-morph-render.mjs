// Runs in an embedded worker so a local-file audition needs no audio fetches
// and the scene controls remain responsive while the morph is calculated.
import { morphTimbre } from './morph-audio.mjs';
import { encodeWav } from '../src/wav.mjs';
import { db } from './analyze.mjs';

function decodeTrack(encoded) {
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  if (!bytes.length || bytes.length % 4) throw new Error('Invalid embedded morph source');
  const view = new DataView(bytes.buffer);
  return Float32Array.from({ length: bytes.length / 4 }, (_, i) => view.getFloat32(i * 4, true));
}

export function renderMorphTake({ recipe, sources, preRoll, sceneSeconds }) {
  if (recipe.babbleMorph !== 1 || recipe.algorithm !== 'cepstral-envelope-v1') throw new Error('Unsupported morph recipe');
  const [speech, slices] = recipe.sources.map((s) => decodeTrack(sources[s.id]));
  const { sampleRate } = recipe;
  if (!Number.isFinite(preRoll) || preRoll < 0 || !Number.isFinite(sceneSeconds) || sceneSeconds <= 0) throw new Error('Invalid scene timing');
  const { samples, metrics } = morphTimbre(speech, slices, sampleRate, { ...recipe.settings, cues: recipe.timing.cues });
  const offset = Math.round(preRoll * sampleRate);
  const scene = new Float32Array(Math.max(Math.ceil(sceneSeconds * sampleRate), offset + samples.length));
  scene.set(samples, offset);
  return { clip: encodeWav(samples, sampleRate), sceneClip: encodeWav(scene, sampleRate),
    morphMetrics: metrics, peakDbFS: db(metrics.peak), rmsDbFS: db(metrics.outputRms) };
}

export function handleMorphMessage(data, reply) {
  try {
    const result = renderMorphTake(data);
    reply({ result }, [result.clip.buffer, result.sceneClip.buffer]);
  } catch (error) { reply({ error: error.message }); }
}
