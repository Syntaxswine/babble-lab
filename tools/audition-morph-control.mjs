import { mixMorphTake, morphKey } from './audition-morph-render.mjs';

// Settings belong to the audition, not individual voices. Keep the last
// audible result while the worker catches up with a moving morph slider.
export function createMorphControl({ createWorker, onUpdate, getRequest = (recipe) => ({ recipe }),
  remix = mixMorphTake, delay = 25, idleMs = 15000 }) {
  const states = new Map();
  let current, settings, worker, job, timer, idle, revision = 0, disposed = false;
  function retire() { clearTimeout(idle); worker?.terminate(); worker = undefined; }
  function cancel() {
    revision++; clearTimeout(timer); timer = undefined; job = undefined; retire();
  }
  const recipeFor = (state, amount = state.amount) => ({ ...state.base.recipe, babbleMorph: 2,
    settings: { ...state.base.recipe.settings, amount },
    sliceLayer: { algorithm: 'rms-overlay-v1', level: state.sliceLevel } });
  const matches = (state, recipe) => state.amount === recipe.settings.amount && state.sliceLevel === (recipe.sliceLayer?.level ?? 0);
  function apply(state, recipe, result) {
    const { clip, sceneClip, playback, morphCache, ...metrics } = result, base = state.base;
    const stem = `${base.id}-morph-${Math.round(recipe.settings.amount * 100)}pct-slices-${Math.round(recipe.sliceLayer.level * 100)}pct`;
    state.take = { ...base, ...metrics, recipe, cueData: { ...base.cueData, morph: recipe },
      clip: `${stem}.wav`, sceneClip: `${stem}.scene.wav`, recipeFile: `${stem}.morph.json`, cueFile: `${stem}.cues.json` };
    state.output = { clip, sceneClip }; state.playback = playback; state.morphCache = morphCache;
    if (recipe.settings.amount === base.recipe.settings.amount && recipe.sliceLayer.level === (base.recipe.sliceLayer?.level ?? 0)) {
      state.take = base; state.output = null;
    }
    state.status = matches(state, recipe) ? 'ready' : 'pending'; state.error = '';
    onUpdate(state);
  }
  function request() {
    const state = current;
    state.error = '';
    const desired = recipeFor(state);
    if (state.playback && matches(state, state.take.recipe)) {
      clearTimeout(timer); timer = undefined;
      state.status = 'ready'; onUpdate(state); return;
    }
    state.status = 'pending';
    if (state.morphCache?.key === morphKey(desired)) {
      clearTimeout(timer); timer = undefined;
      apply(state, desired, remix({ ...getRequest(desired), morphCache: state.morphCache })); return;
    }
    // Beeps respond immediately even while a different morph is rendering.
    if (state.playback && state.take.recipe.sliceLayer.level !== state.sliceLevel) {
      const audible = recipeFor(state, state.take.recipe.settings.amount);
      apply(state, audible, remix({ ...getRequest(audible), morphCache: state.morphCache }));
    } else onUpdate(state);
    if (job || timer !== undefined) return; // coalesce input without starving playback
    const token = revision;
    timer = setTimeout(() => {
      timer = undefined; clearTimeout(idle);
      const recipe = recipeFor(state);
      job = recipe;
      const fail = (message) => {
        if (token !== revision || disposed) return;
        cancel(); state.status = 'error'; state.error = message; onUpdate(state);
      };
      try {
        worker ??= createWorker();
        const activeWorker = worker;
        worker.onmessage = ({ data }) => {
          if (worker !== activeWorker || token !== revision || disposed) return;
          job = undefined;
          if (data.error) { fail(data.error); return; }
          // Returning to an already-audible setting must not be undone by an
          // older render that was still running when the slider moved back.
          if (!(state.playback && state.status === 'ready' && matches(state, state.take.recipe))) {
            const audible = recipeFor(state, recipe.settings.amount);
            const result = audible.sliceLayer.level === recipe.sliceLayer.level ? data.result
              : remix({ ...getRequest(audible), morphCache: data.result.morphCache });
            apply(state, audible, result);
          }
          idle = setTimeout(retire, idleMs);
          if (state.status !== 'ready') request();
        };
        worker.onerror = (event) => { event.preventDefault?.(); if (worker === activeWorker) fail(event.message || 'The audio worker stopped unexpectedly.'); };
        worker.onmessageerror = () => { if (worker === activeWorker) fail('Could not read the rendered audio.'); };
        worker.postMessage(getRequest(recipe));
      } catch (error) { fail(error.message); }
    }, delay);
  }
  return {
    get current() { return current; },
    get settings() { return settings && { ...settings }; },
    select(base) {
      if (disposed) return;
      cancel();
      if (base.engine !== 'morph') {
        current = { base, take: base, status: 'ready', output: null }; onUpdate(current); return;
      }
      settings ??= { amount: base.recipe.settings.amount, sliceLevel: base.recipe.sliceLayer?.level ?? 0 };
      if (!states.has(base.id)) states.set(base.id, { base, take: base, output: null });
      current = states.get(base.id); Object.assign(current, settings); request();
    },
    change(amount) {
      if (disposed || current?.base.engine !== 'morph') return;
      if (!Number.isFinite(amount) || amount < 0 || amount > 1) throw new Error('Morph amount must be in 0..1');
      settings.amount = current.amount = amount; request();
    },
    changeSlices(level) {
      if (disposed || current?.base.engine !== 'morph') return;
      if (!Number.isFinite(level) || level < 0 || level > 1) throw new Error('Slice layer level must be in 0..1');
      settings.sliceLevel = current.sliceLevel = level; request();
    },
    suspend() { cancel(); },
    dispose() { cancel(); disposed = true; states.clear(); current = undefined; },
  };
}
