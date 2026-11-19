import { compactAddButton, compactRemoveButton } from '../buttons/index.js';
import { escapeHtml } from '../utils/escape-html.js';
import { select } from '../selectors/index.js';

export const LINK_TYPES = ['Instagram', 'ВКонтакте', 'YouTube', 'Facebook', 'Сайт', 'Другое'];

// Compact platform abbreviations are presentation-only: saved link types keep their full identifiers.
const COMPACT_LINK_LABELS = Object.freeze({
  Instagram: 'in',
  'ВКонтакте': 'VK',
  YouTube: 'U',
  Facebook: 'F',
  'Сайт': 'W',
  'Другое': '…',
});

function linkRow(link = {}, { compact = false } = {}) {
  const type = link.type || 'Instagram';
  const options = compact
    ? LINK_TYPES.map((value) => ({ value, label: COMPACT_LINK_LABELS[value] || value, meta: value }))
    : LINK_TYPES;
  return `<div class="link-row" data-link-row>${select({
    name: 'linkType', value: type, options, aria: 'Тип ссылки',
  })}<input class="link-row__url" name="linkUrl" value="${escapeHtml(link.url || '')}" placeholder="Ссылка">${compactRemoveButton({ data: "data-remove-link", aria: "Удалить ссылку" })}</div>`;
}

export function links({ links: values = [], name = 'links', label = '', compact = false, addInHeader = false } = {}) {
  const rows = values.length ? values : [{ type: 'Instagram', url: '' }];
  const add = compactAddButton({
    className: compact && addInHeader ? 'array-row__add' : 'ui-links__add',
    data: `data-add-link="${escapeHtml(name)}"`,
    aria: 'Добавить ссылку',
  });
  if (compact && addInHeader) {
    return `<div class="array-group ui-links ui-links--compact" data-links="${escapeHtml(name)}" data-links-compact="true" data-repeated-add-placement="header">
      <div class="array-group__header"><span class="array-label">${escapeHtml(label || 'Ссылки')}</span>${add}</div>
      <div data-links-list>${rows.map((row) => linkRow(row, { compact: true })).join('')}</div>
    </div>`;
  }
  const content = `<div class="ui-links${compact ? ' ui-links--compact' : ''}" data-links="${escapeHtml(name)}" data-links-compact="${compact ? 'true' : 'false'}"><div data-links-list>${rows.map((row) => linkRow(row, { compact })).join('')}</div>${add}</div>`;
  return label
    ? `<div class="array-group"><span class="array-label">${escapeHtml(label)}</span>${content}</div>`
    : content;
}

export function initLinks(root) {
  root.querySelectorAll('[data-links]').forEach((host) => {
    if (host.dataset.linksReady === 'true') return;
    host.dataset.linksReady = 'true';
    host.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-remove-link]');
      if (remove) {
        remove.closest('[data-link-row]')?.remove();
        host.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      const add = event.target.closest('[data-add-link]');
      if (!add) return;
      host.querySelector('[data-links-list]')?.insertAdjacentHTML('beforeend', linkRow({}, { compact: host.dataset.linksCompact === 'true' }));
      host.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}

export function collectLinks(root, name = 'links') {
  return [...root.querySelectorAll(`[data-links="${CSS.escape(name)}"] [data-link-row]`)]
    .map((row) => ({
      type: row.querySelector('[name="linkType"]')?.value || '',
      url: row.querySelector('[name="linkUrl"]')?.value.trim() || '',
    }))
    .filter((link) => link.url);
}
