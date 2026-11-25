import { settingsDetailHeading, setSettingsDetailOpen } from '../settings.js';
import {
  actionBlock,
  button,
  compactButton,
  documentTile,
  documentTiles,
  emptyState,
  field,
  initSegmentControls,
  modal,
  mountModal,
  mountV2ZLayer,
  openDocumentViewer,
  openNotice,
  page,
  segmentControl,
  select,
  selectFile,
  setV2ZHeaderRows,
  shortDateTime,
  textareaField,
  v2ListEntries,
  v2ListEntry,
  v2ZLayer,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { formatPhone, phonesMatch } from '../../core/phone/index.js';
import { getAllPeople } from '../../core/people/data.js';
import {
  createStandaloneDocument,
  deleteDocument,
  getDocuments,
  getPlatformDocumentBases,
  renderPlatformBaseText,
  saveDocument,
} from './data.js';
import {
  CORE_DOCUMENT_IDS,
  DOCUMENT_CLASS,
  canDeleteDocument,
  canSignDocument,
  isCoreDocument,
  isFileDocument,
  visibleDocumentVersion,
} from './policy.js';
import { getConsents } from './consents.js';
import { getDocumentHistory } from './history.js';

const VIEWS = [
  { value: 'documents', label: 'Документы' },
  { value: 'history', label: 'История' },
];

const HISTORY_SORT_OPTIONS = [
  { value: 'date', label: 'По дате' },
  { value: 'name', label: 'По имени (А–Я)' },
  { value: 'version', label: 'По версии' },
];

const USER_PDF_FILE_LIMIT = 15 * 1024 * 1024;
const USER_PDF_TOTAL_LIMIT = 30 * 1024 * 1024;

let currentView = 'documents';

function isRknGuide(item = {}) {
  return item?.attachment?.type === 'RKN_GUIDE_PDF'
    && Boolean(item?.attachment?.pdfBase64);
}

function isUserPdf(item = {}) {
  return item?.attachment?.type === 'USER_PDF'
    && Boolean(item?.attachment?.dataUrl);
}

function documentPdfDataUrl(item = {}) {
  if (isUserPdf(item)) return String(item.attachment.dataUrl || '');
  if (!isRknGuide(item)) return '';
  const mimeType = String(item?.attachment?.mimeType || 'application/pdf');
  return `data:${mimeType};base64,${String(item?.attachment?.pdfBase64 || '')}`;
}

function documentMoment(item = {}) {
  const direct = item?.attachment?.generatedAt
    || item?.attachment?.uploadedAt
    || item?.updatedAt
    || item?.createdAt
    || '';
  if (direct) return direct;
  const history = getDocumentHistory().find((entry) =>
    entry.documentId === item.id
    && Number(entry.documentVersion || 0) === Number(item.version || 0)
  );
  return history?.createdAt || '';
}

function currentProfileDocuments() {
  const grouped = new Map();
  getDocuments().forEach((item) => {
    if (item?.hidden) return;
    const key = String(item.id || '');
    if (!key) return;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, item);
      return;
    }
    const currentVersion = Number(current.version || 0);
    const nextVersion = Number(item.version || 0);
    if (nextVersion > currentVersion) grouped.set(key, item);
    else if (nextVersion === currentVersion && Date.parse(documentMoment(item) || 0) > Date.parse(documentMoment(current) || 0)) {
      grouped.set(key, item);
    }
  });
  return [...grouped.values()];
}

function coreDocuments() {
  const byId = new Map(currentProfileDocuments().map((item) => [item.id, item]));
  return CORE_DOCUMENT_IDS.map((id) => byId.get(id)).filter(Boolean);
}

function otherDocuments() {
  return currentProfileDocuments()
    .filter((item) => !isCoreDocument(item))
    .sort((left, right) => Date.parse(documentMoment(right) || 0) - Date.parse(documentMoment(left) || 0));
}

function templates() {
  const documentsById = new Map(getDocuments().map((item) => [String(item.id || ''), item]));
  return getPlatformDocumentBases()
    .map((base) => {
      const current = documentsById.get(String(base.documentId || '')) || null;
      return {
        id: String(base.documentId || ''),
        templateKey: String(base.key || ''),
        system: true,
        kind: base.kind || 'agreement',
        documentClass: DOCUMENT_CLASS.CORE_LEGAL,
        title: current?.title || base.title || 'Шаблон',
        personConsent: Boolean(base.personConsent),
        required: Boolean(base.required),
        signable: Boolean(base.personConsent),
        version: Number(current?.version || base.version || 1),
        text: current ? String(current.text || '') : renderPlatformBaseText(base),
        sourceMode: current?.sourceMode === 'CUSTOM' ? 'CUSTOM' : 'PLATFORM',
        baseKey: String(base.key || ''),
        baseVersion: Number(base.version || 1),
      };
    })
    .filter((item) => item.id)
    .sort((left, right) => CORE_DOCUMENT_IDS.indexOf(left.id) - CORE_DOCUMENT_IDS.indexOf(right.id));
}

function consentStateText(status) {
  if (status === 'revoked') return 'Отозвано';
  if (status === 'declined') return 'Не подписано';
  return 'Подписано';
}

function consentStateKind(status) {
  if (status === 'revoked') return 'revoked';
  if (status === 'declined') return 'pending';
  return 'signed';
}

function consentPerson(item, people) {
  if (item.subjectType === 'ACCOUNT') {
    return people.find((person) => (person.accounts || []).includes(item.subjectKey)) || null;
  }
  if (item.subjectType !== 'CONTACT_POINT') return null;
  if (item.contactType === 'PHONE') {
    return people.find((person) => (person.phones || []).some((value) => phonesMatch(value, item.contactValue))) || null;
  }
  if (item.contactType === 'EMAIL') {
    const target = String(item.contactValue || '').trim().toLowerCase();
    return people.find((person) => (person.emails || []).some((value) => String(value || '').trim().toLowerCase() === target)) || null;
  }
  if (item.contactType === 'TELEGRAM') {
    const target = String(item.contactValue || '').trim();
    return people.find((person) => (person.telegrams || []).some((value) => String(value || '').trim() === target)) || null;
  }
  return null;
}

function signedDocumentSnapshot(item) {
  const historical = getDocumentHistory().find((entry) =>
    entry.documentId === item.documentId
    && Number(entry.documentVersion || 0) === Number(item.documentVersion || 0)
    && entry.snapshot
  );
  if (historical?.snapshot) return historical.snapshot;
  return getDocuments().find((document) =>
    document.id === item.documentId
    && Number(document.version || 0) === Number(item.documentVersion || 0)
  ) || null;
}

// Titles for the timeline are descriptive metadata only. Never substitute the
// current document body for an unavailable signed snapshot.
function signingDocumentTitle(item, snapshot = signedDocumentSnapshot(item)) {
  const id = String(item.documentId || '');
  const version = Number(item.documentVersion || 0);
  const historyTitle = getDocumentHistory().find(entry => entry.documentId === id
    && Number(entry.documentVersion || 0) === version && entry.documentTitle)?.documentTitle;
  const fallback = {
    'pdn-agreement': 'Политика обработки персональных данных',
    'pdn-consent': 'Согласие на обработку персональных данных',
    'messages-consent': 'Согласие на рекламные и маркетинговые сообщения',
  };
  return snapshot?.title || historyTitle || fallback[id]
    || getDocuments().find(document => document.id === id)?.title || 'Документ (название недоступно)';
}

function signingSubjectTypeLabel(item) {
  if (item.subjectType === 'ACCOUNT') return 'Аккаунт';
  if (item.subjectType !== 'CONTACT_POINT') return 'Тип не определён';
  return ({ PHONE: 'Телефон', EMAIL: 'Электронная почта', TELEGRAM: 'Telegram' })[item.contactType] || 'Контакт';
}

function signingHistoryEventLabel(item) {
  const subject = signingSubjectTypeLabel(item);
  if (item.documentId === 'messages-consent' && item.subjectType === 'CONTACT_POINT') return 'Канал: ' + subject;
  return subject;
}

function openDocument(item) {
  if (!item) return null;
  return openDocumentViewer({
    title: item.title || 'Документ',
    version: visibleDocumentVersion(item),
    content: item.text || '',
    pdfDataUrl: documentPdfDataUrl(item),
  });
}

function documentTypeText(item) {
  if (isCoreDocument(item)) return 'Основной документ';
  if (isRknGuide(item)) return 'PDF-помощник';
  if (isFileDocument(item)) return 'Файл';
  return 'Документ';
}

function documentCard(item, data) {
  const moment = documentMoment(item);
  const date = moment ? shortDateTime(moment, '') : '';
  return documentTile({
    title: item.title || 'Документ',
    version: visibleDocumentVersion(item),
    meta: [documentTypeText(item), date].filter(Boolean).join(' · '),
    data,
    editData: canEditDesktopDocument(item) || canDeleteDocument(item) ? `data-mobile-document-edit="${escapeHtml(item.id)}"` : '',
    editAria: canEditDesktopDocument(item) ? 'Редактировать документ' : 'Управление файлом',
    aria: `Открыть документ ${item.title || 'Документ'}`,
  });
}

function documentsMarkup() {
  const core = coreDocuments();
  const other = otherDocuments();
  return `
    <section class="document-group document-group--core" data-document-group="core">
      <h3 class="document-group__title">Основные документы</h3>
      ${core.length
        ? documentTiles(core.map((item) => documentCard(item, `data-profile-document="${escapeHtml(item.id || '')}"`)), { layout: 'rail' })
        : emptyState('Основные документы не загрузились', 'Обновите раздел.')}
    </section>
    <section class="document-group document-group--other" data-document-group="other">
      <h3 class="document-group__title">Другие документы</h3>
      ${other.length
        ? documentTiles(other.map((item) => documentCard(item, `data-profile-document="${escapeHtml(item.id || '')}"`)), { layout: 'rail' })
        : emptyState('Других документов пока нет', 'Здесь появятся PDF-помощники и добавленные вами документы.')}
    </section>
  `;
}

function historyItems() {
  return [...getConsents()].sort((left, right) =>
    Date.parse(right.eventAt || right.createdAt || 0) - Date.parse(left.eventAt || left.createdAt || 0)
  );
}

function historySubject(item, people) {
  const person = consentPerson(item, people);
  const members = person ? [person, ...people.filter(candidate => candidate !== person && person.uei && candidate.uei === person.uei)] : [];
  const named = members.find(candidate => [candidate.name, candidate.surname].some(value => String(value || '').trim()));
  const name = named ? [named.name, named.surname].map(value => String(value || '').trim()).filter(Boolean).join(' ') : '';
  const eventPhone = item.subjectType === 'CONTACT_POINT' && item.contactType === 'PHONE' ? String(item.contactValue || '').trim() : '';
  const rawPhone = eventPhone || members.flatMap(candidate => candidate.phones || []).find(Boolean) || '';
  const phone = rawPhone ? formatPhone(rawPhone) || rawPhone : '';
  return { name, phone };
}

function historyCard(item, people, index) {
  const snapshot = signedDocumentSnapshot(item);
  const date = shortDateTime(item.eventAt || item.acceptedAt || item.revokedAt || item.createdAt, '');
  const { name, phone } = historySubject(item, people);
  const title = signingDocumentTitle(item, snapshot);
  return documentTile({
    title,
    version: item.documentVersion || snapshot?.version || 1,
    subject: name || 'Имя не указано',
    subjectPhone: phone || 'Телефон не указан',
    eventLabel: signingHistoryEventLabel(item),
    meta: date,
    status: consentStateText(item.status),
    statusState: consentStateKind(item.status),
    data: `data-signing-event="${escapeHtml(String(item.id || ''))}" data-history-person="${escapeHtml(name)}" data-history-phone="${escapeHtml(phone)}" data-history-version="${escapeHtml(String(item.documentVersion || snapshot?.version || 1))}" data-history-order="${index}"`,
    aria: `Открыть факт подписания ${title}: ${name || 'Имя не указано'}${phone ? ', ' + phone : ''}`,
  });
}

function historyMarkup() {
  const items = historyItems();
  if (!items.length) return emptyState('Истории подписаний пока нет', 'Здесь появятся факты подписания, отказа и отзыва.');
  const people = getAllPeople();
  return `
    ${documentTiles(items.map((item, index) => historyCard(item, people, index)), { className: 'mobile-document-history' })}
    <div class="mobile-document-history-empty" data-history-no-results hidden>${emptyState('Ничего не найдено', 'Измените имя, фамилию или телефон.')}</div>
  `;
}

function mobileDocumentsHeaderRows() {
  const rows = [segmentControl(VIEWS, {
    value: currentView,
    name: 'documentsView',
    aria: 'Документы и история подписаний',
  })];
  if (currentView === 'history') rows.push(`<div class="mobile-document-history-tools" data-v2-layer-gesture-ignore>
    <div class="ui-search-field">${field({ name: 'documentHistoryQuery', type: 'search', placeholder: 'Поиск', autocomplete: 'off', data: 'aria-label="Поиск по имени, фамилии или телефону"' })}</div>
    ${select({ name: 'documentHistorySort', value: 'date', options: HISTORY_SORT_OPTIONS, triggerKind: 'sort', pickerTitle: 'Сортировка', aria: 'Сортировка' })}
  </div>`);
  return rows;
}

function normalizeHistoryQuery(value) {
  return String(value || '').trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');
}

function bindDocumentHistory(root, tools) {
  const host = root.querySelector('.mobile-document-history, .desktop-document-history');
  if (!host) return;
  const cards = [...host.querySelectorAll('[data-history-person]')];
  const query = tools?.querySelector('[name="documentHistoryQuery"]');
  const sort = tools?.querySelector('[name="documentHistorySort"]');
  const empty = root.querySelector('[data-history-no-results]');
  let mode = 'date';
  const order = () => {
    cards.sort((a, b) => {
      const byName = () => Number(!a.dataset.historyPerson) - Number(!b.dataset.historyPerson)
        || a.dataset.historyPerson.localeCompare(b.dataset.historyPerson, 'ru', { sensitivity: 'base' });
      const version = node => {
        const value = Number(node.dataset.historyVersion);
        return Number.isFinite(value) && value > 0 ? value : 0;
      };
      const primary = mode === 'name' ? byName() : mode === 'version' ? version(b) - version(a) : 0;
      return primary || Number(a.dataset.historyOrder) - Number(b.dataset.historyOrder);
    });
    for (const card of cards) host.append(card);
  };
  const filter = () => {
    const value = normalizeHistoryQuery(query?.value);
    const phoneQuery = /^[+\d\s()\-]+$/.test(value) ? value.replace(/\D/g, '') : '';
    const tokens = value.split(/\s+/).filter(Boolean);
    let count = 0;
    for (const card of cards) {
      const subject = normalizeHistoryQuery(card.dataset.historyPerson);
      const phone = String(card.dataset.historyPhone || '').replace(/\D/g, '');
      card.hidden = phoneQuery ? !phone.includes(phoneQuery) : !tokens.every(token => subject.includes(token));
      if (!card.hidden) count++;
    }
    if (empty) empty.hidden = count !== 0;
  };
  query?.addEventListener('input', filter);
  sort?.addEventListener('change', () => {
    mode = HISTORY_SORT_OPTIONS.some(option => option.value === sort.value) ? sort.value : 'date';
    order();
  });
}

function canEditDesktopDocument(item) {
  return isCoreDocument(item) || (!item.system && !isRknGuide(item));
}

function desktopDocumentList() {
  const heading=history=>'<div class="settings-document-list-heading"><span>Наименование / Дата</span><span>Версия</span><span>'+(history?'Статус':'')+'</span></div>';
  if(currentView==='history') {
    const items=historyItems();
    if (!items.length) return emptyState('Истории подписаний пока нет','Здесь появятся факты подписания, отказа и отзыва.');
    const people = getAllPeople();
    const rows = items.map((item,index) => {
      const snapshot = signedDocumentSnapshot(item);
      const {name,phone} = historySubject(item,people);
      const title = signingDocumentTitle(item,snapshot);
      return v2ListEntry({
        className:'settings-document-row settings-document-row--history',leadingIcon:'document',
        identityTitle:name || 'Имя не указано',identitySubtitle:phone || 'Телефон не указан',
        title,subtitle:[shortDateTime(item.eventAt||item.acceptedAt||item.revokedAt||item.createdAt,''),signingHistoryEventLabel(item)].filter(Boolean).join(' · '),
        rightTop:String(item.documentVersion||snapshot?.version||1),
        statusMark:{symbol:item.status==='revoked'?'×':item.status==='declined'?'—':'✓',label:consentStateText(item.status)},
        data:`data-signing-event="${escapeHtml(item.id)}" data-history-person="${escapeHtml(name)}" data-history-phone="${escapeHtml(phone)}" data-history-version="${escapeHtml(String(item.documentVersion || snapshot?.version || 1))}" data-history-order="${index}"`,
      });
    });
    return '<div class="settings-document-table settings-document-table--history"><div class="settings-document-list-heading settings-document-list-heading--history"><span class="settings-history-heading-main"><span aria-hidden="true"></span><span>Имя / Телефон</span><span>Наименование / Дата</span></span><span>Версия</span><span>Статус</span></div>'
      +'<div class="list-entries desktop-document-history">'+rows.join('')+'</div></div>'
      +`<div data-history-no-results hidden>${emptyState('Ничего не найдено','Измените имя, фамилию или телефон.')}</div>`;
  }
  const group=(title,items)=>'<section class="settings-document-group"><h3>'+title+'</h3><div class="settings-document-table">'+heading(false)+(items.length?v2ListEntries(items.map(item=>v2ListEntry({
    className:'settings-document-row',leadingIcon:'document',title:item.title||'Документ',
    subtitle:documentMoment(item)?shortDateTime(documentMoment(item),''):'',omitEmptySubtitle:true,
    rightTop:String(visibleDocumentVersion(item)),
    data:'data-profile-document="'+escapeHtml(item.id)+'"',
    actionData:canEditDesktopDocument(item)?'data-desktop-document-actions="'+escapeHtml(item.id)+'" aria-expanded="false"':'',
    actionIcon:'✎',
    actionAria:'Редактировать документ',
    deleteData:canDeleteDocument(item)?item.id:'',
    deleteAria:isRknGuide(item)?'Убрать документ':'Удалить документ'
  }))):'<div class="settings-document-empty" role="status">Документов пока нет</div>')+'</div></section>';
  return group('Основные документы',coreDocuments())+group('Другие документы',otherDocuments());
}

function contentMarkup() {
  return currentView === 'history' ? historyMarkup() : documentsMarkup();
}

function confirmDocumentDeletion(root, layer, item) {
  const rkn = isRknGuide(item);
  const desktop = root.hasAttribute('data-settings-embedded');
  const title = rkn ? 'Убрать документ' : 'Удалить документ';
  const message = rkn
    ? 'Документ будет убран из отображения. Системный файл останется в архиве.'
    : 'Документ будет удалён из текущих документов. Уже существующие факты подписания не удаляются.';
  const destructive = button(rkn ? 'Убрать' : 'Удалить', { variant: 'critical', data: 'data-confirm-document-delete' });
  const confirm = mountModal(document.body, modal(
    desktop
      ? `<div class="modal-title"><h2>${escapeHtml(title)}?</h2><p>${escapeHtml(message)}</p></div>
         <div class="modal-actions">${destructive}${button('Отмена', {variant:'secondary',data:'data-cancel-document-delete'})}</div>`
      : `<div class="compact-form"><p>${escapeHtml(message)}</p>${destructive}</div>`,
    {
      title: rkn ? 'Убрать документ' : 'Удалить документ',
      variant: 'x',
      surface: 'app',
      className: desktop ? 'document-delete-confirmation' : 'modal--form-sheet',
    },
  ));
  confirm?.querySelector('[data-cancel-document-delete]')?.addEventListener('click', () => confirm.v2Close?.());
  confirm?.querySelector('[data-confirm-document-delete]')?.addEventListener('click', () => {
    try {
      deleteDocument(item.id);
      confirm.v2Close?.();
      layer?.v2Close?.();
      renderMain(root);
    } catch (error) {
      openNotice({
        title: 'Документ не удалён',
        message: error instanceof Error ? error.message : 'Не удалось удалить документ',
      });
    }
  });
}

function openSignedDocument(item) {
  const snapshot = signedDocumentSnapshot(item);
  if (!snapshot) return openNotice({
    title: 'Версия документа недоступна',
    message: 'Подписанная версия не найдена в архиве. Текущая версия не подменяет подписанный документ.',
  });
  return openDocumentViewer({
    title: snapshot.title || 'Документ',
    version: item.documentVersion || snapshot.version || 1,
    content: snapshot.text || '',
    pdfDataUrl: documentPdfDataUrl(snapshot),
  });
}

function setPrimaryVisible(source, visible) {
  if (!source) return;
  const actions = source.closest('.modal-actions');
  if (actions) actions.hidden = !visible;
}

function userPdfStoredBytes() {
  return getDocuments().reduce((total, item) => {
    if (!isUserPdf(item)) return total;
    return total + Number(item?.attachment?.size || 0);
  }, 0);
}

function signableSetting(checked = false) {
  return v2ListEntries([
    v2ListEntry({
      title: 'Подписание клиентом',
      omitEmptySubtitle: true,
      interactive: false,
      toggleData: 'data-document-signable',
      toggleAria: 'Разрешить использовать документ для подписания',
      toggleChecked: checked,
    }),
  ]);
}

function renderNewDocumentEditor(layer, root, draft = {}) {
  let signable = Boolean(draft.signable);
  const attachment = draft.attachment || null;
  const desktop = root.hasAttribute('data-settings-embedded');
  const saveButton = button('Сохранить', {
    className: desktop ? 'v2-desktop-tool-accent' : '',
    data: 'data-new-document-save' + (desktop ? ' hidden' : ''),
    aria: 'Сохранить документ',
  });
  const toolbar = desktop ? `<div class="v2-desktop-tool-row documents-new-toolbar">
    <div class="v2-desktop-tool-context">
      <button type="button" class="app-setting-toggle documents-new-signable${signable?' is-on':''}" data-document-signable aria-pressed="${signable}" aria-label="Подписание клиентом">
        <span class="app-setting-toggle__switch${signable?' is-on':''}" aria-hidden="true"><span></span></span><span>Подписание клиентом</span>
      </button>
    </div>
    <div class="v2-desktop-tool-actions">${saveButton}</div>
  </div>` : '';
  layer.innerHTML = page([
    workspaceHeaderContext({title:'Новый документ'}),
    attachment ? documentTiles([
      documentTile({
        title: draft.title || attachment.fileName || 'PDF',
        version: '',
        meta: 'PDF',
        interactive: false,
      }),
    ]) : '',
    `<form class="form-grid" data-new-document-form>
      ${field({ label: 'Название', name: 'documentTitle', value: draft.title || '', required: true, placeholder: 'Название документа' })}
      ${attachment ? '' : textareaField({ label: 'Текст документа', name: 'documentText', value: draft.text || '', rows: 16, placeholder: 'Текст документа' })}
      ${desktop ? '' : signableSetting(signable)}
    </form>`,
    desktop ? '' : actionBlock(saveButton),
  ]);
  const form = layer.querySelector('[data-new-document-form]');
  let tools = layer;
  if (desktop) {
    const [row] = setV2ZHeaderRows(layer,[toolbar],{desktopTitle:'Новый документ'});
    if (row) tools = row;
    else form?.insertAdjacentHTML('beforebegin',toolbar);
  }
  const primary = tools.querySelector('[data-new-document-save]');
  const toggle = tools.querySelector('[data-document-signable]');

  const sync = () => {
    const title = String(form?.querySelector('[name="documentTitle"]')?.value || '').trim();
    const body = String(form?.querySelector('[name="documentText"]')?.value || '').trim();
    const valid = Boolean(title && (attachment || body));
    if (desktop && primary) primary.hidden = !valid;
    else setPrimaryVisible(primary, valid);
  };

  toggle?.addEventListener('click', () => {
    signable = !signable;
    toggle.setAttribute('aria-pressed', signable ? 'true' : 'false');
    toggle.classList.toggle('is-on', signable);
    toggle.querySelector('.app-setting-toggle__switch')?.classList.toggle('is-on', signable);
  });
  form?.addEventListener('input', sync);
  form?.addEventListener('change', sync);

  primary?.addEventListener('click', () => {
    const title = String(form?.querySelector('[name="documentTitle"]')?.value || '').trim();
    const body = String(form?.querySelector('[name="documentText"]')?.value || '');
    if (!title || (!attachment && !body.trim())) return;
    createStandaloneDocument({
      title,
      text: body,
      signable,
      documentClass: attachment && !signable ? DOCUMENT_CLASS.FILE : DOCUMENT_CLASS.USER_DOCUMENT,
      attachment,
    });
    layer.v2Close?.();
    currentView = 'documents';
    renderMain(root);
  });

  sync();
}

function openNewDocumentEditor(root, draft = {}) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'documents-new-editor' }), { stack: true });
  if (!layer) return null;
  renderNewDocumentEditor(layer, root, draft);
  return layer;
}

async function choosePdf(root) {
  const file = await selectFile({ accept: 'application/pdf,.pdf' }).catch(() => null);
  if (!file) return;
  if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    openNotice({ title: 'Нужен PDF', message: 'Выберите файл в формате PDF.' });
    return;
  }
  if (file.size > USER_PDF_FILE_LIMIT) {
    openNotice({ title: 'Файл слишком большой', message: 'Сейчас один PDF может быть не больше 15 МБ.' });
    return;
  }
  if (userPdfStoredBytes() + file.size > USER_PDF_TOTAL_LIMIT) {
    openNotice({ title: 'Недостаточно места', message: 'Для текущего серверного архива суммарный объём загруженных PDF ограничен 30 МБ.' });
    return;
  }
  openNewDocumentEditor(root, {
    title: file.name.replace(/\.pdf$/i, '') || 'Документ',
    attachment: {
      type: 'USER_PDF',
      fileName: file.name || 'document.pdf',
      mimeType: file.type || 'application/pdf',
      size: file.size,
      dataUrl: file.dataUrl,
      uploadedAt: new Date().toISOString(),
    },
  });
}

function openAddDocumentMenu(root) {
  const layer = mountModal(document.body, modal(
    `<div class="compact-form">
      ${button('Создать документ', { data: 'data-create-text-document', variant: 'outline' })}
      ${button(root.hasAttribute('data-settings-embedded') ? 'Загрузить PDF' : 'Загрузить документ', { data: 'data-upload-pdf-document' })}
    </div>`,
    {
      title: 'Добавить документ',
      variant: 'x',
      surface: 'app',
      className: 'modal--form-sheet',
    },
  ));
  if (!layer) return null;

  layer.querySelector('[data-create-text-document]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openNewDocumentEditor(root);
  });
  layer.querySelector('[data-upload-pdf-document]')?.addEventListener('click', () => {
    layer.v2Close?.();
    void choosePdf(root);
  });
  return layer;
}

function openMobileDocumentEditor(root, item) {
  const layer = mountV2ZLayer(root, v2ZLayer('', {className:'documents-mobile-editor'}), {stack:true});
  if (!layer) return null;
  const editable = canEditDesktopDocument(item);
  const core = isCoreDocument(item);
  const attachment = item.attachment;
  let signable = canSignDocument(item);
  const initialSignable = signable;
  const initialTitle = String(item.title || '');
  const initialText = String(item.text || '');
  layer.innerHTML = page([
    workspaceHeaderContext({title:editable ? 'Редактирование документа' : 'Документ'}),
    `<form class="form-grid" data-mobile-document-form>
      ${field({label:'Название',name:'documentTitle',value:initialTitle,required:true,disabled:!editable})}
      ${attachment || !editable ? '' : textareaField({label:'Текст документа',name:'documentText',value:initialText,rows:16,placeholder:'Текст документа'})}
    </form>`,
    `<div class="documents-mobile-editor-controls">
      ${editable && !core ? signableSetting(signable) : ''}
      ${canDeleteDocument(item) ? button(isRknGuide(item)?'Убрать документ':'Удалить',{variant:'critical',data:'data-mobile-document-delete'}) : ''}
    </div>`,
    editable ? actionBlock(button('Сохранить',{data:'data-mobile-document-save',aria:'Сохранить документ'})) : '',
  ]);
  const form = layer.querySelector('[data-mobile-document-form]');
  const save = layer.querySelector('[data-mobile-document-save]');
  const toggle = layer.querySelector('[data-document-signable]');
  const draft = () => ({
    title:String(form?.querySelector('[name="documentTitle"]')?.value || '').trim(),
    text:attachment ? initialText : String(form?.querySelector('[name="documentText"]')?.value || ''),
  });
  const dirty = () => {
    const next = draft();
    return Boolean(editable && next.title && (attachment || next.text.trim()) &&
      (next.title !== initialTitle || next.text !== initialText || signable !== initialSignable));
  };
  const sync = () => setPrimaryVisible(save, dirty());
  toggle?.addEventListener('click', () => {
    signable = !signable;
    toggle.setAttribute('aria-pressed', String(signable));
    toggle.classList.toggle('is-on', signable);
    toggle.querySelector('.app-setting-toggle__switch')?.classList.toggle('is-on', signable);
    sync();
  });
  form?.addEventListener('input', sync);
  form?.addEventListener('change', sync);
  form?.addEventListener('submit', event => {event.preventDefault(); if(dirty()) save?.click();});
  save?.addEventListener('click', () => {
    if (!dirty()) return;
    // Promote a plain PDF when signing is enabled; never demote a versioned
    // document, since its signed history must retain the original version.
    const documentClass = !core && signable && isFileDocument(item) ? DOCUMENT_CLASS.USER_DOCUMENT : item.documentClass;
    saveDocument({...item,...draft(),documentClass,signable:core ? item.signable : signable,sourceMode:'CUSTOM'});
    layer.v2Close?.();
    currentView = 'documents';
    renderMain(root);
  });
  layer.querySelector('[data-mobile-document-delete]')?.addEventListener('click', () => confirmDocumentDeletion(root,layer,item));
  sync();
  window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
  return layer;
}

function closeDesktopDocumentEditor(root) {
  root.querySelector('[data-inline-document-editor]')?.remove();
  for (const action of root.querySelectorAll('[data-desktop-document-actions][aria-expanded="true"]')) {
    action.setAttribute('aria-expanded', 'false');
  }
}

function openDesktopDocumentEditor(root, control, item) {
  const existing = root.querySelector('[data-inline-document-editor]');
  const same = existing?.dataset.inlineDocumentEditor === item.id;
  closeDesktopDocumentEditor(root);
  if (same) return;
  const row = control.closest('[data-profile-document]');
  if (!row) return;
  const template = isCoreDocument(item) ? (templates().find(entry => entry.id === item.id) || item) : item;
  row.insertAdjacentHTML('afterend', `<section class="settings-inline-document-editor" data-inline-document-editor="${escapeHtml(item.id)}">
    <div class="settings-inline-heading">
      <strong>Редактирование документа</strong>
      <div class="settings-documents-actions">
        ${button('Сохранить', { className: 'settings-h-action', data: 'data-inline-document-save hidden', aria: 'Сохранить документ' })}
        ${compactButton({ kind: 'remove', className: 'settings-detail-close', data: 'data-inline-document-close', aria: 'Закрыть редактор' })}
      </div>
    </div>
    <form class="form-grid" data-inline-document-form>
      ${field({ label: 'Название', name: 'documentTitle', value: template.title || '', required: true })}
      ${template.attachment ? '' : textareaField({ label: 'Текст документа', name: 'documentText', value: template.text || '', rows: 12, placeholder: 'Текст документа' })}
    </form>
  </section>`);
  const editor = root.querySelector('[data-inline-document-editor]');
  const form = editor.querySelector('[data-inline-document-form]');
  const save = editor.querySelector('[data-inline-document-save]');
  control.setAttribute('aria-expanded', 'true');
  const draft = () => ({
    title: String(form.querySelector('[name="documentTitle"]')?.value || '').trim(),
    text: template.attachment ? String(template.text || '') : String(form.querySelector('[name="documentText"]')?.value || ''),
  });
  const sync = () => {
    const next = draft();
    save.hidden = !next.title || (next.title === String(template.title || '') && next.text === String(template.text || ''));
  };
  form.addEventListener('input', sync);
  form.addEventListener('change', sync);
  form.addEventListener('submit', event => { event.preventDefault(); if (!save.hidden) save.click(); });
  editor.querySelector('[data-inline-document-close]')?.addEventListener('click', () => {
    closeDesktopDocumentEditor(root);
    control.focus({ preventScroll: true });
  });
  save.addEventListener('click', () => {
    if (save.hidden) return;
    const next = draft();
    saveDocument({ ...template, ...next, sourceMode: 'CUSTOM' });
    renderMain(root);
    const updatedControl = [...root.querySelectorAll('[data-desktop-document-actions]')].find(action => action.dataset.desktopDocumentActions === item.id);
    const updatedItem = currentProfileDocuments().find(document => document.id === item.id);
    if (updatedControl && updatedItem) openDesktopDocumentEditor(root, updatedControl, updatedItem);
  });
  sync();
}

function desktopHistoryToolbar(root) {
  return root.closest('[data-settings-inline="documents"]')?.parentElement?.querySelector('[data-desktop-document-history-toolbar]') || null;
}

function syncDesktopHistoryToolbar(root) {
  const toolbar = desktopHistoryToolbar(root);
  if (toolbar) toolbar.hidden = currentView !== 'history' || root.querySelector('[data-documents-content]')?.hidden !== false;
}

function renderDesktopHistoryToolbar(root) {
  const toolbar = desktopHistoryToolbar(root);
  if (!toolbar) return;
  toolbar.innerHTML = currentView === 'history' ? `<div class="settings-history-tools people-desktop-tools">${field({name:'documentHistoryQuery',type:'search',placeholder:'Поиск',autocomplete:'off',data:'aria-label="Поиск по имени, фамилии или телефону"'})}<div class="people-desktop-actions people-desktop-query-tools">${select({name:'documentHistorySort',value:'date',options:HISTORY_SORT_OPTIONS,triggerKind:'sort',pickerTitle:'Сортировка',aria:'Сортировка'})}</div></div>` : '';
  syncDesktopHistoryToolbar(root);
}

function bindMain(root, headerRows = []) {
  root.querySelector('[data-documents-content]')?.addEventListener('settings-detail-closed', () => {
    closeDesktopDocumentEditor(root);
    syncDesktopHistoryToolbar(root);
  });
  root.querySelector('[data-settings-document-create]')?.addEventListener('click',()=>openNewDocumentEditor(root));
  root.querySelector('[data-settings-document-pdf]')?.addEventListener('click',()=>void choosePdf(root));
  root.querySelector('[data-settings-document-toggle]')?.addEventListener('click',()=>{
    const host=root.querySelector('[data-documents-content]');
    setSettingsDetailOpen(host,host.hidden);
    syncDesktopHistoryToolbar(root);
  });
  root.querySelector('[data-settings-document-add]')?.addEventListener('click', () => openAddDocumentMenu(root));

  initSegmentControls(root);
  for (const row of headerRows) initSegmentControls(row);
  if(root.hasAttribute('data-settings-embedded')) root.querySelector('.settings-documents-switch')?.addEventListener('click',event=>{
    if(!event.target.closest('[data-segment-option]'))return;
    const host=root.querySelector('[data-documents-content]');
    if(host?.hidden) setSettingsDetailOpen(host,true);
  });
  const viewInput = headerRows[0]?.querySelector('[name="documentsView"]') || root.querySelector('[name="documentsView"]');
  viewInput?.addEventListener('change', (event) => {
    currentView = event.target.value === 'history' ? 'history' : 'documents';
    if(root.hasAttribute('data-settings-embedded')) setSettingsDetailOpen(root.querySelector('[data-documents-content]'),true);
    renderMain(root);
  });

  root.querySelectorAll('[data-desktop-document-actions]').forEach(control=>{
    const open=event=>{
      event.preventDefault();event.stopPropagation();
      const item=currentProfileDocuments().find(doc=>doc.id===control.dataset.desktopDocumentActions);
      if (!item) return;
      if (canEditDesktopDocument(item)) openDesktopDocumentEditor(root, control, item);
    };
    control.addEventListener('click',open);
    control.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')open(event);});
  });
  root.querySelectorAll('[data-profile-document] [data-delete-action]').forEach(control => {
    control.setAttribute('role','button');
    control.setAttribute('tabindex','0');
    const remove = event => {
      event.preventDefault(); event.stopPropagation();
      const item = currentProfileDocuments().find(doc=>doc.id===control.dataset.deleteAction);
      if (item && canDeleteDocument(item)) confirmDocumentDeletion(root, null, item);
    };
    control.addEventListener('click',remove);
    control.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')remove(event);});
  });
  root.querySelectorAll('[data-mobile-document-edit]').forEach(control => {
    control.addEventListener('click', event => {
      event.stopPropagation();
      const item = currentProfileDocuments().find(doc => doc.id === control.dataset.mobileDocumentEdit);
      if (item && (canEditDesktopDocument(item) || canDeleteDocument(item))) openMobileDocumentEditor(root,item);
    });
  });
  root.querySelectorAll('[data-profile-document]').forEach((control) => {
    control.addEventListener('click', () => {
      const item = currentProfileDocuments().find((document) => document.id === control.dataset.profileDocument);
      if (item) openDocument(item);
    });
  });

  bindDocumentHistory(root, desktopHistoryToolbar(root) || headerRows[1] || root);
  root.querySelectorAll('[data-signing-event]').forEach((control) => {
    control.addEventListener('click', () => {
      const item = getConsents().find((event) => event.id === control.dataset.signingEvent);
      if (!item) return;
      openSignedDocument(item);
    });
  });
}

function renderMain(root) {
  if(root.hasAttribute('data-settings-embedded')) {
    const expanded=root.dataset.documentsExpanded==='true';
    const tools=button('Загрузить PDF',{variant:'outline',className:'settings-outline-action',data:'data-settings-document-pdf'})+button('Создать документ',{className:'settings-h-action',data:'data-settings-document-create'});
    root.innerHTML=`<div class="settings-documents-heading"><button type="button" class="settings-document-toggle" data-settings-document-toggle aria-controls="settings-document-content" aria-expanded="${expanded}">Документы <span aria-hidden="true">⌄</span></button><div class="settings-documents-actions">${tools}</div></div><div class="settings-documents-switch">${segmentControl(VIEWS,{value:currentView,name:'documentsView',aria:'Документы и история подписаний'})}</div>
      <section id="settings-document-content" class="settings-document-list" data-documents-content data-settings-detail data-settings-detail-state="documentsExpanded"${expanded?'':' hidden'}>${settingsDetailHeading(currentView==='history'?'История':'Документы','settings-document-content')}${desktopDocumentList()}</section>`;
    renderDesktopHistoryToolbar(root);
    bindMain(root);
    window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
    return;
  }
  root.innerHTML = page([
    workspaceHeaderContext({
      title: 'Документы',
      c: currentView === 'documents' ? { label: '+', data: 'data-settings-document-add', aria: 'Добавить документ' } : null,
    }),
    `<section class="documents-content" data-documents-content>${contentMarkup()}</section>`,
  ]);
  const rows = mobileDocumentsHeaderRows();
  const headerRows = setV2ZHeaderRows(root, rows);
  // The standalone legacy settings renderer has no Z shell. Keep its controls reachable.
  if (!headerRows.length) root.querySelector('[data-documents-content]')?.insertAdjacentHTML('beforebegin', rows.join(''));
  bindMain(root, headerRows);
  window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
}

export function render(root) {
  renderMain(root);
}
