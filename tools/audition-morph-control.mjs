// One cancellable render at a time, with a remembered setting for each pair.
// Keep the requested amount separate from the last playable/exportable take.
export function createMorphControl({ createWorker, onUpdate, getRequest = (recipe) => ({ recipe }), delay = 180 }) {
  const states = new Map();
  let current, worker, timer, revision = 0, disposed = false;
  function cancel() {
    revision++;
    clearTimeout(timer); timer = undefined;
    worker?.terminate(); worker = undefined;
  }
  function notify() { onUpdate(current); }
  function request() {
    const state = current, base = state.base, token = revision;
    state.error = '';
    if (state.amount === base.recipe.settings.amount) {
      state.take = base; state.output = null;
    }
    if (state.amount === state.take.recipe.settings.amount) {
      state.status = 'ready'; notify(); return;
    }
    state.status = 'pending'; notify();
    timer = setTimeout(() => {
      const recipe = { ...base.recipe, settings: { ...base.recipe.settings, amount: state.amount } };
      const fail = (message) => {
        if (token !== revision || disposed) return;
        cancel(); state.status = 'error'; state.error = message; notify();
      };
      try {
        worker = createWorker();
        worker.onmessage = ({ data }) => {
          if (token !== revision || disposed) return;
          if (data.error) { fail(data.error); return; }
          cancel();
          const { clip, sceneClip, ...metrics } = data.result;
          const stem = `${base.id}-${Math.round(state.amount * 100)}pct`;
          state.take = { ...base, ...metrics, recipe, cueData: { ...base.cueData, morph: recipe },
            clip: `${stem}.wav`, sceneClip: `${stem}.scene.wav`, recipeFile: `${stem}.morph.json`, cueFile: `${stem}.cues.json` };
          state.output = { clip, sceneClip }; state.status = 'ready'; notify();
        };
        worker.onerror = (event) => { event.preventDefault?.(); fail(event.message || 'The audio worker stopped unexpectedly.'); };
        worker.onmessageerror = () => fail('Could not read the rendered audio.');
        worker.postMessage(getRequest(recipe));
      } catch (error) { fail(error.message); }
    }, delay);
  }
  return {
    get current() { return current; },
    select(base) {
      if (disposed) return;
      cancel();
      if (base.engine !== 'morph') {
        current = { base, take: base, status: 'ready', output: null }; notify(); return;
      }
      if (!states.has(base.id)) states.set(base.id, { base, take: base, amount: base.recipe.settings.amount, output: null });
      current = states.get(base.id);
      request();
    },
    change(amount) {
      if (disposed || current?.base.engine !== 'morph') return;
      if (!Number.isFinite(amount) || amount < 0 || amount > 1) throw new Error('Morph amount must be in 0..1');
      cancel(); current.amount = amount; request();
    },
    suspend() { cancel(); },
    dispose() { cancel(); disposed = true; states.clear(); current = undefined; },
  };
}
