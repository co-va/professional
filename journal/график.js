import { actionBlock, button, initCalendar, initMultiSelect, modal, mountModal, openDayWorkplaceControl, timePicker, initTimePickers, escapeHtml, ALL_WORKPLACES_ID } from '../ui/ui.js';
import { getWorkplaces, resolveWorkplaceTime, getWorkingDayIndicators, getWorkingDayTotalMinutes } from '../core/workplace-time.js';
import { getDays, getDay, getDayTime } from '../core/day/index.js';
import { applyTimetableWorkingDays, applyTimetableDaysOff, applyTimetableTimeCorrection } from '../timetable/day-editor.js';

function datesForWorkplace(days, workplaceId) { return days.filter((item) => item?.workplaceId === workplaceId).map((item) => item.date).filter(Boolean); }
function datesForAllWorkplaces(days) { return [...new Set(days.map((item) => item?.date).filter(Boolean))]; }
function workingDayForDate(days, workplaceId, date) { return getDay(days, workplaceId, date); }
function formatDateLabel(value) { const [year, month, day] = String(value || '').split('-'); return year && month && day ? `${day}.${month}.${year}` : String(value || ''); }
function formatDuration(totalMinutes) {
  const total = Math.max(0, Number(totalMinutes) || 0);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!minutes) return `${hours} ч`;
  if (!hours) return `${minutes} м`;
  return `${hours} ч ${minutes} м`;
}
function occupiedLabel(item) { return item?.type === 'event' ? 'Событие' : 'Запись'; }
export function renderJournalGraphMode({
  root,
  calendarRoot,
  actionsRoot,
  month,
  workplaceId = ALL_WORKPLACES_ID,
  onMonthChange = () => {},
  onDateFocus = () => {},
  onWorkplaceChange = () => {},
  onControls = () => {},
} = {}) {
  const workplaces = getWorkplaces();
  const workingDays = getDays();
  let selectedWorkplaceId = workplaceId || ALL_WORKPLACES_ID;
  const initialMonth = new Date(month.getFullYear(), month.getMonth(), 1);
  actionsRoot.innerHTML = actionBlock(button('Применить', {
    data: 'data-timetable-apply',
    aria: 'Применить',
    disabled: true,
  }));
  const applyButton = actionsRoot.querySelector('[data-timetable-apply]');
  const applyActions = applyButton?.closest('.modal-actions');
  let calendar; let selection; let selectionMode = null;
  const isAllMode = () => selectedWorkplaceId === ALL_WORKPLACES_ID;
  const isWorkingDate = (date) => !isAllMode() && datesForWorkplace(workingDays, selectedWorkplaceId).includes(date);
  const syncApplyButton = (dates) => {
    const allMode = isAllMode();
    if (!dates.length) {
      selectionMode = null;
      applyButton.disabled = true;
      applyButton.textContent = 'Применить';
      applyButton.classList.remove('ui-button--danger');
      applyButton.setAttribute('aria-label', 'Применить');
      if (applyActions) applyActions.hidden = true;
      return;
    }
    const selectedDate = new Date(`${dates[0]}T00:00:00`);
    if (allMode) {
      onDateFocus(selectedDate);
      selectionMode = 'add-workplace';
      applyButton.textContent = 'Применить';
      applyButton.classList.remove('ui-button--danger');
      applyButton.setAttribute('aria-label', 'Применить');
    } else {
      onDateFocus(selectedDate);
      selectionMode = isWorkingDate(dates[0]) ? 'make-off' : 'make-working';
      const makeOff = selectionMode === 'make-off';
      applyButton.textContent = makeOff ? 'Выходной' : 'Рабочий';
      applyButton.classList.toggle('ui-button--danger', makeOff);
      applyButton.setAttribute('aria-label', makeOff ? 'Сделать выходным' : 'Сделать рабочим');
    }
    applyButton.disabled = false;
    if (applyActions) applyActions.hidden = false;
  };
  const guard = (event) => {
    const calendarButton = event.target.closest('[data-calendar-date]'); if (!calendarButton || !selection || isAllMode()) return;
    const date = calendarButton.dataset.calendarDate || ''; if (!date || selection.isSelected(date)) return;
    const mode = isWorkingDate(date) ? 'make-off' : 'make-working';
    if (!selectionMode) selectionMode = mode; else if (mode !== selectionMode) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  calendarRoot.addEventListener('click', guard, true);

  const bindSelection = () => {
    selection?.destroy();
    selection = initMultiSelect(calendarRoot, { onChange: syncApplyButton });
    syncApplyButton([]);
  };

  const startSelectionSession = (month) => {
    const allMode = isAllMode();
    calendar = initCalendar(calendarRoot, {
      month,
      workingDates: allMode ? datesForAllWorkplaces(workingDays) : datesForWorkplace(workingDays, selectedWorkplaceId),
      renderDateContent: ({ dateKey, isCurrentMonth, isWorking }) => {
        if (!isCurrentMonth || !isWorking) return '';
        if (allMode) return `<span>${escapeHtml(formatDuration(getWorkingDayTotalMinutes(workingDays, workplaces, dateKey)))}</span>`;
        const time = getDayTime(workingDayForDate(workingDays, selectedWorkplaceId, dateKey), workplaces);
        return time ? `<span>${time.from}</span><span>${time.to}</span>` : '';
      },
      resolveDateIndicators: ({ dateKey, isCurrentMonth }) => isCurrentMonth
        ? getWorkingDayIndicators(workingDays, workplaces, dateKey, { excludeWorkplaceId: allMode ? '' : selectedWorkplaceId })
        : [],
      onDateSelect: (date) => {
        if (!date) return;
        const nextDate = new Date(`${date}T00:00:00`);
        onDateFocus(nextDate);
      },
      onMonthChange: (nextMonth) => {
        bindSelection();
        onMonthChange(nextMonth);
        
      },
    });
    bindSelection();
  };

  const applySelectedWorkingDays = (dates, workplaceId = selectedWorkplaceId) => {
    applyTimetableWorkingDays({
      dates,
      workplaceId,
      workingDays,
      workplaces,
      onSave: () => {
        const month = calendar?.getDisplayedMonth() || initialMonth;
        startSelectionSession(month);
        
      },
    });
  };

  function openAggregateWorkplaceApply(dates) {
    openDayWorkplaceControl({
      active: [],
      available: workplaces.filter((item) => dates.some((date) => !getDay(workingDays, item.key, date))),
      catalogTitle: 'Рабочее пространство',
      onAdd: (id) => applySelectedWorkingDays(dates, id),
    });
  }

  function openRemovalBlockedModal(entries = []) {
    const blocked = (Array.isArray(entries) ? entries : []).filter((entry) => Array.isArray(entry?.conflicts) && entry.conflicts.length);
    if (!blocked.length) return;
    const workplace = workplaces.find((item) => String(item?.key || '') === String(selectedWorkplaceId || '')) || null;
    const workplaceName = workplace?.name || 'Рабочее пространство';
    const multiple = blocked.length > 1;
    const title = multiple ? 'Не все дни можно сделать выходными' : 'День нельзя сделать выходным';
    const description = multiple
      ? `${workplaceName}: на этих датах есть занятое время. Рабочие дни сохранены.`
      : `${workplaceName}: на этой дате есть занятое время. Рабочий день сохранён.`;
    const rows = blocked.map((entry) => {
      const details = entry.conflicts
        .filter((conflict) => conflict?.from && conflict?.to)
        .map((conflict) => `${occupiedLabel(conflict)} ${conflict.from}–${conflict.to}`)
        .join(', ');
      return `<div><span>${escapeHtml(formatDateLabel(entry.date))}</span><strong>${escapeHtml(details || 'Есть занятое время')}</strong></div>`;
    }).join('');
    const content = `<div class="modal-title"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div><div class="entity-details">${rows}</div>${button('Понятно', { data: 'data-removal-blocked-close' })}`;
    const m = mountModal(document.body, modal(content, { title, variant: 'x' }));
    if (!m) return;
    m.querySelector('[data-removal-blocked-close]')?.addEventListener('click', () => m.remove());
  }

  function openSelectedWorkingTimeCorrection(dates = selection?.getSelectedDates?.() || []) {
    const selected = (Array.isArray(dates) ? dates : []).filter((date) => getDay(workingDays, selectedWorkplaceId, date));
    if (!selected.length || isAllMode()) return;

    const first = getDayTime(getDay(workingDays, selectedWorkplaceId, selected[0]), workplaces)
      || resolveWorkplaceTime(workplaces, selectedWorkplaceId)
      || { from: '09:00', to: '18:00' };

    const content = `<div class="compact-form">
      <div class="modal-title"><h2>Время работы</h2><p>Изменение применяется к выбранным рабочим датам.</p></div>
      <div class="time-range-fields">
        ${timePicker({ name: 'timetableCorrectionFrom', label: 'С', value: first.from, minuteStep: 1 })}
        ${timePicker({ name: 'timetableCorrectionTo', label: 'До', value: first.to, minuteStep: 1 })}
      </div>
      <div class="form-error" data-timetable-correction-error aria-live="polite"></div>
      ${button('Сохранить', { data: 'data-timetable-correction-save' })}
    </div>`;

    const m = mountModal(document.body, modal(content, { title: 'Время работы', variant: 'x' }));
    if (!m) return;
    initTimePickers(m);

    m.querySelector('[data-timetable-correction-save]')?.addEventListener('click', () => {
      const from = m.querySelector('[name="timetableCorrectionFrom"]')?.value || '';
      const to = m.querySelector('[name="timetableCorrectionTo"]')?.value || '';
      const result = applyTimetableTimeCorrection({
        dates: selected,
        workplaceId: selectedWorkplaceId,
        from,
        to,
        workingDays,
      });
      if (!result.ok) {
        const error = m.querySelector('[data-timetable-correction-error]');
        if (error) error.textContent = result.message;
        return;
      }
      const month = calendar?.getDisplayedMonth() || initialMonth;
      m.v2Close?.();
      startSelectionSession(month);
    });
  }
  function selectGraphWorkplace(nextId) {
    const id = String(nextId || '');
    if (id !== ALL_WORKPLACES_ID && !workplaces.some((item) => String(item?.key || '') === id)) return;
    selectedWorkplaceId = id;
    onWorkplaceChange(id);
    startSelectionSession(calendar?.getDisplayedMonth() || initialMonth);
  }

  if (workplaces.length) startSelectionSession(initialMonth); else calendar = initCalendar(calendarRoot, { month: initialMonth, workingDates: [] });
  onControls({
    selectWorkplace: selectGraphWorkplace,
    openTime: () => openSelectedWorkingTimeCorrection(),
    canEditTime: () => !isAllMode() && (selection?.getSelectedDates?.() || [])
      .some((date) => Boolean(getDay(workingDays, selectedWorkplaceId, date))),
  });

  applyButton.addEventListener('click', () => {
    const dates = selection?.getSelectedDates?.() || [];
    if (!dates.length || !selectionMode) return;
    if (isAllMode()) {
      openAggregateWorkplaceApply(dates);
      return;
    }
    const makeWorking = selectionMode === 'make-working';
    if (makeWorking) {
      applySelectedWorkingDays(dates);
      return;
    }

    const result = applyTimetableDaysOff({
      dates,
      workplaceId: selectedWorkplaceId,
      workingDays,
    });
    if (result.changed) startSelectionSession(calendar.getDisplayedMonth());
    if (result.blocked.length) openRemovalBlockedModal(result.blocked);
  });

  let refreshQueued = false;
  const syncCanonicalState = () => {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      if (!root.isConnected) return;
      const nextWorkplaces = getWorkplaces();
      const nextDays = getDays();
      workplaces.splice(0, workplaces.length, ...nextWorkplaces);
      workingDays.splice(0, workingDays.length, ...nextDays);
      if (!isAllMode() && !workplaces.some((item) => String(item?.key || '') === String(selectedWorkplaceId || ''))) {
        selectedWorkplaceId = ALL_WORKPLACES_ID;
        onWorkplaceChange(selectedWorkplaceId);
      }
      const month = calendar?.getDisplayedMonth?.() || initialMonth;
      if (workplaces.length) startSelectionSession(month);
      else calendar = initCalendar(calendarRoot, { month, workingDates: [] });
      
    });
  };
  window.addEventListener('professional:time-usage-changed', syncCanonicalState);
  window.addEventListener('professional:workplaces-changed', syncCanonicalState);

  return () => {
    onControls(null);
    window.removeEventListener('professional:time-usage-changed', syncCanonicalState);
    window.removeEventListener('professional:workplaces-changed', syncCanonicalState);
    selection?.destroy?.();
  };
}
