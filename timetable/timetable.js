import { actionBlock, button, entityCard, initCalendar, initMultiSelect, modal, mountModal, timePicker, initTimePickers, escapeHtml, mountV2ZLayer, v2HorizontalRail, v2ZLayer, workspaceHeaderContext, ALL_WORKPLACES_ID, getWorkplaceContext, setWorkplaceContext } from '../ui/ui.js';
import { getWorkplaces, resolveWorkplaceTime, getWorkingDayIndicators, getWorkingDayTotalMinutes, getWorkplaceMonthStats, getAllWorkplacesMonthStats, getWorkplaceMonthStatsMap } from '../core/workplace-time.js';
import { getDays, saveDays, getDay, getDayTime, removeDay, getDayRemovalConflicts, getScheduleConflicts } from '../core/day/index.js';
import { applyTimetableWorkingDays } from './day-editor.js';
import { getWorkingTimeUsageConflicts, isValidRange } from '../core/time/index.js';

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
function formatMonthStats(stats = {}) {
  const days = Math.max(0, Number(stats?.days) || 0);
  const hours = Math.max(0, Number(stats?.hours) || 0);
  const minutes = String(Math.max(0, Number(stats?.minutes) || 0)).padStart(2, '0');
  return { days, duration: `${hours} ч ${minutes} м` };
}
function notifyContext() {
  window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
}

export function renderTimetable(root) {
  const workplaces = getWorkplaces();
  const workingDays = getDays();
  const context = getWorkplaceContext(workplaces);
  let selectedWorkplaceId = context.workplaceId;
  const initialDate = context.date;
  const initialMonth = new Date(initialDate.getFullYear(), initialDate.getMonth(), 1);

  const statsForMonth = (month) => ({
    aggregate: getAllWorkplacesMonthStats(workingDays, workplaces, month),
    byWorkplace: getWorkplaceMonthStatsMap(workingDays, workplaces, month),
  });

  const workplaceGraphCard = (workplace, stats, { data = '', aria = '' } = {}) => {
    const summary = formatMonthStats(stats);
    return entityCard({
      title: workplace?.name || 'Без названия',
      image: workplace?.photo || '',
      initial: (workplace?.name || '?').slice(0, 1).toUpperCase(),
      topRightMeta: [
        { value: `${summary.days} дней`, row: 1 },
        { value: summary.duration, row: 2 },
      ],
      interactive: true,
      data,
      aria: aria || `Открыть рабочее пространство ${workplace?.name || ''}`,
      className: 'entity-card--hero entity-card--rail entity-card--top-light',
    });
  };

  const aggregateGraphCard = (stats, { data = '', aria = 'Открыть общий график' } = {}) => {
    const summary = formatMonthStats(stats);
    return entityCard({
      title: 'Общий график',
      topRightMeta: [
        { value: `${summary.days} дней`, row: 1 },
        { value: summary.duration, row: 2 },
      ],
      interactive: true,
      data,
      aria,
      className: 'entity-card--hero entity-card--rail entity-card--top-light',
    });
  };

  const headerContextMarkup = (month, { inactiveA = false, title = '' } = {}) => {
    const allMode = selectedWorkplaceId === ALL_WORKPLACES_ID;
    const stats = allMode
      ? getAllWorkplacesMonthStats(workingDays, workplaces, month)
      : getWorkplaceMonthStats(workingDays, workplaces, selectedWorkplaceId, month);
    const summary = formatMonthStats(stats);
    const workplace = workplaces.find((item) => String(item?.key || '') === String(selectedWorkplaceId || '')) || null;
    return workspaceHeaderContext({
      title: title || (allMode ? 'Общий график' : (workplace?.name || 'Рабочее пространство')),
      a: workplace ? {
        kind: 'avatar',
        image: String(workplace.photo || ''),
        imagePosition: `${Number(workplace.photoCropX || 50)}% ${Number(workplace.photoCropY || 50)}%`,
        initials: String(workplace.name || '?').slice(0, 1).toUpperCase(),
      } : null,
      v: inactiveA ? null : {
        data: 'data-timetable-settings-open',
        aria: `Настройки графика. Рабочих дней: ${summary.days}`,
      },
      hideD: true,
    });
  };

  root.innerHTML = `<div class="calendar-workspace">${headerContextMarkup(initialMonth)}<div data-timetable-calendar data-calendar-workspace-host></div>${actionBlock(button('Применить', {
    data: 'data-timetable-apply',
    aria: 'Применить',
    disabled: true,
  }))}</div>`;
  const calendarRoot = root.querySelector('[data-timetable-calendar]');
  const applyButton = root.querySelector('[data-timetable-apply]');
  const applyActions = applyButton?.closest('.modal-actions');
  let calendar; let selection; let selectionMode = null;

  const bindHeaderContext = () => {
    root.querySelector('[data-timetable-settings-open]')?.addEventListener('click', openTimetableSettingsMenu);
  };

  const renderHeader = (month) => {
    const current = root.querySelector('[data-workspace-header-context]');
    if (!current) return;
    current.outerHTML = headerContextMarkup(month);
    bindHeaderContext();
    notifyContext();
  };
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
      notifyContext();
      return;
    }
    const selectedDate = new Date(`${dates[0]}T00:00:00`);
    if (allMode) {
      setWorkplaceContext({ date: selectedDate });
      selectionMode = 'add-workplace';
      applyButton.textContent = 'Применить';
      applyButton.classList.remove('ui-button--danger');
      applyButton.setAttribute('aria-label', 'Применить');
    } else {
      setWorkplaceContext({ workplaceId: selectedWorkplaceId, date: selectedDate });
      selectionMode = isWorkingDate(dates[0]) ? 'make-off' : 'make-working';
      const makeOff = selectionMode === 'make-off';
      applyButton.textContent = makeOff ? 'Выходной' : 'Рабочий';
      applyButton.classList.toggle('ui-button--danger', makeOff);
      applyButton.setAttribute('aria-label', makeOff ? 'Сделать выходным' : 'Сделать рабочим');
    }
    applyButton.disabled = false;
    if (applyActions) applyActions.hidden = false;
    notifyContext();
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
        if (allMode) setWorkplaceContext({ date: nextDate });
        else setWorkplaceContext({ workplaceId: selectedWorkplaceId, date: nextDate });
      },
      onMonthChange: (nextMonth) => {
        bindSelection();
        if (allMode) setWorkplaceContext({ date: nextMonth });
        else setWorkplaceContext({ workplaceId: selectedWorkplaceId, date: nextMonth });
        renderHeader(nextMonth);
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
        renderHeader(month);
      },
    });
  };

  function openAggregateWorkplaceApply(dates) {
    const month = calendar?.getDisplayedMonth() || initialMonth;
    const monthStats = statsForMonth(month);
    const cards = workplaces.map((workplace) => {
      const key = String(workplace?.key || '');
      return workplaceGraphCard(workplace, monthStats.byWorkplace[key], {
        data: `data-timetable-apply-workplace="${escapeHtml(key)}"`,
        aria: `Добавить рабочее пространство ${workplace?.name || ''}`,
      });
    });
    const activeSummary = formatMonthStats(monthStats.aggregate);
    const layer = mountV2ZLayer(root, v2ZLayer(`${workspaceHeaderContext({
      title: 'Добавить рабочее пространство',
      a: {
        kind: 'logo',
        label: String(activeSummary.days),
        aria: `Рабочих дней: ${activeSummary.days}`,
        disabled: true,
      },
      hideD: true,
    })}${v2HorizontalRail(cards.join(''), { className: 'timetable-workplace-card-rail' })}`, { className: 'timetable-workplace-picker-layer' }), { stack: true });
    if (!layer) return;
    layer.querySelectorAll('[data-timetable-apply-workplace]').forEach((card) => {
      card.addEventListener('click', () => {
        const targetId = String(card.dataset.timetableApplyWorkplace || '');
        if (!targetId) return;
        layer.v2Close?.();
        applySelectedWorkingDays(dates, targetId);
      });
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
      const error = m.querySelector('[data-timetable-correction-error]');
      if (!isValidRange(from, to)) {
        if (error) error.textContent = 'Окончание должно быть позже начала.';
        return;
      }

      for (const date of selected) {
        const usage = getWorkingTimeUsageConflicts({ date, workplaceId: selectedWorkplaceId, from, to })
          .filter((item) => item?.from && item?.to);
        if (usage.length) {
          if (error) error.textContent = `${formatDateLabel(date)}: ${usage.map((item) => `${occupiedLabel(item)} ${item.from}–${item.to}`).join(', ')} выходит за рабочее время.`;
          return;
        }

        const schedule = getScheduleConflicts(workingDays, {
          workplaceId: selectedWorkplaceId,
          date,
          from,
          to,
        });
        if (schedule.length) {
          if (error) error.textContent = `${formatDateLabel(date)}: время пересекается с другим рабочим пространством.`;
          return;
        }
      }

      selected.forEach((date) => updateDayTime(workingDays, selectedWorkplaceId, date, from, to));
      saveDays(workingDays);
      const month = calendar?.getDisplayedMonth() || initialMonth;
      m.v2Close?.();
      startSelectionSession(month);
      renderHeader(month);
    });
  }
  function openTimetableSettingsMenu() {
    const dates = selection?.getSelectedDates?.() || [];
    const canEditTime = !isAllMode() && dates.some((date) => getDay(workingDays, selectedWorkplaceId, date));
    const content = `<div class="compact-form">
      ${canEditTime ? button('Время работы', { variant: 'secondary', data: 'data-timetable-settings-time' }) : ''}
      ${button('Рабочее пространство', { variant: 'secondary', data: 'data-timetable-settings-workplace' })}
    </div>`;
    const m = mountModal(document.body, modal(content, { title: 'Настройки графика', variant: 'x' }));
    if (!m) return;
    m.querySelector('[data-timetable-settings-time]')?.addEventListener('click', () => {
      const selectedDates = selection?.getSelectedDates?.() || [];
      m.v2Close?.();
      openSelectedWorkingTimeCorrection(selectedDates);
    });
    m.querySelector('[data-timetable-settings-workplace]')?.addEventListener('click', () => {
      m.v2Close?.();
      openTimetableSettingsZ2();
    });
  }

  function openTimetableSettingsZ2() {
    const month = calendar?.getDisplayedMonth() || initialMonth;
    const monthStats = statsForMonth(month);
    const activeStats = isAllMode() ? monthStats.aggregate : monthStats.byWorkplace[selectedWorkplaceId];
    const activeSummary = formatMonthStats(activeStats);
    const cards = [
      aggregateGraphCard(monthStats.aggregate, {
        data: `data-timetable-settings-select="${ALL_WORKPLACES_ID}"`,
      }),
      ...workplaces.map((workplace) => {
        const key = String(workplace?.key || '');
        return workplaceGraphCard(workplace, monthStats.byWorkplace[key], {
          data: `data-timetable-settings-select="${escapeHtml(key)}"`,
        });
      }),
    ];
    const layer = mountV2ZLayer(root, v2ZLayer(`${workspaceHeaderContext({
      title: 'Настройки графика',
      a: {
        kind: 'logo',
        label: String(activeSummary.days),
        aria: `Рабочих дней: ${activeSummary.days}`,
        disabled: true,
      },
      hideD: true,
    })}${v2HorizontalRail(cards.join(''), { className: 'timetable-settings-card-rail' })}${(!isAllMode() && (selection?.getSelectedDates?.() || []).some((date) => getDay(workingDays, selectedWorkplaceId, date))) ? actionBlock(button('Время', { type: 'button', data: 'data-timetable-correct-selected-time', aria: 'Изменить время выбранных рабочих дней' })) : ''}`, { className: 'timetable-settings-layer' }), { stack: true });
    if (!layer) return;
    layer.querySelector('[data-timetable-correct-selected-time]')?.addEventListener('click', () => {
      const dates = selection?.getSelectedDates?.() || [];
      layer.v2Close?.();
      openSelectedWorkingTimeCorrection(dates);
    });
    layer.querySelectorAll('[data-timetable-settings-select]').forEach((card) => {
      card.addEventListener('click', () => {
        const nextId = String(card.dataset.timetableSettingsSelect || '');
        if (!nextId) return;
        selectedWorkplaceId = nextId;
        if (selectedWorkplaceId === ALL_WORKPLACES_ID) setWorkplaceContext({ date: month });
        else setWorkplaceContext({ workplaceId: selectedWorkplaceId, date: month });
        layer.v2Close?.();
        startSelectionSession(month);
        renderHeader(month);
      });
    });
  }

  bindHeaderContext();
  if (workplaces.length) startSelectionSession(initialMonth); else calendar = initCalendar(calendarRoot, { month: initialMonth, workingDates: [] });

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

    const blockedRemoval = [];
    for (const date of dates) {
      if (removeDay(workingDays, selectedWorkplaceId, date)) continue;
      const conflicts = getDayRemovalConflicts(selectedWorkplaceId, date);
      if (conflicts.length) blockedRemoval.push({ date, conflicts });
    }
    saveDays(workingDays); const month = calendar.getDisplayedMonth(); startSelectionSession(month); renderHeader(month);
    if (blockedRemoval.length) openRemovalBlockedModal(blockedRemoval);
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
        selectedWorkplaceId = getWorkplaceContext(workplaces).workplaceId;
      }
      const month = calendar?.getDisplayedMonth?.() || initialMonth;
      if (workplaces.length) startSelectionSession(month);
      else calendar = initCalendar(calendarRoot, { month, workingDates: [] });
      renderHeader(month);
    });
  };
  window.addEventListener('professional:time-usage-changed', syncCanonicalState);
  window.addEventListener('professional:workplaces-changed', syncCanonicalState);

  return () => {
    window.removeEventListener('professional:time-usage-changed', syncCanonicalState);
    window.removeEventListener('professional:workplaces-changed', syncCanonicalState);
    selection?.destroy?.();
  };
}
