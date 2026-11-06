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
let restingVisualHeight = 0;
// Keep the outer shell's pre-keyboard dimensions through input changes and
// WebKit's staggered focus/viewport events. Only its work area may shrink.
let keyboardSession = false;
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
    // VisualViewport.width can change on iOS focus zoom/pan without rotating.
    // Rotation is a LAYOUT width change, not a keyboard-size change.
    width: Math.round(window.innerWidth || root.clientWidth || vv?.width || 0),
  };
}

function syncViewport() {
  const { height, width } = viewportSize();
  if (!height || !width) return;

  // The visual viewport is the VISIBLE area, not the physical app size.
  // In iOS standalone mode WebKit may exclude the status-bar height from
  // visualViewport AND innerHeight, leaving a dark band at the screen bottom.
  // Keep the outer H/Z/Q/X coordinate space anchored to the full screen.
  const standalone = navigator.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)')?.matches === true;
  const physicalHeight = standalone &&
    Math.abs(Number(window.screen.width || 0) - width) < 48
      ? Math.round(Number(window.screen.height || 0)) : 0;
  const layoutHeight = Math.round(window.innerHeight || root.clientHeight || 0);
  const rotated = !stableHeight || !stableWidth || Math.abs(width - stableWidth) > 48;
  if (rotated) {
    stableHeight = Math.max(height, layoutHeight, physicalHeight);
    stableWidth = width;
    restingVisualHeight = height;
    keyboardSession = false;
  }
  const focused = Boolean(activeEditable());
  if (focused) keyboardSession = true;
  // Detect keyboard relative to the *resting visual viewport*, not screen
  // height: the persistent iOS standalone status-bar delta is not a keyboard.
  const shrinking = height < restingVisualHeight - 60;
  if (!keyboardSession && !focused && height > restingVisualHeight) {
    restingVisualHeight = height;
  }
  if (!keyboardSession && !focused) {
    stableHeight = Math.max(stableHeight, layoutHeight, physicalHeight);
  }
  if (!focused && !shrinking) keyboardSession = false;
  const keyboardOpen = keyboardSession && shrinking;

  setRootPixel('--app-stable-vh', stableHeight);
  setRootPixel('--app-stable-vw', stableWidth);
  // iOS can pan its visual viewport vertically AND horizontally when
  // focusing an edge field. Apply both compensations only to the one app
  // shell: Z, Q and X continue sharing its stable coordinate space.
  const visualTop = Math.max(0, Math.round(Number(viewport()?.offsetTop || 0)));
  const visualLeft = Math.max(0, Math.round(Number(viewport()?.offsetLeft || 0)));
  setRootPixel('--ui-visual-top', visualTop);
  setRootPixel('--ui-visual-left', visualLeft);
  const inset = keyboardOpen ? Math.max(0, stableHeight - height) : 0;
  setRootPixel('--ui-keyboard-inset', inset);
  root.classList.toggle('keyboard-open', keyboardOpen);
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
