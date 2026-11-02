import { button } from '../buttons/index.js';
import { escapeHtml } from '../utils/escape-html.js';
import { select } from '../selectors/index.js';

export const LINK_TYPES = ['Instagram', 'ВКонтакте', 'YouTube', 'Facebook', 'Сайт', 'Другое'];

function linkRow(link = {}) {
  return `<div class="link-row" data-link-row>${select({ name:'linkType', value:link.type||'Instagram', options:LINK_TYPES })}<input class="link-row__url" name="linkUrl" value="${escapeHtml(link.url||'')}" placeholder="Ссылка"><button type="button" class="remove-button" data-remove-link aria-label="Удалить ссылку">×</button></div>`;
}

export function links({ links: values = [], name = 'links', label = '' } = {}) {
  const rows = values.length ? values : [{ type: 'Instagram', url: '' }];
  const content = `<div class="ui-links" data-links="${escapeHtml(name)}"><div data-links-list>${rows.map(linkRow).join('')}</div>${button('+',{className:'ui-links__add',data:`data-add-link="${escapeHtml(name)}"`,aria:'Добавить ссылку'})}</div>`;
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
      host.querySelector('[data-links-list]')?.insertAdjacentHTML('beforeend', linkRow());
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
