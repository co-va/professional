import { escapeHtml } from '../utils/escape-html.js';

function valuesOf(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && String(item) !== '');
  if (value === null || value === undefined || String(value) === '') return [];
  return [value];
}

/**
 * Canonical Core UI List.
 *
 * The List remains generic and does not know what values represent.
 * It can show a generic color indicator, selected state and right-side
 * metadata without becoming entity-specific.
 */
export function list({ items = [], className = '' } = {}) {
  const listItems = Array.isArray(items) ? items : [];

  return `<div class="ui-list${className ? ` ${escapeHtml(className)}` : ''}" data-ui-list>${listItems.map((item = {}, index) => {
    const secondary = valuesOf(item.secondary);
    const primarySecondary = secondary[0] ?? '';
    const rightSecondary = item.right !== undefined ? valuesOf(item.right) : secondary.slice(1);
    const interactive = Boolean(item.interactive);
    const tag = interactive ? 'button' : 'div';
    const attrs = item.data || item.aria
      ? `${item.data ? ` ${item.data}` : ''}${item.aria ? ` aria-label="${escapeHtml(item.aria)}"` : ''}`
      : '';
    const classes = [
      'ui-list__item',
      item.className || '',
      item.selected ? 'is-selected' : '',
      index === 0 ? 'is-first' : '',
      index === listItems.length - 1 ? 'is-last' : ''
    ].filter(Boolean).join(' ');
    const indicatorColor = String(item.indicatorColor || '').trim();
    const indicatorLabel = String(item.indicatorLabel || '').trim();
    const indicator = indicatorColor
      ? `<span class="ui-list__indicator" style="--ui-list-indicator:${escapeHtml(indicatorColor)}"${indicatorLabel ? ` role="img" aria-label="${escapeHtml(indicatorLabel)}" title="${escapeHtml(indicatorLabel)}"` : ' aria-hidden="true"'}></span>`
      : '';
    const overline = item.overline
      ? `<span class="ui-list__overline">${escapeHtml(item.overline)}</span>`
      : '';

    return `<${tag} class="${classes}"${interactive ? ` type="button"` : ''}${attrs}>` +
      indicator +
      `<span class="ui-list__main">${overline}<span class="ui-list__title">${escapeHtml(item.title ?? '')}</span>` +
      (primarySecondary ? `<span class="ui-list__secondary">${escapeHtml(primarySecondary)}</span>` : '') +
      `</span>` +
      (rightSecondary.length ? `<span class="ui-list__right-secondary">${rightSecondary.map((value) => `<span>${escapeHtml(value)}</span>`).join('')}</span>` : '') +
      `</${tag}>`;
  }).join('')}</div>`;
}
