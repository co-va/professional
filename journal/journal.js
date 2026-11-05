import { viewNavigation, initViewNavigation, ALL_WORKPLACES_ID, modal, mountModal, openDayWorkplaceControl, openSharedProfileSettingsMenu, workspaceHeaderContext } from '../ui/ui.js';
import { setV2ZHeaderRows, clearV2ZHeaderRows } from '../ui/v2/z-layout.js';
import { getWorkplaceContext, setWorkplaceContext } from '../core/workplace-context.js';
import { readOnlyReceipt } from '../ui/receipt/index.js';
import { canUseCapability } from '../core/access.js';
import { getAllWorkplacesMonthStats, getWorkplaceMonthStats, getWorkplaceMonthStatsMap, getWorkingDays, getWorkplaces } from '../core/workplace-time.js';
import { getActiveDayWorkplaces, getAvailableDayWorkplaces, getDayRemovalConflicts } from '../core/day/index.js';
import { getRecordPaymentState, recordAmountDue } from '../core/finance/index.js';
import { applyTimetableWorkingDays, makeTimetableDayOff, openTimetableDayTimeEditor } from '../timetable/day-editor.js';
import { getActiveRecordCountForDay, getRecords, getRecordsForDay } from '../core/record/index.js';
import { journalWorkplaceSelect, openJournalWorkplaceControl } from './workplace-control.js';
import { renderJournalDay } from './день.js';
import { renderJournalMonth } from './месяц.js';
import { getJournalListRecords, renderJournalList } from './список.js';

const JOURNAL_CONTEXT_SCOPE = 'journal';

const views = [
  { id: 'day', label: 'День', render: renderJournalDay, capability: 'journal.day.access' },
  { id: 'month', label: 'Месяц', render: renderJournalMonth, capability: 'journal.month.access' },
  { id: 'list', label: 'Список', render: renderJournalList, capability: 'journal.list.access' },
];

const listModes = [
  { id: 'flow', label: 'Поток' },
  { id: 'time', label: 'По времени' },
];

function dateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthPrefix(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-`;
}

function formatRubles(value = 0) {
  const amount = Math.max(0, Math.round(Number(value) || 0));
  return `${amount.toLocaleString('ru-RU').replaceAll('\u00a0', ' ')} р.`;
}

function formatNumber(value = 0) {
  const number = Math.max(0, Number(value) || 0);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(number).replaceAll('\u00a0', ' ');
}

function timeMinutes(value = '') {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function recordDurationHours(record = null) {
  const from = timeMinutes(record?.from);
  const to = timeMinutes(record?.to);
  if (from == null || to == null || to <= from) return 0;
  return (to - from) / 60;
}

function recordHasEnded(record = null, now = new Date()) {
  const date = String(record?.date || '').slice(0, 10);
  const to = String(record?.to || record?.from || '').slice(0, 5);
  if (!date || !/^\d{2}:\d{2}$/.test(to)) return false;
  const end = new Date(`${date}T${to}:00`);
  return Number.isFinite(end.getTime()) && now.getTime() >= end.getTime();
}

export function renderJournal(root, options = {}) {
  const availableViews = views.filter((view) => canUseCapability(view.capability));
  let activeView = availableViews.some((view) => view.id === options.initialView)
    ? options.initialView
    : (availableViews[0]?.id || 'day');
  let listMode = 'flow';
  let monthMode = 'view';
  let graphControls = null;
  // Month-only unsaved selections: zero-day workplaces do not become server WorkPlan facts.
  const monthDraftWorkplaces = new Map();
  const workplaces = getWorkplaces();
  const professionalContext = getWorkplaceContext(workplaces, { scope: JOURNAL_CONTEXT_SCOPE });
  let selectedWorkplaceId = professionalContext.workplaceId;
  let selectedDate = professionalContext.date;
  let disposeActiveView = () => {};
  let noteFocusTarget = null;

  root.dataset.journalContext = 'professional';

  const persistProfessionalContext = () => {
    setWorkplaceContext({ workplaceId: selectedWorkplaceId, date: selectedDate, scope: JOURNAL_CONTEXT_SCOPE });
  };

  const activeDayWorkplaces = () => getActiveDayWorkplaces(selectedDate, workplaces);
  const monthDraftIds = (date = selectedDate) => {
    const key = monthPrefix(date);
    if (!monthDraftWorkplaces.has(key)) monthDraftWorkplaces.set(key, new Set());
    return monthDraftWorkplaces.get(key);
  };
  const monthWorkplaceVisible = (id, date = selectedDate) => {
    const key = String(id || '');
    if (key === ALL_WORKPLACES_ID) return true;
    const catalog = getWorkplaces();
    if (!catalog.some((item) => String(item?.key || '') === key)) return false;
    return monthDraftIds(date).has(key)
      || getWorkplaceMonthStats(getWorkingDays(), catalog, key, date).days > 0;
  };

  const openDayTime = (workplaceId = '') => {
    const id = String(workplaceId || selectedWorkplaceId || '');
    if (!id || id === ALL_WORKPLACES_ID) return;
    openTimetableDayTimeEditor({
      date: selectedDate,
      workplaceId: id,
      onSave: () => {
        setWorkplaceContext({ workplaceId: id, date: selectedDate, scope: JOURNAL_CONTEXT_SCOPE });
        renderView();
      },
    });
  };

  const selectWorkplace = (nextId) => {
    selectedWorkplaceId = nextId || selectedWorkplaceId;
    persistProfessionalContext();
    renderView();
  };

  const addDayWorkplace = () => {
    openDayWorkplaceControl({
      available: getAvailableDayWorkplaces(selectedDate, workplaces),
      catalogTitle: 'Рабочее пространство',
      onAdd: (workplaceId) => applyTimetableWorkingDays({
        dates: [dateKey(selectedDate)],
        workplaceId,
        onSave: () => selectWorkplace(workplaceId),
      }),
    });
  };

  const openDayWorkplaces = () => {
    const day = dateKey(selectedDate);
    const active = activeDayWorkplaces().map((item) => {
      const workplace = workplaces.find((entry) => String(entry?.key || '') === String(item.workplaceId || '')) || null;
      return {
        ...(workplace || {}),
        key: item.workplaceId,
        name: item.name,
        indicatorColor: item.indicatorColor,
        from: item.from,
        to: item.to,
      };
    });
    const recordCounts = Object.fromEntries(active.map((workplace) => {
      const key = String(workplace?.key || '');
      return [key, key ? getActiveRecordCountForDay(day, key) : 0];
    }));

    openJournalWorkplaceControl({
      workplaces: active,
      workplaceId: selectedWorkplaceId,
      recordCounts,
      aggregateCount: getActiveRecordCountForDay(day),
      availableWorkplaces: getAvailableDayWorkplaces(selectedDate, workplaces),
      onSelect: selectWorkplace,
      onAdd: addDayWorkplace,
    });
  };

  const openWorkplace = () => {
    const day = dateKey(selectedDate);
    const recordCounts = Object.fromEntries(workplaces.map((workplace) => {
      const key = String(workplace?.key || '');
      return [key, key ? getActiveRecordCountForDay(day, key) : 0];
    }));

    openJournalWorkplaceControl({
      workplaces,
      workplaceId: selectedWorkplaceId,
      recordCounts,
      aggregateCount: getActiveRecordCountForDay(day),
      onSelect: selectWorkplace,
    });
  };

  const openListWorkplaces = () => {
    const catalog = getWorkplaces();
    const records = getJournalListRecords();
    const recordCounts = Object.fromEntries(catalog.map((workplace) => {
      const id = String(workplace?.key || '');
      return [id, records.filter((record) => String(record?.workplaceId || '') === id).length];
    }).filter(([id]) => id));

    const main = mountModal(document.body, modal(
      `<div class="compact-form">${journalWorkplaceSelect({
        workplaces: catalog,
        workplaceId: selectedWorkplaceId,
        list: true,
        recordCounts,
        aggregateCount: records.length,
      })}</div>`,
      { variant: 'x', surface: 'app', title: 'Настройки журнала', className: 'modal--form-sheet' },
    ));
    const input = main?.querySelector('input[name="journalWorkplaceMode"]');
    input?.addEventListener('change', () => {
      const nextId = String(input.value || '');
      if (!nextId || (nextId !== ALL_WORKPLACES_ID && !catalog.some((item) => String(item?.key || '') === nextId))) return;
      main.v2Close?.();
      if (nextId !== selectedWorkplaceId) selectWorkplace(nextId);
    });
  };

  const selectMonthWorkplace = (nextId) => {
    if (monthMode === 'graph' && graphControls?.selectWorkplace) {
      graphControls.selectWorkplace(nextId);
      return;
    }
    selectWorkplace(nextId);
  };

  const openMonthWorkplaces = (afterSelection = null) => {
    const days = getWorkingDays();
    const catalog = getWorkplaces();
    const stats = getWorkplaceMonthStatsMap(days, catalog, selectedDate);
    const extra = monthDraftIds();
    const active = catalog.filter((workplace) => {
      const id = String(workplace?.key || '');
      return id && (Number(stats[id]?.days || 0) > 0 || extra.has(id));
    });
    const activeIds = new Set(active.map((workplace) => String(workplace.key)));
    const available = catalog.filter((workplace) => {
      const id = String(workplace?.key || '');
      return id && !activeIds.has(id);
    });

    openJournalWorkplaceControl({
      workplaces: active,
      workplaceId: activeIds.has(selectedWorkplaceId) ? selectedWorkplaceId : ALL_WORKPLACES_ID,
      month: true,
      workplaceStats: stats,
      aggregateStats: getAllWorkplacesMonthStats(days, catalog, selectedDate),
      availableWorkplaces: available,
      onSelect: (id) => {
        selectMonthWorkplace(id);
        if (typeof afterSelection === 'function' && id !== ALL_WORKPLACES_ID) afterSelection();
      },
      onAdd: () => openDayWorkplaceControl({
        available,
        catalogTitle: 'Добавить рабочее пространство',
        onAdd: (id) => {
          if (!available.some((item) => String(item?.key || '') === String(id))) return;
          extra.add(String(id));
          selectMonthWorkplace(String(id));
          if (typeof afterSelection === 'function') afterSelection();
        },
      }),
    });
  };

  const journalTitle = () => {
    if (selectedWorkplaceId === ALL_WORKPLACES_ID) return 'Журнал';
    return workplaces.find((item) => String(item?.key || '') === String(selectedWorkplaceId || ''))?.name || 'Журнал';
  };

  const journalHeader = () => {
    const aggregate = selectedWorkplaceId === ALL_WORKPLACES_ID;
    const graph = activeView === 'month' && monthMode === 'graph';
    const list = activeView === 'list';
    return {
      title: aggregate ? (graph ? 'График' : list ? 'Список' : 'Журнал') : journalTitle(),
      subtitle: aggregate ? 'Общий режим' : (graph ? 'График' : list ? 'Список' : 'Журнал'),
    };
  };

  const syncJournalHeader = () => {
    const context = root.querySelector('[data-workspace-header-context]');
    if (!context) return;
    const { title, subtitle } = journalHeader();
    if (context.dataset.workspaceTitle === title && context.dataset.workspaceSubtitle === subtitle) return;
    context.dataset.workspaceTitle = title;
    context.dataset.workspaceSubtitle = subtitle;
    window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
  };

  const openJournalZReport = () => {
    const allMode = selectedWorkplaceId === ALL_WORKPLACES_ID;
    const isMonth = activeView === 'month';
    const records = (isMonth
      ? getRecords().filter((record) => {
        if (!String(record?.date || '').startsWith(monthPrefix(selectedDate))) return false;
        return allMode || String(record?.workplaceId || '') === String(selectedWorkplaceId || '');
      })
      : getRecordsForDay(dateKey(selectedDate), allMode ? '' : selectedWorkplaceId))
      .filter((record) => record?.status !== 'cancelled');
    const procedureCount = records.reduce((sum, record) => sum + (Array.isArray(record?.procedures) ? record.procedures.length : 0), 0);
    const hours = records.reduce((sum, record) => sum + recordDurationHours(record), 0);
    const total = records.reduce((sum, record) => sum + recordAmountDue(record), 0);
    const averageRecord = records.length ? total / records.length : 0;
    const averageProcedure = procedureCount ? total / procedureCount : 0;
    const averageHour = hours ? total / hours : 0;
    const workingDayStats = isMonth
      ? (allMode
        ? getAllWorkplacesMonthStats(getWorkingDays(), workplaces, selectedDate)
        : getWorkplaceMonthStats(getWorkingDays(), workplaces, selectedWorkplaceId, selectedDate))
      : null;
    const workingDayCount = Math.max(0, Number(workingDayStats?.days || 0));
    const averageWorkingDay = workingDayCount ? total / workingDayCount : 0;
    const paymentStates = records.map((record) => ({ record, state: getRecordPaymentState(record) }));
    const paidTotal = paymentStates.reduce((sum, item) => sum + Math.max(0, Number(item.state?.paidTotal) || 0), 0);
    const outstanding = paymentStates.filter((item) => Math.max(0, Number(item.state?.remaining) || 0) > 0.009);
    const dueTotal = outstanding
      .filter((item) => !recordHasEnded(item.record))
      .reduce((sum, item) => sum + Math.max(0, Number(item.state?.remaining) || 0), 0);
    const debtTotal = outstanding
      .filter((item) => recordHasEnded(item.record))
      .reduce((sum, item) => sum + Math.max(0, Number(item.state?.remaining) || 0), 0);
    const periodLabel = isMonth
      ? selectedDate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
      : selectedDate.toLocaleDateString('ru-RU');
    const workplaceLabel = allMode ? 'Все пространства' : journalTitle();
    const statusRows = records.length
      ? (outstanding.length === 0
        ? [{ label: 'Статус', value: 'Оплачено' }]
        : [
          { label: 'Оплачено', value: formatRubles(paidTotal) },
          dueTotal > 0.009 ? { label: 'К оплате', value: formatRubles(dueTotal) } : null,
          debtTotal > 0.009 ? { label: 'Задолженность', value: formatRubles(debtTotal) } : null,
        ].filter(Boolean))
      : [];
    const summaryRows = [
      { label: workplaceLabel, value: periodLabel },
      { label: 'Кол-во записей', value: String(records.length) },
      { label: 'Кол-во процедур', value: String(procedureCount) },
      { label: 'Кол-во часов', value: formatNumber(hours) },
      isMonth ? { label: 'Кол-во рабочих дней', value: String(workingDayCount) } : null,
      { label: 'Средний чек записи', value: formatRubles(averageRecord) },
      { label: 'Средний чек процедуры', value: formatRubles(averageProcedure) },
      { label: 'Средний чек часа', value: formatRubles(averageHour) },
      isMonth ? { label: 'Средний чек за рабочий день', value: formatRubles(averageWorkingDay) } : null,
    ].filter(Boolean);
    const groups = [
      summaryRows,
      statusRows,
      [{ label: 'Сумма', value: formatRubles(total), strong: true }],
    ];
    mountModal(document.body, modal(readOnlyReceipt({
      title: 'Z - Отчет',
      groups,
    }), { variant: 's', surface: 'app', title: 'Z - Отчет' }));
  };

  const openJournalSettings = () => {
    if (activeView === 'list') {
      openListWorkplaces();
      return;
    }
    if (activeView === 'month') {
      const inGraph = monthMode === 'graph';
      openSharedProfileSettingsMenu({
        title: 'Настройки журнала',
        actions: [
          canUseCapability('timetable.access') ? {
            id: 'calendar-mode',
            label: inGraph ? 'Месяц' : 'График',
            onSelect: () => {
              monthMode = inGraph ? 'view' : 'graph';
              renderView();
            },
          } : null,
          inGraph ? {
            id: 'graph-workplace',
            label: 'Рабочее пространство',
            onSelect: openMonthWorkplaces,
          } : {
            id: 'workplace',
            label: 'Рабочее пространство',
            onSelect: openMonthWorkplaces,
          },
          inGraph ? {
            id: 'graph-time',
            label: 'Рабочее время',
            onSelect: () => {
              if (graphControls?.canEditTime?.()) graphControls.openTime();
              else openMonthWorkplaces(() => graphControls?.openTime?.());
            },
          } : null,
          !inGraph ? {
            id: 'z-report',
            label: 'Z-Отчет',
            onSelect: openJournalZReport,
          } : null,
        ].filter(Boolean),
      });
      return;
    }
    const day = dateKey(selectedDate);
    const allMode = selectedWorkplaceId === ALL_WORKPLACES_ID;
    const active = activeView === 'day' ? activeDayWorkplaces() : [];
    const isDayOff = activeView === 'day' && !active.length;
    const hasUsage = active.some((item) => getDayRemovalConflicts(item.workplaceId, day).length > 0);
    const activeIds = active.map((item) => item.workplaceId);
    const selectedActive = !allMode && activeIds.includes(selectedWorkplaceId);
    const applyDayOff = () => {
      const workplaceIds = selectedActive ? [selectedWorkplaceId] : activeIds;
      makeTimetableDayOff({
        date: selectedDate,
        workplaceIds,
        onSave: () => selectWorkplace(ALL_WORKPLACES_ID),
      });
    };

    openSharedProfileSettingsMenu({
      title: 'Настройки журнала',
      actions: (isDayOff ? [{
        id: 'add-workplace',
        label: '+ Рабочее пространство',
        variant: 'primary',
        onSelect: addDayWorkplace,
      }] : [
        {
          id: 'workplace',
          label: 'Рабочее пространство',
          onSelect: activeView === 'day' ? openDayWorkplaces : openWorkplace,
        },
        activeView === 'day' && selectedActive ? {
          id: 'working-time',
          label: 'Рабочее время',
          onSelect: () => openDayTime(selectedWorkplaceId),
        } : null,
        activeView === 'day' && !hasUsage ? {
          id: 'day-off',
          label: 'Применить выходной',
          variant: 'danger',
          onSelect: applyDayOff,
        } : null,
        (activeView === 'day' && hasUsage) || activeView === 'month' ? {
          id: 'z-report',
          label: 'Z-Отчет',
          onSelect: openJournalZReport,
        } : null,
      ]).filter(Boolean),
    });
  };

  const renderView = () => {
    // An inline Record/Event/Note editor owns the visible Z body until commit/cancel.
    if (!root.isConnected || root.querySelector('[data-record-creation-flow]')) return;
    disposeActiveView();
    disposeActiveView = () => {};
    graphControls = null;
    if (activeView === 'month' && !monthWorkplaceVisible(selectedWorkplaceId)) {
      selectedWorkplaceId = ALL_WORKPLACES_ID;
      persistProfessionalContext();
    }

    const primaryNavigation = viewNavigation({ views: availableViews, activeView });
    const secondaryNavigation = activeView === 'list'
      ? viewNavigation({ views: listModes, activeView: listMode, ariaLabel: 'Режим списка' })
      : '<div data-journal-period-navigation></div>';
    const headerRows = setV2ZHeaderRows(root, [primaryNavigation, secondaryNavigation]);
    const primaryNavigationRoot = headerRows[0] || null;
    const secondaryNavigationRoot = headerRows[1] || null;
    const periodNavigationRoot = secondaryNavigationRoot?.querySelector('[data-journal-period-navigation]') || null;
    const viewClass = activeView === 'list' ? ' class="journal-list-viewport"' : '';
    const headerOptions = journalHeader();
    headerOptions.v = { data: 'data-journal-settings', aria: 'Настройки журнала' };

    root.innerHTML = `${workspaceHeaderContext(headerOptions)}<div data-journal-view${viewClass}></div>`;
    const viewRoot = root.querySelector('[data-journal-view]');
    if (activeView === 'day') {
      disposeActiveView = renderJournalDay(viewRoot, {
        context: 'professional',
        date: selectedDate,
        workplaceId: selectedWorkplaceId,
        navigationRoot: periodNavigationRoot,
        focusTarget: noteFocusTarget,
        onCreationFinished: renderView,
        onWorkplaceFieldClick: openDayTime,
        onChange: (nextDate) => {
          selectedDate = nextDate;
          persistProfessionalContext();
          renderView();
        },
      }) || (() => {});
      noteFocusTarget = null;
    } else if (activeView === 'month') {
      disposeActiveView = renderJournalMonth(viewRoot, {
        context: 'professional',
        month: selectedDate,
        mode: monthMode,
        onGraphControls: (controls) => { graphControls = controls; },
        onDateFocus: (nextDate) => {
          selectedDate = nextDate;
          persistProfessionalContext();
        },
        onWorkplaceChange: (nextId) => {
          selectedWorkplaceId = nextId;
          persistProfessionalContext();
          syncJournalHeader();
        },
        workplaceId: selectedWorkplaceId,
        navigationRoot: periodNavigationRoot,
        onMonthChange: (nextMonth) => {
          const year = nextMonth.getFullYear();
          const month = nextMonth.getMonth();
          const day = Math.min(selectedDate.getDate(), new Date(year, month + 1, 0).getDate());
          selectedDate = new Date(year, month, day);
          if (!monthWorkplaceVisible(selectedWorkplaceId)) {
            selectedWorkplaceId = ALL_WORKPLACES_ID;
            if (monthMode === 'graph') graphControls?.selectWorkplace(ALL_WORKPLACES_ID);
            else renderView();
          }
          persistProfessionalContext();
        },
        onDateSelect: (nextDate) => {
          selectedDate = nextDate;
          persistProfessionalContext();
          activeView = 'day';
          options.onViewChange?.(activeView);
          renderView();
        },
      }) || (() => {});
    } else renderJournalList(viewRoot, { mode: listMode, workplaceId: selectedWorkplaceId });

    root.querySelector('[data-journal-settings]')?.addEventListener('click', openJournalSettings);
    if (activeView === 'list' && secondaryNavigationRoot) {
      initViewNavigation(secondaryNavigationRoot, {
        views: listModes,
        activeView: listMode,
        onChange: (nextMode) => {
          listMode = nextMode;
          renderView();
        },
      });
    }
    if (primaryNavigationRoot) {
      initViewNavigation(primaryNavigationRoot, { views: availableViews, activeView, onChange: (nextView) => {
        if (nextView !== 'month') monthMode = 'view';
        activeView = nextView;
        options.onViewChange?.(activeView);
        renderView();
      } });
    }
  };

  const focusJournalNotes = (event) => {
    const detail = event?.detail && typeof event.detail === 'object' ? event.detail : {};
    const targetType = detail.targetType === 'record' || detail.targetType === 'event' ? detail.targetType : '';
    const targetId = String(detail.targetId || '');
    const date = String(detail.date || '').slice(0, 10);
    if (!targetType || !targetId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

    const nextDate = new Date(`${date}T12:00:00`);
    if (!Number.isNaN(nextDate.getTime())) selectedDate = nextDate;
    const targetWorkplaceId = String(detail.workplaceId || '');
    if (selectedWorkplaceId !== ALL_WORKPLACES_ID && targetWorkplaceId) {
      selectedWorkplaceId = targetWorkplaceId;
    }
    activeView = 'day';
    noteFocusTarget = { targetType, targetId };
    persistProfessionalContext();
    options.onViewChange?.(activeView);
    renderView();
  };

  window.addEventListener('professional:journal-note-focus-request', focusJournalNotes);

  let refreshQueued = false;
  const scheduleRefresh = () => {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      renderView();
    });
  };
  const refreshEvents = [
    'professional:records-changed',
    'professional:dds-changed',
    'professional:time-usage-changed',
    'professional:people-changed',
    'professional:procedures-changed',
    'professional:products-changed',
    'professional:workplaces-changed',
  ];
  refreshEvents.forEach((eventName) => window.addEventListener(eventName, scheduleRefresh));
  renderView();

  return () => {
    disposeActiveView();
    refreshEvents.forEach((eventName) => window.removeEventListener(eventName, scheduleRefresh));
    window.removeEventListener('professional:journal-note-focus-request', focusJournalNotes);
    clearV2ZHeaderRows(root);
  };
}
