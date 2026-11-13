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
  return () => observer.disconnect();
}
