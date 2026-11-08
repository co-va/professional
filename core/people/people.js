import {
  actionBlock,
  button,
  collectLinks,
  details,
  collectRepeatedEntries,
  collectTags,
  emptyState,
  entityVisualCard,
  documentTile,
  documentTiles,
  escapeHtml,
  field,
  initLinks,
  initMonthDayPickers,
  initRepeatedFields,
  initTags,
  initUEI,
  links,
  list,
  modal,
  monthDayPicker,
  mountModal,
  mountV2ZLayer,
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
import { getConsents } from '../../settings/documents/consents.js';
import { getAllPeople, getIdentityMemberKeys, getPeople, savePeople } from './data.js';
import { bindPersonCreateForm, personCreateForm } from './create.js';
import { personDisplay } from './presentation.js';
import { personCardAppearance, personCardFields } from './card-presentation.js';
import { getCurrentPersonHistory, getPersonHistory } from './history.js';
import { getPersonMetadata } from './metadata.js';
import { getRecord, getRecords } from '../record/index.js';
import { getProcedures, hasCurrentProceduresSnapshot } from '../service/procedures/data.js';
import { loadRecordCreationOperationalState } from '../runtime/operational-state.js';
import { getCardAppearanceTemplate, saveCardAppearanceTemplate } from '../card-appearance-templates.js';
import { getPeopleFilters, getPeopleSortMode, setPeopleFilters, setPeopleSortMode } from './view-state.js';
import { buildPersonRelationshipSections } from './programs.js';
import { openPersonRecordCreation } from './record-creation.js';
import { canUseRealPersonalData } from '../access.js';
import { isTelegramUserId, loadTelegramUsernames, telegramDisplay } from './telegram-usernames.js';

const name = (person) => [person?.name, person?.surname].filter(Boolean).join(' ').trim() || 'Без имени';
const money = (value) => new Intl.NumberFormat('ru-RU').format(Number(value || 0)) + ' ₽';
const initials = (person) => [person?.name, person?.surname].filter(Boolean).slice(0, 2).map((part) => String(part).slice(0, 1).toUpperCase()).join('') || '?';

function notifyContext() {
  window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
}

function sortItems(items, mode) {
  return [...items].sort((a, b) => {
    if (mode.startsWith('name')) {
      const compared = name(a).localeCompare(name(b), 'ru');
      return mode === 'nameDesc' ? -compared : compared;
    }
    if (mode.startsWith('uei')) {
      const compared = String(personDisplay(a).uei || '').localeCompare(String(personDisplay(b).uei || ''), 'ru', { numeric: true });
      return mode === 'ueiDesc' ? -compared : compared;
    }
    const av = getPersonMetadata(a.key).lastVisit ? Date.parse(getPersonMetadata(a.key).lastVisit) : 0;
    const bv = getPersonMetadata(b.key).lastVisit ? Date.parse(getPersonMetadata(b.key).lastVisit) : 0;
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

function consentEventTime(fact) {
  const value = Date.parse(fact?.eventAt || fact?.revokedAt || fact?.acceptedAt || fact?.createdAt || 0);
  return Number.isFinite(value) ? value : 0;
}

function canonicalPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

function personIdentityMembers(person) {
  const all = getAllPeople();
  if (!person?.uei) return [person];
  const members = all.filter((item) => item.uei === person.uei);
  return members.length ? members : [person];
}

function personConsentFactMatches(person, fact) {
  const members = personIdentityMembers(person);
  const accounts = new Set(members.flatMap((item) => Array.isArray(item.accounts) ? item.accounts : []).map(String).filter(Boolean));
  const phones = new Set(members.flatMap((item) => Array.isArray(item.phones) ? item.phones : []).map(canonicalPhone).filter(Boolean));
  const emails = new Set(members.flatMap((item) => Array.isArray(item.emails) ? item.emails : []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  const telegrams = new Set(members.flatMap((item) => Array.isArray(item.telegrams) ? item.telegrams : []).map((value) => String(value || '').trim()).filter(Boolean));
  if (fact?.subjectType === 'ACCOUNT') return accounts.has(String(fact.subjectKey || ''));
  if (fact?.subjectType !== 'CONTACT_POINT') return false;
  if (fact.contactType === 'PHONE') return phones.has(canonicalPhone(fact.contactValue));
  if (fact.contactType === 'EMAIL') return emails.has(String(fact.contactValue || '').trim().toLowerCase());
  if (fact.contactType === 'TELEGRAM') return telegrams.has(String(fact.contactValue || '').trim());
  return false;
}

function currentConsentFacts(person, documentId) {
  const relevant = getConsents().filter((fact) => fact.documentId === documentId && personConsentFactMatches(person, fact));
  const latestBySubject = new Map();
  for (const fact of relevant) {
    const key = `${fact.subjectType}:${fact.subjectKey}:${fact.documentId}`;
    const previous = latestBySubject.get(key);
    if (!previous || consentEventTime(fact) > consentEventTime(previous)) latestBySubject.set(key, fact);
  }
  return [...latestBySubject.values()];
}

function personConsentState(person, documentItem) {
  // An earlier document version remains in the audit, but is NOT an active signature.
  const version = Math.max(1, Number(documentItem?.version || 1));
  const facts = currentConsentFacts(person, documentItem?.id);
  const current = facts
    .filter((fact) => Number(fact.documentVersion) === version)
    .sort((a, b) => consentEventTime(b) - consentEventTime(a));
  const accepted = current.find((fact) => fact.status === 'accepted') || null;
  return { active: Boolean(accepted), fact: accepted };
}


function personDocuments(person) {
  const documents = getDocuments().filter((item) => !item.hidden);
  const byId = new Map(documents.map((item) => [String(item.id || ''), item]));
  const relevantIds = new Set(getConsents()
    .filter((fact) => personConsentFactMatches(person, fact))
    .map((fact) => String(fact.documentId || ''))
    .filter(Boolean));
  return documents.filter((item) => item.personConsent || relevantIds.has(String(item.id || '')))
    .concat([...relevantIds].filter((id) => !byId.has(id)).map((id) => ({
      id, title: id, version: 1, text: '', personConsent: true,
    })));
}

function personDocumentTile(person, documentItem) {
  const state = personConsentState(person, documentItem);
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
    rightTop: item.amount == null ? shortDateTime(item.occurredAt, '') : money(item.amount),
    rightBottom: item.amount == null ? '' : shortDateTime(item.occurredAt, ''),
    interactive: true,
    initial: '',
    data: `data-person-history-item="${index}"`,
    aria: `Открыть ${item.title || 'событие'}`,
  })));
}

function personQContext(person, { settings = true } = {}) {
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
      // Deleted/history-only records retain their original Record values.
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
      <div class="people-search-divider ui-search-divider" aria-hidden="true"></div>
    </div>`;
  }
  const host = layer.querySelector('[data-person-history-host]');
  const search = layer.querySelector('[data-person-history-search]');
  // Show existing Journal records immediately; audit History enriches the list.
  let sourceItems = getCurrentPersonHistory(person.key);
  const render = () => {
    const query = String(search?.value || '').trim();
    const items = historyItems(sourceItems, query);
    if (host) host.innerHTML = personHistoryMarkup(sourceItems, query);
    host?.querySelectorAll('[data-person-history-item]').forEach((node) => {
      node.addEventListener('click', () => {
        const item = items[Number(node.dataset.personHistoryItem)];
        if (item) void openPersonHistoryItemQ(layer, person, item, options);
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
    ${button('Записать', { data: 'data-person-settings-record' })}
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
  layer.querySelector('[data-person-settings-record]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openPersonRecordCreation({ person });
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

function procedurePersonKeys(procedureId) {
  if (!procedureId) return null;
  const keys = new Set();
  for (const record of getRecords()) {
    if (record?.status === 'cancelled') continue;
    if (!(record?.procedures || []).some((item) => String(item?.id || '') === String(procedureId))) continue;
    const key = String(record?.person?.key || '');
    if (key) keys.add(key);
    for (const participant of record?.group?.participants || []) {
      const participantKey = String(participant?.key || '');
      if (participantKey) keys.add(participantKey);
    }
  }
  return keys;
}

function applyPeopleFilters(items = [], filters = getPeopleFilters()) {
  const selectedMonth = Number(filters.birthday);
  const procedureKeys = procedurePersonKeys(filters.procedure);
  return items.filter((person) => {
    if (filters.gender === 'none' && person.gender) return false;
    if (filters.gender && filters.gender !== 'none' && person.gender !== filters.gender) return false;
    if (filters.birthday === 'none' && person.birthDate) return false;
    if (filters.birthday === 'has' && !person.birthDate) return false;
    if (selectedMonth >= 1 && selectedMonth <= 12 && birthMonth(person.birthDate) !== selectedMonth) return false;
    if (filters.tag && !(person.tags || []).includes(filters.tag)) return false;
    if (procedureKeys && !getIdentityMemberKeys(person.key).some((key) => procedureKeys.has(key))) return false;
    if (filters.noEmail === 'yes' && (person.emails || []).some((value) => String(value || '').trim())) return false;
    if (filters.noVisits === 'yes' && getPersonMetadata(person.key).recordCount > 0) return false;
    return true;
  });
}

function tagFilterOptions() {
  return [{ value: '', label: 'Все ярлыки' }, ...getTags().map((item) => ({ value: String(item.id), label: item.name }))];
}

function procedureFilterOptions() {
  const items = getProcedures()
    .filter((item) => item?.id && item?.name)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
  return [{ value: '', label: 'Все процедуры' }, ...items.map((item) => ({ value: String(item.id), label: String(item.name) }))];
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
      initial: '',
      className: 'list-entry--record-person',
      interactive: true,
      data: `data-person="${escapeHtml(person.key)}"`,
      aria: `Открыть ${display.name}`,
    });
  }));
}

function visiblePeople(root) {
  const query = root.peopleSearchInput?.value || '';
  return filterPeople(applyPeopleFilters(sortItems(getPeople(), getPeopleSortMode())), query);
}

function refreshPeopleList(root) {
  const host = root.querySelector('[data-people-list-host]');
  if (!host) return;
  const query = root.peopleSearchInput?.value || '';
  const items = visiblePeople(root);
  host.innerHTML = listMarkup(items, query);
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
  root.innerHTML = page([
    listContext(),
    `<section><div data-people-list-host></div></section>`,
    button('+', {
      className: 'v2-primary-source-only',
      data: 'data-add data-v2-primary-action data-v2-primary-label="+"',
      aria: 'Добавить клиента',
    }),
  ]);
  const [searchRow] = setV2ZHeaderRows(root, [`<div class="people-search ui-search-field">
    ${field({ name: 'peopleSearch', type: 'search', placeholder: 'Поиск по имени или UEI', autocomplete: 'off', data: 'data-people-search' })}
    <div class="people-search-divider ui-search-divider" aria-hidden="true"></div>
  </div>`]);
  root.peopleSearchInput = searchRow?.querySelector('[data-people-search]') || null;
  refreshPeopleList(root);
  root.peopleSearchInput?.addEventListener('input', () => refreshPeopleList(root));
  root.querySelector('[data-people-list-settings]')?.addEventListener('click', () => openListSettings(root, options));
  root.querySelector('[data-add]')?.addEventListener('click', () => openAddMenu(root, options));
}

function openSortSettings(root) {
  const layer = mountModal(root, modal(`<div class="form-grid">${select({
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

function peopleFilterFields(filters = {}) {
  return `<div class="form-grid">
    ${select({ label: 'Пол', name: 'peopleGenderFilter', value: filters.gender, options: [
      { value: '', label: 'Любой' }, { value: 'female', label: 'Женский' }, { value: 'male', label: 'Мужской' }, { value: 'none', label: 'Не указан' },
    ] })}
    ${select({ label: 'Месяц рождения', name: 'peopleBirthdayFilter', value: filters.birthday, options: [
      { value: '', label: 'Все месяцы' }, ...BIRTH_MONTH_OPTIONS,
      { value: 'has', label: 'Дата указана' }, { value: 'none', label: 'Дата не указана' },
    ] })}
    ${select({ label: 'Ярлык', name: 'peopleTagFilter', value: filters.tag, options: tagFilterOptions(), searchable: true })}
    <div data-people-procedure-filter>${hasCurrentProceduresSnapshot()
      ? select({ label: 'Процедура', name: 'peopleProcedureFilter', value: filters.procedure, options: procedureFilterOptions(), searchable: true })
      : '<div class="field">Процедура: загрузка…</div>'}</div>
    ${select({ label: 'Почта', name: 'peopleNoEmailFilter', value: filters.noEmail, options: [{ value: '', label: 'Все' }, { value: 'yes', label: 'Без почты' }] })}
    ${select({ label: 'Посещения', name: 'peopleNoVisitsFilter', value: filters.noVisits, options: [{ value: '', label: 'Все' }, { value: 'yes', label: 'Без посещений' }] })}
  </div>`;
}

function openFilterSettings(root) {
  let applied = getPeopleFilters();
  let draft = { ...applied };
  const hasFilters = (filters) => Object.values(filters).some(Boolean);
  const sameFilters = (left, right) => Object.keys(applied).every((key) => String(left[key] || '') === String(right[key] || ''));
  const layer = mountModal(root, modal(`
    <div data-people-filter-fields>${peopleFilterFields(draft)}</div>
    <div class="modal-actions" data-people-filter-actions hidden>
      ${button('Применить', { data: 'data-people-filter-action' })}
    </div>`, { title: 'Фильтр', variant: 'x', surface: 'app' }));
  if (!layer) return null;
  const action = layer.querySelector('[data-people-filter-action]');
  const actions = layer.querySelector('[data-people-filter-actions]');

  const updateAction = () => {
    const changed = !sameFilters(draft, applied);
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
      peopleNoEmailFilter: 'noEmail',
      peopleNoVisitsFilter: 'noVisits',
    };
    const key = keyByName[event.target?.name];
    if (!key) return;
    draft[key] = String(event.target.value || '');
    updateAction();
  });

  action.addEventListener('click', () => {
    if (!sameFilters(draft, applied)) {
      applied = setPeopleFilters(draft);
      refreshPeopleList(root);
      layer.v2Close?.();
      return;
    }
    if (!hasFilters(applied)) return;
    applied = setPeopleFilters({});
    draft = { ...applied };
    const fields = layer.querySelector('[data-people-filter-fields]');
    if (fields) fields.innerHTML = peopleFilterFields(draft);
    refreshPeopleList(root);
    updateAction();
  });

  if (!hasCurrentProceduresSnapshot()) {
    void loadRecordCreationOperationalState().then(() => {
      if (!layer.isConnected) return;
      const host = layer.querySelector('[data-people-procedure-filter]');
      if (!host) return;
      host.innerHTML = select({
        label: 'Процедура',
        name: 'peopleProcedureFilter',
        value: draft.procedure,
        options: procedureFilterOptions(),
        searchable: true,
      });
    }).catch(() => {
      if (!layer.isConnected) return;
      const host = layer.querySelector('[data-people-procedure-filter]');
      if (host) host.textContent = 'Не удалось загрузить процедуры';
    });
  }
  updateAction();
  return layer;
}

function openListSettings(root, options = {}) {
  const layer = mountModal(root, modal(`<div class="modal-actions">
    ${button('Сортировка', { variant: 'secondary', data: 'data-people-sort' })}
    ${button('Фильтр', { variant: 'secondary', data: 'data-people-filter' })}
    ${button('Вид', { variant: 'secondary', data: 'data-people-appearance' })}
    ${button('Выгрузить в Excel', { variant: 'secondary', data: 'data-people-export' })}
  </div>`, { title: 'Клиенты', variant: 'x', surface: 'app' }));
  if (!layer) return null;
  layer.querySelector('[data-people-sort]')?.addEventListener('click', () => { layer.v2Close?.(); openSortSettings(root); });
  layer.querySelector('[data-people-filter]')?.addEventListener('click', () => { layer.v2Close?.(); openFilterSettings(root); });
  layer.querySelector('[data-people-appearance]')?.addEventListener('click', () => { layer.v2Close?.(); openPeopleAppearanceQ(root, options); });
  layer.querySelector('[data-people-export]')?.addEventListener('click', () => {
    layer.v2Close?.();
    downloadCsv(root);
  });
  return layer;
}

function openPeopleAppearanceQ(root, options = {}) {
  const values = getPeople();
  const sample = values[0] || {
    key: '', name: 'Имя', surname: 'Фамилия', phones: ['+7 900 000-00-00'],
    emails: [], telegrams: [], uei: '0000', photo: '',
  };
  return openEntityCardAppearanceQ(root, {
    title: 'Вид',
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

function downloadCsv(root) {
  const headers = ['Имя', 'Фамилия', 'Телефон', 'Email'];
  const rows = visiblePeople(root).map((person) => [person.name, person.surname, person.phones?.[0], person.emails?.[0]]);
  const text = '\uFEFF' + [headers, ...rows]
    .map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(';'))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'клиенты.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}


function openAddMenu(root, options = {}) {
  const allowReal = canUseRealPersonalData();
  const layer = mountModal(root, modal(`<div class="modal-actions">
    ${button('Из контакта', { variant: 'secondary', data: 'data-add-from-contacts' })}
    ${button('Внести вручную', { variant: 'secondary', data: 'data-add-manual' })}
  </div><div class="form-error" data-add-choice-error></div>`, {
    title: 'Добавить клиента',
    variant: 'x',
    surface: 'app',
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
  return personQContext(person);
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

async function renderPersonOverview(layer, baseRoot, key, options = {}) {
  const person = getAllPeople().find((item) => item.key === key);
  if (!person) {
    layer.v2Close?.();
    renderPeople(baseRoot, options);
    return;
  }
  const relationships = await buildPersonRelationshipSections(person);
  // Z2 Header stays empty (apart from its shared dismiss control).
  // The contact card and its programs belong to the same scrollable Z2 Body.
  layer.innerHTML = page([
    personContext(person),
    overviewCard(person),
    relationships.markup,
  ]);
  setV2ZHeaderRows(layer, []);
  bindPersonContext(layer, person, options);
  relationships.bind(layer, (detail) => openPersonRelationshipQ(baseRoot, person, detail, options));
  layer.querySelector('[data-person-card]')?.addEventListener('click', () => {
    openPersonEdit(baseRoot, person.key, {
      onSaved: (nextKey) => void renderPersonOverview(layer, baseRoot, nextKey || person.key, options),
      onDeleted: () => {
        layer.v2Close?.();
        renderPeople(baseRoot, options);
      },
    });
  });
  notifyContext();
}

function openPersonRelationshipQ(root, person, detail, options = {}) {
  const layer = mountModal(root, modal(`${personQContext(person, { settings: detail?.settings !== false })}${detail?.body || ''}`, {
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
  return [
    `<section class="v2-section"><div class="form-grid people-uei-editor">${uei(ueiData(person, all))}</div></section>`,
    v2Section('Персональные данные', `<div class="form-grid">
      ${field({ label: 'Имя', name: 'name', value: person.name, required: true })}
      ${field({ label: 'Фамилия', name: 'surname', value: person.surname })}
      ${select({ label: 'Пол', name: 'gender', value: person.gender || '', options: [
        { value: '', label: 'Не указан' },
        { value: 'female', label: 'Женский' },
        { value: 'male', label: 'Мужской' },
      ] })}
      ${monthDayPicker({ label: 'Дата рождения', name: 'birthDate', value: person.birthDate || '' })}
      ${field({ label: 'Скидка %', name: 'discountPercent', value: person.discountPercent || '', type: 'number', inputmode: 'decimal' })}
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
    fields: [...new FormData(form).entries()].map(([key, value]) => [key, typeof value === 'string' ? value : '']),
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
  person.gender = root.querySelector('[name="gender"]')?.value || '';
  person.birthDate = root.querySelector('[name="birthDate"]')?.value || '';
  const rawDiscount = Number(String(root.querySelector('[name="discountPercent"]')?.value || '0').replace(',', '.'));
  person.discountPercent = Number.isFinite(rawDiscount) ? Math.max(0, Math.min(100, rawDiscount)) : 0;
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
  const layer = mountModal(baseRoot, modal(`<form data-person-edit-form>
    ${personDataFields(person, all)}
    ${button('Удалить', { type: 'button', variant: 'critical', data: 'data-person-delete' })}
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
  const isDirty = () => formSnapshot(form) !== initialState;
  const syncAction = () => {
    if (!action) return;
    const visible = isDirty();
    action.hidden = !visible;
    if (actions) actions.hidden = !visible;
    notifyContext();
  };
  const save = () => {
    if (!isDirty()) return;
    try {
      savePersonData(layer, key);
      const nextKey = savePersonUei(layer, key);
      layer.v2Close?.();
      callbacks.onSaved?.(nextKey || key);
    } catch (error) {
      const node = layer.querySelector('[data-person-edit-error]');
      if (node) node.textContent = error instanceof Error ? error.message : 'Не удалось сохранить';
    }
  };

  action?.addEventListener('click', save);
  layer.querySelector('[data-person-delete]')?.addEventListener('click', () => {
    confirmDelete(layer, person, () => {
      layer.v2Close?.();
      callbacks.onDeleted?.();
    });
  });
  form?.addEventListener('input', syncAction);
  form?.addEventListener('change', syncAction);
  form?.addEventListener('submit', (event) => { event.preventDefault(); save(); });
  syncAction();
  return layer;
}
