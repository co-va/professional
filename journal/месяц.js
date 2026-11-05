import { initCalendar, ALL_WORKPLACES_ID } from '../ui/ui.js';
import { renderJournalGraphMode } from './график.js';
import { bindCalendarHeaderHost } from '../ui/calendar/index.js';
import { getRecordPaymentState } from '../core/finance/index.js';
import { timeToMinutes } from '../core/time/index.js';
import { getWorkplaces, getWorkingDays, getWorkingDayIndicators, resolveWorkingDayTime } from '../core/workplace-time.js';
import { getRecordsInRange, recordVisualState } from '../core/record/index.js';
import { getEvents } from '../core/event/index.js';

const RECORD_COLOR = '#EFFFBB';
const PAID_COLOR = '#DDE8D7';
const NO_SHOW_COLOR = '#F1DADA';
const EVENT_COLOR = '#777A7D';

// Visual priorities only: an occupied minute is counted once, even if two
// different sources unexpectedly overlap. This does not change owner statuses.
const ACTIVE = 1;
const PAID = 2;
const EVENT = 3;
const NO_SHOW = 4;

function recordsByDate(records, workplaceId, allMode) {
  const index = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    if (record?.status === 'cancelled') return;
    if (!allMode && String(record?.workplaceId || '') !== String(workplaceId || '')) return;
    const key = String(record?.date || '').slice(0, 10);
    if (!key) return;
    const bucket = index.get(key) || [];
    bucket.push(record);
    index.set(key, bucket);
  });
  return index;
}

function eventsByDate(events, workplaceId, allMode, prefix) {
  const index = new Map();
  (Array.isArray(events) ? events : []).forEach((event) => {
    const key = String(event?.date || '').slice(0, 10);
    if (!key.startsWith(prefix)) return;
    if (!allMode && String(event?.workplaceId || '') !== String(workplaceId || '')) return;
    const bucket = index.get(key) || [];
    bucket.push(event);
    index.set(key, bucket);
  });
  return index;
}

function dayRecordData({ dateKey, workplaceId, allMode, workingDays, workplaces, recordIndex, eventIndex }) {
  const records = recordIndex.get(dateKey) || [];
  const events = eventIndex.get(dateKey) || [];
  const minutes = { paid: 0, active: 0, noShow: 0, event: 0 };

  // Day owns planned work, Record/Event own actual occupancy. A later schedule
  // correction must not hide an existing appointment from the Month.
  const timelines = new Map();
  const timeline = (id) => {
    if (!timelines.has(id)) timelines.set(id, {
      planned: new Uint8Array(1440),
      occupied: new Uint8Array(1440),
    });
    return timelines.get(id);
  };
  const inScope = (id) => id && (allMode || id === String(workplaceId || ''));
  const bounds = (value) => {
    const from = timeToMinutes(value?.from);
    const to = timeToMinutes(value?.to);
    return from == null || to == null || to <= from ? null : { from, to };
  };

  for (const day of workingDays) {
    if (String(day?.date || '') !== dateKey) continue;
    const id = String(day?.workplaceId || '');
    if (!inScope(id)) continue;
    const range = bounds(resolveWorkingDayTime(workplaces, day));
    if (!range) continue;
    timeline(id).planned.fill(1, range.from, range.to);
  }

  const occupy = (item, rank) => {
    const id = String(item?.workplaceId || '');
    if (!inScope(id)) return;
    const range = bounds(item);
    if (!range) return;
    const slots = timeline(id).occupied;
    for (let minute = range.from; minute < range.to; minute += 1) {
      if (rank > slots[minute]) slots[minute] = rank;
    }
  };
  for (const record of records) {
    // "No-show" remains occupied and pink, regardless of payment status.
    if (record?.attendance === 'no-show') occupy(record, NO_SHOW);
    else {
      const paid = Boolean(getRecordPaymentState(record).fullyPaid);
      occupy(record, recordVisualState(record, { paid }) === 'paid' ? PAID : ACTIVE);
    }
  }
  for (const event of events) occupy(event, EVENT);

  let capacity = 0;
  for (const { planned, occupied } of timelines.values()) {
    for (let minute = 0; minute < planned.length; minute += 1) {
      const rank = occupied[minute];
      if (planned[minute] || rank) capacity += 1;
      if (rank === PAID) minutes.paid += 1;
      else if (rank === ACTIVE) minutes.active += 1;
      else if (rank === NO_SHOW) minutes.noShow += 1;
      else if (rank === EVENT) minutes.event += 1;
    }
  }
  const busy = minutes.paid + minutes.active + minutes.noShow + minutes.event;
  return { count: records.length, capacity, minutes, busy };
}

function usageGradient({ capacity, minutes }) {
  if (!(capacity > 0)) return '';
  const values = [
    { color: PAID_COLOR, minutes: minutes.paid },
    { color: RECORD_COLOR, minutes: minutes.active },
    { color: NO_SHOW_COLOR, minutes: minutes.noShow },
    { color: EVENT_COLOR, minutes: minutes.event },
  ];
  let cursor = 0;
  const stops = [];

  values.forEach((item) => {
    if (!(item.minutes > 0) || cursor >= 100) return;
    const width = Math.min(100 - cursor, (item.minutes / capacity) * 100);
    const end = cursor + width;
    stops.push(`${item.color} ${cursor.toFixed(2)}%`, `${item.color} ${end.toFixed(2)}%`);
    cursor = end;
  });

  if (!stops.length) return '';
  stops.push(`transparent ${cursor.toFixed(2)}%`, 'transparent 100%');
  return `linear-gradient(90deg,${stops.join(',')})`;
}

function busyLabel(total) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours && minutes ? `${hours}ч${String(minutes).padStart(2, '0')}м`
    : hours ? `${hours} ч` : `${minutes} м`;
}

function dateContent(data) {
  const gradient = usageGradient(data);
  const fill = gradient ? `<span class="calendar__date-fill" style="--calendar-date-fill:${gradient}" aria-hidden="true"></span>` : '';
  const count = data.count ? `<span>${data.count} зап.</span>` : '';
  const busy = data.busy ? `<span>${busyLabel(data.busy)}</span>` : '';
  const details = count || busy ? `<span class="calendar__date-count">${count}${busy}</span>` : '';
  return `${fill}${details}`;
}

function workingDatesForJournal(workingDays, workplaceId, allMode) {
  return [...new Set((Array.isArray(workingDays) ? workingDays : [])
    .filter((day) => allMode || String(day?.workplaceId || '') === String(workplaceId || ''))
    .map((day) => String(day?.date || ''))
    .filter(Boolean))];
}

export function renderJournalMonth(root, {
  month = new Date(),
  workplaceId = '',
  mode = 'view',
  onDateSelect = () => {},
  onDateFocus = () => {},
  onMonthChange = () => {},
  onWorkplaceChange = () => {},
  onGraphControls = () => {},
  navigationRoot = null,
} = {}) {
  root.dataset.journalMonthContext = 'professional';
  root.innerHTML = '<div data-journal-month-calendar data-calendar-workspace-host></div><div data-journal-month-actions></div>';
  const calendarRoot = root.querySelector('[data-journal-month-calendar]');
  if (mode === 'graph') {
    const disposeGraph = renderJournalGraphMode({
      root,
      calendarRoot,
      actionsRoot: root.querySelector('[data-journal-month-actions]'),
      month,
      workplaceId,
      onDateFocus,
      onMonthChange,
      onWorkplaceChange,
      onControls: onGraphControls,
    });
    const disposeHeader = bindCalendarHeaderHost(calendarRoot, navigationRoot);
    return () => { disposeHeader(); disposeGraph?.(); };
  }

  const workingDays = getWorkingDays();
  const workplaces = getWorkplaces();
  const allMode = workplaceId === ALL_WORKPLACES_ID;
  // The calendar can navigate months internally, without remounting Journal.
  // Read/project a month only when it becomes visible; reuse it for its 28-31 cells.
  let indexMonth = '';
  let recordIndex = new Map();
  let eventIndex = new Map();
  const dataForDisplayedMonth = (dateKey) => {
    const prefix = String(dateKey || '').slice(0, 7);
    if (prefix !== indexMonth) {
      const [year, number] = prefix.split('-').map(Number);
      const lastDay = new Date(year, number, 0).getDate();
      const records = getRecordsInRange({
        from: `${prefix}-01`,
        to: `${prefix}-${String(lastDay).padStart(2, '0')}`,
        workplaceId: allMode ? '' : workplaceId,
      });
      recordIndex = recordsByDate(records, workplaceId, allMode);
      eventIndex = eventsByDate(getEvents(), workplaceId, allMode, prefix);
      indexMonth = prefix;
    }
    return { recordIndex, eventIndex };
  };

  initCalendar(calendarRoot, {
    month,
    workingDates: workingDatesForJournal(workingDays, workplaceId, allMode),
    renderDateContent: ({ dateKey, isCurrentMonth }) => {
      if (!isCurrentMonth) return '';
      return dateContent(dayRecordData({
        dateKey, workplaceId, allMode, workingDays, workplaces,
        ...dataForDisplayedMonth(dateKey),
      }));
    },
    resolveDateIndicators: ({ dateKey, isCurrentMonth }) => isCurrentMonth
      ? getWorkingDayIndicators(workingDays, workplaces, dateKey, { excludeWorkplaceId: allMode ? '' : workplaceId })
      : [],
    onDateSelect: (dateKey) => {
      const [year, monthNumber, day] = String(dateKey).split('-').map(Number);
      if (!year || !monthNumber || !day) return;
      onDateSelect(new Date(year, monthNumber - 1, day));
    },
    onMonthChange,
  });

  return bindCalendarHeaderHost(calendarRoot, navigationRoot);
}
