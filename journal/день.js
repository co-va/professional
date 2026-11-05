import {
  ALL_WORKPLACES_ID,
  clearV2Y,
  focusNoteReels,
  initDateNavigator,
  initJournalDayTimeline,
  initNoteReels,
  journalDayTimeline,
  noteReels,
  setV2Y,
} from '../ui/ui.js';
import { getWorkplaces } from '../core/workplace-time.js';
import { getDays, getDay, getDayTime, getDaysForDate, getScheduleConflicts } from '../core/day/index.js';
import { createTimeGrid, getTimeGridMinuteState, getTimeUsagesForScope } from '../core/time/index.js';
import { getRecordPaymentState, recordAmountDue } from '../core/finance/index.js';
import { getNotesForDay } from '../core/note/index.js';
import { noteTargetLabel, noteVisibleForWorkplace } from './note-target.js';

// Warm the existing Journal creation module after the Day view has painted.
let creationModuleRequest = null;
function loadJournalCreationModule() {
  if (!creationModuleRequest) {
    creationModuleRequest = import('./creation-flow.js').catch((error) => {
      creationModuleRequest = null;
      throw error;
    });
  }
  return creationModuleRequest;
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function withFinancialState(usages = []) {
  return (Array.isArray(usages) ? usages : []).map((usage) => usage?.type === 'record' ? {
    ...usage,
    paid: Boolean(getRecordPaymentState(usage).fullyPaid),
    financialTotal: recordAmountDue(usage),
  } : usage);
}

async function openExistingRecord(record, rerender = () => {}) {
  const { openRecordView } = await import('../core/records/view.js');
  openRecordView(record, { onClose: rerender });
}

async function openUsage(usage, rerender = () => {}) {
  if (usage?.type === 'record') {
    await openExistingRecord(usage, rerender);
    return;
  }
  if (usage?.type === 'event') {
    const { openEventView } = await import('./event-view.js');
    openEventView(usage, { onClose: rerender });
  }
}

export function renderJournalDay(root, {
  date = new Date(),
  workplaceId = '',
  onChange = () => {},
  onWorkplaceFieldClick = () => {},
  navigationRoot = null,
  focusTarget = null,
  onCreationFinished = null,
  onUsageSummary = () => {},
} = {}) {
  root.dataset.journalDayContext = 'professional';
  root.innerHTML = navigationRoot
    ? '<div data-journal-day-content><div data-journal-timeline-host></div></div>'
    : '<div data-journal-day-navigator></div><div data-journal-day-content><div data-journal-timeline-host></div></div>';

  const navigatorRoot = navigationRoot || root.querySelector('[data-journal-day-navigator]');
  if (navigatorRoot) initDateNavigator(navigatorRoot, { date, onChange });

  const contentRoot = root.querySelector('[data-journal-day-content]');
  const timelineRoot = contentRoot?.querySelector('[data-journal-timeline-host]');
  const dayDate = dateKey(date);
  let creationWarmTimer = null;
  let creationWarmIdle = null;
  // Avoid making the first click perform a cold import of Record + editor dependencies.
  if (typeof window.requestIdleCallback === 'function') {
    creationWarmIdle = window.requestIdleCallback(() => {
      creationWarmIdle = null;
      void loadJournalCreationModule().catch(() => {});
    }, { timeout: 1200 });
  } else {
    creationWarmTimer = window.setTimeout(() => {
      creationWarmTimer = null;
      void loadJournalCreationModule().catch(() => {});
    }, 0);
  }

  const dispose = () => {
    if (creationWarmTimer !== null) window.clearTimeout(creationWarmTimer);
    if (creationWarmIdle !== null) window.cancelIdleCallback?.(creationWarmIdle);
    clearV2Y(root);
  };

  const rerender = () => {
    dispose();
    return renderJournalDay(root, {
      date,
      workplaceId,
      onChange,
      onWorkplaceFieldClick,
      navigationRoot,
      focusTarget,
      onCreationFinished,
      onUsageSummary,
    });
  };

  const workplaces = getWorkplaces();
  const allMode = workplaceId === ALL_WORKPLACES_ID;
  const workingDayRows = getDaysForDate(getDays(), dayDate);
  // One Time-owned read for the visible day, shared by Journal timeline and V.
  // The V menu never needs to read or re-project all Record/Finance facts.
  const dayUsages = workingDayRows.length ? getTimeUsagesForScope({ date: dayDate }) : [];
  onUsageSummary({
    usages: dayUsages,
    records: dayUsages.filter((usage) =>
      usage?.type === 'record' && String(usage?.date || '').slice(0, 10) === dayDate),
  });
  const dayNotes = getNotesForDay(dayDate);
  const visibleNotes = dayNotes.filter((note) => noteVisibleForWorkplace(note, workplaceId, { allMode }));
  const relatedIds = focusTarget?.targetType && focusTarget?.targetId
    ? visibleNotes
      .filter((note) => note.targetType === focusTarget.targetType && note.targetId === focusTarget.targetId)
      .map((note) => note.id)
    : [];

  const renderY = () => {
    const yRoot = setV2Y(root, noteReels(visibleNotes, {
      relatedIds,
      targetLabel: noteTargetLabel,
    }));
    if (!yRoot || yRoot.hidden) return;
    initNoteReels(yRoot, {
      onOpen: async ({ noteId }) => {
        const note = visibleNotes.find((item) => String(item?.id || '') === String(noteId || ''));
        if (!note) return;
        const { openNoteView } = await import('./note-view.js');
        openNoteView(note, {
          onSaved: rerender,
          onDeleted: rerender,
        });
      },
    });
    if (relatedIds.length) {
      requestAnimationFrame(() => focusNoteReels(yRoot, relatedIds));
    }
  };

  renderY();

  if (allMode) {
    const days = workingDayRows;
    if (!days.length) {
      timelineRoot.innerHTML = '<div class="time-day-state" aria-disabled="true">Выходной день</div>';
      return dispose;
    }

    const columns = days.map((day) => {
      const currentId = String(day?.workplaceId || '');
      const workplace = workplaces.find((item) => String(item?.key || '') === currentId) || null;
      const time = getDayTime(day, workplaces);
      if (!currentId || !time) return null;
      return {
        workplaceId: currentId,
        name: workplace?.name || 'Рабочее место',
        from: time.from,
        to: time.to,
        usages: withFinancialState(dayUsages.filter((usage) => String(usage?.workplaceId || '') === currentId)),
        conflict: getScheduleConflicts(days, {
          workplaceId: currentId,
          date: dayDate,
          from: time.from,
          to: time.to,
        }).length > 0,
      };
    }).filter(Boolean);

    if (!columns.length) {
      timelineRoot.innerHTML = '<div class="time-day-state" aria-disabled="true">Не задано рабочее время</div>';
      return dispose;
    }

    timelineRoot.innerHTML = journalDayTimeline({ columns, day: dayDate });
    initJournalDayTimeline(timelineRoot, {
      onWorkFieldClick: ({ workplaceId: nextWorkplaceId }) => {
        if (nextWorkplaceId) onWorkplaceFieldClick(nextWorkplaceId);
      },
    });
    return dispose;
  }

  const workingDay = getDay(getDays(), workplaceId, dayDate);
  if (!workingDay) {
    timelineRoot.innerHTML = '<div class="time-day-state" aria-disabled="true">Выходной день</div>';
    return dispose;
  }

  const time = getDayTime(workingDay, workplaces);
  if (!time) {
    timelineRoot.innerHTML = '<div class="time-day-state" aria-disabled="true">Не задано рабочее время</div>';
    return dispose;
  }

  const usages = withFinancialState(dayUsages.filter((usage) =>
    String(usage?.workplaceId || '') === String(workplaceId)));
  const usageById = new Map(usages.map((usage) => [String(usage?.sourceId || usage?.id || ''), usage]));
  const timeGrid = createTimeGrid({ date: dayDate, workplaceId, plan: time, usages });

  timelineRoot.innerHTML = journalDayTimeline({
    from: time.from,
    to: time.to,
    usages,
    day: dayDate,
    clipUsagesToWorkRange: true,
  });

  initJournalDayTimeline(timelineRoot, {
    onWorkFieldClick: () => onWorkplaceFieldClick(workplaceId),
    onUsageClick: ({ usageId }) => {
      const usage = usageById.get(String(usageId || ''));
      void openUsage(usage, rerender);
    },
    onSlotClick: async ({ from }) => {
      const minuteState = getTimeGridMinuteState(timeGrid, from);
      if (minuteState.state === 'occupied' && minuteState.usage) {
        const usage = usageById.get(String(minuteState.usage.sourceId || '')) || minuteState.usage;
        await openUsage(usage, rerender);
        return;
      }
      if (minuteState.state !== 'free') return;

      const { openJournalCreation } = await loadJournalCreationModule();
      if (!root.isConnected) return;
      openJournalCreation({
        date: dayDate,
        workplaceId,
        timeHint: from,
        timeGrid,
        onCreated: onCreationFinished || rerender,
        onCancel: onCreationFinished || rerender,
      });
    },
  });

  return dispose;
}
