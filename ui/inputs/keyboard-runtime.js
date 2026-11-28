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
// Keep the outer shell's pre-keyboard dimensions through input changes and
// WebKit's staggered focus/viewport events. Only its work area may shrink.
let keyboardSession = false;
// Keep the last real keyboard inset through WebKit's intermediate focusout /
// focusin viewport rebounds. A short rebound must not move the Z/Q footer.
let keyboardInset = 0;
// WebKit sometimes briefly restores the entire viewport between two fields.
// Confirm a blur before releasing keyboard geometry, never per field.
let blurGraceUntil = 0;
let actionsFrame = 0;
let trackingFrame = 0;
let trackThrough = 0;
let focusFrame = 0;

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

  // The keyboard changes VisualViewport, not the physical bottom of H/Z/Q/X.
  // The layout viewport is an additional source of the pre-keyboard height.
  // Neither a focusout nor an iOS viewport rebound may make this shell shorter.
  const layoutHeight = Math.round(window.innerHeight || root.clientHeight || height);
  const focused = Boolean(activeEditable());
  const rotated = !stableHeight || !stableWidth || Math.abs(width - stableWidth) > 48;
  // A non-touch Desktop browser has no native iOS keyboard to protect.
  // Its visible window may shrink without an orientation/width change.
  const desktopViewport = width >= 768
    && window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches
    && !(window.navigator?.maxTouchPoints > 0);
  if (desktopViewport) {
    stableWidth = width;
    stableHeight = Math.min(height, layoutHeight);
    keyboardSession = false;
    keyboardInset = 0;
    blurGraceUntil = 0;
  } else if (rotated) {
    // A real orientation change starts a new coordinate space; an ordinary
    // keyboard event never changes its layout width by this amount.
    stableWidth = width;
    stableHeight = Math.max(height, layoutHeight);
    keyboardSession = false;
    keyboardInset = 0;
  } else {
    // Critical invariant: the containing block for Z/Q/X NEVER shrinks while
    // the phone stays in the same orientation. In particular, do not replace
    // it with VisualViewport.height after a delayed blur or keyboard event.
    stableHeight = Math.max(stableHeight, height, layoutHeight);
  }

  if (focused && !desktopViewport) {
    keyboardSession = true;
    blurGraceUntil = 0;
  }
  const awaitingNextField = !focused && performance.now() < blurGraceUntil;
  if (keyboardSession && !focused && !awaitingNextField
      && height >= stableHeight - 10) {
    keyboardSession = false;
  }

  const visibleInset = Math.max(0, stableHeight - height);
  if (!keyboardSession) keyboardInset = 0;
  else if (visibleInset >= 60) keyboardInset = visibleInset;
  // When WebKit briefly expands the viewport during a focus transition,
  // keep the last real inset; do not expose the underlying H background.
  const keyboardOpen = keyboardSession && keyboardInset > 0;

  setRootPixel('--app-stable-vh', stableHeight);
  setRootPixel('--app-stable-vw', stableWidth);
  // Compensate Safari's native visual viewport pan once at the app root,
  // never independently at individual Q/X surfaces.
  const visualTop = Math.max(0, Math.round(Number(viewport()?.offsetTop || 0)));
  const visualLeft = Math.max(0, Math.round(Number(viewport()?.offsetLeft || 0)));
  setRootPixel('--ui-visual-top', visualTop);
  setRootPixel('--ui-visual-left', visualLeft);
  const nextInset = keyboardOpen ? keyboardInset : 0;
  const priorInset = Number.parseFloat(root.style.getPropertyValue('--ui-keyboard-inset')) || 0;
  setRootPixel('--ui-keyboard-inset', nextInset);
  root.classList.toggle('keyboard-open', keyboardOpen);
  if (keyboardOpen && Math.abs(nextInset - priorInset) > 1) {
    scheduleActionSync();
    scheduleFocusedFieldVisibility();
  }
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

// Keyboard footer actions have two semantic roles. Commit actions can finish
// the current input; contextual/destructive/navigation actions must not float
// over the keyboard. Shared classification also handles a button whose caption
// switches dynamically (e.g. "Редактировать" -> "Применить").
// Explicit data-ui-keyboard-action="commit|auxiliary" on a button is authoritative.
const COMMIT_CAPTION = /^(?:сохранить|применить|подтвердить|оплатить|отправить)(?:\s|$|[.!,:])/iu;
function syncKeyboardFooterActions() {
  document.querySelectorAll('.modal-actions button').forEach((button) => {
    if (!button.hasAttribute('data-ui-keyboard-auto')
        && /^(?:commit|auxiliary)$/.test(button.getAttribute('data-ui-keyboard-action') || '')) return;
    const dangerous = button.classList.contains('ui-button--critical')
      || button.classList.contains('ui-button--danger')
      || button.classList.contains('ui-button--delete-outline');
    const label = (button.textContent || '').trim().replace(/\s+/g, ' ');
    const isCommit = !dangerous && (
      COMMIT_CAPTION.test(label) || button.type === 'submit'
    );
    const role = isCommit ? 'commit' : 'auxiliary';
    if (button.getAttribute('data-ui-keyboard-action') !== role) {
      button.setAttribute('data-ui-keyboard-action', role);
    }
    if (!button.hasAttribute('data-ui-keyboard-auto')) {
      button.setAttribute('data-ui-keyboard-auto', '');
    }
  });
}

function syncActionHeights() {
  actionsFrame = 0;
  syncKeyboardFooterActions();
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

/* Shared keyboard focus contract:
 * H, Z and Q headers are fixed. Only the existing Z/Q scroll body (or X
 * content) may move to reveal the focused input. Never scroll window,
 * document, app shell or the fixed modal surface itself.
 */
function keepFocusedFieldVisible() {
  focusFrame = 0;
  if (!root.classList.contains('keyboard-open')) return;
  const field = activeEditable();
  if (!field?.isConnected) return;
  const area = field.closest('[data-v2-z-body], [data-v2-q-body], .v2-layer--bottom');
  if (!area) return;
  const bounds = area.getBoundingClientRect();
  const fieldBounds = field.getBoundingClientRect();
  const vv = viewport();
  const visibleBottom = Number(vv?.offsetTop || 0) + Number(vv?.height || window.innerHeight || 0);
  const upper = bounds.top + 12;
  let lower = Math.min(bounds.bottom, visibleBottom) - 12;
  // Z/Q actions float over the form; a field must never be covered by them.
  if (!area.matches('.v2-layer--bottom')) {
    const surface = area.closest('[data-v2-z], [data-v2-z-layer], .v2-layer--standard');
    const actions = measurableAction(surface);
    if (actions && !actions.hidden && !actions.hasAttribute('data-ui-action-hidden')) {
      const actionsTop = actions.getBoundingClientRect().top;
      if (actionsTop > upper) lower = Math.min(lower, actionsTop - 12);
    }
  }
  if (lower <= upper) return;
  // A tall textarea keeps its top visible; ordinary fields fit completely.
  const tooTall = fieldBounds.height > lower - upper;
  const delta = fieldBounds.top < upper - 1
    ? fieldBounds.top - upper
    : !tooTall && fieldBounds.bottom > lower + 1
      ? fieldBounds.bottom - lower
      : 0;
  if (delta && area.scrollHeight > area.clientHeight) {
    area.scrollBy({ top: delta, behavior: 'instant' });
  }
}

function scheduleFocusedFieldVisibility() {
  if (focusFrame) return;
  focusFrame = requestAnimationFrame(keepFocusedFieldVisible);
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
  scheduleFocusedFieldVisibility();
  ensureViewportTracking(800);
});
document.addEventListener('focusout', () => {
  blurGraceUntil = performance.now() + 180;
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
