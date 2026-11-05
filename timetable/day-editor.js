import { button, escapeHtml, initTimePickers, modal, mountModal, openDayWorkplaceControl, openDayWorkplaceTime, timePicker, twoColumnLayout } from '../ui/ui.js';
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
  return usage?.type === 'event' ? 'Событие' : 'Запись';
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
  workplaceIds = [],
  onSave = () => {},
} = {}) {
  const day = dateKey(date);
  const ids = [...new Set((workplaceIds.length ? workplaceIds : [workplaceId])
    .map((value) => String(value || '')).filter(Boolean))];
  if (!day || !ids.length) return false;
  const workingDays = getDays();
  if (ids.some((id) => !getDay(workingDays, id, day) || getWorkingTimeUsageConflicts({
    operation: 'remove', date: day, workplaceId: id,
  }).length > 0)) return false;
  for (const id of ids) {
    if (!removeDay(workingDays, id, day)) return false;
  }
  const result = saveDays(workingDays);
  if (!result?.ok) return false;
  onSave({ date: day, workplaceIds: ids });
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

// One Timetable-owned day creation path for both Timetable and Journal.
export function applyTimetableWorkingDays({
  dates = [],
  workplaceId = '',
  base = null,
  workingDays = getDays(),
  workplaces = getWorkplaces(),
  onSave = () => {},
} = {}) {
  const selectedWorkplaceId = String(workplaceId || '');
  if (!selectedWorkplaceId || !Array.isArray(dates) || !dates.length) return false;
  const formatDateLabel = (value) => {
    const [year, month, day] = String(value || '').split('-');
    return year && month && day ? `${day}.${month}.${year}` : String(value || '');
  };

  function conflictWorkplaceLabel(day) {
    return workplaces.find((item) => String(item?.key || '') === String(day?.workplaceId || ''))?.name || 'Другое место работы';
  }

  function buildConflictEntry(date, base, workplaceId = selectedWorkplaceId) {
    const conflicts = getScheduleConflicts(workingDays, { workplaceId, date, from: base.from, to: base.to });
    if (!conflicts.length) return null;
    const suggested = findSuggestedInterval(workingDays, { workplaceId, date, baseFrom: base.from, baseTo: base.to });
    return { date, conflicts, suggested };
  }

  function conflictParticipant(day, { target = false, from = '', to = '' } = {}) {
    const workplaceId = String(day?.workplaceId || selectedWorkplaceId || '');
    return {
      workplaceId,
      name: target ? (workplaces.find((item) => String(item?.key || '') === workplaceId)?.name || 'Рабочее пространство') : conflictWorkplaceLabel(day),
      from: String(from || day?.from || ''),
      to: String(to || day?.to || ''),
      target,
    };
  }

  function conflictParticipants(entry, base, workplaceId = selectedWorkplaceId) {
    const target = conflictParticipant({ workplaceId }, {
      target: true,
      from: entry.suggested?.from || base.from,
      to: entry.suggested?.to || base.to,
    });
    const seen = new Set([target.workplaceId]);
    const existing = [];
    entry.conflicts.forEach((day) => {
      const workplaceId = String(day?.workplaceId || '');
      if (!workplaceId || seen.has(workplaceId)) return;
      seen.add(workplaceId);
      existing.push(conflictParticipant(day));
    });
    return [target, ...existing];
  }

  function draftDaysForConflict(date, participants) {
    const ids = new Set(participants.map((item) => String(item?.workplaceId || '')));
    const untouched = workingDays.filter((day) => String(day?.date || '').slice(0, 10) !== String(date || '').slice(0, 10)
      || !ids.has(String(day?.workplaceId || '')));
    const drafts = participants.map((item) => ({ date, workplaceId: item.workplaceId, from: item.from, to: item.to }));
    return [...untouched, ...drafts];
  }

  function draftScheduleConflicts(date, participants) {
    const draftDays = draftDaysForConflict(date, participants);
    const found = [];
    const seen = new Set();
    participants.forEach((participant) => {
      getScheduleConflicts(draftDays, {
        workplaceId: participant.workplaceId,
        date,
        from: participant.from,
        to: participant.to,
      }).forEach((other) => {
        const pair = [String(participant.workplaceId || ''), String(other?.workplaceId || '')].sort().join('::');
        if (!other?.workplaceId || seen.has(pair)) return;
        seen.add(pair);
        found.push({ participant, other });
      });
    });
    return found;
  }

  function expandConflictParticipants(participants, conflicts) {
    const next = participants.map((item) => ({ ...item }));
    const seen = new Set(next.map((item) => String(item?.workplaceId || '')));
    conflicts.forEach(({ other }) => {
      const workplaceId = String(other?.workplaceId || '');
      if (!workplaceId || seen.has(workplaceId)) return;
      seen.add(workplaceId);
      next.push(conflictParticipant(other));
    });
    return next;
  }

  function usageConflictMessages(date, participants) {
    const messages = [];
    participants.forEach((participant) => {
      if (!isValidRange(participant.from, participant.to)) return;
      getWorkingTimeUsageConflicts({
        date,
        workplaceId: participant.workplaceId,
        from: participant.from,
        to: participant.to,
      }).forEach((conflict) => {
        if (!conflict?.from || !conflict?.to) return;
        messages.push(`${participant.name}: ${usageLabel(conflict)} ${conflict.from}–${conflict.to} выходит за рабочее время.`);
      });
    });
    return messages;
  }

  function openWorkingDaysConflictModal(entries, base, workplaceId = selectedWorkplaceId) {
    let activeEntries = entries.map((entry) => ({
      date: entry.date,
      participants: conflictParticipants(entry, base, workplaceId),
      error: '',
    }));

    const rowMarkup = (entry, entryIndex) => {
      const participants = entry.participants.map((participant, participantIndex) => {
        const role = participant.target ? 'Добавляем' : 'Уже в графике';
        const timeFields = twoColumnLayout(
          timePicker({ name: `timetableConflictFrom${entryIndex}_${participantIndex}`, label: 'Начало', value: participant.from }),
          timePicker({ name: `timetableConflictTo${entryIndex}_${participantIndex}`, label: 'Окончание', value: participant.to }),
          { ariaLabel: `Интервал ${participant.name}` },
        );
        return `<div class="compact-form" data-timetable-conflict-participant="${participantIndex}"><div class="entity-details"><div><span>${escapeHtml(role)}</span><strong>${escapeHtml(participant.name)}</strong></div></div>${timeFields}</div>`;
      }).join('');
      return `<div class="compact-form" data-timetable-conflict-row="${entryIndex}"><div class="entity-details"><div><span>Дата</span><strong>${escapeHtml(formatDateLabel(entry.date))}</strong></div></div>${participants}<div class="form-error" data-timetable-conflict-error="${entryIndex}">${escapeHtml(entry.error || '')}</div></div>`;
    };

    const content = `<div class="modal-title"><h2>Конфликт времени</h2><p>Можно изменить время нового и уже существующих рабочих мест. Исправленные даты применяются сразу, остальные остаются для дальнейшей корректировки.</p></div><div data-timetable-conflict-rows></div>${button('Сохранить', { data: 'data-timetable-conflicts-save' })}`;
    const m = mountModal(document.body, modal(content, { title: 'Конфликт времени', variant: 'q' }));
    if (!m) return;
    const rowsRoot = m.querySelector('[data-timetable-conflict-rows]');

    const renderRows = () => {
      if (!rowsRoot) return;
      rowsRoot.innerHTML = activeEntries.map(rowMarkup).join('');
      initTimePickers(rowsRoot);
    };

    const readParticipants = (entry, entryIndex) => entry.participants.map((participant, participantIndex) => ({
      ...participant,
      from: m.querySelector(`[name="timetableConflictFrom${entryIndex}_${participantIndex}"]`)?.value || participant.from,
      to: m.querySelector(`[name="timetableConflictTo${entryIndex}_${participantIndex}"]`)?.value || participant.to,
    }));

    renderRows();
    m.querySelector('[data-timetable-conflicts-save]')?.addEventListener('click', () => {
      const remaining = [];
      let applied = 0;

      activeEntries.forEach((entry, entryIndex) => {
        const participants = readParticipants(entry, entryIndex);
        if (participants.some((participant) => !isValidRange(participant.from, participant.to))) {
          remaining.push({ ...entry, participants, error: 'Окончание должно быть позже начала.' });
          return;
        }

        const usageErrors = usageConflictMessages(entry.date, participants);
        if (usageErrors.length) {
          remaining.push({ ...entry, participants, error: usageErrors.join(' ') });
          return;
        }

        const scheduleConflicts = draftScheduleConflicts(entry.date, participants);
        if (scheduleConflicts.length) {
          remaining.push({
            ...entry,
            participants: expandConflictParticipants(participants, scheduleConflicts),
            error: 'Время всё ещё пересекается. Скорректируйте рабочие места этой даты.',
          });
          return;
        }

        participants.forEach((participant) => {
          const existing = getDay(workingDays, participant.workplaceId, entry.date);
          if (existing) updateDayTime(workingDays, participant.workplaceId, entry.date, participant.from, participant.to);
          else {
            const day = createDay({ date: entry.date, workplaceId: participant.workplaceId, from: participant.from, to: participant.to });
            if (day) workingDays.push(day);
          }
        });
        applied += 1;
      });

      if (applied) {
        saveDays(workingDays);
        onSave();
      }

      if (!remaining.length) {
        m.remove();
        return;
      }

      activeEntries = remaining;
      renderRows();
    });
  }

  function applyWorkingDays(dates, base, workplaceId = selectedWorkplaceId) {
    const candidates = dates.filter((date) => !getDay(workingDays, workplaceId, date));
    const conflictEntries = candidates.map((date) => buildConflictEntry(date, base, workplaceId)).filter(Boolean);
    const conflictDates = new Set(conflictEntries.map((entry) => entry.date));
    const freeDates = candidates.filter((date) => !conflictDates.has(date));
    for (const date of freeDates) {
      const day = createDay({ date, workplaceId, from: base.from, to: base.to });
      if (day) workingDays.push(day);
    }
    if (freeDates.length) saveDays(workingDays);
    if (conflictEntries.length) {
      if (freeDates.length) onSave();
      openWorkingDaysConflictModal(conflictEntries, base, workplaceId);
      return;
    }
    saveDays(workingDays);
    onSave();
  }

  function openWorkingTimePicker(dates, workplaceId = selectedWorkplaceId) {
    const content = `<div class="modal-title"><h2>Рабочее время</h2><p>У этого рабочего места время не задано. Выберите интервал для отмеченных дат. Постоянное расписание рабочего места не изменится.</p></div><div class="compact-form">${timePicker({ name: 'timetableWorkingFrom', label: 'Начало', value: '00:00' })}${timePicker({ name: 'timetableWorkingTo', label: 'Окончание', value: '00:00' })}<div class="form-error" data-timetable-working-time-error></div>${button('Применить', { data: 'data-timetable-working-time-save' })}</div>`;
    const m = mountModal(document.body, modal(content, { title: 'Рабочее время', variant: 'x' }));
    if (!m) return;
    initTimePickers(m);
    m.querySelector('[data-timetable-working-time-save]')?.addEventListener('click', () => {
      const from = m.querySelector('[name="timetableWorkingFrom"]')?.value || '';
      const to = m.querySelector('[name="timetableWorkingTo"]')?.value || '';
      const error = m.querySelector('[data-timetable-working-time-error]');
      if (!isValidRange(from, to)) {
        if (error) error.textContent = 'Окончание должно быть позже начала.';
        return;
      }
      if (error) error.textContent = '';
      m.remove();
      applyWorkingDays(dates, { from, to }, workplaceId);
    });
  }

  const schedule = base || resolveWorkplaceTime(workplaces, selectedWorkplaceId);
  if (!schedule) openWorkingTimePicker(dates, selectedWorkplaceId);
  else applyWorkingDays(dates, schedule, selectedWorkplaceId);
  return true;
}
