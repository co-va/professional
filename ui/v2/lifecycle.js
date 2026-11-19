export function retainV2EdgeHost(host) {
  if (!host) return () => {};
  const next = Number(host.dataset.v2EdgeOwners || 0) + 1;
  host.dataset.v2EdgeOwners = String(next);
  host.classList.add('is-active');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = Math.max(0, Number(host.dataset.v2EdgeOwners || 1) - 1);
    if (count) host.dataset.v2EdgeOwners = String(count);
    else {
      delete host.dataset.v2EdgeOwners;
      host.classList.remove('is-active');
    }
  };
}

const v2ModalSurfaceLocks = new WeakMap();
const v2StageInteractionLocks = new WeakMap();

export function lockV2StageInteraction(app) {
  const stage = app?.querySelector?.('.v2-app__stage');
  if (!app || !stage) return null;
  const next = (v2StageInteractionLocks.get(stage) || 0) + 1;
  v2StageInteractionLocks.set(stage, next);
  stage.inert = true;
  app.classList.add('has-v2-modal');
  return stage;
}

export function unlockV2StageInteraction(app, stage) {
  if (!app || !stage) return;
  const next = Math.max(0, (v2StageInteractionLocks.get(stage) || 1) - 1);
  if (next) {
    v2StageInteractionLocks.set(stage, next);
    return;
  }
  v2StageInteractionLocks.delete(stage);
  stage.inert = false;
  app.classList.remove('has-v2-modal');
}

export function activeV2ModalSurface(root = null) {
  const explicit = root?.matches?.('[data-v2-z-layer], [data-v2-z]')
    ? root
    : root?.closest?.('[data-v2-z-layer], [data-v2-z]');
  const app = explicit?.closest?.('[data-v2-app]')
    || root?.closest?.('[data-v2-app]')
    || document.querySelector('[data-v2-app]');
  const layers = [...(app?.querySelectorAll?.('[data-v2-z-layer]') || [])];
  const topLayer = layers.at(-1);
  if (topLayer) return topLayer;
  if (explicit) return explicit;
  return app?.querySelector?.('[data-v2-front] > [data-v2-z]')
    || document.querySelector('.app-content')
    || document.querySelector('#app');
}

export function lockV2ModalSurface(host) {
  if (!host?.classList) return;
  const next = (v2ModalSurfaceLocks.get(host) || 0) + 1;
  v2ModalSurfaceLocks.set(host, next);
  host.classList.add('has-v2-layer');
}

export function unlockV2ModalSurface(host) {
  if (!host?.classList) return;
  const next = Math.max(0, (v2ModalSurfaceLocks.get(host) || 1) - 1);
  if (next) {
    v2ModalSurfaceLocks.set(host, next);
    return;
  }
  v2ModalSurfaceLocks.delete(host);
  host.classList.remove('has-v2-layer');
}
