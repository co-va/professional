import { escapeHtml } from '../utils/escape-html.js';
import { modal, mountModal } from '../modals/index.js';

let selectorEventsReady = false;
let selectorId = 0;

function normalizeOptions(options = []) {
  return (Array.isArray(options) ? options : []).map((option) => {
    const item = typeof option === 'string' ? { value: option, label: option } : option || {};
    return {
      value: String(item.value ?? ''),
      label: String(item.label ?? item.value ?? ''),
      meta: String(item.meta ?? ''),
      indicatorColor: String(item.indicatorColor ?? '').trim(),
    };
  });
}

function closeSelector(surface) {
  const modalRoot = surface?.closest?.('[data-modal]');
  if (modalRoot?.v2Close) modalRoot.v2Close();
  else surface?.remove?.();
}

function commitSelectorValue(surface, value, label, meta = '', indicatorColor = '') {
  const input = surface?.uiSourceInput || document.getElementById(surface?.dataset.inputId || '');
  const trigger = surface?.uiSourceTrigger || input?.closest('.ui-select')?.querySelector('[data-ui-select-trigger]');
  if (!input || !trigger) {
    closeSelector(surface);
    return;
  }
  input.value = String(value ?? '');
  const valueNode = trigger.querySelector('.ui-select__value');
  const metaNode = trigger.querySelector('.ui-select__meta');
  const indicatorNode = trigger.querySelector('.ui-select__indicator');
  if (valueNode) valueNode.textContent = String(label ?? value ?? '');
  if (metaNode) {
    metaNode.textContent = String(meta || '');
    metaNode.hidden = !meta;
  }
  if (indicatorNode) {
    indicatorNode.hidden = !indicatorColor;
    indicatorNode.style.setProperty('--ui-select-indicator', String(indicatorColor || 'transparent'));
  }
  closeSelector(surface);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function filterSelector(surface, query) {
  const needle = String(query || '').trim().toLocaleLowerCase('ru');
  surface.querySelectorAll('[data-ui-select-option]').forEach((option) => {
    const text = `${option.dataset.value || ''} ${option.textContent || ''}`.toLocaleLowerCase('ru');
    option.hidden = Boolean(needle) && !text.includes(needle);
  });
}

function ensureSelectorEvents() {
  if (selectorEventsReady || typeof document === 'undefined') return;
  selectorEventsReady = true;

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest?.('[data-ui-select-trigger]');
    if (!trigger) return;
    event.preventDefault();
    openSelector(trigger);
  });

  document.addEventListener('click', (event) => {
    const option = event.target.closest?.('[data-ui-select-option]');
    if (!option) return;
    const surface = option.closest('[data-ui-selector]');
    if (!surface) return;
    commitSelectorValue(
      surface,
      option.dataset.value ?? '',
      option.querySelector('.ui-selector__option-label')?.textContent ?? '',
      option.dataset.meta ?? '',
      option.dataset.indicatorColor ?? '',
    );
  });

  document.addEventListener('input', (event) => {
    const search = event.target.closest?.('[data-ui-selector-search]');
    if (!search) return;
    const surface = search.closest('[data-ui-selector]');
    if (surface) filterSelector(surface, search.value);
  });

  document.addEventListener('keydown', (event) => {
    const search = event.target.closest?.('[data-ui-selector-search]');
    if (search && event.key === 'Enter') {
      event.preventDefault();
      const surface = search.closest('[data-ui-selector]');
      if (!surface) return;
      const query = search.value.trim();
      if (!query) return;
      const options = JSON.parse(surface.dataset.options || '[]');
      const exact = options.find((option) => option.label.toLocaleLowerCase('ru') === query.toLocaleLowerCase('ru') || option.value.toLocaleLowerCase('ru') === query.toLocaleLowerCase('ru'));
      if (exact) commitSelectorValue(surface, exact.value, exact.label, exact.meta, exact.indicatorColor);
      else if (surface.dataset.allowCustom === 'true') commitSelectorValue(surface, query, query);
      return;
    }
    if (event.key !== 'Escape') return;
    document.querySelectorAll('[data-ui-selector]').forEach(closeSelector);
  });
}

function openSelector(trigger) {
  document.querySelectorAll('[data-ui-selector]').forEach(closeSelector);

  const inputId = trigger.dataset.inputId;
  const input = inputId ? document.getElementById(inputId) : null;
  if (!input) return;

  const options = JSON.parse(trigger.dataset.options || '[]');
  const currentValue = String(input.value ?? '');
  const selectedIndex = options.findIndex((option) => String(option.value ?? '') === currentValue);
  const optionMarkup = options.map((option, index) => `
    <button type="button" class="ui-selector__option${index === selectedIndex ? ' is-current' : ''}" data-ui-select-option data-value="${escapeHtml(option.value)}" data-meta="${escapeHtml(option.meta || '')}" data-indicator-color="${escapeHtml(option.indicatorColor || '')}">
      <span class="ui-selector__option-indicator"${option.indicatorColor ? ` style="--ui-select-indicator:${escapeHtml(option.indicatorColor)}"` : ' hidden'} aria-hidden="true"></span>
      <span class="ui-selector__option-main"><span class="ui-selector__option-label">${escapeHtml(option.label)}</span>${option.meta ? `<small>${escapeHtml(option.meta)}</small>` : ''}</span>
    </button>`).join('');
  const searchable = trigger.dataset.searchable === 'true';
  const allowCustom = trigger.dataset.allowCustom === 'true';
  const placeholder = trigger.dataset.placeholder || 'Начните вводить';

  const centered = trigger.closest('.ui-select')?.classList.contains('ui-select--center');
  const content = `<div class="ui-selector${centered ? ' ui-selector--center' : ''}" data-ui-selector data-input-id="${escapeHtml(input.id)}">
    <div class="ui-selector__wheel${searchable ? ' is-searchable' : ''}" role="listbox" aria-label="Выбор значения">
      ${searchable ? `<div class="ui-selector__search-wrap"><input class="ui-selector__search" type="search" data-ui-selector-search placeholder="${escapeHtml(placeholder)}" autocomplete="off"></div>` : ''}
      <div class="ui-selector__viewport">${optionMarkup}</div>
    </div>
  </div>`;

  const modalRoot = mountModal(trigger, modal(content, { variant: 'x', title: 'Выбор', xRole: 'picker' }));
  const surface = modalRoot?.querySelector('[data-ui-selector]');
  if (!surface) return;
  surface.uiSourceInput = input;
  surface.uiSourceTrigger = trigger;
  surface.dataset.options = JSON.stringify(options);
  surface.dataset.allowCustom = allowCustom ? 'true' : 'false';

  if (searchable) {
    const search = surface.querySelector('[data-ui-selector-search]');
    search?.focus();
    if (currentValue && !options.some((option) => option.value === currentValue)) search.value = currentValue;
    if (search?.value) filterSelector(surface, search.value);
  } else {
    const viewport = surface.querySelector('.ui-selector__viewport');
    const current = viewport?.querySelector('.is-current');
    if (viewport && current) {
      const targetTop = current.offsetTop - (viewport.clientHeight - current.offsetHeight) / 2;
      viewport.scrollTop = Math.max(0, targetTop);
    }
  }
}

export function select({ name = '', label = '', value = '', options = [], aria = '', className = '', data = '', searchable = false, allowCustom = false, placeholder = '' } = {}) {
  ensureSelectorEvents();

  const normalized = normalizeOptions(options);
  const stringValue = String(value ?? '');
  if (stringValue && !normalized.some((option) => option.value === stringValue) && allowCustom) normalized.unshift({ value: stringValue, label: stringValue });
  const inputId = `ui-select-${++selectorId}`;
  const current = normalized.find((option) => option.value === stringValue) || (!stringValue && placeholder ? { value: '', label: placeholder, meta: '', indicatorColor: '' } : normalized[0]) || { value: '', label: placeholder || 'Выбрать', meta: '', indicatorColor: '' };
  const optionData = escapeHtml(JSON.stringify(normalized));
  const dataAttrs = data ? ` ${data}` : '';

  return `<label class="field ui-select ${escapeHtml(className)}">
    ${label ? `<span>${escapeHtml(label)}</span>` : ''}
    <input id="${inputId}" type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(stringValue)}"${dataAttrs}>
    <button type="button" class="ui-select__control" data-ui-select-trigger data-input-id="${inputId}" data-options="${optionData}" data-searchable="${searchable ? 'true' : 'false'}" data-allow-custom="${allowCustom ? 'true' : 'false'}" data-placeholder="${escapeHtml(placeholder)}"${aria ? ` aria-label="${escapeHtml(aria)}"` : ''}${dataAttrs}>
      <span class="ui-select__selection">
        <span class="ui-select__indicator"${current.indicatorColor ? ` style="--ui-select-indicator:${escapeHtml(current.indicatorColor)}"` : ' hidden'} aria-hidden="true"></span>
        <span class="ui-select__text"><span class="ui-select__value">${escapeHtml(current.label)}</span><small class="ui-select__meta"${current.meta ? '' : ' hidden'}>${escapeHtml(current.meta || '')}</small></span>
      </span>
      <span class="ui-select__chevron" aria-hidden="true">⌄</span>
    </button>
  </label>`;
}

export function searchableSelect({ label = '', name = '', value = '', options = [], placeholder = 'Начните вводить', required = false, aria = '' } = {}) {
  return select({ label: required && label && !label.trim().endsWith('*') ? `${label} *` : label, name, value, options, placeholder, searchable: true, allowCustom: true, aria: aria || label });
}
