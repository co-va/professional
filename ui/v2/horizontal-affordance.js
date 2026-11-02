const RAIL_SELECTOR = '[data-v2-horizontal-rail], [data-entity-card-rail], [data-mini-card-rail]';

function syncSection(section) {
  const rails = [...section.querySelectorAll(RAIL_SELECTOR)];
  const hasMore = rails.some((rail) => rail.children.length > 1);
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
