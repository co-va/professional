import { actionBlock, button, initCalendar, initMultiSelect, modal, mountModal, openDayWorkplaceControl, timePicker, initTimePickers, escapeHtml, ALL_WORKPLACES_ID } from '../ui/ui.js';
import { getWorkplaces, resolveWorkplaceTime, getWorkingDayIndicators, getWorkingDayTotalMinutes } from '../core/workplace-time.js';
import { getDays, getDay, getDayTime } from '../core/day/index.js';
import { isValidRange } from '../core/time/index.js';
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
  const timePlans = new Map();
  const timePlanKey = () => {
    const shown = calendar?.getDisplayedMonth?.() || initialMonth;
    return `${selectedWorkplaceId}:${shown.getFullYear()}-${shown.getMonth() + 1}`;
  };
  const selectedTimePlan = () => timePlans.get(timePlanKey()) || null;
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
      if (selectedTimePlan()) {
        selectionMode = 'set-time';
        applyButton.textContent = 'Применить время';
        applyButton.classList.remove('ui-button--danger');
        applyButton.setAttribute('aria-label', 'Применить выбранное время к датам');
      } else {
        selectionMode = isWorkingDate(dates[0]) ? 'make-off' : 'make-working';
        const makeOff = selectionMode === 'make-off';
        applyButton.textContent = makeOff ? 'Выходной' : 'Рабочий';
        applyButton.classList.toggle('ui-button--danger', makeOff);
        applyButton.setAttribute('aria-label', makeOff ? 'Сделать выходным' : 'Сделать рабочим');
      }
    }
    applyButton.disabled = false;
    if (applyActions) applyActions.hidden = false;
  };
  const guard = (event) => {
    const calendarButton = event.target.closest('[data-calendar-date]'); if (!calendarButton || !selection || isAllMode() || selectedTimePlan()) return;
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

  // SModal is informational: bulk Day-off is applied to free dates only.
  // Blocked dates keep their WorkPlan. No confirmation button is needed.
  function showDayOffResult({ blocked = [], applied = [], error = false } = {}) {
    const protectedDates = (Array.isArray(blocked) ? blocked : [])
      .filter((entry) => Array.isArray(entry?.conflicts) && entry.conflicts.length)
      .sort((left, right) => String(left.date).localeCompare(String(right.date)));
    if (!protectedDates.length && applied.length) return;

    const countLabel = (count, singular, plural2, plural5) => {
      const last2 = count % 100;
      if (last2 >= 11 && last2 <= 14) return `${count} ${plural5}`;
      const last = count % 10;
      return `${count} ${last === 1 ? singular : last >= 2 && last <= 4 ? plural2 : plural5}`;
    };
    const title = error ? 'Не удалось применить выходной'
      : protectedDates.length
        ? applied.length ? 'Не все дни можно сделать выходными'
          : protectedDates.length === 1 ? 'День нельзя сделать выходным'
            : 'Выбранные дни нельзя сделать выходными'
        : 'Дни не изменены';
    const summary = error
      ? 'Данные графика не изменены. Проверьте актуальность выбранных дат.'
      : applied.length
        ? `Свободные даты переведены в выходные (${countLabel(applied.length, 'день', 'дня', 'дней')}). Занятые даты остались рабочими.`
        : protectedDates.length
          ? 'Занятые дни остались рабочими. Ничего не удалено.'
          : 'Для выбранных дат нет рабочих дней, которые можно сделать выходными.';
    const rows = protectedDates.map(({ date, conflicts }) => {
      const records = new Set(conflicts
        .filter((usage) => usage?.type === 'record')
        .map((usage, i) => String(usage?.sourceId || usage?.id || `record-${i}`)));
      const events = new Set(conflicts
        .filter((usage) => usage?.type === 'event')
        .map((usage, i) => String(usage?.sourceId || usage?.id || `event-${i}`)));
      const details = [
        records.size ? countLabel(records.size, 'запись', 'записи', 'записей') : '',
        events.size ? countLabel(events.size, 'событие', 'события', 'событий') : '',
      ].filter(Boolean).join(' · ') || 'Есть занятое время';
      return `<div><span>${escapeHtml(formatDateLabel(date))}</span><strong>${escapeHtml(details)}</strong></div>`;
    }).join('');
    const content = `<div class="modal-title"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(summary)}</p></div>${rows ? `<div class="entity-details">${rows}</div>` : ''}`;
    return mountModal(document.body, modal(content, { title, variant: 's', surface: 'app' }));
  }

  function openGraphTimePlan() {
    if (isAllMode()) return;
    const month = calendar?.getDisplayedMonth?.() || initialMonth;
    const current = selectedTimePlan();
    const firstWorkingDay = workingDays.find((day) =>
      String(day?.workplaceId || '') === String(selectedWorkplaceId)
      && String(day?.date || '').startsWith(`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-`));
    const base = current || resolveWorkplaceTime(workplaces, selectedWorkplaceId)
      || getDayTime(firstWorkingDay, workplaces) || { from: '09:00', to: '18:00' };

    const content = `<div class="compact-form">
      <div class="modal-title"><h2>Рабочее время</h2><p>Выберите время до назначения дат. Оно применится к отмеченным дням после подтверждения; настройки пространства не изменятся.</p></div>
      <div class="time-range-fields">
        ${timePicker({ name: 'graphPlanFrom', label: 'С', value: base.from, minuteStep: 1 })}
        ${timePicker({ name: 'graphPlanTo', label: 'До', value: base.to, minuteStep: 1 })}
      </div>
      <div class="form-error" data-graph-plan-error aria-live="polite"></div>
      ${button('Выбрать время', { data: 'data-graph-plan-save' })}
    </div>`;
    const m = mountModal(document.body, modal(content, { title: 'Рабочее время', variant: 'x' }));
    if (!m) return;
    initTimePickers(m);
    m.querySelector('[data-graph-plan-save]')?.addEventListener('click', () => {
      const from = m.querySelector('[name="graphPlanFrom"]')?.value || '';
      const to = m.querySelector('[name="graphPlanTo"]')?.value || '';
      if (!isValidRange(from, to)) {
        const error = m.querySelector('[data-graph-plan-error]');
        if (error) error.textContent = 'Окончание должно быть позже начала.';
        return;
      }
      timePlans.set(timePlanKey(), { from, to });
      m.v2Close?.();
      syncApplyButton(selection?.getSelectedDates?.() || []);
    });
  }

  function showTimePlanError(message) {
    const content = `<div class="modal-title"><h2>Время не изменено</h2><p>${escapeHtml(message || 'Проверьте выбранные даты.')}</p></div>${button('Понятно', { data: 'data-graph-plan-error-close' })}`;
    const m = mountModal(document.body, modal(content, { title: 'Рабочее время', variant: 'x' }));
    m?.querySelector('[data-graph-plan-error-close]')?.addEventListener('click', () => m.v2Close?.());
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
    openTime: openGraphTimePlan,
    canEditTime: () => !isAllMode(),
  });

  applyButton.addEventListener('click', () => {
    const dates = selection?.getSelectedDates?.() || [];
    if (!dates.length || !selectionMode) return;
    if (isAllMode()) {
      openAggregateWorkplaceApply(dates);
      return;
    }
    if (selectionMode === 'set-time') {
      const plan = selectedTimePlan();
      if (!plan) return;
      const result = applyTimetableTimeCorrection({
        dates, workplaceId: selectedWorkplaceId, from: plan.from, to: plan.to,
        workingDays, createMissing: true,
      });
      if (!result.ok) {
        showTimePlanError(result.message);
        return;
      }
      startSelectionSession(calendar?.getDisplayedMonth() || initialMonth);
      return;
    }
    const makeWorking = selectionMode === 'make-working';
    if (makeWorking) {
      applySelectedWorkingDays(dates);
      return;
    }

    // Always apply against the current Day owner's state. The Graph snapshot
    // was taken when this view opened and can be stale after server updates.
    let result;
    try {
      result = applyTimetableDaysOff({
        dates,
        workplaceId: selectedWorkplaceId,
        workingDays: getDays(),
      });
    } catch (error) {
      console.error('Graph Day-off failed', error);
      showDayOffResult({ blocked: [], applied: [], error: true });
      return;
    }
    // Reflect the actual canonical rows, not the old Graph-local snapshot.
    const currentDays = getDays();
    workingDays.splice(0, workingDays.length, ...currentDays);
    if (result.changed) startSelectionSession(calendar.getDisplayedMonth());
    if (result.blocked.length || !result.changed) showDayOffResult(result);
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
