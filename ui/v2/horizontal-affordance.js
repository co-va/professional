import { compactButton } from '../buttons/index.js';

export const V2_HORIZONTAL_RAIL_SELECTOR = '[data-v2-horizontal-rail], [data-entity-card-rail], [data-mini-card-rail]';

export function isV2HorizontalGestureTarget(target) {
  // Shared gesture arbitration: a nested horizontal scroller always owns
  // its horizontal pointer gesture, regardless of whether it lives in Z or Q.
  return Boolean(target?.closest?.(
    `${V2_HORIZONTAL_RAIL_SELECTOR}, [data-v2-layer-gesture-ignore]`,
  ));
}

function affordanceMinimum(rail) {
  const value = Math.round(Number(rail?.dataset?.v2HorizontalAffordanceMin) || 2);
  return Math.max(2, value);
}

function isHorizontallyScrollable(rail) {
  return Boolean(
    rail
    && rail.children.length >= affordanceMinimum(rail)
    && rail.scrollWidth > rail.clientWidth + 1
  );
}

function currentRailItem(rail) {
  if (!rail) return null;
  return [...rail.children].find((item) => (
    item.matches?.('[data-v2-rail-current]')
    || item.querySelector?.('[data-v2-rail-current]')
  )) || null;
}

function positionCurrentRailItem(rail) {
  if (!rail || rail.dataset.v2HorizontalPositioned === 'true') return;
  const current = currentRailItem(rail);
  if (!current) return;
  rail.dataset.v2HorizontalPositioned = 'true';
  requestAnimationFrame(() => {
    if (!rail.isConnected || !current.isConnected) return;
    const target = current.offsetLeft - Math.max(0, (rail.clientWidth - current.offsetWidth) / 2);
    rail.scrollLeft = Math.max(0, target);
  });
}

function syncSection(section) {
  const rails = [...section.querySelectorAll(V2_HORIZONTAL_RAIL_SELECTOR)];
  rails.forEach(positionCurrentRailItem);
  const hasMore = rails.some(isHorizontallyScrollable);
  section.classList.toggle('has-v2-horizontal-rail', hasMore);
  rails.forEach(rail => rail.dispatchEvent(new Event('v2:rail-layout')));
}

export function syncV2HorizontalAffordances(root = document) {
  root.querySelectorAll?.('.v2-section').forEach(syncSection);
}

export function bindV2HorizontalAffordances(root) {
  if (!root?.querySelectorAll || typeof MutationObserver !== 'function') return () => {};
  let queued = false;
  const sync = () => {
    queued = false;
    if (!root.isConnected) return;
    syncV2HorizontalAffordances(root);
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(sync);
  };

  syncV2HorizontalAffordances(root);
  const observer = new MutationObserver(queue);
  observer.observe(root, { childList: true, subtree: true });
  window.addEventListener('resize', queue);
  return () => { observer.disconnect(); window.removeEventListener('resize', queue); };
}

/** Existing Desktop rail navigation, independent of card owner. */
export function bindDesktopRailControls(rail, { prefix = 'rail', label = 'карта' } = {}) {
  const section = rail?.closest('.v2-section');
  const title = section?.querySelector('.v2-section__title');
  if (!rail || !title || title.querySelector('.profile-workplace-rail-controls')) return;
  title.insertAdjacentHTML('beforeend', '<span class="profile-workplace-rail-controls" data-v2-layer-gesture-ignore>' +
    compactButton({ kind: 'previous', data: 'data-' + prefix + '-prev', aria: 'Назад: ' + label }) +
    compactButton({ kind: 'next', data: 'data-' + prefix + '-next', aria: 'Вперёд: ' + label }) + '</span>');
  section.classList.add('profile-workplace-rail-interactive');
  const nav = title.querySelector('.profile-workplace-rail-controls');
  const prev = nav.querySelector('[data-' + prefix + '-prev]');
  const next = nav.querySelector('[data-' + prefix + '-next]');
  const sync = () => {
    const max = Math.max(0, rail.scrollWidth - rail.clientWidth);
    nav.hidden = max <= 1;
    prev.disabled = rail.scrollLeft <= 1;
    next.disabled = rail.scrollLeft >= max - 1;
  };
  const step = direction => {
    const max = Math.max(0, rail.scrollWidth - rail.clientWidth);
    const first = rail.firstElementChild?.getBoundingClientRect().left || 0;
    const positions = [...new Set([0, ...[...rail.children].map(card => Math.max(0, Math.min(max, card.getBoundingClientRect().left - first))), max])].sort((a,b) => a-b);
    const target = direction > 0 ? positions.find(x => x > rail.scrollLeft + 1) : positions.slice().reverse().find(x => x < rail.scrollLeft - 1);
    if (target != null) rail.scrollTo({ left: target, behavior: 'smooth' });
  };
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  rail.addEventListener('scroll', sync, { passive: true });
  rail.addEventListener('v2:rail-layout', sync);
  requestAnimationFrame(sync);
}
