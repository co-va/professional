import { button, escapeHtml, initTimePickers, modal, mountModal, openDayWorkplaceControl, openDayWorkplaceTime, timePicker } from '../ui/ui.js';
import { createDay, findSuggestedInterval, getDay, getDayDraftScheduleConflicts, getDayTime, getDays, getDaysForDate, getScheduleConflicts, removeDay, saveDays, updateDayTime } from '../core/day/index.js';
import { getWorkingTimeUsageConflicts } from '../core/time/index.js';
import { isValidRange } from '../core/time/index.js';
import { getWorkplaces, resolveWorkplaceTime } from '../core/workplace-time.js';

function dateKey(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value || '').slice(0, 10);
}

function formatModalDate(value) {
  const key = dateKey(value);
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const [, month, day] = key.split('-');
  const monthName = months[Math.max(0, Number(month) - 1)] || '';
  return day && monthName ? `${Number(day)} ${monthName}` : key;
}

function usageLabel(usage) {
  return usage?.type === 'break' ? 'Перерыв' : 'Запись';
}

function dayEntries(date, workingDays, workplaces) {
  return getDaysForDate(workingDays, date).map((day) => {
    const workplaceId = String(day?.workplaceId || '');
    const workplace = workplaces.find((item) => String(item?.key || '') === workplaceId) || null;
    const time = getDayTime(day, workplaces);
    if (!workplaceId || !time) return null;
    return {
      workplaceId,
      name: workplace?.name || 'Рабочее пространство',
      from: time.from,
      to: time.to,
    };
  }).filter(Boolean);
}

function suggestedEntry({ workplaceId, date, workingDays, workplaces }) {
  const workplace = workplaces.find((item) => String(item?.key || '') === String(workplaceId || '')) || null;
  const base = resolveWorkplaceTime(workplaces, workplaceId);
  if (!workplace || !base) return null;
  const suggested = findSuggestedInterval(workingDays, {
    workplaceId,
    date,
    baseFrom: base.from,
    baseTo: base.to,
  }) || base;
  return {
    workplaceId: String(workplaceId),
    name: workplace.name || 'Рабочее пространство',
    from: suggested.from,
    to: suggested.to,
  };
}

export function makeTimetableDayOff({
  date,
  workplaceId,
  onSave = () => {},
} = {}) {
  const day = dateKey(date);
  const id = String(workplaceId || '');
  if (!day || !id) return false;
  const workingDays = getDays();
  if (!removeDay(workingDays, id, day)) return false;
  const result = saveDays(workingDays);
  if (!result?.ok) return false;
  onSave({ date: day, workplaceId: id });
  return true;
}

export function openTimetableDayTimeEditor({
  date,
  workplaceId = '',
  onSave = () => {},
} = {}) {
  const day = dateKey(date);
  const id = String(workplaceId || '');
  if (!day || !id) return null;

  const workplaces = getWorkplaces();
  const workingDays = getDays();
  const existing = getDay(workingDays, id, day);
  const current = getDayTime(existing, workplaces) || resolveWorkplaceTime(workplaces, id);
  if (!current) return null;

  return openDayWorkplaceTime({
    title: 'Время работы',
    from: current.from,
    to: current.to,
    onSave: ({ from, to }) => {
      if (!isValidRange(from, to)) return { ok: false, message: 'Окончание должно быть позже начала.' };

      const usage = getWorkingTimeUsageConflicts({ date: day, workplaceId: id, from, to })
        .filter((item) => item?.from && item?.to);
      if (usage.length) {
        return {
          ok: false,
          message: usage.map((item) => `${usageLabel(item)} ${item.from}–${item.to} выходит за рабочее время`).join('. '),
        };
      }

      const schedule = getScheduleConflicts(workingDays, { workplaceId: id, date: day, from, to });
      if (schedule.length) return { ok: false, message: 'Время пересекается с другим рабочим пространством.' };

      if (existing) updateDayTime(workingDays, id, day, from, to);
      else {
        const created = createDay({ date: day, workplaceId: id, from, to });
        if (created) workingDays.push(created);
      }
      const saved = saveDays(workingDays);
      if (saved?.ok === false) return { ok: false, message: 'Не удалось сохранить рабочее время.' };
      onSave({ date: day, workplaceId: id, from, to });
      return { ok: true };
    },
  });
}

export function openTimetableDayEditor({
  date,
  focusWorkplaceId = '',
  onSave = () => {},
} = {}) {
  const day = dateKey(date);
  if (!day) return null;

  const workplaces = getWorkplaces();
  const workingDays = getDays();
  const entries = dayEntries(day, workingDays, workplaces);
  const focusId = String(focusWorkplaceId || '');

  if (focusId && !entries.some((entry) => entry.workplaceId === focusId)) {
    const draft = suggestedEntry({ workplaceId: focusId, date: day, workingDays, workplaces });
    if (draft) entries.push(draft);
  }
  if (focusId) entries.sort((left, right) => Number(right.workplaceId === focusId) - Number(left.workplaceId === focusId));

  const rowMarkup = (entry, index) => `<div class="compact-form" data-aggregate-workplace="${escapeHtml(entry.workplaceId)}"><strong>${escapeHtml(entry.name)}</strong><div class="time-range-fields">${timePicker({ name: `aggregateFrom${index}`, label: 'Начало', value: entry.from })}${timePicker({ name: `aggregateTo${index}`, label: 'Окончание', value: entry.to })}</div><div class="form-error" data-aggregate-error="${index}" aria-live="polite"></div></div>`;
  const title = formatModalDate(day);
  const content = `<div class="compact-form"><div class="modal-title"><h2>${escapeHtml(title)}</h2></div><div data-aggregate-day-rows>${entries.map(rowMarkup).join('')}</div>${button('+ Добавить рабочее пространство', { variant: 'secondary', data: 'data-aggregate-day-add' })}${button('Применить', { data: 'data-aggregate-day-apply' })}</div>`;
  const main = mountModal(document.body, modal(content, { title, variant: 'q' }));
  if (!main) return null;

  initTimePickers(main);
  const rowsRoot = main.querySelector('[data-aggregate-day-rows]');
  const addButton = main.querySelector('[data-aggregate-day-add]');
  const saveButton = main.querySelector('[data-aggregate-day-apply]');

  const availableWorkplaces = () => {
    const active = new Set(entries.map((entry) => String(entry.workplaceId || '')));
    return workplaces.filter((workplace) => {
      const key = String(workplace?.key || '');
      return key && !active.has(key);
    });
  };

  const syncAddButton = () => {
    if (addButton) addButton.hidden = availableWorkplaces().length === 0;
  };

  const readValues = () => entries.map((entry, index) => ({
    ...entry,
    from: main.querySelector(`[name="aggregateFrom${index}"]`)?.value || entry.from,
    to: main.querySelector(`[name="aggregateTo${index}"]`)?.value || entry.to,
  }));

  const validate = () => {
    const values = readValues();
    const errors = values.map(() => []);

    values.forEach((value, index) => {
      if (!isValidRange(value.from, value.to)) errors[index].push('Проверьте рабочее время.');
    });

    getDayDraftScheduleConflicts(values).forEach((conflict) => {
      const overlap = `${conflict.from}–${conflict.to}`;
      errors[conflict.leftIndex].push(`Пересечение с ${values[conflict.rightIndex].name}: ${overlap}`);
      errors[conflict.rightIndex].push(`Пересечение с ${values[conflict.leftIndex].name}: ${overlap}`);
    });

    values.forEach((value, index) => {
      if (!isValidRange(value.from, value.to)) return;
      const conflicts = getWorkingTimeUsageConflicts({
        date: day,
        workplaceId: value.workplaceId,
        from: value.from,
        to: value.to,
      });
      conflicts.forEach((conflict) => {
        if (!conflict?.from || !conflict?.to) return;
        errors[index].push(`${usageLabel(conflict)} ${conflict.from}–${conflict.to} выходит за рабочее время`);
      });
    });

    errors.forEach((messages, index) => {
      const error = main.querySelector(`[data-aggregate-error="${index}"]`);
      if (error) error.innerHTML = messages.map((message) => `<div>${escapeHtml(message)}</div>`).join('');
    });

    const hasErrors = errors.some((messages) => messages.length > 0);
    if (saveButton) saveButton.disabled = hasErrors || values.length === 0;
    return { ok: !hasErrors && values.length > 0, values };
  };

  const appendWorkplace = (workplaceId) => {
    if (entries.some((entry) => entry.workplaceId === String(workplaceId || ''))) return;
    const entry = suggestedEntry({ workplaceId, date: day, workingDays, workplaces });
    if (!entry) return;
    entries.push(entry);
    const shell = document.createElement('div');
    shell.innerHTML = rowMarkup(entry, entries.length - 1);
    const row = shell.firstElementChild;
    if (row && rowsRoot) {
      rowsRoot.append(row);
      initTimePickers(row);
    }
    syncAddButton();
    validate();
  };

  addButton?.addEventListener('click', () => {
    const available = availableWorkplaces();
    if (!available.length) return;
    openDayWorkplaceControl({
      active: [],
      available,
      catalogTitle: 'Добавить рабочее пространство',
      onAdd: appendWorkplace,
    });
  });

  main.addEventListener('change', (event) => {
    if (event.target?.matches?.('[data-time-value]')) validate();
  });

  syncAddButton();
  validate();

  saveButton?.addEventListener('click', () => {
    const result = validate();
    if (!result.ok) return;

    result.values.forEach((value) => {
      const existing = getDay(workingDays, value.workplaceId, day);
      if (existing) updateDayTime(workingDays, value.workplaceId, day, value.from, value.to);
      else {
        const nextDay = createDay({ date: day, workplaceId: value.workplaceId, from: value.from, to: value.to });
        if (nextDay) workingDays.push(nextDay);
      }
    });

    saveDays(workingDays);
    main.remove();
    onSave({ date: day, values: result.values });
  });

  return main;
}
