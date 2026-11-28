import { escapeHtml } from '../utils/escape-html.js';

// The native checkbox and its mark have one renderer in every layout.
export function checkControl({ checked = false, disabled = false, data = '', aria = '', value, markClass = '' } = {}) {
  return `<input class="ui-check-input" type="checkbox"${value == null ? '' : ` value="${escapeHtml(String(value))}"`}${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}${data ? ` ${data}` : ''}${aria ? ` aria-label="${escapeHtml(aria)}"` : ''}>
    <span class="ui-compact-check__mark${markClass ? ` ${escapeHtml(markClass)}` : ''}" aria-hidden="true"></span>`;
}

export function checkList(items = [], { className = '' } = {}) {
  const values = Array.isArray(items) ? items : [];
  return `<div class="ui-check-list${className ? ` ${escapeHtml(className)}` : ''}" data-check-list>${values.map((item = {}) => {
    const value = String(item.value ?? item.id ?? '');
    const label = String(item.label ?? item.title ?? value);
    const secondary = String(item.secondary ?? '');
    const checked = Boolean(item.checked);
    return `<label class="ui-check-list__item${checked ? ' is-checked' : ''}">
      ${checkControl({ value, checked, disabled: Boolean(item.disabled), data: item.data || '', markClass: 'ui-check-list__mark' })}
      <span class="ui-check-list__text"><strong>${escapeHtml(label)}</strong>${secondary ? `<small>${escapeHtml(secondary)}</small>` : ''}</span>
    </label>`;
  }).join('')}</div>`;
}

export function compactCheck({ label = '', checked = false, data = '', aria = '', disabled = false } = {}) {
  return `<label class="ui-compact-check${disabled ? ' is-disabled' : ''}">
    ${checkControl({ checked, disabled, data, aria: aria || label })}
    <span class="ui-compact-check__label">${escapeHtml(label)}</span>
  </label>`;
}

export function collectCheckList(root, selector = '.ui-check-list input[type="checkbox"]') {
  return [...root.querySelectorAll(selector)].filter((input) => input.checked).map((input) => input.value).filter(Boolean);
}

export function initCheckList(root) {
  const sync = (input) => {
    const row = input.closest('.ui-check-list__item');
    row?.classList.toggle('is-checked', input.checked);
  };
  root.querySelectorAll('.ui-check-list input[type="checkbox"]').forEach((input) => {
    sync(input);
    input.addEventListener('change', () => sync(input));
  });
}

// One grouping pre-section for the desktop sort menus. Native checkbox
// behavior and the existing action menu's sorting buttons remain unchanged.
export function sortGroupingSection(items) {
  return '<div class="sort-grouping-section" role="group" aria-label="Группировка"><div class="sort-menu-section-label">Группировка</div><div class="sort-grouping-options">'+items.map(compactCheck).join('')+'</div></div><div class="sort-menu-section-label sort-menu-order-label">Сортировка</div>';
}
