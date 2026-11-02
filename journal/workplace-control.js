import { ALL_WORKPLACES_ID, modal, mountModal, select } from '../ui/ui.js';

const WORKPLACE_FALLBACK_COLOR = '#212529';

function recordCountText(count = 0) {
  return `${Math.max(0, Number(count) || 0)} записей`;
}

function workplaceMeta(workplace = {}, count = 0) {
  const range = workplace?.from && workplace?.to ? `${workplace.from} - ${workplace.to}` : '';
  return [range, recordCountText(count)].filter(Boolean).join(' · ');
}

/**
 * Journal-owned workplace selector.
 * The Journal owns aggregate semantics; Shared Select owns the visual control
 * and its bottom selector manifestation.
 */
export function openJournalWorkplaceControl({
  workplaces = [],
  workplaceId = '',
  recordCounts = {},
  aggregateCount = 0,
  onSelect = () => {},
} = {}) {
  const options = [{
    value: ALL_WORKPLACES_ID,
    label: 'График дня',
    meta: recordCountText(aggregateCount),
    indicatorColor: '',
  }];

  for (const workplace of Array.isArray(workplaces) ? workplaces : []) {
    const key = String(workplace?.key || workplace?.workplaceId || '');
    if (!key) continue;
    options.push({
      value: key,
      label: workplace?.name || 'Без названия',
      meta: workplaceMeta(workplace, recordCounts?.[key]),
      indicatorColor: workplace?.indicatorColor || workplace?.color || WORKPLACE_FALLBACK_COLOR,
    });
  }

  const main = mountModal(document.body, modal(
    `<div class="compact-form">${select({
      label: 'Режим',
      name: 'journalWorkplaceMode',
      value: workplaceId || ALL_WORKPLACES_ID,
      options,
      aria: 'Режим рабочего поля журнала',
      data: 'data-journal-workplace-select',
    })}</div>`,
    { variant: 'x', surface: 'app', title: 'Рабочее пространство', className: 'modal--form-sheet' },
  ));
  const input = main?.querySelector('input[name="journalWorkplaceMode"]');
  input?.addEventListener('change', () => {
    const nextId = String(input.value || '');
    if (!nextId) return;
    main.v2Close?.();
    onSelect(nextId);
  });
  return main;
}
