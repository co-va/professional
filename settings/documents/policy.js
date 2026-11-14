export const DOCUMENT_CLASS = Object.freeze({
  CORE_LEGAL: 'CORE_LEGAL',
  USER_DOCUMENT: 'USER_DOCUMENT',
  FILE: 'FILE',
});

export const CORE_DOCUMENT_IDS = Object.freeze([
  'pdn-agreement',
  'pdn-consent',
  'messages-consent',
]);

const VALID_CLASSES = new Set(Object.values(DOCUMENT_CLASS));

function attachmentType(item = {}) {
  return String(item?.attachment?.type || '').trim().toUpperCase();
}

export function inferDocumentClass(item = {}) {
  const explicit = String(item?.documentClass || '').trim().toUpperCase();
  if (VALID_CLASSES.has(explicit)) return explicit;
  if (CORE_DOCUMENT_IDS.includes(String(item?.id || ''))) return DOCUMENT_CLASS.CORE_LEGAL;
  const attachment = attachmentType(item);
  if (attachment === 'RKN_GUIDE_PDF') return DOCUMENT_CLASS.FILE;
  if (attachment === 'USER_PDF' && !Boolean(item?.signable)) return DOCUMENT_CLASS.FILE;
  return DOCUMENT_CLASS.USER_DOCUMENT;
}

export function documentPolicy(item = {}) {
  const documentClass = inferDocumentClass(item);
  const file = documentClass === DOCUMENT_CLASS.FILE;
  const core = documentClass === DOCUMENT_CLASS.CORE_LEGAL;
  const signable = !file && Boolean(item?.signable || item?.personConsent);
  return {
    documentClass,
    core,
    file,
    deletable: !core,
    versioned: !file,
    signable,
  };
}

export function isCoreDocument(item = {}) {
  return documentPolicy(item).core;
}

export function isFileDocument(item = {}) {
  return documentPolicy(item).file;
}

export function canDeleteDocument(item = {}) {
  return documentPolicy(item).deletable;
}

export function tracksDocumentVersions(item = {}) {
  return documentPolicy(item).versioned;
}

export function canSignDocument(item = {}) {
  return documentPolicy(item).signable;
}

export function visibleDocumentVersion(item = {}) {
  return tracksDocumentVersions(item) ? Math.max(1, Number(item?.version || 1)) : '';
}
