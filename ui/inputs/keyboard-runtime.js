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
let actionsFrame = 0;
let trackingFrame = 0;
let trackThrough = 0;

function setRootPixel(name, value) {
  const next = `${Math.round(value)}px`;
  if (root.style.getPropertyValue(name) !== next) root.style.setProperty(name, next);
}

function activeEditable() {
  const node = document.activeElement;
  return node instanceof HTMLElement && node.matches(EDITABLE_SELECTOR) ? node : null;
}

function viewportSize() {
  const vv = viewport();
  return {
    height: Math.round(vv?.height || window.innerHeight || root.clientHeight || 0),
    width: Math.round(vv?.width || window.innerWidth || root.clientWidth || 0),
  };
}

function syncViewport() {
  const { height, width } = viewportSize();
  if (!height || !width) return;

  // Orientation changes can change the stable size; keyboard changes only height.
  if (!stableHeight || !stableWidth || Math.abs(width - stableWidth) > 48) {
    stableHeight = height;
    stableWidth = width;
  }
  const shrinking = height < stableHeight - 60;
  const keyboardOpen = shrinking && Boolean(activeEditable() || performance.now() < trackThrough);
  if (!keyboardOpen && height >= stableHeight - 60) {
    stableHeight = height;
    stableWidth = width;
  }

  setRootPixel('--app-stable-vh', stableHeight);
  setRootPixel('--app-stable-vw', stableWidth);
  // In iOS WebKit the *visual* viewport can pan while document.scrollTop
  // remains zero. Compensate only at the one fixed application root:
  // its SCREEN position is (layout top - visualViewport.offsetTop).
  // Q/X are app-owned portals and inherit the exact same offset.
  const visualTop = keyboardOpen
    ? Math.max(0, Math.round(Number(viewport()?.offsetTop || 0)))
    : 0;
  setRootPixel('--ui-visual-top', visualTop);
  const inset = keyboardOpen ? Math.max(0, stableHeight - height) : 0;
  setRootPixel('--ui-keyboard-inset', inset);
  root.classList.toggle('keyboard-open', keyboardOpen);
}

// Reveal the focused field by scrolling its owner body only, never Z/Q/H.
// Clamp to the real last item; iOS cannot extend the scroll beyond content.
function syncFocusedFieldVisibility() {
  if (!root.classList.contains('keyboard-open')) return;
  const field = activeEditable();
  const body = field?.closest?.('[data-v2-q-body], [data-v2-z-body]');
  if (!body) return;
  const area = body.getBoundingClientRect();
  const rect = field.getBoundingClientRect();
  const top = area.top + 12;
  const bottom = area.bottom - 16;
  if (bottom <= top) return;
  let shift = 0;
  if (rect.height > bottom - top) shift = rect.top - top;
  else if (rect.bottom > bottom) shift = rect.bottom - bottom;
  else if (rect.top < top) shift = rect.top - top;
  if (Math.abs(shift) <= 2) return;
  const limit = Math.max(0, body.scrollHeight - body.clientHeight);
  body.scrollTop = Math.max(0, Math.min(limit, body.scrollTop + shift));
}

const observedActions = new Set();
const actionObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver(() => scheduleActionSync())
  : null;

function measurableAction(surface) {
  if (!surface) return null;
  // A hidden Q/Z footer remains measurable so editing does not suddenly
  // increase the inner scroll surface's height when Save first appears.
  return [...surface.querySelectorAll('.modal-actions')]
    .reverse()
    .find((node) => node.getBoundingClientRect().height > 0 && getComputedStyle(node).display !== 'none') || null;
}

function syncActionHeights() {
  actionsFrame = 0;
  const areas = document.querySelectorAll('[data-v2-z-body], [data-v2-q-body]');
  const nextActions = new Set();
  areas.forEach((area) => {
    const action = measurableAction(area);
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
  const action = measurableAction(active);
  const value = `${action && !action.hidden && !action.hasAttribute('data-ui-action-hidden') ? Math.ceil(action.getBoundingClientRect().height) : 0}px`;
  if (app.style.getPropertyValue('--ui-active-action-height') !== value) {
    app.style.setProperty('--ui-active-action-height', value);
  }
}

function scheduleActionSync() {
  if (actionsFrame) return;
  actionsFrame = requestAnimationFrame(syncActionHeights);
}

// Some WebKit versions dispatch visualViewport.scroll only AFTER a native pan.
 // During a keyboard interaction, read its offset once per animation frame.
 // This is the SAME root anchor, not a per-form scroll or animation.
function followVisualViewport() {
  trackingFrame = 0;
  if (document.visibilityState === 'hidden') return;
  syncViewport();
  syncFocusedFieldVisibility();
  if ((activeEditable() && root.classList.contains('keyboard-open'))
    || performance.now() < trackThrough) {
    trackingFrame = requestAnimationFrame(followVisualViewport);
  }
}

function ensureViewportTracking(milliseconds = 0) {
  trackThrough = Math.max(trackThrough, performance.now() + milliseconds);
  if (!trackingFrame && document.visibilityState !== 'hidden') {
    trackingFrame = requestAnimationFrame(followVisualViewport);
  }
}

function onViewportChange() {
  syncViewport();
  if (root.classList.contains('keyboard-open')) ensureViewportTracking();
}

document.addEventListener('focusin', (event) => {
  if (!event.target?.matches?.(EDITABLE_SELECTOR)) return;
  onViewportChange();
  ensureViewportTracking(800);
});
document.addEventListener('focusout', () => {
  onViewportChange();
  ensureViewportTracking(500);
});
window.addEventListener('resize', onViewportChange, { passive: true });
viewport()?.addEventListener('resize', onViewportChange, { passive: true });
viewport()?.addEventListener('scroll', onViewportChange, { passive: true });
document.addEventListener('visibilitychange', onViewportChange);

new MutationObserver(scheduleActionSync).observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['hidden', 'class', 'data-ui-action-hidden'],
});
window.addEventListener('va-tools:v2-context-changed', scheduleActionSync);

syncViewport();
scheduleActionSync();
