const EDITABLE_SELECTOR = [
  'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([disabled]):not([readonly])',
  'textarea:not([disabled]):not([readonly])',
  '[contenteditable="true"]',
].join(',');

const root = document.documentElement;
const viewport = () => window.visualViewport;

let stableHeight = 0;
let stableWidth = 0;

function currentViewportSize() {
  const vv = viewport();
  return {
    height: Math.round(vv?.height || window.innerHeight || root.clientHeight || 0),
    width: Math.round(vv?.width || window.innerWidth || root.clientWidth || 0),
  };
}

function activeEditable() {
  const node = document.activeElement;
  return node instanceof HTMLElement && node.matches(EDITABLE_SELECTOR) ? node : null;
}

function storeStableViewport(height, width) {
  if (height > 0) {
    stableHeight = height;
    root.style.setProperty('--app-stable-vh', `${height}px`);
  }
  if (width > 0) {
    stableWidth = width;
    root.style.setProperty('--app-stable-vw', `${width}px`);
  }
}

function syncStableViewport({ force = false } = {}) {
  const { height, width } = currentViewportSize();
  if (!stableHeight || !stableWidth) storeStableViewport(height, width);

  const focused = activeEditable();
  const reducedWhileEditing = Boolean(focused && stableHeight && height < stableHeight - 24);

  // The iOS keyboard shrinks VisualViewport. Do not feed that temporary
  // height back into the application frame; only the visible area changed.
  if (force || !reducedWhileEditing) storeStableViewport(height, width);

  const overlap = reducedWhileEditing ? Math.max(0, stableHeight - height) : 0;
  root.style.setProperty('--keyboard-overlap', `${Math.round(overlap)}px`);
  root.classList.toggle('keyboard-open', overlap > 0);
}

function scrollHostFor(node) {
  let current = node?.parentElement || null;
  while (current && current !== document.body && current !== root) {
    const style = getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight + 1) return current;
    current = current.parentElement;
  }
  return null;
}

function revealEditable(node) {
  if (!(node instanceof HTMLElement) || !node.matches(EDITABLE_SELECTOR)) return;

  const vv = viewport();
  const viewportTop = vv?.offsetTop || 0;
  const viewportBottom = viewportTop + (vv?.height || window.innerHeight || stableHeight);
  const rect = node.getBoundingClientRect();
  const margin = 24;

  if (rect.top >= viewportTop + margin && rect.bottom <= viewportBottom - margin) return;

  const host = scrollHostFor(node);
  if (!host) {
    node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    return;
  }

  const hostRect = host.getBoundingClientRect();
  const visibleTop = Math.max(hostRect.top, viewportTop) + margin;
  const visibleBottom = Math.min(hostRect.bottom, viewportBottom) - margin;
  const desiredCenter = (visibleTop + visibleBottom) / 2;
  const currentCenter = (rect.top + rect.bottom) / 2;
  host.scrollBy({ top: currentCenter - desiredCenter, behavior: 'smooth' });
}

function scheduleReveal(node) {
  window.setTimeout(() => revealEditable(node), 180);
  window.setTimeout(() => revealEditable(node), 360);
}

document.addEventListener('focusin', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.matches(EDITABLE_SELECTOR)) return;
  syncStableViewport();
  scheduleReveal(target);
});

document.addEventListener('focusout', () => {
  window.setTimeout(() => syncStableViewport(), 80);
});

// A normal tap outside the active editor dismisses the system keyboard.
// Scrolling is unaffected because a drag does not produce a normal click.
document.addEventListener('click', (event) => {
  const focused = activeEditable();
  if (!focused) return;
  const target = event.target;
  if (target instanceof Element && target.closest(EDITABLE_SELECTOR)) return;
  focused.blur();
});

window.addEventListener('resize', () => syncStableViewport(), { passive: true });
viewport()?.addEventListener('resize', () => {
  syncStableViewport();
  const focused = activeEditable();
  if (focused) scheduleReveal(focused);
}, { passive: true });
viewport()?.addEventListener('scroll', () => {
  const focused = activeEditable();
  if (focused) revealEditable(focused);
}, { passive: true });

window.addEventListener('orientationchange', () => {
  activeEditable()?.blur();
  window.setTimeout(() => {
    stableHeight = 0;
    stableWidth = 0;
    syncStableViewport({ force: true });
  }, 250);
}, { passive: true });

syncStableViewport({ force: true });
