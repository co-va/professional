import { button } from '../buttons/index.js';
import { phoneInput } from '../inputs/index.js';
import { escapeHtml } from '../utils/escape-html.js';

function normalizeItems(values) {
  if (!Array.isArray(values)) return [];
  return values
    .filter(value => value !== null && value !== undefined)
    .map(value => typeof value === 'object' && value !== null
      ? { value: String(value.value ?? ''), source: String(value.source ?? '') }
      : { value: String(value), source: '' });
}

export function repeatedField({ label = '', name = '', values = [], type = 'text', placeholder = 'Добавить значение', className = '', showEmptyRow = true } = {}) {
  const items = normalizeItems(values);
  const rows = items.length ? items : (showEmptyRow ? [{ value: '', source: '' }] : []);
  return `<div class="array-group ${escapeHtml(className)}" data-repeated-field data-repeated-name="${escapeHtml(name)}" data-repeated-label="${escapeHtml(label)}" data-repeated-type="${escapeHtml(type)}" data-repeated-placeholder="${escapeHtml(placeholder)}"><span class="array-label">${escapeHtml(label)}</span><div data-repeated-list>${rows.map((item,index) => repeatedRow({ name, type, value: item.value, source: item.source, placeholder, label, primary:index===0 })).join('')}</div></div>`;
}

function repeatedRow({ name, type, value = '', source = '', placeholder, label = '', primary = false }) {
  const sourceMarkup = source ? ` data-repeated-source="${escapeHtml(source)}"` : '';
  const removeLabel = label ? `Удалить ${label}` : 'Удалить значение';
  const addLabel = label ? `Добавить ${label}` : 'Добавить значение';
  const inputMarkup = type === 'tel'
    ? phoneInput({ name, value, aria: label || 'Телефон' })
    : `<input type="${escapeHtml(type)}" name="${escapeHtml(name)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}">`;
  const action = primary
    ? button('+', { className:'array-row__add', data:`data-repeated-add="${escapeHtml(name)}"`, aria:addLabel })
    : `<button type="button" class="remove-button" data-repeated-remove aria-label="${escapeHtml(removeLabel)}">×</button>`;
  return `<div class="array-row" data-repeated-row${sourceMarkup}>${inputMarkup}${action}</div>`;
}

export function initRepeatedFields(root) {
  root.querySelectorAll('[data-repeated-field]').forEach(group => {
    if (group.dataset.repeatedInitialized === 'true') return;
    group.dataset.repeatedInitialized = 'true';
    group.addEventListener('click', event => {
      const remove = event.target.closest('[data-repeated-remove]');
      if (remove) {
        remove.closest('[data-repeated-row]')?.remove();
        group.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      const add = event.target.closest('[data-repeated-add]');
      if (!add) return;
      const list = group.querySelector('[data-repeated-list]');
      if (!list) return;
      const name = group.dataset.repeatedName || '';
      const label = group.dataset.repeatedLabel || '';
      const type = group.dataset.repeatedType || 'text';
      const placeholder = group.dataset.repeatedPlaceholder || 'Добавить значение';
      list.insertAdjacentHTML('beforeend', repeatedRow({ name, type, placeholder, label, primary:false }));
      group.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}

export function collectRepeatedField(root, name) {
  return [...root.querySelectorAll(`[data-repeated-field][data-repeated-name="${CSS.escape(name)}"] input[name="${CSS.escape(name)}"]`)]
    .map(input => input.value.trim())
    .filter(Boolean);
}

export function collectRepeatedEntries(root, name) {
  return [...root.querySelectorAll(`[data-repeated-field][data-repeated-name="${CSS.escape(name)}"] [data-repeated-row]`)]
    .map(row => ({ value: row.querySelector(`input[name="${CSS.escape(name)}"]`)?.value.trim() || '', source: row.dataset.repeatedSource || '' }))
    .filter(item => item.value);
}
