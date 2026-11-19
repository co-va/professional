import { button } from '../buttons/index.js';
import { escapeHtml } from '../utils/escape-html.js';

/**
 * Canonical Core UI StateView.
 *
 * A StateView is composed of independent state blocks. A block is not a
 * list() component: it uses the Core List visual principles for its rows,
 * while retaining its own semantics and optional block/row behavior.
 *
 * Supported block shapes:
 * - rows: independent data rows;
 * - list: item rows plus an optional summary row.
 */
export function stateView({ title = '', blocks = [], actions = [], className = '' } = {}) {
  const safeBlocks = Array.isArray(blocks) ? blocks : [];
  const safeActions = Array.isArray(actions) ? actions : [];

  const renderRow = (row = {}, index, total, extraClass = '', rowIndex = index) => {
    const classes = [
      'ui-state-view__row',
      index === 0 ? 'is-first' : '',
      index === total - 1 ? 'is-last' : '',
      extraClass
    ].filter(Boolean).join(' ');
    const left = row.title ?? row.left ?? '';
    const secondary = row.secondary ?? '';
    const right = row.right ?? '';
    const rowAttrs = row.interactive === false ? '' : ` data-state-view-row="${escapeHtml(rowIndex)}"`;
    return `<div class="${classes}"${rowAttrs}>` +
      `<span class="ui-state-view__row-main"><span class="ui-state-view__row-title">${escapeHtml(left)}</span>` +
      (secondary !== '' ? `<span class="ui-state-view__row-secondary">${escapeHtml(secondary)}</span>` : '') +
      `</span>` +
      (right !== '' ? `<span class="ui-state-view__row-right">${escapeHtml(right)}</span>` : '') +
      `</div>`;
  };

  const renderBlockContent = (block = {}) => {
    if (block.kind === 'list') {
      const items = Array.isArray(block.items) ? block.items : [];
      const summary = block.summary || {};
      const hasSummary = summary.left !== undefined || summary.right !== undefined;
      const rows = items.map((item = {}, index) => renderRow({
        title: item.title ?? item.left ?? '',
        secondary: item.secondary ?? '',
        right: item.right ?? '',
        interactive: item.interactive
      }, index, hasSummary ? items.length + 1 : items.length, '', index));
      const summaryRow = hasSummary
        ? `<div class="ui-state-view__row ui-state-view__summary is-last" data-state-view-row="summary"><span class="ui-state-view__row-main"><span class="ui-state-view__row-title">${escapeHtml(summary.left ?? '')}</span></span><span class="ui-state-view__row-right">${escapeHtml(summary.right ?? '')}</span></div>`
        : '';
      if (!items.length && !summaryRow) return '<div class="ui-state-view__empty">Нет данных</div>';
      return `<div class="ui-state-view__rows">${rows}${summaryRow}</div>`;
    }

    const rows = Array.isArray(block.rows) ? block.rows : [];
    if (!rows.length) return '<div class="ui-state-view__empty">Нет данных</div>';
    return `<div class="ui-state-view__rows">${rows.map((row, index) => renderRow(row, index, rows.length, '', index)).join('')}</div>`;
  };

  const renderedBlocks = safeBlocks.map((block = {}, index) => {
    const blockId = block.id ?? index;
    const clickable = block.interactive !== false;
    const attrs = [
      `data-state-view-block="${escapeHtml(blockId)}"`,
      clickable ? 'role="button" tabindex="0"' : '',
      block.data || '',
      block.aria ? `aria-label="${escapeHtml(block.aria)}"` : ''
    ].filter(Boolean).join(' ');
    const separator = block.heading
      ? `<div class="ui-state-view__separator"><span>${escapeHtml(block.heading)}</span></div>`
      : (index ? '<div class="ui-state-view__separator" aria-hidden="true"></div>' : '');

    return `${separator}<div class="ui-state-view__block${clickable ? ' is-interactive' : ''}" ${attrs}>${renderBlockContent(block)}</div>`;
  }).join('');

  const renderedActions = safeActions.map((action = {}) => button(escapeHtml(action.label ?? ''), {
    type: escapeHtml(action.type ?? 'button'),
    className: escapeHtml(action.className ?? ''),
    data: action.data || '',
    aria: action.aria ?? '',
  })).join('');

  return `<section class="ui-state-view${className ? ` ${escapeHtml(className)}` : ''}" data-state-view>` +
    (title ? `<h1 class="ui-state-view__title">${escapeHtml(title)}</h1>` : '') +
    `<div class="ui-state-view__blocks">${renderedBlocks}</div>` +
    (safeActions.length ? '<div class="ui-state-view__actions-spacer" aria-hidden="true"></div>' : '') +
    (renderedActions ? `<div class="ui-state-view__actions">${renderedActions}</div>` : '') +
    `</section>`;
}

export function initStateView(root, { onBlockSelect = () => {}, onRowSelect = () => {} } = {}) {
  if (!root) return { destroy() {} };

  const handleActivate = (event) => {
    if (event.target.closest('a,button,input,select,textarea')) return;
    const row = event.target.closest('[data-state-view-row]');
    if (row && root.contains(row)) {
      if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      const block = row.closest('[data-state-view-block]');
      onRowSelect(block?.dataset.stateViewBlock, row.dataset.stateViewRow, row, block);
      return;
    }
    const block = event.target.closest('[data-state-view-block]');
    if (!block || !root.contains(block) || !block.classList.contains('is-interactive')) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onBlockSelect(block.dataset.stateViewBlock, block);
  };

  root.addEventListener('click', handleActivate);
  root.addEventListener('keydown', handleActivate);

  return {
    destroy() {
      root.removeEventListener('click', handleActivate);
      root.removeEventListener('keydown', handleActivate);
    }
  };
}
