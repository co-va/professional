import { DATA_EXCHANGE_ICON } from '../ui/buttons/index.js';
import { formatReportRubles as formatRubles, formatReportNumber as formatNumber } from '../ui/utils/values.js';
import { recordDurationHours } from '../core/time/index.js';
import { viewNavigation, initViewNavigation, ALL_WORKPLACES_ID, modal, mountModal, openDayWorkplaceControl, openSharedProfileSettingsMenu, workspaceHeaderContext, button } from '../ui/ui.js';
import { setV2ZHeaderRows, clearV2ZHeaderRows } from '../ui/v2/z-layout.js';
import { isV2DesktopWorkspace, V2_DESKTOP_MEDIA } from '../ui/v2/geometry.js';
import { getWorkplaceContext, setWorkplaceContext } from '../core/workplace-context.js';
import { readOnlyReceipt } from '../ui/receipt/index.js';
import { canUseCapability } from '../core/access.js';
import { getAllWorkplacesMonthStats, getWorkplaceMonthStats, getWorkplaceMonthStatsMap, getWorkingDays, getWorkplaces } from '../core/workplace-time.js';
import { getActiveDayWorkplaces, getAvailableDayWorkplaces } from '../core/day/index.js';
import { getRecordPaymentState } from '../core/finance/index.js';
import { readFinanceState } from '../core/finance/data.js';
import { recordPaymentReport } from '../core/finance/prepayment-model.js';
import { hasZonedIntervalEnded } from '../core/time/index.js';
import { applyTimetableWorkingDays, makeTimetableDayOff, openTimetableDayTimeEditor } from '../timetable/day-editor.js';
import { getRecordsInRange, getRecordsForDay } from '../core/record/index.js';
import { journalWorkplaceSelect, openJournalWorkplaceControl, updateJournalWorkplaceMetas } from './workplace-control.js';
import { renderJournalDay } from './день.js';
import { renderJournalMonth } from './месяц.js';
import { getJournalListRecords, renderJournalList } from './список.js';
import { openJournalExcel } from './excel.js';

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





function recordHasEnded(record = null, now = new Date()) {
  const workplace = getWorkplaces().find((entry) =>
    String(entry?.key || '') === String(record?.workplaceId || ''));
  return hasZonedIntervalEnded(record, workplace?.timeZone || '', now);
}

export function renderJournal(root, options = {}) {
  const availableViews = views.filter((view) => canUseCapability(view.capability));
  const desktop = () => isV2DesktopWorkspace(root.closest('[data-v2-app]'));
  const visibleViews = () => desktop() ? availableViews.filter(view => view.id !== 'month') : availableViews;
  let activeView = visibleViews().some((view) => view.id === options.initialView)
    ? options.initialView
    : (visibleViews()[0]?.id || (desktop() ? 'calendar-only' : 'day'));
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
    : activeView === 'calendar-only' ? 'day' : activeView;
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
    options.onCalendarContextChange?.({ date: selectedDate, workplaceId: selectedWorkplaceId });
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
      })}</div><div class="modal-actions">${button('Excel', {variant:'secondary',data:'data-journal-list-excel'})}</div>`,
      { variant: 'x', surface: 'app', title: 'Настройки журнала', className: 'modal--form-sheet' },
    ));
    main?.querySelector('[data-journal-list-excel]')?.addEventListener('click',()=>{
      main.v2Close?.();
      openJournalExcel(document.body,{onImported:()=>renderView()});
    });
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
      ? getRecordsInRange({
        from: `${monthPrefix(selectedDate)}01`,
        to: `${monthPrefix(selectedDate)}${String(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate()).padStart(2, '0')}`,
        workplaceId: allMode ? '' : selectedWorkplaceId,
      })
      : getRecordsForDay(dateKey(selectedDate), allMode ? '' : selectedWorkplaceId))
      .filter((record) => record?.status !== 'cancelled');
    // PaymentState already includes the canonical Settlement. Resolve once
    // per Record; aggregate stored projections rather than recalculating prices.
    const paymentStates = records.map((record) => ({ record, state: getRecordPaymentState(record) }));
    const procedureCount = records.reduce((sum, record) => sum + (Array.isArray(record?.procedures) ? record.procedures.length : 0), 0);
    const hours = records.reduce((sum, record) => sum + recordDurationHours(record), 0);
    const total = paymentStates.reduce((sum, { state }) => sum + Math.max(0, Number(state?.planTotal) || 0), 0);
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
    const paidTotal = paymentStates.reduce((sum, item) => sum + Math.max(0, Number(item.state?.paidTotal) || 0), 0);
    const tipsTotal = paymentStates.reduce((sum, item) => sum + Math.max(0, Number(item.state?.tipsTotal) || 0), 0);
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
        ? [{ label: 'Статус', value: paymentStates.every(({ state }) => state?.fullyPaid) ? 'Оплачено' : 'К оплате' }]
        : [
          { label: 'Оплачено', value: formatRubles(paidTotal) },
          dueTotal > 0.009 ? { label: 'К оплате', value: formatRubles(dueTotal) } : null,
          debtTotal > 0.009 ? { label: 'Задолженность', value: formatRubles(debtTotal) } : null,
        ].filter(Boolean))
      : [];
    const summaryRows = [
      { label: workplaceLabel, value: periodLabel },
      { label: 'Кол-во записей', value: String(records.length) },
      { label: 'Кол-во услуг', value: String(procedureCount) },
      { label: 'Кол-во часов', value: formatNumber(hours) },
      isMonth ? { label: 'Кол-во рабочих дней', value: String(workingDayCount) } : null,
      { label: 'Средний чек записи', value: formatRubles(averageRecord) },
      { label: 'Средний чек услуги', value: formatRubles(averageProcedure) },
      { label: 'Средний чек часа', value: formatRubles(averageHour) },
      isMonth ? { label: 'Средний чек за рабочий день', value: formatRubles(averageWorkingDay) } : null,
    ].filter(Boolean);
    const finance=readFinanceState();
    const paymentReport=recordPaymentReport(finance.operations,finance.ledger,records.map(r=>String(r.id)));
    const paymentRows=paymentReport.prepayment>0?[{label:'Предоплата',value:formatRubles(paymentReport.prepayment)},...paymentReport.wallets.map(w=>({label:w.label,value:formatRubles(w.amount)}))]:[];
    const groups = [
      summaryRows,
      [...statusRows,...paymentRows],
      [{ label: 'Tips', value: formatRubles(tipsTotal) }],
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
    const hasUsage = !dayViewState || (allMode
      ? dayViewState.busyWorkplaces.size > 0
      : dayViewState.busyWorkplaces.has(String(selectedWorkplaceId || '')));
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
      actions: isDayOff && !hasUsage ? [] : [
        selectedActive ? {
          id: 'working-time',
          label: 'Рабочее время',
          onSelect: () => openDayTime(selectedWorkplaceId),
        } : null,
        !isDayOff && !hasUsage ? {
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
    const displayedViews = visibleViews();
    if (!displayedViews.some(view => view.id === activeView)) {
      activeView = displayedViews[0]?.id || (desktop() ? 'calendar-only' : 'day');
      monthMode = 'view';
      restoreWorkplaceContext();
      options.onViewChange?.(activeView);
    }
    dayViewState = null;
    disposeActiveView();
    disposeActiveView = () => {};
    graphControls = null;
    if (activeView === 'month' && !monthWorkplaceVisible(selectedWorkplaceId)) {
      selectedWorkplaceId = ALL_WORKPLACES_ID;
      persistProfessionalContext();
    }

    const wide = desktop();
    const primaryNavigation = wide && displayedViews.length < 2 ? '' : viewNavigation({ views: displayedViews, activeView });
    const secondaryNavigation = activeView === 'list'
      ? viewNavigation({ views: listModes, activeView: listMode, ariaLabel: 'Режим списка' })
      : '<div data-journal-period-navigation></div>';
    const toolbar = wide ? `<div class="v2-journal-desktop-toolbar"><div data-journal-primary-navigation>${primaryNavigation}</div><div data-journal-secondary-navigation>${secondaryNavigation}</div><div class="v2-journal-desktop-actions">${activeView === 'day' ? button('Сегодня',{variant:'secondary',data:'data-journal-today'}) + button('Z-отчёт',{variant:'secondary',data:'data-journal-day-report'}) : ''}${activeView === 'list' ? button(DATA_EXCHANGE_ICON,{variant:'secondary',className:'v2-journal-excel-icon',data:'data-journal-direct-excel title="Обмен данными" aria-haspopup="dialog"',aria:'Обмен данными'}) : ''}</div></div>` : '';
    const headerRows = setV2ZHeaderRows(root, wide ? [toolbar] : [primaryNavigation, secondaryNavigation]);
    const primaryNavigationRoot = wide ? headerRows[0]?.querySelector('[data-journal-primary-navigation]') : headerRows[0] || null;
    const secondaryNavigationRoot = wide ? headerRows[0]?.querySelector('[data-journal-secondary-navigation]') : headerRows[1] || null;
    if (wide) {
      headerRows[0]?.querySelector('[data-journal-today]')?.addEventListener('click', () => { selectedDate = new Date(); persistProfessionalContext(); renderView(); });
      headerRows[0]?.querySelector('[data-journal-day-report]')?.addEventListener('click', () => openJournalZReport());
      headerRows[0]?.querySelector('[data-journal-direct-excel]')?.addEventListener('click', event => openJournalExcel(document.body,{anchor:event.currentTarget,onImported:()=>renderView()}));
    }
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
    options.onCalendarContextChange?.({ date: selectedDate, workplaceId: selectedWorkplaceId });
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
    } else if (activeView === 'list') renderJournalList(viewRoot, { mode: listMode, workplaceId: selectedWorkplaceId });
    else viewRoot.replaceChildren();

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
      initViewNavigation(primaryNavigationRoot, { views: displayedViews, activeView, onChange: (nextView) => {
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
  const selectDesktopDate = (event) => {
    const nextDate = event.detail?.date;
    if (!(nextDate instanceof Date) || Number.isNaN(nextDate.getTime()) || !availableViews.some(view => view.id === 'day')) return;
    if (root.querySelector('[data-record-creation-flow]')) return;
    selectedDate = nextDate;
    activeView = 'day';
    monthMode = 'view';
    restoreWorkplaceContext();
    persistProfessionalContext();
    options.onViewChange?.(activeView);
    renderView();
  };
  window.addEventListener('professional:desktop-journal-date', selectDesktopDate);
  const wideMedia = window.matchMedia?.(V2_DESKTOP_MEDIA);
  wideMedia?.addEventListener?.('change', renderView);

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
    window.removeEventListener('professional:desktop-journal-date', selectDesktopDate);
    wideMedia?.removeEventListener?.('change', renderView);
    clearV2ZHeaderRows(root);
  };
}
