import {
  actionBlock,
  button,
  compactButton,
  dataTable,
  collectLinks,
  details,
  collectRepeatedEntries,
  collectTags,
  emptyState,
  entityVisualCard,
  documentTile,
  documentTiles,
  datePicker,
  initDatePickers,
  escapeHtml,
  field,
  initLinks,
  initMonthDayPickers,
  initRepeatedFields,
  initTags,
  initUEI,
  links,
  modal,
  monthDayPicker,
  mountModal,
  mountV2ZLayer,
  openNotice,
  page,
  repeatedField,
  select,
  setV2ZHeaderRows,
  shortDate,
  shortDateTime,
  tags,
  uei,
  v2ListEntry,
  v2ListEntries,
  v2Section,
  v2ZLayer,
  workspaceHeaderContext,
  openEntityCardAppearanceQ,
} from '../../ui/ui.js';
import { applyUEI, detachUEI, getMembers, getOptions, getUEI } from '../uei.js';
import { getTags } from '../../settings/tags/data.js';
import { openTagEditor } from '../../settings/tags/tags.js';
import { addTagToSelection } from '../../ui/tags/index.js';
import { getDocuments } from '../../settings/documents/data.js';
import { getPersonConsentState, getPersonConsentDocumentIds } from '../../settings/documents/consents.js';
import { getAllPeople, getIdentityMemberKeys, getPeople, getPersonPriceCondition, savePeople } from './data.js';
import { flushBusinessPersistence, isBusinessServerReady } from '../business-persistence.js';
import { bindPersonCreateForm, personCreateForm } from './create.js';
import { personDisplay } from './presentation.js';
import { openPeopleExcelMenu } from './excel.js';
import { openContactImportBatches } from './contact-import-review.js';
import { personCardAppearance, personCardFields } from './card-presentation.js';
import { getCurrentPersonHistory, getPersonHistory } from './history.js';
import { getPersonMetadata, formatPersonVisitDate, buildPersonVisitIndex } from './metadata.js';
import { checkControl } from '../../ui/selection/check-list.js';
import { isV2DesktopWorkspace } from '../../ui/v2/geometry.js';
import { getRecord, getRecords } from '../record/index.js';
import { getProcedures, hasCurrentProceduresSnapshot } from '../service/procedures/data.js';
import { getWorkplaces, isWorkplacesServerReady } from '../profile/workplaces/data.js';
import { loadRecordCreationOperationalState } from '../runtime/operational-state.js';
import { loadFinanceState } from '../runtime/auxiliary-state.js';
import { saveCardAppearanceTemplate } from '../card-appearance-templates.js';
import { getPeopleFilters, getPeopleSortMode, setPeopleFilters, setPeopleSortMode } from './view-state.js';
import { buildPersonRelationshipSections } from './programs.js';
import { openPersonProgramActions, personProgramActionTypes } from '../loyalty/person-program-actions.js';
import { listPersonDeposits } from '../loyalty/deposit/data.js';
import { peopleHasAssignedDiscount, peopleAssignedPrograms, peopleProgramOptions, refreshPeopleLoyaltyData } from './loyalty-filter.js';
import { openPersonRecordCreation } from './record-creation.js';
import { canUseRealPersonalData } from '../access.js';
import { isTelegramUserId, loadTelegramUsernames, telegramDisplay } from './telegram-usernames.js';

const name = (person) => [person?.name, person?.surname].filter(Boolean).join(' ').trim() || 'Без имени';
const money = (value) => new Intl.NumberFormat('ru-RU').format(Number(value || 0)) + ' ₽';
const initials = (person) => [person?.name, person?.surname].filter(Boolean).slice(0, 2).map((part) => String(part).slice(0, 1).toUpperCase()).join('') || '?';

function notifyContext() {
  window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
}

function sortItems(items, mode, visitIndex = null) {
  const visits = mode.startsWith('last') ? (visitIndex || buildPersonVisitIndex()) : null;
  return [...items].sort((a, b) => {
    if (mode.startsWith('name')) {
      const compared = name(a).localeCompare(name(b), 'ru');
      return mode === 'nameDesc' ? -compared : compared;
    }
    if (mode.startsWith('uei')) {
      const compared = String(personDisplay(a).uei || '').localeCompare(String(personDisplay(b).uei || ''), 'ru', { numeric: true });
      return mode === 'ueiDesc' ? -compared : compared;
    }
    const av = Date.parse(visits?.get(String(a.key))?.lastVisit || '') || 0;
    const bv = Date.parse(visits?.get(String(b.key))?.lastVisit || '') || 0;
    return mode === 'lastDesc' ? bv - av : av - bv;
  });
}

function sortOptions() {
  return [
    ['nameAsc', 'Имя ↑'],
    ['nameDesc', 'Имя ↓'],
    ['ueiAsc', 'UEI ↑'],
    ['ueiDesc', 'UEI ↓'],
    ['lastAsc', 'Последнее посещение ↑'],
    ['lastDesc', 'Последнее посещение ↓'],
  ].map(([value, label]) => ({ value, label }));
}

function consentSignedMoment(fact) {
  // Never display the timestamp of a revocation or a superseded signature.
  return shortDate(fact?.acceptedAt || fact?.eventAt || '', '');
}



function personDocuments(person) {
  const documents = getDocuments().filter((item) => !item.hidden);
  const byId = new Map(documents.map((item) => [String(item.id || ''), item]));
  const relevantIds = new Set(getPersonConsentDocumentIds(person, getAllPeople()));
  return documents.filter((item) => item.personConsent || relevantIds.has(String(item.id || '')))
    .concat([...relevantIds].filter((id) => !byId.has(id)).map((id) => ({
      id, title: id, version: 1, text: '', personConsent: true,
    })));
}

function personDocumentTile(person, documentItem) {
  const state = getPersonConsentState(person, documentItem, getAllPeople());
  return documentTile({
    title: documentItem.title || 'Документ',
    meta: state.active ? consentSignedMoment(state.fact) : '',
    status: state.active ? 'Подписано' : '',
    statusState: state.active ? 'signed' : '',
    interactive: false,
  });
}

function openPersonDocuments(root, person) {
  const documents = personDocuments(person);
  const body = documents.length
    ? documentTiles(documents.map((item) => personDocumentTile(person, item)), { layout: 'rail' })
    : emptyState('Документов пока нет', 'Документы и согласия этого человека появятся здесь.');
  return mountModal(root, modal(body, { title: 'Документы / согласия', variant: 'x', surface: 'app' }));
}

function historyItems(items = [], query = '') {
  const needle = String(query || '').trim().toLocaleLowerCase('ru');
  if (!needle) return items;
  return items.filter((item) => {
    const kind = item.kind === 'finance' ? 'Продажа операция' : 'Запись';
    const amount = item.amount == null ? '' : money(item.amount);
    const moment = shortDateTime(item.occurredAt, '');
    return [kind, item.title || '', item.subtitle || '', amount, moment]
      .join(' ')
      .toLocaleLowerCase('ru')
      .includes(needle);
  });
}

function personHistoryMarkup(items = [], query = '') {
  const filtered = historyItems(items, query);
  if (!filtered.length) return emptyState(query ? 'Ничего не найдено' : 'Истории пока нет', query ? 'Измените запрос.' : 'Здесь появятся записи, продажи и связанные события.');
  return v2ListEntries(filtered.map((item, index) => v2ListEntry({
    overline: item.kind === 'finance' ? 'Продажа / операция' : 'Запись',
    title: item.title || (item.kind === 'finance' ? 'Финансовая операция' : 'Запись'),
    subtitle: item.subtitle || '',
    omitEmptySubtitle: true,
    className: item.kind === 'record' ? (item.visualClass || '') : '',
    rightTop: item.amount == null ? shortDateTime(item.occurredAt, '') : money(item.amount),
    rightBottom: item.amount == null ? '' : shortDateTime(item.occurredAt, ''),
    interactive: true,
    initial: '',
    data: `data-person-history-item="${index}"`,
    aria: `Открыть ${item.title || 'событие'}`,
  })));
}

function personQContext(person, { settings = false } = {}) {
  return workspaceHeaderContext({
    title: name(person),
    a: {
      kind: 'avatar',
      image: person.photo || '',
      initials: initials(person),
    },
    v: settings ? { data: 'data-person-settings', aria: `Настройки ${name(person)}` } : null,
    d: {
      kind: 'chat',
      data: 'data-person-direct-chat',
      aria: `Чат с ${name(person)}`,
    },
  });
}

function financeHistoryDetail(item = {}) {
  return v2Section('Операция', details([
    { label: 'Операция', value: item.title || 'Финансовая операция' },
    ...(item.subtitle ? [{ label: 'Описание', value: item.subtitle }] : []),
    { label: 'Дата', value: shortDateTime(item.occurredAt, '—') },
    ...(item.provenance?.type === 'import' ? [{ label: 'Происхождение', value: 'Импорт' }, { label: 'Перенесено в CO-VA', value: shortDateTime(item.recordedAt, '—') }] : []),
    { label: 'Сумма', value: money(item.amount) },
  ]));
}

async function openPersonHistoryItemQ(root, person, item, options = {}) {
  if (item.kind === 'record') {
    const current = getRecord(item.recordId);
    const snapshot = item.recordSnapshot || null;
    const record = current || (snapshot?.id ? {
      ...snapshot,
      // History-only Record snapshots retain their original values; deleted
      // records are excluded from the working history at the data owner.
      person: snapshot.person?.key ? snapshot.person : person,
    } : null);
    if (!record?.id) return null;
    const { openRecordView } = await import('../records/view.js');
    if (root?.isConnected === false) return null;
    // History stays Q1; the canonical Record preview opens as Q2 above it.
    // Closing Q2 reveals the same history Q without another network request.
    return openRecordView(record, {
      presentation: 'q',
      readOnlyHistory: !current,
      // History Q1 remains mounted underneath Record Q2. Refresh it after
      // a persisted cancellation/payment before it is visible again.
      onClose: () => { if (typeof options.refreshHistory === 'function') void options.refreshHistory(); },
    });
  }
  // Financial events have their own information, not a Record preview.
  const layer = mountModal(root, modal(`${personQContext(person)}${financeHistoryDetail(item)}`, {
    title: name(person),
    variant: 'q',
    surface: 'app',
    className: 'people-history-q',
  }));
  if (layer) bindPersonContext(layer, person, options);
  return layer;
}

export async function openPersonHistoryQ(root, person, options = {}) {
  const layer = mountModal(root, modal(`${personQContext(person)}<div data-person-history-host></div>`, {
    title: 'История',
    variant: 'q',
    surface: 'app',
    className: 'people-history-q',
  }));
  if (!layer) return null;
  const header = layer.querySelector('[data-v2-q-header-content]');
  if (header) {
    header.innerHTML = `<div class="people-history-search ui-search-field">
      ${field({ name: 'personHistorySearch', type: 'search', placeholder: 'Поиск', autocomplete: 'off', data: 'data-person-history-search' })}
    </div>`;
  }
  const host = layer.querySelector('[data-person-history-host]');
  const search = layer.querySelector('[data-person-history-search]');
  // On Desktop, paint the new Q and a loading state before doing the synchronous
  // Journal/Finance projection. Keep the original immediate Mobile path.
  const desktopOverview = Boolean(root?.closest?.('.people-desktop-overview-q'));
  if (desktopOverview) {
    if (host) host.innerHTML = emptyState('История', 'Загружаем данные…');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!layer.isConnected) return layer;
  }
  // Show existing Journal records immediately; audit History enriches the list.
  let sourceItems = getCurrentPersonHistory(person.key);
  const refreshHistory = async () => {
    if (!layer.isConnected) return;
    try {
      const current = await getPersonHistory(person.key);
      if (layer.isConnected) {
        sourceItems = current;
        render();
      }
    } catch (_) {
      if (layer.isConnected) {
        sourceItems = getCurrentPersonHistory(person.key);
        render();
      }
    }
  };
  const render = () => {
    const query = String(search?.value || '').trim();
    const items = historyItems(sourceItems, query);
    if (host) host.innerHTML = personHistoryMarkup(sourceItems, query);
    host?.querySelectorAll('[data-person-history-item]').forEach((node) => {
      node.addEventListener('click', () => {
        const item = items[Number(node.dataset.personHistoryItem)];
        if (item) void openPersonHistoryItemQ(layer, person, item, { ...options, refreshHistory });
      });
    });
  };
  search?.addEventListener('input', render);
  bindPersonContext(layer, person, options);
  if (sourceItems.length) render();
  else if (host) host.innerHTML = emptyState('История', 'Загружаем данные…');
  try {
    sourceItems = await getPersonHistory(person.key);
    if (layer.isConnected !== false) render();
  } catch (error) {
    if (layer.isConnected !== false && host) {
      // The low-level fetch failure is not useful in a contact card.
      // Audit history is optional for showing the already-hydrated Journal records.
      if (sourceItems.length) {
        render();
        host.insertAdjacentHTML('afterbegin', '<p class="muted" role="status">Показаны записи из Журнала. Полная история сейчас недоступна.</p>');
      } else {
        host.innerHTML = emptyState('История недоступна', 'Не удалось получить историю с сервера. Повторите попытку позже.');
      }
    }
  }
  return layer;
}

function openPersonSettings(root, person, options = {}) {
  const layer = mountModal(root, modal(`<div class="modal-actions">
    ${button('Документы', { variant: 'secondary', data: 'data-person-settings-documents' })}
    ${button('История', { variant: 'secondary', data: 'data-person-settings-history' })}
    ${button('Программы', { variant: 'secondary', data: 'data-person-settings-programs' })}
    ${button('Записать', { data: 'data-person-settings-record' })}
    ${button('Удалить', { variant: 'critical', data: 'data-person-settings-delete' })}
  </div>`, {
    title: 'Настройки',
    variant: 'x',
    surface: 'app',
    xRole: 'action',
  }));
  if (!layer) return null;
  layer.querySelector('[data-person-settings-documents]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openPersonDocuments(root, person);
  });
  layer.querySelector('[data-person-settings-history]')?.addEventListener('click', () => {
    layer.v2Close?.();
    void openPersonHistoryQ(root, person, options);
  });
  layer.querySelector('[data-person-settings-programs]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openPersonProgramActions(root, person, { onChanged: options.onProgramChanged });
  });
  layer.querySelector('[data-person-settings-record]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openPersonRecordCreation({ person });
  });
  layer.querySelector('[data-person-settings-delete]')?.addEventListener('click', () => {
    layer.v2Close?.();
    confirmDelete(root, person, () => options.onDeleted?.());
  });
  return layer;
}

function birthMonth(value = '') {
  const source = String(value || '').trim();
  const iso = source.match(/^(?:\d{4}-)?(\d{2})-\d{2}(?:$|T)/);
  if (iso) return Number(iso[1]);
  const local = source.match(/^\d{2}[./](\d{2})(?:[./]\d{4})?$/);
  return local ? Number(local[1]) : 0;
}

function currentPeopleFilters() {
  const filters = getPeopleFilters();
  if (!filters.workplace || !isWorkplacesServerReady()) return filters;
  const workplaces = getWorkplaces();
  if (workplaces.length > 1 && workplaces.some((item) => item.key === filters.workplace)) return filters;
  // A deleted/sole workplace must not remain as an invisible, active filter.
  return setPeopleFilters({ ...filters, workplace: '' });
}

function recordPeriodStart(monthCount, today = new Date()) {
  const months = Number(monthCount);
  if (![1, 3, 6].includes(months)) return '';
  // Months are fixed 30-day windows, counted backwards from today, inclusive.
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - months * 30 + 1);
  return [start.getFullYear(), String(start.getMonth() + 1).padStart(2, '0'),
    String(start.getDate()).padStart(2, '0')].join('-');
}

function recordFilterPersonKeys({ procedure = '', workplace = '', recordPeriod = '', recordFrom = '', recordTo = '' } = {}) {
  if (!procedure && !workplace && !recordPeriod) return null;
  const matched = new Set();
  const periodStart = recordPeriodStart(recordPeriod);
  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')].join('-');
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const validRange = recordPeriod !== 'range'
    || (datePattern.test(recordFrom) && datePattern.test(recordTo) && recordFrom <= recordTo);

  for (const record of getRecords()) {
    if (record?.status === 'cancelled') continue;
    if (procedure && !(record?.procedures || []).some((item) => String(item?.id || '') === procedure)) continue;
    if (workplace && String(record?.workplaceId || '') !== workplace) continue;

    const appointmentDate = String(record?.date || '').slice(0, 10);
    if (recordPeriod) {
      if (!datePattern.test(appointmentDate)) continue;
      if (recordPeriod === 'none') {
        if (appointmentDate > today) continue;
      } else if (recordPeriod === 'range') {
        if (!validRange || appointmentDate < recordFrom || appointmentDate > recordTo) continue;
      } else if (!periodStart || appointmentDate < periodStart || appointmentDate > today) {
        continue;
      }
    }

    // All record-based conditions must describe the SAME record.
    // Person fields (gender, labels, email, birthday) are checked separately.
    const keys = [record?.person?.key, ...(record?.group?.participants || []).map((item) => item?.key)];
    for (const key of keys) if (key) matched.add(String(key));
  }
  return matched;
}

function applyPeopleFilters(items = [], filters = currentPeopleFilters()) {
  const selectedMonth = Number(filters.birthday);
  const recordKeys = recordFilterPersonKeys(filters);
  return items.filter((person) => {
    if (filters.gender === 'none' && person.gender) return false;
    if (filters.gender && filters.gender !== 'none' && person.gender !== filters.gender) return false;
    if (filters.birthday === 'none' && person.birthDate) return false;
    if (filters.birthday === 'has' && !person.birthDate) return false;
    if (selectedMonth >= 1 && selectedMonth <= 12 && birthMonth(person.birthDate) !== selectedMonth) return false;
    if (filters.tag && !(person.tags || []).includes(filters.tag)) return false;
    if (filters.loyaltyMode === 'discount' && !peopleHasAssignedDiscount(person)) return false;
    if (filters.loyaltyMode === 'program') {
      const assigned=peopleAssignedPrograms(person);
      if (!assigned.size || (filters.loyaltyProgram && !assigned.has(filters.loyaltyProgram))) return false;
    }
    if (recordKeys) {
      const matched = getIdentityMemberKeys(person.key).some((key) => recordKeys.has(String(key)));
      if (filters.recordPeriod === 'none' ? matched : !matched) return false;
    }
    const emailSpecified = (person.emails || []).some((value) => String(value || '').trim());
    if (filters.noEmail === 'yes' && emailSpecified) return false;
    if (filters.noEmail === 'has' && !emailSpecified) return false;
    return true;
  });
}

function tagFilterOptions() {
  return [{ value: '', label: 'Без фильтра' }, ...getTags().map((item) => ({ value: String(item.id), label: item.name }))];
}

function procedureFilterOptions() {
  const items = getProcedures()
    .filter((item) => item?.id && item?.name)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
  return [{ value: '', label: 'Без фильтра' }, ...items.map((item) => ({ value: String(item.id), label: String(item.name) }))];
}

function workplaceFilterOptions() {
  const workplaces = getWorkplaces().filter((item) => item.key);
  if (workplaces.length <= 1) return [];
  return [{ value: '', label: 'Без фильтра' },
    ...workplaces.map((item) => ({ value: String(item.key), label: String(item.name || 'Без названия') }))];
}

const BIRTH_MONTH_OPTIONS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
].map((label, index) => ({ value: String(index + 1), label }));

function filterPeople(items, query = '') {
  const needle = String(query || '').trim().toLocaleLowerCase('ru');
  if (!needle) return items;
  return items.filter((person) => {
    const display = personDisplay(person);
    return display.name.toLocaleLowerCase('ru').includes(needle)
      || String(display.uei || '').toLocaleLowerCase('ru').includes(needle);
  });
}

function listMarkup(items, query = '') {
  if (!items.length) {
    return query
      ? emptyState('Ничего не найдено', 'Проверьте имя или UEI.')
      : emptyState('Клиентов пока нет', 'Добавьте человека кнопкой «+».');
  }
  return v2ListEntries(items.map((person) => {
    const display = personDisplay(person);
    return v2ListEntry({
      overline: display.uei,
      title: display.name,
      subtitle: display.phone,
      rightBottom: person.contactStatus === 'import' ? 'Импорт'
        : person.contactStatus === 'registered' ? 'Аккаунт' : '',
      initial: '',
      className: 'list-entry--record-person',
      interactive: true,
      data: `data-person="${escapeHtml(person.key)}"`,
      aria: `Открыть ${display.name}`,
    });
  }));
}

function desktopPeopleTable(root, items, visitIndex) {
  if (!items.length) return listMarkup(items, root.peopleSearchInput?.value || '');
  const selected = root.peopleSelectedKeys ||= new Set();
  const allSelected = items.every(person => selected.has(String(person.key)));
  const check = (data, aria, checked) => `<label class="ui-compact-check">${checkControl({ data, aria, checked })}</label>`;
  const columns = [
    { key: 'select', label: '', narrow: true, sortable: false, header: () => check('data-people-select-all', 'Выбрать все видимые контакты', allSelected), render: row => check(`data-people-select="${escapeHtml(row.key)}"`, `Выбрать ${row.name}`, selected.has(String(row.key))) },
    { key: 'code', label: 'Код', sortable:false },
    { key: 'name', label: 'Клиент', sortable:false, render: row => `<div class="people-table-person"><span class="people-table-person__name">${escapeHtml(row.name)}</span>${row.phone ? `<span class="people-table-person__phone">${escapeHtml(row.phone)}</span>` : ''}</div>` },
    { key:'visitCount', label:'Количество посещений', sortable:false, header:()=>'<span>Количество</span><span>посещений</span>' },
    { key:'paidTotal', label:'Оплачено', sortable:false, render:row=>row.paidTotal == null ? '—' : escapeHtml(money(row.paidTotal)) },
    { key:'debt', label:'Задолженность', sortable:false, render:row=>row.debt == null ? '—' : row.debt > 0.009 ? escapeHtml(money(row.debt)) : '' },
    { key: 'firstVisit', label: 'Первое посещение', sortable: false, header: () => '<span>Первое</span><span>посещение</span>', render: row => escapeHtml(row.firstVisit ? formatPersonVisitDate(row.firstVisit) : '') },
    { key: 'lastVisit', label: 'Последнее посещение', sortable:false, header: () => '<span>Последнее</span><span>посещение</span>', render: row => escapeHtml(row.lastVisit ? formatPersonVisitDate(row.lastVisit) : '') },
    { key:'open',label:'',narrow:true,sortable:false,render:row=>`<button type="button" class="people-table-open" data-person="${escapeHtml(row.key)}" aria-label="Открыть клиента ${escapeHtml(row.name)}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>` },
  ];
  const rows = items.map(person => {
    const display = personDisplay(person);
    const metadata = visitIndex.get(String(person.key)) || {};
    return { key: person.key, code: display.uei, name: display.name, phone: display.phone, firstVisit: metadata.firstVisit || '', lastVisit: metadata.lastVisit || '', visitCount:metadata.visitCount ?? 0, paidTotal:metadata.paidTotal, debt:metadata.debt };
  });
  return dataTable({ columns, rows, caption: 'Клиенты', compact: true });
}

function updateDesktopPeopleCount(root, total, selected = 0) {
  const counter = root.peopleCounter;
  if (!counter?.isConnected) return;
  counter.textContent = total == null ? '—' : selected ? `${selected} / ${total}` : String(total);
  counter.setAttribute('aria-label',total == null ? 'Количество клиентов уточняется' : `Клиентов в списке: ${total}. Выбрано: ${selected}`);
}

function bindDesktopPeopleTable(root, host, items) {
  const selected = root.peopleSelectedKeys ||= new Set();
  const all = host.querySelector('[data-people-select-all]');
  const sync = () => {
    const inputs = [...host.querySelectorAll('[data-people-select]')];
    const selectedCount = inputs.filter(input => input.checked).length;
    if (all) {
      all.checked = inputs.length > 0 && selectedCount === inputs.length;
      all.indeterminate = selectedCount > 0 && !all.checked;
    }
    updateDesktopPeopleCount(root,items.length,selectedCount);
  };
  host.querySelectorAll('[data-people-select]').forEach(input => input.addEventListener('change', () => {
    if (input.checked) selected.add(input.dataset.peopleSelect);
    else selected.delete(input.dataset.peopleSelect);
    sync();
  }));
  all?.addEventListener('change', () => {
    items.forEach(person => { if (all.checked) selected.add(String(person.key)); else selected.delete(String(person.key)); });
    host.querySelectorAll('[data-people-select]').forEach(input => { input.checked = all.checked; });
    sync();
  });
  sync();
}

function visiblePeople(root, visitIndex = null) {
  const query = root.peopleSearchInput?.value || '';
  return filterPeople(applyPeopleFilters(sortItems(getPeople(), getPeopleSortMode(), visitIndex)), query);
}

function refreshPeopleList(root) {
  const host = root.querySelector('[data-people-list-host]');
  if (!host) return;
  if (currentPeopleFilters().loyaltyMode && root.peopleLoyaltyLoading) {
    host.textContent='Загружаем контакты…';
    updateDesktopPeopleCount(root,null);
    return;
  }
  if (currentPeopleFilters().loyaltyMode && root.peopleLoyaltyError) {
    host.textContent=root.peopleLoyaltyError;
    updateDesktopPeopleCount(root,null);
    return;
  }
  const query = root.peopleSearchInput?.value || '';
  const desktop = isV2DesktopWorkspace(root.closest('[data-v2-app]'));
  const visitIndex = desktop ? (root.peopleVisitIndex ||= buildPersonVisitIndex({ finance:root.peopleFinanceReady === true })) : null;
  const items = visiblePeople(root, visitIndex);
  host.innerHTML = desktop ? desktopPeopleTable(root, items, visitIndex) : listMarkup(items, query);
  if (desktop) bindDesktopPeopleTable(root, host, items);
  host.querySelectorAll('[data-person]').forEach((node) => {
    node.addEventListener('click', () => openPersonOverview(root, node.dataset.person, root.peopleOptions || {}));
  });
}

function listContext() {
  return workspaceHeaderContext({
    title: 'Клиенты',
    v: { data: 'data-people-list-settings', aria: 'Настройки клиентов' },
  });
}

export function renderPeople(root, options = {}) {
  root.peopleOptions = options;
  const wide = isV2DesktopWorkspace(root.closest('[data-v2-app]'));
  root.peopleVisitIndex = null;
  root.peopleFinanceReady = false;
  root.peopleMetricsDispose?.();
  root.innerHTML = page([
    wide ? workspaceHeaderContext({title:'Клиенты'}) : listContext(),
    `<section><div data-people-list-host></div></section>`,
    wide ? '' : button('+', {
      className: 'v2-primary-source-only',
      data: 'data-add data-v2-primary-action data-v2-primary-label="+"',
      aria: 'Добавить клиента',
    }),
  ]);
  const search = field({ name:'peopleSearch', type:'search', placeholder:wide?'Поиск по имени или коду':'Поиск по имени или UEI', autocomplete:'off', data:'data-people-search' });
  const [searchRow] = setV2ZHeaderRows(root, [wide ? `<section data-people-desktop-toolbar>
    <div class="people-desktop-title"><h2>Клиенты</h2><output data-people-count aria-live="polite">—</output></div>
    <div class="people-desktop-tools">${search}
      <div class="people-desktop-actions">
        ${button('Фильтр',{variant:'secondary',data:'data-people-desktop-filter'})}
        ${button('Сортировка',{variant:'secondary',data:'data-people-desktop-sort'})}
      </div>
      <div class="people-desktop-actions people-desktop-actions--right">
        ${button('<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3v18m-4-4 4 4 4-4M17 21V3m-4 4 4-4 4 4"/></svg>',{variant:'secondary',className:'people-desktop-icon',data:'data-people-desktop-excel title="Обмен данными" aria-haspopup="dialog"',aria:'Обмен данными'})}
        ${button('Вид',{variant:'secondary',data:'data-people-desktop-view'})}
        ${button('<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',{variant:'secondary',className:'people-desktop-icon people-desktop-add',data:'data-people-desktop-add title="Добавить клиента" aria-haspopup="dialog"',aria:'Добавить клиента'})}
      </div>
    </div></section>` : `<div class="people-search ui-search-field">${search}</div>`]);
  root.peopleSearchInput = searchRow?.querySelector('[data-people-search]') || null;
  root.peopleCounter = searchRow?.querySelector('[data-people-count]') || null;
  root.peopleRefreshPresentation = () => refreshPeopleList(root);
  searchRow?.querySelector('[data-people-desktop-filter]')?.addEventListener('click', event => openFilterSettings(root, event.currentTarget));
  searchRow?.querySelector('[data-people-desktop-excel]')?.addEventListener('click', event => openPeopleExcelMenu(root, {
    anchor:event.currentTarget,
    getRows: () => {
      if (currentPeopleFilters().loyaltyMode && (root.peopleLoyaltyLoading || root.peopleLoyaltyError)) throw new Error('Список ещё загружается. Повторите выгрузку после обновления.');
      return visiblePeople(root);
    },
    onLoaded: () => renderPeople(root, options)
  }));
  searchRow?.querySelector('[data-people-desktop-sort]')?.addEventListener('click', event => openSortSettings(root,event.currentTarget));
  searchRow?.querySelector('[data-people-desktop-view]')?.addEventListener('click', () => openPeopleAppearanceQ(root,options));
  searchRow?.querySelector('[data-people-desktop-add]')?.addEventListener('click', event => openAddMenu(root,options,event.currentTarget));
  root.peopleLoyaltyLoading=Boolean(currentPeopleFilters().loyaltyMode);
  root.peopleLoyaltyError='';
  refreshPeopleList(root);
  if(root.peopleLoyaltyLoading){
    void refreshPeopleLoyaltyData().then(()=>{
      if(!root.isConnected)return;
      root.peopleLoyaltyLoading=false;
      refreshPeopleList(root);
    }).catch(()=>{
      if(!root.isConnected)return;
      root.peopleLoyaltyLoading=false;
      root.peopleLoyaltyError='Не удалось загрузить программы. Повторите попытку.';
      refreshPeopleList(root);
    });
  }
  root.peopleSearchInput?.addEventListener('input', () => refreshPeopleList(root));
  root.querySelector('[data-people-list-settings]')?.addEventListener('click', () => openListSettings(root, options));
  root.querySelector('[data-add]')?.addEventListener('click', () => openAddMenu(root, options));
  if (wide) {
    const host = root.querySelector('[data-people-list-host]');
    let disposed = false;
    let queued = false;
    const current = () => !disposed && host?.isConnected && root.querySelector('[data-people-list-host]') === host;
    const invalidate = () => {
      if (!current() || queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!current()) return;
        root.peopleVisitIndex = null;
        refreshPeopleList(root);
      });
    };
    const events = ['professional:records-changed','professional:dds-changed','professional:people-changed'];
    events.forEach(event=>window.addEventListener(event,invalidate));
    const dispose = () => { disposed = true; events.forEach(event=>window.removeEventListener(event,invalidate)); };
    root.peopleMetricsDispose = dispose;
    void loadFinanceState().then(()=>{
      if (!current()) return;
      root.peopleFinanceReady = true;
      invalidate();
    }).catch(error=>{
      if (current()) console.error('Не удалось загрузить показатели оплат клиентов',error);
    });
    return () => root.peopleMetricsDispose?.();
  }
}

function openSortSettings(root, anchor = null) {
  if (anchor && isV2DesktopWorkspace(root.closest('[data-v2-app]'))) {
    const labels = {nameAsc:'Имя — от А до Я',nameDesc:'Имя — от Я до А',ueiAsc:'Код — по возрастанию',ueiDesc:'Код — по убыванию',lastAsc:'Посещение — сначала ранние',lastDesc:'Посещение — сначала недавние'};
    const markup = '<div class="people-action-menu">' + sortOptions().map(option =>
      button(escapeHtml(labels[option.value] || option.label), {variant:'secondary',data:`data-people-sort-choice="${escapeHtml(option.value)}" aria-pressed="${option.value === getPeopleSortMode()}"`})
    ).join('') + '</div>';
    const layer = mountModal(anchor,modal(markup,{title:'Сортировка',variant:'x',surface:'app',xRole:'action',className:'people-action-popup people-sort-popup'}));
    layer?.querySelectorAll('[data-people-sort-choice]').forEach(node=>node.addEventListener('click',()=>{
      setPeopleSortMode(node.dataset.peopleSortChoice);
      layer.v2Close?.();
      refreshPeopleList(root);
    }));
    return layer;
  }
  const layer = mountModal(anchor || root, modal(`<div class="form-grid">${select({
    label: 'Сортировка',
    value: getPeopleSortMode(),
    options: sortOptions(),
    aria: 'Сортировка клиентов',
    data: 'data-people-sort-settings',
  })}</div>`, { title: 'Сортировка', variant: 'x', surface: 'app' }));
  layer?.querySelector('[data-people-sort-settings]')?.addEventListener('change', (event) => {
    setPeopleSortMode(event.target.value);
    refreshPeopleList(root);
  });
  return layer;
}

function peopleProgramSelect(filters={}){
  const options=[{value:'',label:'Все программы'},...peopleProgramOptions(getPeople())];
  if(filters.loyaltyProgram&&!options.some(item=>item.value===filters.loyaltyProgram)){
    options.push({value:filters.loyaltyProgram,label:'Программа недоступна'});
  }
  return select({
    name:'peopleLoyaltyProgramFilter',value:filters.loyaltyProgram||'',aria:'Выбор программы',
    options,
  });
}

function peopleFilterFields(filters = {}) {
  return `<div class="form-grid">
    ${select({ label: 'Пол', name: 'peopleGenderFilter', value: filters.gender, options: [
      { value: '', label: 'Без фильтра' }, { value: 'female', label: 'Женский' }, { value: 'male', label: 'Мужской' }, { value: 'none', label: 'Не указан' },
    ] })}
    ${select({ label: 'Месяц рождения', name: 'peopleBirthdayFilter', value: filters.birthday, options: [
      { value: '', label: 'Без фильтра' }, ...BIRTH_MONTH_OPTIONS,
      { value: 'has', label: 'Дата указана' }, { value: 'none', label: 'Дата не указана' },
    ] })}
    ${select({ label: 'Ярлык', name: 'peopleTagFilter', value: filters.tag, options: tagFilterOptions() })}
    <div data-people-procedure-filter>${hasCurrentProceduresSnapshot()
      ? select({ label: 'Услуга', name: 'peopleProcedureFilter', value: filters.procedure, options: procedureFilterOptions() })
      : '<div class="field">Услуга: загрузка…</div>'}</div>
    ${workplaceFilterOptions().length ? select({
      label: 'Рабочее пространство', name: 'peopleWorkplaceFilter',
      value: filters.workplace, options: workplaceFilterOptions(),
    }) : ''}
    ${select({
      label:'Скидка / программа',name:'peopleLoyaltyFilter',value:filters.loyaltyMode,aria:'Скидка или программа',
      options:[{value:'',label:'Без фильтра'},{value:'discount',label:'Скидка'},{value:'program',label:'Программа'}],
    })}
    <div data-people-program-filter${filters.loyaltyMode==='program'?'':' hidden'}>
      ${filters.loyaltyMode==='program'?peopleProgramSelect(filters):''}
    </div>
    ${select({ label: 'Email', name: 'peopleNoEmailFilter', value: filters.noEmail, options: [{ value: '', label: 'Без фильтра' }, { value: 'has', label: 'Указан' }, { value: 'yes', label: 'Не указан' }] })}
    ${select({ label: 'Посещения', name: 'peopleRecordPeriodFilter', value: filters.recordPeriod, options: [
      { value: '', label: 'Без фильтра' },
      { value: '1', label: 'За 1 месяц' },
      { value: '3', label: 'За 3 месяца' },
      { value: '6', label: 'За 6 месяцев' },
      { value: 'range', label: 'За период' },
      { value: 'none', label: 'Без посещений' },
    ] })}
    <div data-people-record-range${filters.recordPeriod === 'range' ? '' : ' hidden'}>
      <div class="form-grid form-grid--two">
        ${datePicker({ name: 'peopleRecordFromFilter', value: filters.recordFrom || '', label: '', placeholder: 'С даты', allowClear: true, modalSurface: 'app' })}
        ${datePicker({ name: 'peopleRecordToFilter', value: filters.recordTo || '', label: '', placeholder: 'По дату', allowClear: true, modalSurface: 'app' })}
      </div>
    </div>
  </div>`;
}

function openFilterSettings(root, anchor = null) {
  const desktopMenu = Boolean(anchor && isV2DesktopWorkspace(root.closest('[data-v2-app]')));
  let applied = currentPeopleFilters();
  let draft = { ...applied };
  const hasFilters = (filters) => Object.values(filters).some(Boolean);
  const sameFilters = (left, right) => Object.keys(applied).every((key) => String(left[key] || '') === String(right[key] || ''));
  const layer = mountModal(anchor || root, modal(`
    <div data-people-filter-fields>${peopleFilterFields(draft)}</div>
    <div class="modal-actions" data-people-filter-actions hidden>
      ${button('Применить', { data: 'data-people-filter-action' })}
    </div>`, { title: 'Фильтр', variant: 'x', surface: 'app', className: desktopMenu ? 'people-action-popup people-filter-popup' : '' }));
  if (!layer) return null;
  initDatePickers(layer);
  const action = layer.querySelector('[data-people-filter-action]');
  const actions = layer.querySelector('[data-people-filter-actions]');
  let loyaltyReady=false;
  let loyaltyError='';
  const programHost=layer.querySelector('[data-people-program-filter]');
  const refreshProgramSelect=()=>{
    if(programHost && draft.loyaltyMode==='program')programHost.innerHTML=peopleProgramSelect(draft);
  };

  const updateAction = () => {
    const changed = !sameFilters(draft, applied);
    const datesValid = draft.recordPeriod !== 'range' || (
      /^\d{4}-\d{2}-\d{2}$/.test(draft.recordFrom)
      && /^\d{4}-\d{2}-\d{2}$/.test(draft.recordTo)
      && draft.recordFrom <= draft.recordTo);
    action.disabled = changed && (!datesValid || (Boolean(draft.loyaltyMode) && (!loyaltyReady || Boolean(loyaltyError))));
    const reset = !changed && hasFilters(applied);
    actions.hidden = !changed && !reset;
    action.textContent = changed ? 'Применить' : 'Сбросить';
    action.classList.toggle('ui-button--secondary', reset);
  };

  // Changes are drafts until the only action button is pressed.
  layer.addEventListener('change', (event) => {
    const keyByName = {
      peopleGenderFilter: 'gender',
      peopleBirthdayFilter: 'birthday',
      peopleTagFilter: 'tag',
      peopleProcedureFilter: 'procedure',
      peopleWorkplaceFilter: 'workplace',
      peopleNoEmailFilter: 'noEmail',
      peopleLoyaltyFilter: 'loyaltyMode',
      peopleLoyaltyProgramFilter: 'loyaltyProgram',
      peopleRecordPeriodFilter: 'recordPeriod',
      peopleRecordFromFilter: 'recordFrom',
      peopleRecordToFilter: 'recordTo',
    };
    const key = keyByName[event.target?.name];
    if (!key) return;
    draft[key] = String(event.target.value || '');
    if (key === 'loyaltyMode') {
      if(draft.loyaltyMode!=='program')draft.loyaltyProgram='';
      if(programHost){
        programHost.hidden=draft.loyaltyMode!=='program';
        if(programHost.hidden)programHost.innerHTML='';
        else refreshProgramSelect();
      }
    }
    if (key === 'recordPeriod') {
      if (draft.recordPeriod !== 'range') {
        draft.recordFrom = '';
        draft.recordTo = '';
      }
      const rangeHost = layer.querySelector('[data-people-record-range]');
      if (rangeHost) rangeHost.hidden = draft.recordPeriod !== 'range';
    }
    updateAction();
  });

  action.addEventListener('click', () => {
    if (!sameFilters(draft, applied)) {
      if (action.disabled) return;
      applied = setPeopleFilters(draft);
      root.peopleLoyaltyLoading=false;
      root.peopleLoyaltyError='';
      refreshPeopleList(root);
      layer.v2Close?.();
      return;
    }
    if (!hasFilters(applied)) return;
    applied = setPeopleFilters({});
    draft = { ...applied };
    root.peopleLoyaltyLoading=false;
    root.peopleLoyaltyError='';
    const fields = layer.querySelector('[data-people-filter-fields]');
    if (fields) {
      fields.innerHTML = peopleFilterFields(draft);
      initDatePickers(fields);
    }
    refreshPeopleList(root);
    updateAction();
  });

  // Fetch real assignments and available program definitions without delaying X opening.
  void refreshPeopleLoyaltyData().then(()=>{
    loyaltyReady=true;
    if(!layer.isConnected)return;
    refreshProgramSelect();
    if(currentPeopleFilters().loyaltyMode){
      root.peopleLoyaltyLoading=false;
      root.peopleLoyaltyError='';
      refreshPeopleList(root);
    }
    updateAction();
  }).catch(()=>{
    loyaltyReady=false;
    loyaltyError='Не удалось загрузить программы';
    if(!layer.isConnected)return;
    if(programHost && draft.loyaltyMode==='program')programHost.textContent=loyaltyError;
    updateAction();
  });
  if (!hasCurrentProceduresSnapshot()) {
    void loadRecordCreationOperationalState().then(() => {
      if (!layer.isConnected) return;
      const host = layer.querySelector('[data-people-procedure-filter]');
      if (!host) return;
      host.innerHTML = select({
        label: 'Услуга',
        name: 'peopleProcedureFilter',
        value: draft.procedure,
        options: procedureFilterOptions(),
      });
    }).catch(() => {
      if (!layer.isConnected) return;
      const host = layer.querySelector('[data-people-procedure-filter]');
      if (host) host.textContent = 'Не удалось загрузить услуги';
    });
  }
  updateAction();
  return layer;
}

function openListWorkMenu(root, options = {}) {
  const layer = mountModal(root, modal(`<div class="modal-actions">
    ${button('Сортировка', { variant: 'secondary', data: 'data-people-sort' })}
    ${button('Фильтр', { variant: 'secondary', data: 'data-people-filter' })}
    ${button('Загрузки', { variant: 'secondary', data: 'data-people-uploads' })}
  </div>`, { title: 'Работа со списками', variant: 'x', surface: 'app', xRole: 'action' }));
  if (!layer) return null;
  layer.querySelector('[data-people-sort]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openSortSettings(root);
  });
  layer.querySelector('[data-people-filter]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openFilterSettings(root);
  });
  layer.querySelector('[data-people-uploads]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openContactImportBatches(root, {
      onLoaded: () => renderPeople(root, options),
    });
  });
  return layer;
}

function openListSettings(root, options = {}) {
  const layer = mountModal(root, modal(`<div class="modal-actions">
    ${button('Работа со списками', { variant: 'secondary', data: 'data-people-list-work' })}
    ${button('Вид', { variant: 'secondary', data: 'data-people-appearance' })}
    ${button('Excel', { variant: 'secondary', data: 'data-people-excel' })}
  </div>`, { title: 'Клиенты', variant: 'x', surface: 'app', xRole: 'action' }));
  if (!layer) return null;
  layer.querySelector('[data-people-list-work]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openListWorkMenu(root, options);
  });
  layer.querySelector('[data-people-appearance]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openPeopleAppearanceQ(root, options);
  });
  layer.querySelector('[data-people-excel]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openPeopleExcelMenu(root, {
      getRows: () => {
        if (currentPeopleFilters().loyaltyMode && (root.peopleLoyaltyLoading || root.peopleLoyaltyError)) {
          throw new Error('Список ещё загружается. Повторите выгрузку после обновления.');
        }
        return visiblePeople(root);
      },
      onLoaded: () => renderPeople(root, options),
    });
  });
  return layer;
}

// The shared Excel migration tool is not ready. Keep the existing filtered
// export intact; don't fabricate a contact import workflow or template schema.
function openPeopleAppearanceQ(root, options = {}) {
  const values = getPeople();
  const sample = values[0] || {
    key: '', name: 'Имя', surname: 'Фамилия', phones: ['+7 900 000-00-00'],
    emails: [], telegrams: [], uei: '0000', photo: '',
  };
  return openEntityCardAppearanceQ(root, {
    title: 'Вид',
    className: isV2DesktopWorkspace(root.closest('[data-v2-app]')) ? 'people-card-appearance-q' : '',
    typeLabel: 'Карта',
    typeOptions: [{ value: 'person', label: 'Клиент' }],
    initialType: 'person',
    targetOptions: () => [],
    allowPhoto: false,
    resolve: () => ({
      appearance: personCardAppearance(sample),
      fields: personCardFields(sample),
      photo: sample.photo || '',
      photoPosition: '50% 50%',
    }),
    save: async ({ appearance }) => {
      saveCardAppearanceTemplate('person', { appearance, photo: '', photoPosition: '50% 50%' });
    },
    onSaved: () => renderPeople(root, options),
  });
}


function openAddMenu(root, options = {}, anchor = null) {
  const allowReal = canUseRealPersonalData();
  const desktopMenu = Boolean(anchor && isV2DesktopWorkspace(root.closest('[data-v2-app]')));
  const layer = mountModal(anchor || root, modal(`<div class="${desktopMenu ? 'people-action-menu' : 'modal-actions'}">
    ${button(desktopMenu ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="9" r="2.5"/><path d="M8 16c0-3 8-3 8 0M2 7h2m-2 5h2m-2 5h2"/></svg><span>Из контактов</span>' : 'Из контакта', { variant: 'secondary', data: 'data-add-from-contacts' })}
    ${button(desktopMenu ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m4-12v6m-3-3h6"/></svg><span>Внести вручную</span>' : 'Внести вручную', { variant: 'secondary', data: 'data-add-manual' })}
  </div><div class="form-error" data-add-choice-error></div>`, {
    title: 'Добавить клиента',
    variant: 'x',
    surface: 'app',
    className: desktopMenu ? 'people-action-popup' : '',
  }));
  if (!layer) return null;

  layer.querySelector('[data-add-manual]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openCreateX(root, options);
  });
  layer.querySelector('[data-add-from-contacts]')?.addEventListener('click', async () => {
    const error = layer.querySelector('[data-add-choice-error]');
    if (!allowReal) {
      if (error) error.textContent = 'Добавление реальных контактов недоступно в текущем режиме.';
      return;
    }
    if (!navigator.contacts?.select) {
      if (error) error.textContent = 'Доступ к системным контактам не поддерживается этим браузером.';
      return;
    }
    try {
      const contact = (await navigator.contacts.select(['name', 'tel'], { multiple: false }))[0];
      if (!contact) return;
      layer.v2Close?.();
      openCreateX(root, options, {
        name: contact.name?.[0] || '',
        phone: contact.tel?.[0] || '',
      });
    } catch {}
  });
  return layer;
}

function openCreateX(root, options = {}, preset = {}) {
  const layer = mountModal(root, modal(personCreateForm(preset), {
    title: 'Внести вручную',
    variant: 'x',
    surface: 'app',
    className: 'people-create-x',
  }));
  if (!layer) return null;
  bindPersonCreateForm(layer, {
    onCreated: (person) => {
      layer.v2Close?.();
      renderPeople(root, options);
      openPersonOverview(root, person.key, options);
    },
  });
  return layer;
}

function personContext(person) {
  return personQContext(person, { settings: true });
}

function bindPersonContext(root, person, options = {}) {
  root.querySelector('[data-person-settings]')?.addEventListener('click', () => {
    openPersonSettings(root, person, options);
  });
  root.querySelector('[data-person-direct-chat]')?.addEventListener('click', () => {
    options.onDirectChat?.(person.key);
  });
}

function overviewCard(person) {
  const display = personDisplay(person);
  return entityVisualCard({
    appearance: personCardAppearance(person),
    fields: personCardFields(person),
    image: person.photo || '',
    imagePosition: '50% 50%',
    interactive: true,
    data: 'data-person-card',
    aria: `Открыть данные ${display.name}`,
  });
}

function desktopPersonOverviewTools(layer, person, options = {}) {
  const header = layer.closest('[data-v2-q="true"]')?.querySelector('[data-v2-q-header-content]');
  if (!header) return;
  header.innerHTML = `<div class="people-overview-heading"><h2 class="v2-q-title">Клиент</h2></div>
  <div class="people-overview-toolbar" data-v2-layer-gesture-ignore>
    ${select({ name: 'personOverviewProgram', aria: 'Программы', value: '', options: [
      { value: '', label: 'Программы' },
      ...personProgramActionTypes().map(item => ({ value: item.id, label: item.label })),
    ] })}
    <div class="people-overview-tools">
      ${compactButton({ kind: 'document', data: 'data-person-overview-documents title="Документы"', aria: 'Документы' })}
      ${compactButton({ kind: 'history', data: 'data-person-overview-history title="История"', aria: 'История' })}
      ${button('Записать', { className: 'people-overview-record', data: 'data-person-overview-record' })}
    </div>
  </div>`;
  header.querySelector('[data-person-overview-documents]')?.addEventListener('click', () => openPersonDocuments(layer, person));
  header.querySelector('[data-person-overview-history]')?.addEventListener('click', () => void openPersonHistoryQ(layer, person, options));
  const programInput = header.querySelector('[name="personOverviewProgram"]');
  programInput?.addEventListener('change', () => {
    const kind = programInput.value;
    if (!kind) return;
    programInput.value = '';
    const value = header.querySelector('.ui-select__value');
    if (value) value.textContent = 'Программы';
    openPersonProgramActions(layer, person, { onChanged: options.onProgramChanged, initialKind: kind });
  });
  header.querySelector('[data-person-overview-record]')?.addEventListener('click', async (event) => {
    const control = event.currentTarget;
    control.disabled = true;
    try { await openPersonRecordCreation({ person }); }
    finally { if (control.isConnected) control.disabled = false; }
  });
  layer.querySelector('[data-person-overview-delete]')?.addEventListener('click', () => confirmDelete(layer, person, options.onDeleted));
}

async function renderPersonOverview(layer, baseRoot, key, options = {}) {
  const person = getAllPeople().find((item) => item.key === key);
  if (!person) {
    layer.v2Close?.();
    renderPeople(baseRoot, options);
    return;
  }
  const relationships = await buildPersonRelationshipSections(person);
  if (!layer.isConnected) return;
  // Z2 Header stays empty (apart from its shared dismiss control).
  // The contact card and its programs belong to the same scrollable Z2 Body.
  const desktop = layer.hasAttribute('data-desktop-person-overview');
  const contextOptions = {
    ...options,
    onProgramChanged: () => void renderPersonOverview(layer, baseRoot, person.key, options),
    onDeleted: () => {
      layer.v2Close?.();
      renderPeople(baseRoot, options);
    },
  };
  layer.innerHTML = page([
    desktop ? personQContext(person) : personContext(person),
    overviewCard(person),
    relationships.markup,
    desktop ? actionBlock(
      button('Удалить', { variant: 'danger', data: 'data-person-overview-delete data-ui-keyboard-action="auxiliary"' }),
      { className: 'people-overview-footer' },
    ) : '',
  ]);
  setV2ZHeaderRows(layer, []);
  bindPersonContext(layer, person, contextOptions);
  if (desktop) desktopPersonOverviewTools(layer, person, contextOptions);
  relationships.bind(layer, (detail) => openPersonRelationshipQ(baseRoot, person, detail, {
    ...options,
    onNativeChanged: () => renderPersonOverview(layer, baseRoot, person.key, options),
  }));
  layer.querySelector('[data-person-card]')?.addEventListener('click', () => {
    openPersonEdit(baseRoot, person.key, {
      onSaved: (nextKey) => void renderPersonOverview(layer, baseRoot, nextKey || person.key, options),
    });
  });
  notifyContext();
}

async function openPersonRelationshipQ(root, person, detail, options = {}) {
  // The E owner supplies its original Q with full V actions. Contacts has
  // no Loyalty-specific type branches, menu copies, or business logic.
  if (typeof detail?.open === 'function') {
    try {
      return await detail.open(root, person, options.onNativeChanged);
    } catch (error) {
      openNotice({
        title: detail?.title || 'Программа',
        message: error instanceof Error ? error.message : 'Не удалось открыть программу',
      });
      return null;
    }
  }
  const layer = mountModal(root, modal(`${personQContext(person)}${detail?.body || ''}`, {
    title: detail?.title || name(person),
    variant: 'q',
    surface: 'app',
    className: 'people-program-q',
  }));
  if (layer) bindPersonContext(layer, person, options);
  return layer;
}

function openPersonOverview(root, key, options = {}) {
  if (!key) return null;
  if (isV2DesktopWorkspace(root.closest?.('[data-v2-app]') || document.querySelector('.v2-app--workspace'))) {
    const layer = mountModal(root, modal('<div data-desktop-person-overview></div>', { title:'Клиент', variant:'q', surface:'app', className:'people-desktop-overview-q' }));
    const host = layer?.querySelector('[data-desktop-person-overview]');
    if (!host) return layer;
    const close = layer.v2Close?.bind(layer);
    host.v2Close = () => layer.v2Close?.();
    if (close && options.onClose) layer.v2Close = () => { if (layer.isConnected) { close(); options.onClose(); } };
    void renderPersonOverview(host, root, key, options).catch(error => {
      if (host.isConnected) host.textContent = 'Не удалось открыть клиента.';
      console.error(error);
    });
    return layer;
  }
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'people-overview-layer' }), {
    stack: true,
    onClose: options.onClose || null,
  });
  if (!layer) return null;
  void renderPersonOverview(layer, root, key, options);
  return layer;
}

export function openPerson({ root = document.body, key, onClose, onDirectChat } = {}) {
  return openPersonOverview(root, key, { onClose, onDirectChat });
}

function memberPeople(person, all) {
  const members = getMembers(person.uei);
  if (members.length <= 1) return [person];
  const ids = members.map((member) => member.startsWith('person:') ? member.slice(7) : member);
  return ids.map((id) => all.find((item) => item.key === id)).filter(Boolean);
}

function businessEntries(person, all, fieldName) {
  const people = memberPeople(person, all);
  const entries = [];
  const seen = new Set();
  for (const member of people) {
    for (const value of Array.isArray(member[fieldName]) ? member[fieldName] : []) {
      const text = String(value ?? '').trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      entries.push({ value: text, source: member.key });
    }
  }
  return entries;
}

function contactAnchor(person) {
  const telegram = (person.telegrams || []).map((value) => String(value || '').trim()).find((value) => value && !isTelegramUserId(value));
  if (telegram) return { value: person.key, label: telegram };
  const phone = (person.phones || []).map((value) => String(value || '').trim()).find(Boolean);
  if (phone) return { value: person.key, label: phone };
  const email = (person.emails || []).map((value) => String(value || '').trim()).find(Boolean);
  if (email) return { value: person.key, label: email };
  if ((person.telegrams || []).some((value) => isTelegramUserId(value))) return { value: person.key, label: 'Telegram' };
  return null;
}

function hasContact(person) {
  return Boolean(contactAnchor(person));
}

function ueiData(person, all) {
  const current = person.uei || getUEI('person', person.key) || '';
  const existing = getOptions('person', person.key);
  const members = getMembers(current);
  const detachable = members.map((member) => {
    const id = member.startsWith('person:') ? member.slice(7) : member;
    const item = all.find((candidate) => candidate.key === id);
    return item ? contactAnchor(item) : null;
  }).filter(Boolean);
  return {
    value: current,
    existing,
    detachable,
    memberCount: members.length,
    showApply: false,
  };
}

function telegramEntries(person, all) {
  return businessEntries(person, all, 'telegrams').map((entry) => isTelegramUserId(entry.value)
    ? { ...entry, display: telegramDisplay(entry.value) }
    : entry);
}

function personDataFields(person, all) {
  const discount = getPersonPriceCondition(person);
  const programDiscount = discount.sources.find((source) => source.type === 'program') || null;
  const manualPercent = discount.sources.find((source) => source.type === 'personal')?.percent || 0;
  return [
    `<section class="v2-section"><div class="form-grid people-uei-editor">${uei(ueiData(person, all))}</div></section>`,
    v2Section('Персональные данные', `<div class="form-grid">
      ${field({ label: 'Имя', name: 'name', value: person.name, required: true })}
      ${field({ label: 'Фамилия', name: 'surname', value: person.surname })}
      ${field({ label: 'Примечание', name: 'note', value: person.note || '' })}
      ${select({ label: 'Пол', name: 'gender', value: person.gender || '', options: [
        { value: '', label: 'Не указан' },
        { value: 'female', label: 'Женский' },
        { value: 'male', label: 'Мужской' },
      ] })}
      ${monthDayPicker({ label: 'Дата рождения', name: 'birthDate', value: person.birthDate || '' })}
      ${field({ label: 'Скидка %', name: 'discountPercent', value: programDiscount?.percent ?? (manualPercent || ''), type: 'number', inputmode: 'decimal', disabled: Boolean(programDiscount) })}
    </div>`),
    v2Section('Контактные данные',
      repeatedField({ label: 'Телефон', name: 'phones', values: businessEntries(person, all, 'phones'), type: 'tel', addInHeader: true })
      + repeatedField({ label: 'Telegram', name: 'telegrams', values: telegramEntries(person, all), addInHeader: true })
      + repeatedField({ label: 'Email', name: 'emails', values: businessEntries(person, all, 'emails'), type: 'email', addInHeader: true })
      + links({ links: person.links || [], name: 'person-links', label: 'Ссылки', compact: true, addInHeader: true })),
    v2Section('Ярлыки', tags({ tags: getTags(), selected: person.tags || [], name: 'person-tags', allowCreate: true })),
  ].join('');
}

function formSnapshot(form) {
  if (!form) return '';
  return JSON.stringify({
    fields: [...new FormData(form).entries()].filter(([key]) => key !== 'discountPercent').map(([key, value]) => [key, typeof value === 'string' ? value : '']),
    tags: collectTags(form, 'person-tags'),
  });
}

function saveBusinessEntries(all, ownerKey, fieldName, entries, memberKeys) {
  const valuesBySource = new Map(memberKeys.map((key) => [key, []]));
  for (const entry of entries) {
    const source = memberKeys.includes(entry.source) ? entry.source : ownerKey;
    if (!valuesBySource.has(source)) valuesBySource.set(source, []);
    if (!valuesBySource.get(source).includes(entry.value)) valuesBySource.get(source).push(entry.value);
  }
  for (const key of memberKeys) {
    const person = all.find((item) => item.key === key);
    if (person) person[fieldName] = valuesBySource.get(key) || [];
  }
}

function savePersonUei(root, key) {
  const all = getAllPeople();
  const person = all.find((item) => item.key === key);
  if (!person) return key;
  const current = person.uei || getUEI('person', person.key) || '';
  const value = String(root.querySelector('[name="uei"]')?.value || '').trim();
  const linkValue = String(root.querySelector('[name="ueiLink"]')?.value || '').trim();
  const detachValue = String(root.querySelector('[name="ueiDetach"]')?.value || '').trim();
  const identifiers = [...(person.phones || []), ...(person.telegrams || []), ...(person.emails || [])];

  if (detachValue && current) {
    detachUEI({ entityType: 'person', entityId: detachValue, uei: current, explicit: true });
    savePeople(all);
    return key;
  }
  if (linkValue) {
    if (!hasContact(person)) {
      const targetMembers = getMembers(linkValue);
      const targetOwner = targetMembers[0]?.startsWith('person:') ? targetMembers[0].slice(7) : targetMembers[0];
      savePeople(all.filter((item) => item.key !== person.key));
      return targetOwner || key;
    }
    applyUEI({ entityType: 'person', entityId: key, currentUEI: current, value, linkValue, identifiers });
    savePeople(all);
    return key;
  }
  if (value && value !== current) {
    applyUEI({ entityType: 'person', entityId: key, currentUEI: current, value, linkValue: '', identifiers });
    savePeople(all);
  }
  return key;
}

function savePersonData(root, key) {
  const all = getAllPeople();
  const person = all.find((item) => item.key === key);
  if (!person) throw new Error('Человек не найден');
  const memberKeys = getMembers(person.uei).map((member) => member.startsWith('person:') ? member.slice(7) : member);
  if (!memberKeys.length) memberKeys.push(key);
  person.name = root.querySelector('[name="name"]')?.value.trim() || person.name;
  person.surname = root.querySelector('[name="surname"]')?.value.trim() || '';
  person.note = root.querySelector('[name="note"]')?.value.trim() || '';
  person.gender = root.querySelector('[name="gender"]')?.value || '';
  const selectedBirthDay = root.querySelector('[name="birthDate"]')?.value || '';
  const originalBirthDate = String(person.birthDate || '');
  // The day/month editor must not erase a known birth year imported from Excel.
  person.birthDate = /^\d{4}-\d{2}-\d{2}$/.test(originalBirthDate)
    && /^\d{2}-\d{2}$/.test(selectedBirthDay)
    ? originalBirthDate.slice(0, 5) + selectedBirthDay
    : selectedBirthDay;
  const discountField = root.querySelector('[name="discountPercent"]');
  const programDiscount = getPersonPriceCondition(person).sources.some((source) => source.type === 'program');
  // The shown program percentage is derived only. Never write it to
  // person.discountPercent: that would create a second competing discount.
  if (programDiscount) {
    if (!discountField?.disabled) throw new Error('Условия скидки изменились. Откройте данные клиента повторно.');
  } else {
    if (discountField?.disabled) throw new Error('Условия скидки изменились. Откройте данные клиента повторно.');
    const rawDiscount = Number(String(discountField?.value || '0').replace(',', '.'));
    const nextDiscount = Number.isFinite(rawDiscount) ? Math.max(0, Math.min(100, rawDiscount)) : 0;
    const effectiveBefore = getPersonPriceCondition(person).sources
      .find((source) => source.type === 'personal')?.percent || 0;
    if(nextDiscount!==effectiveBefore){
      person.discountAssignedAt = nextDiscount>0 ? new Date().toISOString() : '';
    }
    person.discountPercent = nextDiscount;
  }
  saveBusinessEntries(all, key, 'phones', collectRepeatedEntries(root, 'phones'), memberKeys);
  saveBusinessEntries(all, key, 'telegrams', collectRepeatedEntries(root, 'telegrams'), memberKeys);
  saveBusinessEntries(all, key, 'emails', collectRepeatedEntries(root, 'emails'), memberKeys);
  person.links = collectLinks(root, 'person-links');
  person.tags = collectTags(root, 'person-tags');
  savePeople(all);
  return getAllPeople().find((item) => item.key === key) || person;
}

function deletePersonByKey(key) {
  const all = getAllPeople();
  const person = all.find((item) => item.key === key);
  if (!person) return;
  const current = getUEI('person', key) || person.uei || '';
  if (current) detachUEI({ entityType: 'person', entityId: key, uei: current, explicit: false });
  savePeople(all.filter((item) => item.key !== key));
}

function confirmDelete(root, person, onDeleted) {
  const layer = mountModal(root, modal(`<div class="modal-title"><h2>Удалить?</h2><p>${escapeHtml(name(person))} будет удалён.</p></div>
    <div class="modal-actions">
      ${button('Удалить', { variant: 'critical', data: 'data-confirm-delete' })}
      ${button('Отмена', { variant: 'secondary', data: 'data-cancel-delete' })}
    </div>`, { title: 'Удалить', variant: 'x', surface: 'app' }));
  if (!layer) return;
  layer.querySelector('[data-cancel-delete]')?.addEventListener('click', () => layer.v2Close?.());
  layer.querySelector('[data-confirm-delete]')?.addEventListener('click', () => {
    deletePersonByKey(person.key);
    layer.v2Close?.();
    onDeleted?.();
  });
}

function openPersonEdit(baseRoot, key, callbacks = {}) {
  const person = getAllPeople().find((item) => item.key === key);
  if (!person) return null;
  const all = getAllPeople();
  const layer = mountModal(baseRoot, modal(`<form class="form-grid" data-person-edit-form>
    ${personDataFields(person, all)}
    <div class="form-error" data-person-edit-error></div>
    ${actionBlock(button('Сохранить', { type: 'button', data: 'data-person-q-save', aria: 'Сохранить изменения' }))}
  </form>`, {
    title: 'Данные клиента',
    variant: 'q',
    surface: 'app',
    className: 'people-edit-q',
  }));
  if (!layer) return null;

  initMonthDayPickers(layer);
  initLinks(layer);
  initTags(layer, { onCreate: (host) => {
    openTagEditor({ onSaved: (tag) => {
      if (layer.isConnected === false) return;
      addTagToSelection(host, tag);
    } });
  } });
  initRepeatedFields(layer);
  initUEI(layer);
  // Resolve the visible alias asynchronously, without replacing the stable ID
  // submitted by the Q form or treating the lookup as a user edit.
  const telegramIds = telegramEntries(person, all).map((entry) => entry.value).filter(isTelegramUserId);
  if (telegramIds.length) {
    void loadTelegramUsernames(telegramIds).then(() => {
      if (layer.isConnected === false) return;
      layer.querySelectorAll('[data-repeated-identity-alias]').forEach((input) => {
        input.value = telegramDisplay(input.dataset.repeatedIdentityAlias);
      });
    }).catch(() => {});
  }

  const form = layer.querySelector('[data-person-edit-form]');
  const action = layer.querySelector('[data-person-q-save]');
  const actions = action?.closest('.modal-actions');
  const initialState = formSnapshot(form);
  const discountField = layer.querySelector('[name="discountPercent"]');
  let initialManualDiscount = String(getPersonPriceCondition(person).sources
    .find((source) => source.type === 'personal')?.percent || '');
  let discountVerified = false;
  let saving = false;
  // A locked program discount is a view of the program, NOT a personal
  // discount edit. Ignore that derived value in dirty-state detection.
  const isDirty = () => formSnapshot(form) !== initialState
    || Boolean(discountField && !discountField.disabled
      && String(discountField.value || '') !== initialManualDiscount);
  const syncAction = () => {
    if (!action) return;
    const visible = isDirty();
    action.hidden = !visible;
    action.disabled = saving || !discountVerified;
    if (actions) actions.hidden = !visible;
    notifyContext();
  };

  // The Q renders immediately, but the discount input stays locked until its
  // active program is confirmed by the server. This prevents stale local
  // caches from allowing a conflicting manual discount after reloading.
  if (discountField) discountField.disabled = true;
  void listPersonDeposits(key).then(() => {
    if (layer.isConnected === false) return;
    const condition = getPersonPriceCondition(person);
    const programDiscount = condition.sources.find((source) => source.type === 'program') || null;
    if (discountField) {
      const manual = condition.sources.find((source) => source.type === 'personal')?.percent || 0;
      discountField.value = String(programDiscount?.percent ?? (manual || ''));
      discountField.disabled = Boolean(programDiscount);
      initialManualDiscount = String(manual || '');
    }
    discountVerified = true;
    syncAction();
  }).catch((error) => {
    if (layer.isConnected === false) return;
    const node = layer.querySelector('[data-person-edit-error]');
    if (node) node.textContent = `Не удалось проверить условия скидки: ${error instanceof Error ? error.message : 'Нет ответа сервера'}`;
    syncAction();
  });

  const save = async () => {
    if (saving || !discountVerified || !isDirty()) return;
    saving = true;
    syncAction();
    const errorNode = layer.querySelector('[data-person-edit-error]');
    if (errorNode) errorNode.textContent = '';
    try {
      if (!isBusinessServerReady()) throw new Error('Нет соединения с сервером. Изменения не сохранены.');
      savePersonData(layer, key);
      const nextKey = savePersonUei(layer, key);
      // The Q must not close on a successful local write while the real
      // server mutation is still queued, retrying or rejected.
      await flushBusinessPersistence();
      layer.v2Close?.();
      callbacks.onSaved?.(nextKey || key);
    } catch (error) {
      if (errorNode) errorNode.textContent = error instanceof Error ? error.message : 'Не удалось сохранить на сервере';
    } finally {
      saving = false;
      if (layer.isConnected) syncAction();
    }
  };

  action?.addEventListener('click', () => { void save(); });
  form?.addEventListener('input', syncAction);
  form?.addEventListener('change', syncAction);
  form?.addEventListener('submit', (event) => { event.preventDefault(); void save(); });
  syncAction();
  return layer;
}
