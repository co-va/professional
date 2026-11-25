import { ALL_WORKPLACES_ID, emptyState, escapeHtml, v2ListEntries, v2ListEntry, shortDate, dataTable } from '../ui/ui.js';
import { isV2DesktopWorkspace } from '../ui/v2/geometry.js';
import { getWorkplaces } from '../core/workplace-time.js';
import { getRecordPaymentState } from '../core/finance/index.js';
import { getRecordsInRange } from '../core/record/index.js';
import { isRecordCompletedSide, recordActivityTime, recordAppointmentTime, recordListStatusClass } from '../core/record/index.js';

let recordViewModulePromise = null;
function loadRecordViewModule() {
  recordViewModulePromise ||= import('../core/records/view.js');
  return recordViewModulePromise;
}

function formatMoney(value = 0) {
  const amount = Math.max(0, Number(value) || 0);
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(amount).replaceAll('\u00a0', ' ')} ₽`;
}

function personName(person = {}, fallback = 'Человек') {
  return [person?.name, person?.surname].filter(Boolean).join(' ').trim() || fallback;
}

function workplaceName(workplaces, workplaceId) {
  const workplace = workplaces.find((item) => String(item?.key || '') === String(workplaceId || ''));
  return workplace?.name || 'Рабочее место';
}

function recordZone(record, workplaces) {
  const workplace = workplaces.find((item) => String(item?.key || '') === String(record?.workplaceId || ''));
  return String(workplace?.timeZone || '');
}

function recordPresentation(record, workplaces) {
  return { workplace: workplaceName(workplaces, record?.workplaceId), person: record?.person || {} };
}

function paymentFor(record) {
  const state = getRecordPaymentState(record);
  const imported = !state.hasPayments && record.historicalTransfer
    ? String(record.historicalPaymentStatus || '') : '';
  return {
    paid: Boolean(state.fullyPaid || imported === 'Оплачено'),
    activity: state.fullyPaid ? state.latestPayment : null,
    total: state.planTotal,
    imported,
  };
}

function recordId(record) {
  return String(record?.id || record?.sourceId || '');
}

function recordEntry(record, workplaces, { focus = false, paid = false, amountDue = 0, imported = '' } = {}) {
  const presentation = recordPresentation(record, workplaces);
  const name = personName(presentation.person, 'Человек');
  const classes = [recordListStatusClass(record, { paid }), focus ? 'journal-list-focus' : ''].filter(Boolean).join(' ');
  const id = recordId(record);
  return v2ListEntry({
    overline: presentation.workplace,
    title: name,
    subtitle: record?.person?.phone || '',
    rightTop: [shortDate(record?.date), String(record?.from || '')].filter(Boolean).join(' · '),
    rightBottom: imported || formatMoney(amountDue),
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

function renderDesktopRows(root, records, workplaces, focusId = '') {
  const rows = records.map(record => {
    const payment = paymentFor(record);
    const presentation = recordPresentation(record, workplaces);
    return { id: recordId(record), date: shortDate(record.date), time: [record.from, record.to].filter(Boolean).join(' – '),
      name: personName(presentation.person), phone: presentation.person.phone || '', workplace: presentation.workplace,
      services: (Array.isArray(record.procedures) ? record.procedures : []).map(item => item.name || item.title || '').filter(Boolean).join(', '),
      amount: payment.imported || formatMoney(payment.total), statusClass: recordListStatusClass(record, { paid: payment.paid }) };
  });
  root.innerHTML = dataTable({ caption:'Записи', compact:true,
    columns:[
      {key:'date',label:'Дата',sortable:false},{key:'time',label:'Время',sortable:false},
      {key:'name',label:'Клиент',sortable:false,render:row=>`<button type="button" data-journal-list-record="${escapeHtml(row.id)}">${escapeHtml(row.name)}</button>`},
      {key:'phone',label:'Телефон',sortable:false},{key:'workplace',label:'Рабочее пространство',sortable:false},
      {key:'services',label:'Услуги',sortable:false},{key:'amount',label:'Сумма',sortable:false}
    ], rows });
  [...root.querySelectorAll('tbody tr')].forEach((node,index)=>{
    const row=rows[index];
    if(row?.statusClass) row.statusClass.split(/\s+/).filter(Boolean).forEach(cls=>node.classList.add(cls));
    if(focusId && row?.id===focusId) node.dataset.journalDesktopFocus='';
  });
  bindRecordClicks(root, records);
  if(focusId) root.querySelector('[data-journal-desktop-focus]')?.scrollIntoView({block:'nearest'});
}

function renderTimeMode(root, records, workplaces) {
  const now = Date.now();
  const ordered = [...records].sort((a, b) =>
    recordAppointmentTime(a, 'from', recordZone(a, workplaces))
      - recordAppointmentTime(b, 'from', recordZone(b, workplaces)));
  const focusIndex = ordered.findIndex((record) =>
    recordAppointmentTime(record, 'to', recordZone(record, workplaces)) > now);
  const splitIndex = focusIndex >= 0 ? focusIndex : ordered.length;
  if (isV2DesktopWorkspace(root.closest('[data-v2-app]'))) return renderDesktopRows(root, ordered, workplaces, recordId(ordered[splitIndex]));
  const entries = ordered.flatMap((record, index) => {
    const payment = paymentFor(record);
    const row = recordEntry(record, workplaces, {
      focus: index === splitIndex, paid: payment.paid, amountDue: payment.total, imported: payment.imported,
    });
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
    const timeZone = recordZone(record, workplaces);
    return { record, payment, timeZone,
      completed: isRecordCompletedSide(record, { paid: payment.paid, now, timeZone }) };
  });
  const completed = prepared.filter((item) => item.completed).sort((a, b) =>
    recordActivityTime(a.record, a.payment.activity, { completed: true, timeZone: a.timeZone })
      - recordActivityTime(b.record, b.payment.activity, { completed: true, timeZone: b.timeZone }));
  const pending = prepared.filter((item) => !item.completed).sort((a, b) =>
    recordActivityTime(b.record, b.payment.activity, { timeZone: b.timeZone })
      - recordActivityTime(a.record, a.payment.activity, { timeZone: a.timeZone }));
  if (isV2DesktopWorkspace(root.closest('[data-v2-app]'))) return renderDesktopRows(root, [...completed,...pending].map(item=>item.record), workplaces, recordId(pending[0]?.record));
  const entries = [
    ...completed.map(({ record, payment }) => recordEntry(record, workplaces, { paid: payment.paid, amountDue: payment.total, imported: payment.imported })),
    anchorEntry(),
    ...pending.map(({ record, payment }) => recordEntry(record, workplaces, { paid: payment.paid, amountDue: payment.total, imported: payment.imported })),
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
