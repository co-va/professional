import { escapeHtml } from '../utils/escape-html.js';

function columnLines(lines = []) {
  return (Array.isArray(lines) ? lines : []).slice(0, 3).map((line) => {
    const item = line && typeof line === 'object' && !Array.isArray(line) ? line : { value: line };
    const value = escapeHtml(item.value ?? '');
    const classes = ['list-entry__column-line', item.strong ? 'is-strong' : '', item.muted ? 'is-muted' : '', item.className || ''].filter(Boolean).join(' ');
    return `<span class="${classes}">${value || '&nbsp;'}</span>`;
  }).join('');
}

/**
 * Canonical V2 compact entry used by entity lists.
 * V2 List Entry is intentionally separate from entityCard(): it renders one
 * item inside a list; entityCard() renders the opened entity.
 *
 * `columns` is the canonical dense 3-line list form. It supports up to
 * three columns, each with up to three lines, without creating a feature-
 * specific list component.
 */
export function v2ListEntry({
  overline = '',
  title = '',
  subtitle = '',
  omitEmptySubtitle = false,
  rightTop = '',
  rightBottom = '',
  columns = [],
  image = '',
  initial = '?',
  leadingSwatch = '',
  interactive = true,
  data = '',
  className = '',
  aria = '',
  actionData = '',
  actionAria = '',
  actionIcon = '⚙',
  toggleData = '',
  toggleAria = '',
  toggleChecked = false,
  toggleDisabled = false,
  deleteData = '',
  deleteAria = 'Удалить',
  reorderHandle = false,
  reorderAria = 'Переместить',
  selectable = false,
  selected = false
} = {}) {
  const columnValues = (Array.isArray(columns) ? columns : []).slice(0, 3);
  const columnMode = columnValues.length > 0;
  const tag = interactive ? 'button' : 'div';
  const attrs = interactive
    ? `type="button" ${data} aria-pressed="${selected ? 'true' : 'false'}" ${aria ? `aria-label="${escapeHtml(aria)}"` : ''}`
    : '';
  const style = image ? ` style="--list-entry-image:url('${escapeHtml(image)}')"` : '';
  const secondLine = subtitle || '\u00a0';
  const subtitleHtml = subtitle || !omitEmptySubtitle ? `<small>${escapeHtml(secondLine)}</small>` : '';
  const swatch = leadingSwatch ? `<span class="list-entry__swatch" style="--list-entry-swatch:${escapeHtml(leadingSwatch)}" aria-hidden="true"></span>` : '';
  const right = rightTop || rightBottom
    ? `<span class="list-entry__right">${rightTop ? `<strong>${escapeHtml(rightTop)}</strong>` : ''}${rightBottom ? `<small>${escapeHtml(rightBottom)}</small>` : ''}</span>`
    : '';
  const action = actionData
    ? `<span class="list-entry__action" ${actionData} ${actionAria ? `aria-label="${escapeHtml(actionAria)}"` : ''} role="button" tabindex="0">${escapeHtml(actionIcon)}</span>`
    : '';
  const toggleAction = toggleData
    ? `<button type="button" class="list-entry__toggle${toggleChecked ? ' is-on' : ''}" ${toggleData} aria-pressed="${toggleChecked ? 'true' : 'false'}"${toggleAria ? ` aria-label="${escapeHtml(toggleAria)}"` : ''}${toggleDisabled ? ' disabled' : ''}><span class="app-setting-toggle__switch${toggleChecked ? ' is-on' : ''}" aria-hidden="true"><span></span></span></button>`
    : '';
  const deleteAction = deleteData
    ? `<span class="list-entry__delete" data-delete-action="${escapeHtml(deleteData)}" aria-label="${escapeHtml(deleteAria)}">×</span>`
    : '';
  const reorderAction = reorderHandle
    ? `<span class="list-entry__reorder-handle" data-reorder-handle role="button" tabindex="0" aria-label="${escapeHtml(reorderAria)}"><span aria-hidden="true">⋮⋮</span></span>`
    : '';
  const selectionAction = selectable
    ? `<span class="list-entry__selector" aria-hidden="true"></span>`
    : '';
  const firstLine = overline ? `<strong>${escapeHtml(overline)}</strong>` : '';
  const classes = ['list-entry', image ? 'has-image' : '', columnMode ? 'list-entry--columns' : '', selectable ? 'is-selectable' : '', selected ? 'is-selected' : '', className].filter(Boolean).join(' ');

  if (columnMode) {
    return `<${tag} class="${classes}"${attrs}${style}>
      <span class="list-entry__background" aria-hidden="true"></span>
      <span class="list-entry__content">
        ${reorderAction}${swatch}<span class="list-entry__columns">${columnValues.map((column, index) => `<span class="list-entry__column list-entry__column--${index + 1}">${columnLines(column)}</span>`).join('')}</span>
        ${action}${deleteAction}${selectionAction}
      </span>
    </${tag}>`;
  }

  return `<${tag} class="${classes}"${attrs}${style}>
    <span class="list-entry__background" aria-hidden="true">${image ? '' : `<span>${escapeHtml(initial)}</span>`}</span>
    <span class="list-entry__content">
      ${reorderAction}<span class="list-entry__main${swatch ? ' has-swatch' : ''}">${swatch}<span class="list-entry__text">${firstLine}<strong>${escapeHtml(title)}</strong>${subtitleHtml}</span></span>
      ${right}${toggleAction}${action}${deleteAction}${selectionAction}
    </span>
  </${tag}>`;
}

export function v2ListEntries(items = []) {
  return `<div class="list-entries">${(Array.isArray(items) ? items : []).join('')}</div>`;
}

/**
 * Shared long-press reorder interaction for an existing V2 list.
 * It does not draw another list or reorder UI: the existing list entries are
 * moved in place after a deliberate hold, then the caller receives the new IDs.
 */
export function initV2ListReorder(root, {
  selector = '[data-reorder-id]',
  idAttribute = 'reorderId',
  handleSelector = '[data-reorder-handle]',
  onReorder = () => {},
  onError = () => {},
} = {}) {
  const host = root?.matches?.('.list-entries') ? root : root?.querySelector?.('.list-entries');
  if (!host) return () => {};

  const entries = () => [...host.querySelectorAll(selector)];
  const valueOf = (node) => String(node?.dataset?.[idAttribute] || '');
  const currentIds = () => entries().map(valueOf).filter(Boolean);

  let gesture = null;
  let target = null;
  let beforeTarget = true;
  let scrollFrame = 0;
  let saving = false;
  let suppressClick = false;

  const findScroller = (node) => {
    let parent = node?.parentElement;
    while (parent) {
      const css = getComputedStyle(parent);
      if (/(auto|scroll)/.test(css.overflowY) && parent.scrollHeight > parent.clientHeight) return parent;
      parent = parent.parentElement;
    }
    return null;
  };

  const clearTarget = () => {
    target?.classList.remove('is-reorder-target-before', 'is-reorder-target-after');
    target = null;
  };

  // The dragged row remains in its original DOM slot until release.
  // Moving it on every pointermove detached the captured iOS pointer and
  // made Z scroll/paint stutter. Only the row's visual transform changes.
  const showPosition = () => {
    if (!gesture?.dragging) return;
    const delta = gesture.y - gesture.startY
      + (gesture.scroller ? gesture.scroller.scrollTop - gesture.startScrollTop : 0);
    gesture.node.style.setProperty('--list-entry-drag-y', `${delta}px`);

    const hit = document.elementFromPoint?.(gesture.x, gesture.y);
    let nearest = hit?.closest?.(selector);
    if (!nearest || nearest === gesture.node || !host.contains(nearest)) {
      // Gaps between entries and list edges are legitimate drop locations.
      let distance = Infinity;
      nearest = null;
      for (const candidate of entries()) {
        if (candidate === gesture.node) continue;
        const rect = candidate.getBoundingClientRect();
        const gap = gesture.y < rect.top ? rect.top - gesture.y
          : gesture.y > rect.bottom ? gesture.y - rect.bottom : 0;
        if (gap < distance) { distance = gap; nearest = candidate; }
      }
    }
    if (!nearest) { clearTarget(); return; }
    const rect = nearest.getBoundingClientRect();
    const nextBefore = gesture.y < rect.top + rect.height / 2;
    if (target === nearest && beforeTarget === nextBefore) return;
    clearTarget();
    target = nearest;
    beforeTarget = nextBefore;
    target.classList.add(nextBefore ? 'is-reorder-target-before' : 'is-reorder-target-after');
  };

  const stopScroll = () => {
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
  };

  const scrollNearEdge = () => {
    scrollFrame = 0;
    const scroller = gesture?.scroller;
    if (!gesture?.dragging || !scroller) return;
    const rect = scroller.getBoundingClientRect();
    const edge = 54;
    const above = Math.max(0, rect.top + edge - gesture.y);
    const below = Math.max(0, gesture.y - (rect.bottom - edge));
    const speed = above ? -Math.min(16, 3 + above / 4)
      : below ? Math.min(16, 3 + below / 4) : 0;
    if (!speed) return;
    const previous = scroller.scrollTop;
    scroller.scrollTop += speed;
    if (scroller.scrollTop !== previous) {
      showPosition();
      scrollFrame = requestAnimationFrame(scrollNearEdge);
    }
  };

  const resetGesture = () => {
    stopScroll();
    clearTarget();
    if (gesture) {
      const { node, handle, pointerId } = gesture;
      try {
        if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
      } catch {}
      node.style.removeProperty('--list-entry-drag-y');
      node.classList.remove('is-reordering');
    }
    host.classList.remove('is-reordering');
    gesture = null;
  };

  const restoreOrder = (originalIds) => {
    if (!host.isConnected) return;
    const lookup = new Map(entries().map(node => [valueOf(node), node]));
    for (const id of originalIds) {
      const node = lookup.get(id);
      if (node) host.appendChild(node);
    }
  };

  const commit = (originalIds) => {
    const ids = currentIds();
    if (ids.length !== originalIds.length || ids.every((id, i) => id === originalIds[i])) return;
    saving = true;
    // The caller persists once after release. Never redraw an entire Z or Q.
    Promise.resolve().then(() => onReorder(ids)).then((result) => {
      if (result === false) throw new Error('Не удалось сохранить порядок.');
    }).catch((error) => {
      restoreOrder(originalIds);
      onError(error);
    }).finally(() => { saving = false; });
  };

  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (saving || gesture) return;
    const handle = event.target.closest?.(handleSelector);
    if (!handle || !host.contains(handle)) { suppressClick = false; return; }
    const node = handle.closest?.(selector);
    if (!node || !host.contains(node)) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick = true;
    gesture = {
      node, handle, pointerId: event.pointerId,
      startY: event.clientY, y: event.clientY, x: event.clientX,
      scroller: findScroller(host), startScrollTop: 0, dragging: false,
      originalIds: currentIds(),
    };
    gesture.startScrollTop = gesture.scroller?.scrollTop || 0;
    try { handle.setPointerCapture?.(event.pointerId); } catch {}
  };

  const onPointerMove = (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    if (!gesture.dragging && Math.abs(gesture.y - gesture.startY) < 4) return;
    if (!gesture.dragging) {
      gesture.dragging = true;
      gesture.node.classList.add('is-reordering');
      host.classList.add('is-reordering');
    }
    showPosition();
    if (!scrollFrame) scrollFrame = requestAnimationFrame(scrollNearEdge);
  };

  const onPointerUp = (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const { node, originalIds, dragging } = gesture;
    const drop = target;
    const before = beforeTarget;
    resetGesture();
    if (!dragging || !drop || drop === node) return;
    host.insertBefore(node, before ? drop : drop.nextSibling);
    commit(originalIds);
  };

  const onPointerCancel = (event) => {
    if (gesture && event.pointerId === gesture.pointerId) resetGesture();
  };

  const onClick = (event) => {
    if (suppressClick || event.target.closest?.(handleSelector)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClick = false;
    }
  };

  const onKeyDown = (event) => {
    const handle = event.target.closest?.(handleSelector);
    if (!handle || !host.contains(handle) || saving) return;
    const node = handle.closest?.(selector);
    const all = entries();
    const index = all.indexOf(node);
    const change = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!change || index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const next = Math.max(0, Math.min(all.length - 1, index + change));
    if (next === index) return;
    const originalIds = currentIds();
    if (change < 0) host.insertBefore(node, all[next]);
    else host.insertBefore(node, all[next].nextSibling);
    handle.focus();
    commit(originalIds);
  };

  host.addEventListener('pointerdown', onPointerDown, { passive: false });
  host.addEventListener('pointermove', onPointerMove, { passive: false });
  host.addEventListener('pointerup', onPointerUp, { passive: false });
  host.addEventListener('pointercancel', onPointerCancel);
  host.addEventListener('lostpointercapture', onPointerCancel);
  host.addEventListener('click', onClick, true);
  host.addEventListener('keydown', onKeyDown, true);

  return () => {
    resetGesture();
    host.removeEventListener('pointerdown', onPointerDown);
    host.removeEventListener('pointermove', onPointerMove);
    host.removeEventListener('pointerup', onPointerUp);
    host.removeEventListener('pointercancel', onPointerCancel);
    host.removeEventListener('lostpointercapture', onPointerCancel);
    host.removeEventListener('click', onClick, true);
    host.removeEventListener('keydown', onKeyDown, true);
  };
}
