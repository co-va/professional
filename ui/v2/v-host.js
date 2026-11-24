import { v2V } from './v.js';
import { rootApp } from './root-app.js';
import { isV2DesktopWorkspace, V2_DESKTOP_MEDIA } from './geometry.js';

function activeQSurface(app) {
  if (!app?.classList?.contains('has-v2-q-modal')) return null;
  const qLayers = [...document.querySelectorAll('[data-v2-layer][data-v2-q="true"]')]
    .filter((layer) => layer?.isConnected);
  return qLayers.at(-1) || null;
}

function activeZSurface(app) {
  const layers = [...(app?.querySelectorAll?.('[data-v2-z-layer]') || [])];
  return layers.at(-1) || app?.querySelector?.('[data-v2-front] > [data-v2-z]') || null;
}

function syncControlState(control, source) {
  if (!control || !source) return;
  const disabled = Boolean(source.disabled);
  const aria = source.getAttribute('aria-label') || 'Действия раздела';
  if (control.disabled !== disabled) control.disabled = disabled;
  if (control.getAttribute('aria-label') !== aria) control.setAttribute('aria-label', aria);
}

export function setV2V(root, options = null) {
  const app = rootApp(root);
  const host = app?.querySelector?.(':scope > [data-v2-v-host]');
  if (!host) return null;
  if (!options) {
    if (!host.firstChild && host.hidden) return null;
    if (host.firstChild) host.innerHTML = '';
    if (!host.hidden) host.hidden = true;
    return null;
  }
  host.innerHTML = v2V({ ...options, desktop: isV2DesktopWorkspace(app) });
  host.hidden = false;
  return host.querySelector?.('[data-v2-v]') || null;
}

export function clearV2V(root) {
  return setV2V(root, null);
}

export function bindV2VContext(root) {
  const app = rootApp(root);
  if (!app || typeof MutationObserver !== 'function') return () => {};
  let source = null;
  let control = null;
  let queued = false;
  let externalSurface = null;
  let externalObserver = null;
  let suspendedManualNodes = null;
  let suspendedManualHidden = true;

  const hostNode = () => app.querySelector?.(':scope > [data-v2-v-host]') || null;
  const hostControl = () => hostNode()?.querySelector?.('[data-v2-v]') || null;

  const suspendManualV = () => {
    if (suspendedManualNodes) return;
    const host = hostNode();
    if (!host) return;
    suspendedManualNodes = [...host.childNodes];
    suspendedManualHidden = Boolean(host.hidden);
    host.replaceChildren();
    host.hidden = true;
  };

  const restoreManualV = () => {
    if (!suspendedManualNodes) return false;
    const host = hostNode();
    if (!host) return false;
    host.replaceChildren(...suspendedManualNodes);
    host.hidden = suspendedManualHidden;
    suspendedManualNodes = null;
    suspendedManualHidden = true;
    return true;
  };

  const observeExternalSurface = (surface, schedule) => {
    const next = surface && !app.contains(surface) ? surface : null;
    if (next === externalSurface) return;
    externalObserver?.disconnect();
    externalObserver = null;
    externalSurface = next;
    if (!externalSurface) return;
    externalObserver = new MutationObserver(schedule);
    externalObserver.observe(externalSurface, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'disabled', 'aria-label'],
    });
  };

  const sync = () => {
    queued = false;
    if (!app.isConnected) return;
    const qSurface = activeQSurface(app);
    if (!qSurface && suspendedManualNodes) {
      restoreManualV();
      source = null;
      control = null;
      return;
    }

    const surface = qSurface || activeZSurface(app);
    observeExternalSurface(surface, schedule);
    const nextSource = surface?.querySelector?.('[data-workspace-v-action]') || null;
    const currentControl = hostControl();

    if (currentControl && currentControl !== control) {
      if (qSurface) {
        suspendManualV();
      } else {
        source = nextSource;
        control = null;
        return;
      }
    }

    if (!nextSource || nextSource.hidden) {
      if (control?.isConnected) clearV2V(app);
      source = nextSource;
      control = null;
      return;
    }

    if (nextSource === source && control?.isConnected && control.classList.contains('v2-desktop-v') === isV2DesktopWorkspace(app)) {
      syncControlState(control, source);
      return;
    }

    source = nextSource;
    control = setV2V(app, { aria: source.getAttribute('aria-label') || 'Действия раздела' });
    if (control) {
      syncControlState(control, source);
      control.addEventListener('click', () => {
        if (!source?.isConnected || source.disabled) return;
        const anchor = control;
        if (anchor?.classList.contains('v2-desktop-v')) {
          source.v2DesktopAnchor = anchor;
          anchor.focus({ preventScroll: true });
        }
        try { source.click(); } finally { delete source.v2DesktopAnchor; }
      });
    }
  };

  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(sync);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(app, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'disabled', 'aria-label'],
  });
  window.addEventListener('va-tools:v2-context-changed', schedule);
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(V2_DESKTOP_MEDIA) : null;
  media?.addEventListener?.('change', schedule);
  sync();
  return () => {
    observer.disconnect();
    externalObserver?.disconnect();
    externalObserver = null;
    externalSurface = null;
    window.removeEventListener('va-tools:v2-context-changed', schedule);
    media?.removeEventListener?.('change', schedule);
    if (!restoreManualV() && control?.isConnected && hostControl() === control) clearV2V(app);
    source = null;
    control = null;
  };
}
