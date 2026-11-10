import { costField, collectCost, initCostFields } from '../cost/index.js';
import { button } from '../buttons/index.js';
import { openHeaderControl } from '../header/index.js';
import { list } from '../lists/list.js';
import { select } from '../selectors/index.js';
import { escapeHtml } from '../utils/escape-html.js';

export { getWorkplaceContext, setWorkplaceContext } from '../../core/workplace-context.js';
export { dayWorkplaceContent, openDayWorkplaceControl, openDayWorkplaceTime } from './day-control.js';

export const ALL_WORKPLACES_ID = '__all__';
const WORKPLACE_FALLBACK_COLOR = '#212529';

export function workplaceCountText(count = 0) {
  return `${Math.max(0, Number(count) || 0)} р.м.`;
}

export function workplaceAddButton({
  data = 'data-add-workplace',
  label = '+ Добавить рабочее место',
  className = '',
  variant = 'secondary',
} = {}) {
  return button(label, {
    variant,
    className,
    data,
    aria: 'Добавить рабочее место',
  });
}

function workplaceOptions(workplaces = []) {
  return (Array.isArray(workplaces) ? workplaces : []).map((workplace) => ({
    value: String(workplace?.key || ''),
    label: String(workplace?.name || 'Без названия'),
  })).filter((option) => option.value);
}

function row(name, value, options, selected = {}, withCost = false) {
  const cost = selected?.cost || {};
  return `<div class="workplace-select-row" data-workplace-row>${select({
    label: 'Рабочее место',
    name,
    value,
    options: [{ value: '', label: 'Выбор рабочего места' }, ...options],
    data: 'data-workplace-value',
  })}${withCost ? costField({ name: `${name}-cost-${Math.random().toString(36).slice(2, 8)}`, value: cost }) : ''}<button type="button" class="remove-button" data-remove-workplace aria-label="Удалить рабочее место">×</button></div>`;
}

export function workplaceSelector({ name = 'workplaces', selected = [], allowMultiple = true, costPerWorkplace = false, workplaces = [] } = {}) {
  const options = workplaceOptions(workplaces);
  const selections = Array.isArray(selected) ? selected : [];
  const first = String(selections[0]?.workplaceId || selections[0]?.id || selections[0]?.key || '');
  const catalog = escapeHtml(JSON.stringify(options));
  return `<div class="workplace-selector" data-workplace-selector="${escapeHtml(name)}" data-cost-per-workplace="${costPerWorkplace ? 'true' : 'false'}" data-workplace-options="${catalog}"><div data-workplace-rows>${row(name, first, options, selections[0], costPerWorkplace)}</div>${allowMultiple ? workplaceAddButton() : ''}</div>`;
}

export function initWorkplaceSelectors(root) {
  root.querySelectorAll('[data-workplace-selector]').forEach((host) => {
    if (host.dataset.workplaceSelectorReady === 'true') return;
    host.dataset.workplaceSelectorReady = 'true';
    initCostFields(host);
    host.querySelector('[data-add-workplace]')?.addEventListener('click', () => {
      const rows = host.querySelector('[data-workplace-rows]');
      if (!rows) return;
      const options = JSON.parse(host.dataset.workplaceOptions || '[]');
      const withCost = host.dataset.costPerWorkplace === 'true';
      rows.insertAdjacentHTML('beforeend', row(host.dataset.workplaceSelector, '', options, {}, withCost));
      const added = rows.lastElementChild;
      if (withCost && added) initCostFields(added);
    });
    host.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-remove-workplace]');
      if (remove) remove.closest('[data-workplace-row]')?.remove();
    });
  });
}

export function collectWorkplaceSelections(root, name = 'workplaces') {
  const host = root.querySelector(`[data-workplace-selector="${CSS.escape(name)}"]`);
  if (!host) return [];
  const options = JSON.parse(host.dataset.workplaceOptions || '[]');
  return [...host.querySelectorAll('[data-workplace-row]')].map((item) => {
    const input = item.querySelector('input[type="hidden"][data-workplace-value]');
    const workplaceId = String(input?.value || '');
    if (!workplaceId) return null;
    const label = options.find((option) => option.value === workplaceId)?.label || '';
    const costHost = item.querySelector('[data-cost-field]');
    return { workplaceId, name: label, cost: costHost ? collectCost(item, costHost.dataset.costField) : {} };
  }).filter(Boolean);
}

function statsRows(stats) {
  if (!stats) return [];
  const days = Math.max(0, Number(stats.days) || 0);
  const hours = Math.max(0, Number(stats.hours) || 0);
  const minutes = String(Math.max(0, Number(stats.minutes) || 0)).padStart(2, '0');
  return [`${days} дней`, `${hours} ч ${minutes} м`];
}

/** Neutral Workplace content that can be placed in Header Control or elsewhere. */
export function workplaceContent({ workplace = null, title = '', showStats = false, stats = null, primaryText = '', secondaryText = '' } = {}) {
  const name = String(title || workplace?.name || 'Рабочее место');
  const rows = statsRows(stats);
  const primary = String(primaryText || (showStats && rows.length ? rows[0] : ''));
  const secondary = String(secondaryText || (showStats && rows.length ? rows[1] : ''));
  const counter = primary || secondary
    ? `${primary ? `<span class="workplace-content__primary">${escapeHtml(primary)}</span>` : ''}${secondary ? `<span class="workplace-content__secondary">${escapeHtml(secondary)}</span>` : ''}`
    : '';
  return `<span class="workplace-content"><span class="workplace-content__name">${escapeHtml(name)}</span>${counter}</span>`;
}

/**
 * Graph-owned Workplace manifestation.
 * It composes the shared Header Control + List for the Graph scenario only.
 * Journal has its own manifestation and must not call this function.
 */
export function openWorkplaceControl({
  workplaces = [],
  workplaceId = '',
  title = '',
  subtitle = '',
  stats = null,
  workplaceStats = {},
  aggregateStats = null,
  includeAggregate = false,
  onSelect = () => {},
} = {}) {
  const catalog = Array.isArray(workplaces) ? workplaces : [];
  const visibleTitle = String(title || '').trim();
  const visibleSubtitle = String(subtitle || '').trim();
  const listItems = [];

  if (includeAggregate) {
    listItems.push({
      title: 'Общий график',
      right: statsRows(aggregateStats),
      interactive: true,
      selected: workplaceId === ALL_WORKPLACES_ID,
      data: `data-workplace-control-select="${ALL_WORKPLACES_ID}"`,
      aria: 'Показать общий график всех рабочих мест',
    });
  }

  for (const workplace of catalog) {
    const key = String(workplace?.key || '');
    if (!key) continue;
    const rowStats = workplaceStats?.[key] || (key === String(workplaceId || '') ? stats : null);
    listItems.push({
      title: workplace?.name || 'Без названия',
      right: statsRows(rowStats),
      indicatorColor: workplace?.indicatorColor || workplace?.color || WORKPLACE_FALLBACK_COLOR,
      indicatorLabel: workplace?.name || 'Рабочее место',
      interactive: true,
      selected: key === String(workplaceId || ''),
      data: `data-workplace-control-select="${escapeHtml(key)}"`,
      aria: `Выбрать рабочее место ${workplace?.name || ''}`,
    });
  }

  const heading = visibleTitle || visibleSubtitle
    ? `<div class="modal-title">${visibleTitle ? `<h2>${escapeHtml(visibleTitle)}</h2>` : ''}${visibleSubtitle ? `<p>${escapeHtml(visibleSubtitle)}</p>` : ''}</div>`
    : '';
  const content = `${heading}<div class="workplace-control-list">${list({ items: listItems })}</div>`;
  const main = openHeaderControl(content, { title: visibleTitle || visibleSubtitle });
  main?.querySelectorAll('[data-workplace-control-select]').forEach((row) => row.addEventListener('click', () => {
    const nextId = String(row.dataset.workplaceControlSelect || '');
    if (!nextId) return;
    main.remove();
    onSelect(nextId);
  }));
  return main;
}
