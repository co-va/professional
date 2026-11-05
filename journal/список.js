import { ALL_WORKPLACES_ID, emptyState, escapeHtml, v2ListEntries, v2ListEntry, shortDate } from '../ui/ui.js';
import { getWorkplaces } from '../core/workplace-time.js';
import { getRecordPaymentState, recordAmountDue } from '../core/finance/index.js';
import { getRecordsInRange } from '../core/record/index.js';
import { isRecordCompletedSide, recordActivityTime, recordAppointmentTime, recordVisualState } from '../core/record/index.js';

let recordViewModulePromise = null;
function loadRecordViewModule() {
  recordViewModulePromise ||= import('../core/records/view.js');
  return recordViewModulePromise;
}

function formatMoney(value = 0) {
  const amount = Math.max(0, Math.round(Number(value) || 0));
  return `${amount.toLocaleString('ru-RU').replaceAll('\u00a0', ' ')} ₽`;
}

function personName(person = {}, fallback = 'Человек') {
  return [person?.name, person?.surname].filter(Boolean).join(' ').trim() || fallback;
}

function workplaceName(workplaces, workplaceId) {
  const workplace = workplaces.find((item) => String(item?.key || '') === String(workplaceId || ''));
  return workplace?.name || 'Рабочее место';
}

function recordPresentation(record, workplaces) {
  return { workplace: workplaceName(workplaces, record?.workplaceId), person: record?.person || {} };
}

function paymentFor(record) {
  const state = getRecordPaymentState(record);
  return { paid: Boolean(state.fullyPaid), activity: state.fullyPaid ? state.latestPayment : null };
}

function displayAmountDue(record = null) { return recordAmountDue(record); }

function recordStatusClass(record, paid = false) {
  return `journal-list-record--${recordVisualState(record, { paid })}`;
}

function recordId(record) {
  return String(record?.id || record?.sourceId || '');
}

function recordEntry(record, workplaces, { focus = false, paid = false } = {}) {
  const presentation = recordPresentation(record, workplaces);
  const name = personName(presentation.person, 'Человек');
  const classes = [recordStatusClass(record, paid), focus ? 'journal-list-focus' : ''].filter(Boolean).join(' ');
  const id = recordId(record);
  return v2ListEntry({
    overline: presentation.workplace,
    title: name,
    subtitle: record?.person?.phone || '',
    rightTop: [shortDate(record?.date), String(record?.from || '')].filter(Boolean).join(' · '),
    rightBottom: formatMoney(displayAmountDue(record)),
    interactive: Boolean(id),
    data: id ? `data-journal-list-record="${escapeHtml(id)}"` : '',
    aria: id ? `Открыть запись ${name}` : '',
    className: classes,
    initial: (name || '?').slice(0, 1).toUpperCase(),
  });
}

function anchorEntry() {
  return '<div class="journal-list-anchor" data-journal-list-anchor aria-hidden="true"></div>';
}

function scrollToFocus(root, selector) {
  requestAnimationFrame(() => {
    const node = root.querySelector(selector);
    if (!node) return;
    const rootTop = root.getBoundingClientRect().top;
    const nodeTop = node.getBoundingClientRect().top;
    root.scrollTop += nodeTop - rootTop;
  });
}

function bindRecordClicks(root, records) {
  if (typeof root?.querySelectorAll !== 'function') return;
  const byId = new Map(records.map((record) => [recordId(record), record]).filter(([id]) => Boolean(id)));
  root.querySelectorAll('[data-journal-list-record]').forEach((node) => node.addEventListener('click', async () => {
    const record = byId.get(String(node.dataset.journalListRecord || ''));
    if (!record) return;
    const { openRecordView } = await loadRecordViewModule();
    openRecordView(record);
  }));
}

function renderTimeMode(root, records, workplaces) {
  const now = Date.now();
  const ordered = [...records].sort((a, b) => recordAppointmentTime(a, 'from') - recordAppointmentTime(b, 'from'));
  const focusIndex = ordered.findIndex((record) => recordAppointmentTime(record, 'to') > now);
  const splitIndex = focusIndex >= 0 ? focusIndex : ordered.length;
  const entries = ordered.flatMap((record, index) => {
    const payment = paymentFor(record);
    const row = recordEntry(record, workplaces, { focus: index === splitIndex, paid: payment.paid });
    return index === splitIndex ? [anchorEntry(), row] : [row];
  });
  if (splitIndex === ordered.length) entries.push(anchorEntry());
  root.innerHTML = v2ListEntries(entries);
  bindRecordClicks(root, ordered);
  scrollToFocus(root, '[data-journal-list-anchor]');
}

function renderFlowMode(root, records, workplaces) {
  const now = Date.now();
  const prepared = records.map((record) => {
    const payment = paymentFor(record);
    return { record, payment, completed: isRecordCompletedSide(record, { paid: payment.paid, now }) };
  });
  const completed = prepared.filter((item) => item.completed).sort((a, b) => recordActivityTime(a.record, a.payment.activity, { completed: true }) - recordActivityTime(b.record, b.payment.activity, { completed: true }));
  const pending = prepared.filter((item) => !item.completed).sort((a, b) => recordActivityTime(b.record, b.payment.activity) - recordActivityTime(a.record, a.payment.activity));
  const entries = [
    ...completed.map(({ record, payment }) => recordEntry(record, workplaces, { paid: payment.paid })),
    anchorEntry(),
    ...pending.map(({ record, payment }) => recordEntry(record, workplaces, { paid: payment.paid })),
  ];
  root.innerHTML = v2ListEntries(entries);
  bindRecordClicks(root, records);
  scrollToFocus(root, '[data-journal-list-anchor]');
}

// Journal List: previous 30 calendar days, today, and every future date.
export function getJournalListRecords({ workplaceId = ALL_WORKPLACES_ID, now = new Date() } = {}) {
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  cutoff.setDate(cutoff.getDate() - 30);
  const earliest = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  // Preserve the 30-day cutoff and unbounded future, but project only
  // matching Record rows rather than rebuilding all historical settlements.
  return getRecordsInRange({
    from: earliest,
    workplaceId: workplaceId === ALL_WORKPLACES_ID ? '' : workplaceId,
  });
}

export function renderJournalList(root, { mode = 'flow', workplaceId = ALL_WORKPLACES_ID } = {}) {
  root.dataset.journalListContext = 'professional';
  const workplaces = getWorkplaces();
  const visibleRecords = getJournalListRecords({ workplaceId });
  if (!visibleRecords.length) {
    root.innerHTML = emptyState('Список', 'Записей пока нет.');
    return;
  }
  if (mode === 'time') renderTimeMode(root, visibleRecords, workplaces);
  else renderFlowMode(root, visibleRecords, workplaces);
}
