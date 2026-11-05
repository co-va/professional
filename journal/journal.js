import { viewNavigation, initViewNavigation, ALL_WORKPLACES_ID, modal, mountModal, openDayWorkplaceControl, openSharedProfileSettingsMenu, workspaceHeaderContext, button } from '../ui/ui.js';
import { setV2ZHeaderRows, clearV2ZHeaderRows } from '../ui/v2/z-layout.js';
import { getWorkplaceContext, setWorkplaceContext } from '../core/workplace-context.js';
import { readOnlyReceipt } from '../ui/receipt/index.js';
import { canUseCapability } from '../core/access.js';
import { getAllWorkplacesMonthStats, getWorkplaceMonthStats, getWorkplaceMonthStatsMap, getWorkingDays, getWorkplaces } from '../core/workplace-time.js';
import { getActiveDayWorkplaces, getAvailableDayWorkplaces } from '../core/day/index.js';
import { getRecordPaymentState, recordAmountDue } from '../core/finance/index.js';
import { applyTimetableWorkingDays, makeTimetableDayOff, openTimetableDayTimeEditor } from '../timetable/day-editor.js';
import { getRecords, getRecordsForDay } from '../core/record/index.js';
import { journalWorkplaceSelect, openJournalWorkplaceControl, updateJournalWorkplaceMetas } from './workplace-control.js';
import { renderJournalDay } from './день.js';
import { renderJournalMonth } from './месяц.js';
import { getJournalListRecords, renderJournalList } from './список.js';

const JOURNAL_CONTEXT_SCOPE = 'journal';
const WORKPLACE_CONTEXT_SCOPES = {
  day: JOURNAL_CONTEXT_SCOPE,
  month: 'journal:month',
  graph: 'journal:graph',
  list: 'journal:list',
};

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
  // The aggregate choice is valid even though it is not a catalog workplace.
  const contextWorkplaces = [...workplaces, { key: ALL_WORKPLACES_ID }];
  const professionalContext = getWorkplaceContext(contextWorkplaces, { scope: JOURNAL_CONTEXT_SCOPE });
  const workplaceContexts = Object.fromEntries(Object.entries(WORKPLACE_CONTEXT_SCOPES)
    .map(([mode, scope]) => [mode, getWorkplaceContext(contextWorkplaces, { scope }).workplaceId]));
  const currentWorkplaceMode = () => activeView === 'month'
    ? (monthMode === 'graph' ? 'graph' : 'month')
    : activeView;
  let selectedWorkplaceId = workplaceContexts[currentWorkplaceMode()];
  let selectedDate = professionalContext.date;
  let disposeActiveView = () => {};
  let noteFocusTarget = null;
  let dayViewState = null;

  root.dataset.journalContext = 'professional';

  const persistProfessionalContext = () => {
    const mode = currentWorkplaceMode();
    workplaceContexts[mode] = selectedWorkplaceId;
    setWorkplaceContext({ workplaceId: selectedWorkplaceId, date: selectedDate, scope: WORKPLACE_CONTEXT_SCOPES[mode] });
    // The Journal date is shared; its Day workplace selection is not.
    if (mode !== 'day') setWorkplaceContext({ date: selectedDate, scope: JOURNAL_CONTEXT_SCOPE });
  };

  const restoreWorkplaceContext = () => {
    const candidate = workplaceContexts[currentWorkplaceMode()];
    const valid = candidate === ALL_WORKPLACES_ID
      || getWorkplaces().some((workplace) => String(workplace?.key || '') === String(candidate || ''));
    selectedWorkplaceId = valid ? candidate : ALL_WORKPLACES_ID;
    if (!valid) persistProfessionalContext();
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
        selectedWorkplaceId = id;
        persistProfessionalContext();
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

  // Menu structure is only WorkPlan + catalog facts; never query Record,
  // Finance, or Time while handling the V click.
  const dayWorkplaceChoices = () => {
    const rawActive = activeDayWorkplaces();
    const byId = new Map(workplaces.map((item) => [String(item?.key || ''), item]));
    const active = rawActive.map((day) => {
      const workplace = byId.get(String(day.workplaceId || '')) || null;
      return {
        ...(workplace || {}),
        key: day.workplaceId,
        workplaceId: day.workplaceId,
        name: day.name,
        indicatorColor: day.indicatorColor,
        from: day.from,
        to: day.to,
      };
    });
    const ids = new Set(rawActive.map((day) => String(day.workplaceId || '')));
    return {
      active,
      rawActive,
      available: workplaces.filter((item) => item?.key && !ids.has(String(item.key))),
    };
  };

  const afterJournalSettingsPaint = (layer, compute) => {
    // The X selector and all action buttons are mounted before any metadata work.
    requestAnimationFrame(() => window.setTimeout(() => {
      if (!layer?.isConnected) return;
      try {
        const metadata = compute();
        if (layer.isConnected) updateJournalWorkplaceMetas(layer, metadata);
      } catch (error) {
        console.error('Journal selector metadata failed', error);
      }
    }, 0));
  };

  // Keep one Shared Select presentation, embedded directly into Journal settings.
  const inlineWorkplaceSettings = ({
    choices = [], workplaceId = selectedWorkplaceId, available = [],
    recordCounts = {}, aggregateCount = 0, month = false,
    aggregateStats = null, workplaceStats = {}, metaPending = false,
    onSelect = selectWorkplace, onAdd = () => {},
  } = {}) => {
    const ids = new Set([ALL_WORKPLACES_ID, ...choices.map((item) => String(item?.key || '')).filter(Boolean)]);
    const content = `<div class="compact-form">${journalWorkplaceSelect({
      workplaces: choices,
      workplaceId: ids.has(workplaceId) ? workplaceId : ALL_WORKPLACES_ID,
      recordCounts, aggregateCount, month, aggregateStats, workplaceStats, metaPending,
    })}</div>`;
    return {
      content,
      footer: available.length ? button('+ Рабочее пространство', { data: 'data-journal-workplace-add' }) : '',
      onMount: (layer) => {
        const input = layer.querySelector('input[name="journalWorkplaceMode"]');
        input?.addEventListener('change', () => {
          const nextId = String(input.value || '');
          if (!ids.has(nextId)) return;
          layer.v2Close?.();
          if (nextId !== selectedWorkplaceId) onSelect(nextId);
        });
        layer.querySelector('[data-journal-workplace-add]')?.addEventListener('click', () => {
          layer.v2Close?.();
          onAdd();
        });
      },
    };
  };

  const openListWorkplaces = () => {
    const catalog = getWorkplaces();
    const main = mountModal(document.body, modal(
      `<div class="compact-form">${journalWorkplaceSelect({
        workplaces: catalog,
        workplaceId: selectedWorkplaceId,
        list: true,
        metaPending: true,
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
    if (main) afterJournalSettingsPaint(main, () => {
      const records = getJournalListRecords();
      const recordCounts = {};
      for (const record of records) {
        const id = String(record?.workplaceId || '');
        if (id) recordCounts[id] = (recordCounts[id] || 0) + 1;
      }
      return { workplaces: catalog, recordCounts, aggregateCount: records.length };
    });
  };

  const selectMonthWorkplace = (nextId) => {
    if (monthMode === 'graph' && graphControls?.selectWorkplace) {
      graphControls.selectWorkplace(nextId);
      return;
    }
    selectWorkplace(nextId);
  };

  const monthWorkplaceChoices = ({ withStats = false } = {}) => {
    const days = getWorkingDays();
    const catalog = getWorkplaces();
    const prefix = monthPrefix(selectedDate);
    const monthIds = new Set(days
      .filter((day) => String(day?.date || '').startsWith(prefix))
      .map((day) => String(day?.workplaceId || '')));
    const extra = monthDraftIds();
    const active = catalog.filter((workplace) => {
      const id = String(workplace?.key || '');
      return id && (monthIds.has(id) || extra.has(id));
    });
    const activeIds = new Set(active.map((workplace) => String(workplace.key)));
    const available = catalog.filter((workplace) => {
      const id = String(workplace?.key || '');
      return id && !activeIds.has(id);
    });
    const choice = { active, activeIds, available, extra, days, catalog };
    // The secondary picker may want stats immediately; V never does.
    if (withStats) {
      choice.stats = getWorkplaceMonthStatsMap(days, catalog, selectedDate);
      choice.aggregateStats = getAllWorkplacesMonthStats(days, catalog, selectedDate);
    }
    return choice;
  };

  const addMonthWorkplace = ({ available, extra }, afterSelection = null) =>
    openDayWorkplaceControl({
      available,
      catalogTitle: 'Добавить рабочее пространство',
      onAdd: (id) => {
        if (!available.some((item) => String(item?.key || '') === String(id))) return;
        extra.add(String(id));
        selectMonthWorkplace(String(id));
        if (typeof afterSelection === 'function') afterSelection();
      },
    });

  // Only needed when Graph's Working Time action starts in aggregate mode.
  const openMonthWorkplaces = (afterSelection = null) => {
    const choice = monthWorkplaceChoices({ withStats: true });
    openJournalWorkplaceControl({
      workplaces: choice.active,
      workplaceId: choice.activeIds.has(selectedWorkplaceId) ? selectedWorkplaceId : ALL_WORKPLACES_ID,
      month: true,
      workplaceStats: choice.stats,
      aggregateStats: choice.aggregateStats,
      availableWorkplaces: choice.available,
      onSelect: (id) => {
        selectMonthWorkplace(id);
        if (typeof afterSelection === 'function' && id !== ALL_WORKPLACES_ID) afterSelection();
      },
      onAdd: () => addMonthWorkplace(choice, afterSelection),
    });
  };

  const journalTitle = () => {
    if (selectedWorkplaceId === ALL_WORKPLACES_ID) return 'Журнал';
    return workplaces.find((item) => String(item?.key || '') === String(selectedWorkplaceId || ''))?.name || 'Журнал';
  };

  const journalHeader = () => {
    const aggregate = selectedWorkplaceId === ALL_WORKPLACES_ID;
    const graph = activeView === 'month' && monthMode === 'graph';
    return {
      title: aggregate ? (graph ? 'График' : 'Журнал') : journalTitle(),
      subtitle: aggregate ? 'Общий режим' : (graph ? 'График' : 'Журнал'),
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
      const choice = monthWorkplaceChoices();
      const field = inlineWorkplaceSettings({
        choices: choice.active,
        workplaceId: choice.activeIds.has(selectedWorkplaceId) ? selectedWorkplaceId : ALL_WORKPLACES_ID,
        month: true,
        metaPending: true,
        available: choice.available,
        onSelect: selectMonthWorkplace,
        onAdd: () => addMonthWorkplace(choice),
      });
      const monthAtOpen = new Date(selectedDate.getTime());
      const layer = openSharedProfileSettingsMenu({
        title: 'Настройки журнала',
        content: field.content,
        footer: field.footer,
        onMount: field.onMount,
        actions: [
          canUseCapability('timetable.access') ? {
            id: 'calendar-mode',
            label: inGraph ? 'Месяц' : 'График',
            onSelect: () => {
              monthMode = inGraph ? 'view' : 'graph';
              restoreWorkplaceContext();
              renderView();
            },
          } : null,
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
      if (layer) afterJournalSettingsPaint(layer, () => ({
        workplaces: choice.active,
        month: true,
        workplaceStats: getWorkplaceMonthStatsMap(choice.days, choice.catalog, monthAtOpen),
        aggregateStats: getAllWorkplacesMonthStats(choice.days, choice.catalog, monthAtOpen),
      }));
      return;
    }
    const allMode = selectedWorkplaceId === ALL_WORKPLACES_ID;
    const dayChoice = dayViewState?.choices || dayWorkplaceChoices();
    const active = dayChoice.rawActive;
    const isDayOff = !active.length;
    // Occupancy is read from the already rendered Day timeline, never on V.
    // Unknown occupancy conservatively offers Z, not a destructive Day-off.
    const hasUsage = !dayViewState || active.some((item) =>
      dayViewState.busyWorkplaces.has(String(item.workplaceId || '')));
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

    const field = inlineWorkplaceSettings({
      choices: dayChoice.active,
      workplaceId: selectedWorkplaceId,
      available: dayChoice.available,
      metaPending: true,
      onSelect: selectWorkplace,
      onAdd: addDayWorkplace,
    });
    const dayAtOpen = dateKey(selectedDate);
    const layer = openSharedProfileSettingsMenu({
      title: 'Настройки журнала',
      content: field.content,
      footer: field.footer,
      onMount: field.onMount,
      actions: isDayOff ? [] : [
        selectedActive ? {
          id: 'working-time',
          label: 'Рабочее время',
          onSelect: () => openDayTime(selectedWorkplaceId),
        } : null,
        !hasUsage ? {
          id: 'day-off',
          label: 'Применить выходной',
          variant: 'danger',
          onSelect: applyDayOff,
        } : null,
        hasUsage ? {
          id: 'z-report',
          label: 'Z-Отчет',
          onSelect: openJournalZReport,
        } : null,
      ].filter(Boolean),
    });
    if (layer) afterJournalSettingsPaint(layer, () => {
      const records = getRecordsForDay(dayAtOpen);
      const recordCounts = {};
      let aggregateCount = 0;
      for (const record of records) {
        if (record?.status === 'cancelled') continue;
        aggregateCount += 1;
        const id = String(record?.workplaceId || '');
        if (id) recordCounts[id] = (recordCounts[id] || 0) + 1;
      }
      return {
        workplaces: dayChoice.active,
        recordCounts,
        aggregateCount,
      };
    });
  };

  // Delegate once for this Journal instance: the Day source can survive server
  // refreshes without collecting extra click handlers.
  const handleSettingsClick = (event) => {
    const action = event.target?.closest?.('[data-journal-settings]');
    if (action && root.contains(action)) openJournalSettings();
  };
  root.addEventListener('click', handleSettingsClick);

  const renderView = () => {
    // An inline Record/Event/Note editor owns the visible Z body until commit/cancel.
    if (!root.isConnected || root.querySelector('[data-record-creation-flow]')) return;
    dayViewState = null;
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

    // A cold server sync can refresh Day several times immediately after login.
    // Keep the actual V source node mounted, so a finger pressing V is not
    // interrupted by root.innerHTML replacing that source mid-gesture.
    const oldContext = root.querySelector(':scope > [data-workspace-header-context]');
    const oldView = root.querySelector(':scope > [data-journal-view]');
    const retainDayV = activeView === 'day'
      && oldView?.dataset.journalDayContext === 'professional'
      && oldContext?.querySelector('[data-journal-settings]');
    if (!retainDayV) {
      root.innerHTML = `${workspaceHeaderContext(headerOptions)}<div data-journal-view${viewClass}></div>`;
    } else {
      syncJournalHeader();
    }
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
        onUsageSummary: ({ usages = [] } = {}) => {
          dayViewState = {
            choices: dayWorkplaceChoices(),
            busyWorkplaces: new Set(usages.map((usage) => String(usage?.workplaceId || ''))),
          };
        },
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
          restoreWorkplaceContext();
          options.onViewChange?.(activeView);
          renderView();
        },
      }) || (() => {});
    } else renderJournalList(viewRoot, { mode: listMode, workplaceId: selectedWorkplaceId });

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
        restoreWorkplaceContext();
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
    activeView = 'day';
    restoreWorkplaceContext();
    if (selectedWorkplaceId !== ALL_WORKPLACES_ID && targetWorkplaceId) {
      selectedWorkplaceId = targetWorkplaceId;
    }
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
    dayViewState = null;
    disposeActiveView();
    root.removeEventListener('click', handleSettingsClick);
    refreshEvents.forEach((eventName) => window.removeEventListener(eventName, scheduleRefresh));
    window.removeEventListener('professional:journal-note-focus-request', focusJournalNotes);
    clearV2ZHeaderRows(root);
  };
}
