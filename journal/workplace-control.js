import { ALL_WORKPLACES_ID, button, modal, mountModal, select } from '../ui/ui.js';

const WORKPLACE_FALLBACK_COLOR = '#212529';

function recordCountText(count = 0) {
  return `${Math.max(0, Number(count) || 0)} записей`;
}

function monthStatsText(stats = null) {
  const days = Math.max(0, Number(stats?.days) || 0);
  const totalMinutes = Math.max(0, Number(stats?.totalMinutes) || 0);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  const ending = days % 100 >= 11 && days % 100 <= 14
    ? 'дней'
    : days % 10 === 1 ? 'день' : days % 10 >= 2 && days % 10 <= 4 ? 'дня' : 'дней';
  return `${days} ${ending} · ${hours} ч ${minutes} м`;
}

function workplaceMeta(workplace = {}, count = 0) {
  const range = workplace?.from && workplace?.to ? `${workplace.from} - ${workplace.to}` : '';
  return [range, recordCountText(count)].filter(Boolean).join(' · ');
}

/**
 * Journal-owned selector markup; can be mounted directly into an existing X sheet.
 * Shared Select owns the picker, while Journal owns workplace options and counters.
 */
export function journalWorkplaceSelect({
  workplaces = [],
  workplaceId = '',
  recordCounts = {},
  aggregateCount = 0,
  month = false,
  list = false,
  aggregateStats = null,
  workplaceStats = {},
  countsPending = false,
} = {}) {
  const options = [{
    value: ALL_WORKPLACES_ID,
    label: list ? 'Общий список' : month ? 'Общий график' : 'График дня',
    meta: month ? monthStatsText(aggregateStats) : countsPending ? '' : recordCountText(aggregateCount),
    indicatorColor: '',
  }];

  for (const workplace of Array.isArray(workplaces) ? workplaces : []) {
    const key = String(workplace?.key || workplace?.workplaceId || '');
    if (!key) continue;
    options.push({
      value: key,
      label: workplace?.name || 'Без названия',
      meta: month ? monthStatsText(workplaceStats?.[key]) : countsPending ? '' : workplaceMeta(workplace, recordCounts?.[key]),
      indicatorColor: workplace?.indicatorColor || workplace?.color || WORKPLACE_FALLBACK_COLOR,
    });
  }

  return select({
    label: month || list ? 'Рабочее пространство' : 'Режим',
    name: 'journalWorkplaceMode',
    value: workplaceId || ALL_WORKPLACES_ID,
    options,
    aria: list ? 'Выбор списка записей' : month ? 'Выбор графика месяца' : 'Режим рабочего поля журнала',
    data: 'data-journal-workplace-select',
  });
}

/** Fill the Journal Day selector's counts without replacing its live DOM control. */
export function syncJournalDayWorkplaceCounts(layer, {
  workplaces = [], recordCounts = {}, aggregateCount = 0,
} = {}) {
  const input = layer?.querySelector?.('input[name="journalWorkplaceMode"]');
  const trigger = layer?.querySelector?.('[data-ui-select-trigger][data-journal-workplace-select]');
  if (!input || !trigger) return false;
  let options;
  try {
    options = JSON.parse(trigger.dataset.options || '[]');
  } catch {
    return false;
  }
  const byId = new Map((Array.isArray(workplaces) ? workplaces : [])
    .map((item) => [String(item?.key || ''), item]));
  const updated = options.map((option) => {
    const id = String(option?.value || '');
    const meta = id === ALL_WORKPLACES_ID
      ? recordCountText(aggregateCount)
      : workplaceMeta(byId.get(id) || {}, recordCounts[id] || 0);
    return { ...option, meta };
  });
  trigger.dataset.options = JSON.stringify(updated);
  const current = updated.find((option) => option.value === input.value);
  const meta = trigger.querySelector('.ui-select__meta');
  if (meta && current) {
    meta.textContent = current.meta;
    meta.hidden = !current.meta;
  }
  return true;
}

/** Opens a dedicated X sheet for the Journal Day / Month workplace chooser. */
export function openJournalWorkplaceControl({
  workplaces = [],
  workplaceId = '',
  recordCounts = {},
  aggregateCount = 0,
  month = false,
  list = false,
  aggregateStats = null,
  workplaceStats = {},
  availableWorkplaces = [],
  onSelect = () => {},
  onAdd = () => {},
} = {}) {
  const selectorMarkup = journalWorkplaceSelect({
    workplaces, workplaceId, recordCounts, aggregateCount, month, list, aggregateStats, workplaceStats,
  });
  const main = mountModal(document.body, modal(
    `<div class="compact-form">${selectorMarkup}${availableWorkplaces.length ? button('+ Рабочее пространство', { data: 'data-journal-workplace-add' }) : ''}</div>`,
    { variant: 'x', surface: 'app', title: 'Рабочее пространство', className: 'modal--form-sheet' },
  ));
  const input = main?.querySelector('input[name="journalWorkplaceMode"]');
  input?.addEventListener('change', () => {
    const nextId = String(input.value || '');
    if (!nextId) return;
    main.v2Close?.();
    onSelect(nextId);
  });
  main?.querySelector('[data-journal-workplace-add]')?.addEventListener('click', () => {
    main.v2Close?.();
    onAdd();
  });
  return main;
}
