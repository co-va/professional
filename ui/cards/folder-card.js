import { escapeHtml } from '../utils/escape-html.js';

export function folderCard({ title = '', icon = '', count = '', data = '', aria = '', variant = 'card' } = {}) {
  if (variant === 'list') {
    return `<button class="ui-folder-list__item" type="button"${data ? ` ${data}` : ''}${aria ? ` aria-label="${escapeHtml(aria)}"` : ''}><span class="ui-folder-list__title">${escapeHtml(title)}</span>${count !== '' ? `<span class="ui-folder-list__count">${escapeHtml(count)}</span>` : ''}<span class="ui-folder-list__chevron" aria-hidden="true">›</span></button>`;
  }
  const compactClass = variant === 'compact' ? ' ui-folder-card--compact' : '';
  return `<button class="ui-folder-card${compactClass}" type="button"${data ? ` ${data}` : ''}${aria ? ` aria-label="${escapeHtml(aria)}"` : ''}><span class="ui-folder-card__top"><span class="ui-folder-card__icon">${escapeHtml(icon)}</span>${count !== '' ? `<span class="ui-folder-card__count">${escapeHtml(count)}</span>` : ''}</span><span class="ui-folder-card__title">${escapeHtml(title)}</span></button>`;
}

export function folderList(items = []) {
  return `<div class="ui-folder-list">${items.map((item) => folderCard({ ...item, variant: 'list' })).join('')}</div>`;
}
