// One shared viewport, keyboard and action-height controller for every Z, Q and X.
const EDITABLE_SELECTOR = [
  'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([disabled]):not([readonly])',
  'textarea:not([disabled]):not([readonly])',
  '[contenteditable="true"]',
].join(',');

const root = document.documentElement;
const viewport = () => window.visualViewport;
let stableHeight = 0;
let stableWidth = 0;
let revealFrame = 0;
let actionsFrame = 0;

function activeEditable() {
  const node = document.activeElement;
  return node instanceof HTMLElement && node.matches(EDITABLE_SELECTOR) ? node : null;
}

function viewportSize() {
  const vv = viewport();
  return {
    height: Math.round(vv?.height || window.innerHeight || root.clientHeight || 0),
    width: Math.round(vv?.width || window.innerWidth || root.clientWidth || 0),
    top: Number(vv?.offsetTop || 0),
  };
}

function syncViewport() {
  const { height, width, top } = viewportSize();
  if (!height || !width) return;

  // Orientation changes can change the stable size; keyboard changes only height.
  if (!stableHeight || !stableWidth || Math.abs(width - stableWidth) > 48) {
    stableHeight = height;
    stableWidth = width;
  }
  const shrinking = height < stableHeight - 60;
  const keyboardOpen = shrinking && Boolean(activeEditable() || root.classList.contains('keyboard-open'));
  if (!keyboardOpen) {
    stableHeight = height;
    stableWidth = width;
  }

  root.style.setProperty('--app-stable-vh', `${stableHeight}px`);
  root.style.setProperty('--app-stable-vw', `${stableWidth}px`);
  // VisualViewport.offsetTop accounts for Safari panning while the keyboard is shown.
  const inset = keyboardOpen ? Math.max(0, stableHeight - (top + height)) : 0;
  root.style.setProperty('--ui-keyboard-inset', `${Math.round(inset)}px`);
  root.classList.toggle('keyboard-open', keyboardOpen);
}

function scrollHostFor(node) {
  for (let parent = node?.parentElement; parent && parent !== document.body && parent !== root; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight + 1) return parent;
  }
  return null;
}

function revealEditable(node) {
  if (!node?.isConnected || document.activeElement !== node || !node.matches(EDITABLE_SELECTOR)) return;
  const host = scrollHostFor(node);
  if (!host) return; // Never scroll the application shell or a background Z.
  const rect = node.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const vv = viewport();
  const top = Number(vv?.offsetTop || 0);
  const bottom = top + Number(vv?.height || window.innerHeight || stableHeight);
  const surface = node.closest('[data-v2-layer], [data-v2-z-layer], [data-v2-z]');
  const footer = surface?.querySelector('.modal-actions:not([hidden])');
  const footerTop = footer?.getBoundingClientRect?.().top;
  const visibleTop = Math.max(hostRect.top, top) + 12;
  const visibleBottom = Math.min(hostRect.bottom, bottom, Number.isFinite(footerTop) ? footerTop : bottom) - 12;
  if (visibleBottom <= visibleTop) return;

  // Minimal immediate scroll, never smooth recentering or repeated timers.
  const distance = rect.top < visibleTop
    ? rect.top - visibleTop
    : rect.height > visibleBottom - visibleTop
      ? rect.top - visibleTop
      : rect.bottom - visibleBottom;
  if (Math.abs(distance) > 1) host.scrollBy({ top: distance, behavior: 'auto' });
}

function scheduleReveal() {
  if (revealFrame) cancelAnimationFrame(revealFrame);
  revealFrame = requestAnimationFrame(() => {
    revealFrame = 0;
    const focused = activeEditable();
    if (focused) revealEditable(focused);
  });
}

const observedActions = new Set();
const actionObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver(() => scheduleActionSync())
  : null;

function visibleAction(surface) {
  if (!surface) return null;
  return [...surface.querySelectorAll('.modal-actions:not([hidden])')]
    .reverse()
    .find((node) => node.getBoundingClientRect().height > 0 && getComputedStyle(node).display !== 'none') || null;
}

function syncActionHeights() {
  actionsFrame = 0;
  const areas = document.querySelectorAll('[data-v2-z-body], [data-v2-q-body]');
  const nextActions = new Set();
  areas.forEach((area) => {
    const action = visibleAction(area);
    if (action) nextActions.add(action);
    const height = action ? Math.ceil(action.getBoundingClientRect().height) : 0;
    const value = `${height}px`;
    if (area.style.getPropertyValue('--ui-action-height') !== value) area.style.setProperty('--ui-action-height', value);
  });
  for (const node of observedActions) {
    if (!nextActions.has(node)) actionObserver?.unobserve(node);
  }
  for (const node of nextActions) {
    if (!observedActions.has(node)) actionObserver?.observe(node);
  }
  observedActions.clear();
  nextActions.forEach((node) => observedActions.add(node));

  const app = document.querySelector('[data-v2-app]');
  if (!app) return;
  const q = [...document.querySelectorAll('[data-v2-layer][data-v2-q="true"]')].at(-1);
  const z = [...app.querySelectorAll('[data-v2-z-layer]')].at(-1)
    || app.querySelector('[data-v2-front] > [data-v2-z]');
  const active = q || z;
  const action = visibleAction(active);
  const value = `${action ? Math.ceil(action.getBoundingClientRect().height) : 0}px`;
  if (app.style.getPropertyValue('--ui-active-action-height') !== value) {
    app.style.setProperty('--ui-active-action-height', value);
  }
}

function scheduleActionSync() {
  if (actionsFrame) return;
  actionsFrame = requestAnimationFrame(syncActionHeights);
}

function onViewportChange() {
  syncViewport();
  scheduleReveal();
}

document.addEventListener('focusin', (event) => {
  if (!event.target?.matches?.(EDITABLE_SELECTOR)) return;
  onViewportChange();
});
document.addEventListener('focusout', onViewportChange);
window.addEventListener('resize', onViewportChange, { passive: true });
viewport()?.addEventListener('resize', onViewportChange, { passive: true });
viewport()?.addEventListener('scroll', onViewportChange, { passive: true });
document.addEventListener('visibilitychange', onViewportChange);

new MutationObserver(scheduleActionSync).observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['hidden', 'class'],
});
window.addEventListener('va-tools:v2-context-changed', scheduleActionSync);

syncViewport();
scheduleActionSync();
