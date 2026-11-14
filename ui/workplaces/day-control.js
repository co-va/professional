import { button } from '../buttons/index.js';
import { openHeaderControl } from '../header/index.js';
import { list } from '../lists/list.js';
import { modal, mountModal } from '../modals/index.js';
import { timePicker, initTimePickers } from '../time/index.js';
import { escapeHtml } from '../utils/escape-html.js';

const WORKPLACE_FALLBACK_COLOR = '#212529';

function normalizedItems(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) => String(item?.workplaceId || item?.key || ''));
}

export function dayWorkplaceContent({ items = [] } = {}) {
  const values = normalizedItems(items);
  if (!values.length) {
    return '<span class="workplace-content workplace-content--day"><span class="workplace-content__name">+ Добавить рабочее место</span></span>';
  }
  return `<span class="workplace-content workplace-content--day">${values.map((item) => `<span class="workplace-content__name">${escapeHtml(item?.name || 'Рабочее место')}</span>`).join('')}</span>`;
}

function openCatalog({ workplaces = [], title = '', onSelect = () => {} } = {}) {
  const items = (Array.isArray(workplaces) ? workplaces : []).map((workplace) => {
    const key = String(workplace?.key || workplace?.workplaceId || '');
    if (!key) return null;
    return {
      title: workplace?.name || 'Без названия',
      indicatorColor: workplace?.indicatorColor || workplace?.color || WORKPLACE_FALLBACK_COLOR,
      indicatorLabel: workplace?.name || 'Рабочее место',
      interactive: true,
      data: `data-day-workplace-pick="${escapeHtml(key)}"`,
      aria: `Добавить рабочее пространство ${workplace?.name || ''}`,
    };
  }).filter(Boolean);

  const content = items.length
    ? `<div class="workplace-control-list">${list({ items })}</div>`
    : '<div class="time-day-state" aria-disabled="true">Нет доступных рабочих пространств</div>';
  const main = openHeaderControl(content, { title });
  main?.querySelectorAll('[data-day-workplace-pick]').forEach((row) => row.addEventListener('click', () => {
    const workplaceId = String(row.dataset.dayWorkplacePick || '');
    if (!workplaceId) return;
    main.remove();
    onSelect(workplaceId);
  }));
  return main;
}

export function openDayWorkplaceControl({
  active = [],
  available = [],
  title = '',
  catalogTitle = '',
  onEdit = () => {},
  onAdd = () => {},
} = {}) {
  const activeItems = normalizedItems(active);
  if (!activeItems.length) return openCatalog({ workplaces: available, title: catalogTitle, onSelect: onAdd });

  const items = activeItems.map((item) => ({
    title: item?.name || 'Рабочее место',
    right: item?.right ?? [],
    indicatorColor: item?.indicatorColor || WORKPLACE_FALLBACK_COLOR,
    indicatorLabel: item?.name || 'Рабочее место',
    interactive: true,
    data: `data-day-workplace-edit="${escapeHtml(item.workplaceId)}"`,
    aria: `Рабочее место ${item?.name || ''}`,
  }));

  const addAction = (Array.isArray(available) && available.length)
    ? `<div class="workplace-control-actions">${button('+ Добавить рабочее пространство', { variant: 'secondary', data: 'data-day-workplace-add' })}</div>`
    : '';
  const content = `<div class="workplace-control-list">${list({ items })}</div>${addAction}`;
  const main = openHeaderControl(content, { title });
  main?.querySelectorAll('[data-day-workplace-edit]').forEach((row) => row.addEventListener('click', () => {
    const workplaceId = String(row.dataset.dayWorkplaceEdit || '');
    if (!workplaceId) return;
    main.remove();
    onEdit(workplaceId);
  }));
  main?.querySelector('[data-day-workplace-add]')?.addEventListener('click', () => {
    main.remove();
    openCatalog({ workplaces: available, title: catalogTitle, onSelect: onAdd });
  });
  return main;
}

export function openDayWorkplaceTime({
  title = '',
  from = '',
  to = '',
  occupied = [],
  available = [],
  catalogTitle = 'Добавить рабочее пространство',
  onSave = () => ({ ok: true }),
  onAdd = () => {},
} = {}) {
  const occupiedItems = normalizedItems(occupied).map((item) => ({
    title: item?.name || 'Рабочее место',
    right: item?.from && item?.to ? [`${item.from}–${item.to}`] : [],
    indicatorColor: item?.indicatorColor || WORKPLACE_FALLBACK_COLOR,
    indicatorLabel: item?.name || 'Рабочее место',
  }));
  const occupiedMarkup = occupiedItems.length
    ? `<div class="workplace-control-list">${list({ items: occupiedItems })}</div>`
    : '';
  const addAction = Array.isArray(available) && available.length
    ? button('+ Добавить рабочее пространство', { variant: 'secondary', data: 'data-day-workplace-time-add' })
    : '';
  const content = `<div class="compact-form"><div class="modal-title"><h2>${escapeHtml(title || 'Рабочее время')}</h2></div>${occupiedMarkup}<div class="time-range-fields">${timePicker({ name: 'dayWorkplaceFrom', label: 'Начало', value: from })}${timePicker({ name: 'dayWorkplaceTo', label: 'Окончание', value: to })}</div><div class="form-error" data-day-workplace-time-error aria-live="polite"></div>${addAction}${button('Сохранить', { data: 'data-day-workplace-time-save' })}</div>`;
  const main = mountModal(document.body, modal(content, { title: title || 'Рабочее время', variant: 'x', xRole: 'editor' }));
  if (!main) return null;
  initTimePickers(main);
  main.querySelector('[data-day-workplace-time-add]')?.addEventListener('click', () => {
    main.remove();
    openCatalog({ workplaces: available, title: catalogTitle, onSelect: onAdd });
  });
  main.querySelector('[data-day-workplace-time-save]')?.addEventListener('click', () => {
    const nextFrom = main.querySelector('[name="dayWorkplaceFrom"]')?.value || '';
    const nextTo = main.querySelector('[name="dayWorkplaceTo"]')?.value || '';
    const result = onSave({ from: nextFrom, to: nextTo });
    if (result?.ok === false || result === false) {
      const error = main.querySelector('[data-day-workplace-time-error]');
      if (error) error.textContent = result?.message || 'Проверьте рабочее время.';
      return;
    }
    main.remove();
  });
  return main;
}