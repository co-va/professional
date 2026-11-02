let consentState = [];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalize(item = {}) {
  const subjectType = String(item.subjectType || '').trim().toUpperCase();
  const contactTypeRaw = String(item.contactType || '').trim().toUpperCase();
  const contactType = contactTypeRaw === 'SMS' || contactTypeRaw === 'WHATSAPP' ? 'PHONE' : contactTypeRaw;
  const contactValue = String(item.contactValue || '').trim();
  return {
    id: String(item.id || crypto.randomUUID()),
    subjectType,
    subjectKey: String(item.subjectKey || ''),
    contactType,
    contactValue,
    documentId: String(item.documentId || ''),
    documentVersion: Number(item.documentVersion || 1),
    status: item.status === 'revoked' ? 'revoked' : item.status === 'declined' ? 'declined' : 'accepted',
    acceptedAt: String(item.acceptedAt || ''),
    revokedAt: String(item.revokedAt || ''),
    source: String(item.source || 'manual'),
    eventAt: String(item.eventAt || item.revokedAt || item.acceptedAt || item.createdAt || ''),
    createdAt: String(item.createdAt || item.eventAt || new Date().toISOString()),
  };
}

function read() {
  return clone(consentState);
}

export function hydrateConsentsFromServer(items = []) {
  consentState = (Array.isArray(items) ? items : []).map(normalize).filter((item) =>
    item.documentId && item.subjectKey
  );
  return getConsents();
}

export function getConsents() {
  return read();
}
