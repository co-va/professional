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
        ${reorderAction}<span class="list-entry__columns">${columnValues.map((column, index) => `<span class="list-entry__column list-entry__column--${index + 1}">${columnLines(column)}</span>`).join('')}</span>
        ${action}${deleteAction}${selectionAction}
      </span>
    </${tag}>`;
  }

  return `<${tag} class="${classes}"${attrs}${style}>
    <span class="list-entry__background" aria-hidden="true">${image ? '' : `<span>${escapeHtml(initial)}</span>`}</span>
    <span class="list-entry__content">
      ${reorderAction}<span class="list-entry__main${swatch ? ' has-swatch' : ''}">${swatch}<span class="list-entry__text">${firstLine}<strong>${escapeHtml(title)}</strong><small>${escapeHtml(secondLine)}</small></span></span>
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
} = {}) {
  const host = root?.matches?.('.list-entries') ? root : root?.querySelector?.('.list-entries');
  if (!host) return () => {};

  let active = null;
  let handle = null;
  let pointerId = null;

  const entries = () => [...host.querySelectorAll(selector)];
  const valueOf = (node) => String(node?.dataset?.[idAttribute] || '');

  const finish = (commit = false) => {
    const node = active;
    if (handle && pointerId != null) {
      try {
        if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
      } catch {}
    }
    active?.classList.remove('is-reordering');
    host.classList.remove('is-reordering');
    active = null;
    handle = null;
    pointerId = null;
    if (commit && node) {
      const ids = entries().map(valueOf).filter(Boolean);
      if (ids.length) onReorder(ids);
    }
  };

  const moveActive = (clientY) => {
    if (!active) return;
    const candidates = entries().filter((node) => node !== active);
    const target = candidates.find((node) => {
      const rect = node.getBoundingClientRect();
      return clientY >= rect.top && clientY <= rect.bottom;
    });
    if (!target) return;
    const rect = target.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) host.insertBefore(active, target);
    else host.insertBefore(active, target.nextSibling);
  };

  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const nextHandle = event.target.closest?.(handleSelector);
    if (!nextHandle || !host.contains(nextHandle)) return;
    const node = nextHandle.closest?.(selector);
    if (!node || !host.contains(node)) return;

    event.preventDefault();
    event.stopPropagation();
    active = node;
    handle = nextHandle;
    pointerId = event.pointerId;
    active.classList.add('is-reordering');
    host.classList.add('is-reordering');
    try { handle.setPointerCapture?.(pointerId); } catch {}
  };

  const onPointerMove = (event) => {
    if (!active || event.pointerId !== pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    moveActive(event.clientY);
  };

  const onPointerUp = (event) => {
    if (!active || event.pointerId !== pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    finish(true);
  };

  const onPointerCancel = (event) => {
    if (pointerId != null && event.pointerId !== pointerId) return;
    finish(false);
  };

  const onClick = (event) => {
    const nextHandle = event.target.closest?.(handleSelector);
    if (!nextHandle || !host.contains(nextHandle)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const onKeyDown = (event) => {
    const nextHandle = event.target.closest?.(handleSelector);
    if (!nextHandle || !host.contains(nextHandle)) return;
    const node = nextHandle.closest?.(selector);
    if (!node) return;
    const all = entries();
    const index = all.indexOf(node);
    if (index < 0) return;
    const direction = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!direction) return;
    const targetIndex = Math.max(0, Math.min(all.length - 1, index + direction));
    if (targetIndex === index) return;
    event.preventDefault();
    event.stopPropagation();
    const target = all[targetIndex];
    if (direction < 0) host.insertBefore(node, target);
    else host.insertBefore(node, target.nextSibling);
    const ids = entries().map(valueOf).filter(Boolean);
    if (ids.length) onReorder(ids);
    nextHandle.focus();
  };

  host.addEventListener('pointerdown', onPointerDown, { passive: false });
  host.addEventListener('pointermove', onPointerMove, { passive: false });
  host.addEventListener('pointerup', onPointerUp, { passive: false });
  host.addEventListener('pointercancel', onPointerCancel);
  host.addEventListener('click', onClick, true);
  host.addEventListener('keydown', onKeyDown, true);

  return () => {
    finish(false);
    host.removeEventListener('pointerdown', onPointerDown);
    host.removeEventListener('pointermove', onPointerMove);
    host.removeEventListener('pointerup', onPointerUp);
    host.removeEventListener('pointercancel', onPointerCancel);
    host.removeEventListener('click', onClick, true);
    host.removeEventListener('keydown', onKeyDown, true);
  };
}
