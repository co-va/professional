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
  metaPending = false,
} = {}) {
  const options = [{
    value: ALL_WORKPLACES_ID,
    label: list ? 'Общий список' : month ? 'Общий график' : 'График дня',
    meta: metaPending ? '' : month ? monthStatsText(aggregateStats) : recordCountText(aggregateCount),
    indicatorColor: '',
  }];

  for (const workplace of Array.isArray(workplaces) ? workplaces : []) {
    const key = String(workplace?.key || workplace?.workplaceId || '');
    if (!key) continue;
    options.push({
      value: key,
      label: workplace?.name || 'Без названия',
      meta: metaPending ? '' : month ? monthStatsText(workplaceStats?.[key]) : workplaceMeta(workplace, recordCounts?.[key]),
      indicatorColor: workplace?.indicatorColor || workplace?.color || WORKPLACE_FALLBACK_COLOR,
    });
  }

  return select({
    // Journal X has no visual heading: the mode is clear from the selected value.
    // Keep the explicit aria name below for assistive technology.
    name: 'journalWorkplaceMode',
    value: workplaceId || ALL_WORKPLACES_ID,
    options,
    aria: list ? 'Выбор списка записей' : month ? 'Выбор графика месяца' : 'Режим рабочего поля журнала',
    data: 'data-journal-workplace-select',
  });
}

/**
 * Update only option metadata on an already displayed Journal X.
 * No selector replacement, no new handlers, and no action/button mutations.
 */
export function updateJournalWorkplaceMetas(layer, {
  workplaces = [], recordCounts = {}, aggregateCount = 0,
  month = false, aggregateStats = null, workplaceStats = {},
} = {}) {
  if (!layer?.isConnected) return false;
  const input = layer.querySelector('input[name="journalWorkplaceMode"]');
  const trigger = layer.querySelector('[data-ui-select-trigger][data-journal-workplace-select]');
  if (!input || !trigger) return false;
  let options;
  try {
    options = JSON.parse(trigger.dataset.options || '[]');
  } catch {
    return false;
  }
  if (!Array.isArray(options)) return false;
  const byId = new Map((Array.isArray(workplaces) ? workplaces : [])
    .map((workplace) => [String(workplace?.key || workplace?.workplaceId || ''), workplace]));
  const updated = options.map((option) => {
    const id = String(option?.value || '');
    const meta = id === ALL_WORKPLACES_ID
      ? (month ? monthStatsText(aggregateStats) : recordCountText(aggregateCount))
      : (month
        ? monthStatsText(workplaceStats?.[id])
        : workplaceMeta(byId.get(id) || {}, recordCounts?.[id]));
    return { ...option, meta };
  });
  trigger.dataset.options = JSON.stringify(updated);
  const selected = updated.find((item) => item.value === input.value);
  const meta = trigger.querySelector('.ui-select__meta');
  if (meta && selected) {
    meta.textContent = selected.meta;
    meta.hidden = !selected.meta;
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
