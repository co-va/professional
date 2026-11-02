import { button, iconButton } from '../buttons/index.js';
import { escapeHtml } from '../utils/escape-html.js';

function text(value = '') {
  return escapeHtml(String(value ?? ''));
}

function receiptRow(item = {}) {
  const value = `<strong>${text(item.value)}</strong>`;
  const action = item?.action && typeof item.action === 'object'
    ? `<div class="read-only-sheet__row-actions">${value}${iconButton(item.action.label || '×', {
      className: item.action.className || 'remove-button',
      data: item.action.data || '',
      aria: item.action.aria || 'Действие',
    })}</div>`
    : value;
  return `<div class="read-only-sheet__row${item.strong ? ' is-strong' : ''}"><span>${text(item.label)}</span>${action}</div>`;
}

export function readOnlyReceipt({
  title = '',
  status = '',
  date = '',
  time = '',
  items = [],
  totals = [],
  groups = [],
  action = null,
} = {}) {
  const headerVisible = [title, status, date, time].some((value) => String(value ?? '').trim());
  const meta = [
    String(status ?? '').trim() ? `<strong>${text(status)}</strong>` : '',
    String(date ?? '').trim() ? `<span>${text(date)}</span>` : '',
    String(time ?? '').trim() ? `<span>${text(time)}</span>` : '',
  ].filter(Boolean).join('');
  const header = headerVisible
    ? `<header class="read-only-sheet__header">${String(title ?? '').trim() ? `<h2>${text(title)}</h2>` : ''}${meta ? `<div class="read-only-sheet__meta">${meta}</div>` : ''}</header>`
    : '';
  const grouped = (Array.isArray(groups) ? groups : [])
    .filter((group) => Array.isArray(group) ? group.length : Array.isArray(group?.items) && group.items.length)
    .map((group) => {
      const rows = Array.isArray(group) ? group : group.items;
      return `<div class="read-only-sheet__group">${rows.map(receiptRow).join('')}</div>`;
    }).join('');
  const itemRows = (Array.isArray(items) ? items : []).map(receiptRow).join('');
  const totalRows = (Array.isArray(totals) ? totals : []).map(receiptRow).join('');
  return `<section class="read-only-sheet" data-read-only-sheet>
    ${header}
    ${grouped ? `<div class="read-only-sheet__groups">${grouped}</div>` : ''}
    ${itemRows ? `<div class="read-only-sheet__items">${itemRows}</div>` : ''}
    ${totalRows ? `<div class="read-only-sheet__totals">${totalRows}</div>` : ''}
    ${action ? `<div class="read-only-sheet__action">${button(text(action.label || ''), { data: action.data || '', aria: action.aria || action.label || '' })}</div>` : ''}
  </section>`;
}