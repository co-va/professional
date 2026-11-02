import { getDocumentHistory, recordDocumentHistory } from './history.js';
import {
  CORE_DOCUMENT_IDS,
  DOCUMENT_CLASS,
  canDeleteDocument,
  documentPolicy,
  inferDocumentClass,
  tracksDocumentVersions,
} from './policy.js';

let documentsState = null;
let persistDocuments = null;
let platformBasesState = [];
let platformContextState = { profile: {} };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeBase(item = {}) {
  return {
    key: String(item.key || ''),
    documentId: String(item.documentId || ''),
    kind: item.kind === 'consent' ? 'consent' : 'agreement',
    personConsent: Boolean(item.personConsent),
    required: Boolean(item.required),
    title: String(item.title || 'Документ'),
    version: Math.max(1, Number(item.version || 1)),
    content: String(item.content || ''),
  };
}

function normalize(item = {}) {
  const sourceMode = String(item.sourceMode || '').toUpperCase();
  const kindValue = String(item.kind || '').trim().toLowerCase();
  const kind = ['consent', 'agreement', 'instruction', 'document'].includes(kindValue) ? kindValue : 'document';
  const documentClass = inferDocumentClass(item);
  const policy = documentPolicy({ ...item, documentClass });
  return {
    id: String(item.id || `document-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    system: Boolean(item.system),
    kind,
    documentClass,
    signable: policy.signable,
    hidden: Boolean(item.hidden),
    title: String(item.title || 'Документ'),
    personConsent: Boolean(item.personConsent),
    required: Boolean(item.required),
    version: policy.versioned ? Math.max(1, Number(item.version || 1)) : 1,
    text: String(item.text || ''),
    sourceMode: sourceMode === 'BOOK' ? 'BOOK' : sourceMode === 'CUSTOM' ? 'CUSTOM' : '',
    baseKey: String(item.baseKey || ''),
    baseVersion: Math.max(0, Number(item.baseVersion || 0)),
    availableBaseVersion: Math.max(0, Number(item.availableBaseVersion || 0)),
    availableBookText: String(item.availableBookText || ''),
    createdAt: String(item.createdAt || ''),
    updatedAt: String(item.updatedAt || ''),
    attachment: item.attachment && typeof item.attachment === 'object' && !Array.isArray(item.attachment)
      ? clone(item.attachment)
      : null,
  };
}

function contextValues() {
  const profile = platformContextState.profile || {};
  const fullName = [profile.name, profile.surname]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
  const emails = Array.isArray(profile.emails) ? profile.emails : [];
  const phones = Array.isArray(profile.phones) ? profile.phones : [];
  const contact = String(emails[0] || phones[0] || profile.email || profile.phone || '').trim();
  return {
    '[ФИО пользователя]': fullName,
    '[Контакт пользователя]': contact,
  };
}

function contextReady() {
  const values = contextValues();
  return Boolean(values['[ФИО пользователя]'] && values['[Контакт пользователя]']);
}

export function renderPlatformBaseText(base) {
  let text = String(base?.content || '');
  for (const [placeholder, value] of Object.entries(contextValues())) {
    text = text.split(placeholder).join(value || '________________');
  }
  return text;
}

function baseForDocument(documentId) {
  return platformBasesState.find((item) => item.documentId === documentId) || null;
}

function makeDocumentFromPlatformBase(base, version = 1) {
  return normalize({
    id: base.documentId,
    system: true,
    kind: base.kind,
    documentClass: DOCUMENT_CLASS.CORE_LEGAL,
    title: base.title,
    personConsent: base.personConsent,
    required: base.required,
    signable: base.personConsent,
    version,
    text: renderPlatformBaseText(base),
    sourceMode: 'BOOK',
    baseKey: base.key,
    baseVersion: base.version,
  });
}

function historyEntry(document, action, source) {
  return {
    id: crypto.randomUUID(),
    documentId: document.id,
    documentTitle: document.title,
    documentVersion: Math.max(1, Number(document.version || 1)),
    action,
    createdAt: new Date().toISOString(),
    source,
    snapshot: clone(document),
  };
}

function technicalFileHistory(entry = {}) {
  if (String(entry?.source || '') === 'system-rkn-guide') return true;
  const snapshot = entry?.snapshot && typeof entry.snapshot === 'object' ? entry.snapshot : null;
  return Boolean(snapshot && inferDocumentClass(snapshot) === DOCUMENT_CLASS.FILE);
}

export function configurePlatformDocumentBases(bases = [], context = {}) {
  platformBasesState = (Array.isArray(bases) ? bases : [])
    .map(normalizeBase)
    .filter((item) => item.key && item.documentId && item.content);
  platformContextState = {
    profile: context?.profile && typeof context.profile === 'object' ? clone(context.profile) : {},
  };
}

export function getPlatformDocumentBases() {
  return clone(platformBasesState);
}

export function buildTenantDocumentsFromPlatformBases() {
  if (!platformBasesState.length || !contextReady()) return [];
  return CORE_DOCUMENT_IDS
    .map((id) => baseForDocument(id))
    .filter(Boolean)
    .map((base) => makeDocumentFromPlatformBase(base, 1));
}

export function reconcileTenantDocumentsWithPlatformBases(items = [], history = []) {
  const sourceItems = Array.isArray(items) ? items : [];
  const current = sourceItems.map(normalize);
  const sourceHistory = Array.isArray(history) ? clone(history) : [];
  const nextHistory = sourceHistory.filter((entry) => !technicalFileHistory(entry));
  let changed = sourceHistory.length !== nextHistory.length
    || sourceItems.some((item, index) => (
      String(item?.documentClass || '') !== String(current[index]?.documentClass || '')
      || Object.prototype.hasOwnProperty.call(item || {}, 'recordType')
    ));

  if (!platformBasesState.length || !contextReady()) {
    return { documents: current, history: nextHistory, changed };
  }

  for (const documentId of CORE_DOCUMENT_IDS) {
    const base = baseForDocument(documentId);
    if (!base) continue;
    const rendered = renderPlatformBaseText(base);
    const index = current.findIndex((item) => item.id === documentId);

    if (index < 0) {
      const created = makeDocumentFromPlatformBase(base, 1);
      current.push(created);
      nextHistory.push(historyEntry(created, 'created', 'platform-registry'));
      changed = true;
      continue;
    }

    const item = current[index];
    if (item.documentClass !== DOCUMENT_CLASS.CORE_LEGAL) {
      current[index] = normalize({ ...item, documentClass: DOCUMENT_CLASS.CORE_LEGAL });
      changed = true;
    }
    const active = current[index];

    if (!active.sourceMode) {
      const exactRegistryDocument = active.title === base.title && active.text === rendered;
      current[index] = normalize({
        ...active,
        documentClass: DOCUMENT_CLASS.CORE_LEGAL,
        sourceMode: exactRegistryDocument ? 'BOOK' : 'CUSTOM',
        baseKey: base.key,
        baseVersion: exactRegistryDocument ? base.version : 0,
        availableBaseVersion: exactRegistryDocument ? 0 : base.version,
        availableBookText: exactRegistryDocument ? '' : rendered,
      });
      changed = true;
      continue;
    }

    if (active.sourceMode === 'BOOK') {
      if (active.text !== rendered || active.title !== base.title || active.baseVersion !== base.version) {
        const previous = clone(active);
        const refreshed = normalize({
          ...active,
          title: base.title,
          text: rendered,
          version: Number(active.version || 1) + 1,
          baseKey: base.key,
          baseVersion: base.version,
          availableBaseVersion: 0,
          availableBookText: '',
        });
        current[index] = refreshed;
        nextHistory.push(historyEntry(previous, 'superseded', 'platform-registry'));
        nextHistory.push(historyEntry(refreshed, 'version-created', 'platform-registry'));
        changed = true;
      }
      continue;
    }

    const nextAvailable = active.text === rendered && active.title === base.title ? 0 : base.version;
    const nextText = nextAvailable ? rendered : '';
    if (active.baseKey !== base.key
      || active.availableBaseVersion !== nextAvailable
      || active.availableBookText !== nextText) {
      current[index] = normalize({
        ...active,
        baseKey: base.key,
        availableBaseVersion: nextAvailable,
        availableBookText: nextText,
      });
      changed = true;
    }
  }

  return { documents: current.map(normalize), history: nextHistory, changed };
}

export function configureDocumentPersistence(handler = null) {
  persistDocuments = typeof handler === 'function' ? handler : null;
}

export function hydrateDocumentsFromServer(items = []) {
  documentsState = (Array.isArray(items) ? items : []).map(normalize);
  return getDocuments();
}

export function getDocuments() {
  return clone(documentsState === null ? [] : documentsState).map(normalize);
}

export function saveDocuments(items = []) {
  documentsState = (Array.isArray(items) ? items : []).map(normalize);
  if (typeof persistDocuments === 'function') void persistDocuments(clone(documentsState));
  return clone(documentsState);
}

export function saveDocument(document) {
  const items = getDocuments();
  const previous = items.find((item) => item.id === document?.id);
  const provisional = normalize({
    ...previous,
    ...document,
    documentClass: document?.documentClass || previous?.documentClass || inferDocumentClass(document),
  });
  const versioned = tracksDocumentVersions(provisional);
  const changedText = Boolean(previous) && String(previous.text || '') !== String(provisional.text || '');
  const changedTitle = Boolean(previous) && String(previous.title || '') !== String(provisional.title || '');
  const changedContent = changedText || changedTitle;
  const now = new Date().toISOString();

  if (previous && changedContent && versioned) {
    const previousAlreadyRecorded = getDocumentHistory().some((entry) =>
      entry.documentId === previous.id
      && Number(entry.documentVersion || 0) === Number(previous.version || 0)
      && entry.snapshot
    );
    if (!previousAlreadyRecorded) {
      recordDocumentHistory({
        documentId: previous.id,
        documentTitle: previous.title,
        documentVersion: previous.version,
        action: 'superseded',
        source: previous.sourceMode === 'BOOK' ? 'platform-registry' : 'custom',
        snapshot: previous,
      });
    }
  }

  const next = normalize({
    ...provisional,
    sourceMode: previous && changedContent ? 'CUSTOM' : (previous?.sourceMode || provisional.sourceMode || 'CUSTOM'),
    version: versioned && changedContent
      ? Number(previous?.version || provisional.version || 1) + 1
      : Number(previous?.version || provisional.version || 1),
    createdAt: previous?.createdAt || provisional.createdAt || now,
    updatedAt: changedContent || !previous ? now : (provisional.updatedAt || previous?.updatedAt || ''),
  });

  const index = items.findIndex((item) => item.id === next.id);
  if (index >= 0) items[index] = next;
  else items.push(next);
  saveDocuments(items);

  if (versioned && !previous) {
    recordDocumentHistory({
      documentId: next.id,
      documentTitle: next.title,
      documentVersion: next.version,
      action: 'created',
      source: next.sourceMode === 'BOOK' ? 'platform-registry' : 'custom',
      snapshot: next,
    });
  } else if (versioned && previous && changedContent) {
    recordDocumentHistory({
      documentId: next.id,
      documentTitle: next.title,
      documentVersion: next.version,
      action: changedText ? 'version-created' : 'renamed',
      source: 'custom',
      snapshot: next,
    });
  }

  return next;
}

export function createDocument({ title = 'Новый документ', text = '' } = {}) {
  return createStandaloneDocument({ title, text, signable: true });
}

export function createStandaloneDocument({
  title = 'Новый документ',
  text = '',
  signable = false,
  attachment = null,
  documentClass = DOCUMENT_CLASS.USER_DOCUMENT,
} = {}) {
  const resolvedClass = signable && documentClass === DOCUMENT_CLASS.FILE
    ? DOCUMENT_CLASS.USER_DOCUMENT
    : documentClass;
  return saveDocument({
    id: `document-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    system: false,
    kind: 'document',
    documentClass: resolvedClass,
    signable,
    title,
    personConsent: false,
    required: false,
    version: 1,
    text,
    sourceMode: 'CUSTOM',
    attachment,
  });
}

export function deleteDocument(documentId = '') {
  const id = String(documentId || '').trim();
  const items = getDocuments();
  const target = items.find((item) => item.id === id);
  if (!target) return false;
  if (!canDeleteDocument(target)) throw new Error('Основной документ нельзя удалить');

  if (String(target?.attachment?.type || '').toUpperCase() === 'RKN_GUIDE_PDF') {
    saveDocuments(items.map((item) => item.id === id ? normalize({ ...item, hidden: true }) : item));
    return true;
  }

  saveDocuments(items.filter((item) => item.id !== id));
  return true;
}

export function resetDocumentTemplates() {
  const savedDocuments = getDocuments().filter((item) => !CORE_DOCUMENT_IDS.includes(item.id));
  return saveDocuments([...buildTenantDocumentsFromPlatformBases(), ...savedDocuments]);
}
