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

function personIdentityMembers(person, people) {
  const all = Array.isArray(people) ? people : [];
  if (!person?.uei) return [person];
  const members = all.filter((item) => item.uei === person.uei);
  return members.length ? members : [person];
}

function personConsentFactMatches(person, fact, people) {
  const members = personIdentityMembers(person, people);
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

function currentConsentFacts(person, documentId, people) {
  const relevant = getConsents().filter((fact) => fact.documentId === documentId && personConsentFactMatches(person, fact, people));
  const latestBySubject = new Map();
  for (const fact of relevant) {
    const key = `${fact.subjectType}:${fact.subjectKey}:${fact.documentId}`;
    const previous = latestBySubject.get(key);
    if (!previous || consentEventTime(fact) > consentEventTime(previous)) latestBySubject.set(key, fact);
  }
  return [...latestBySubject.values()];
}

export function getPersonConsentState(person, documentItem, people = []) {
  // An earlier document version remains in the audit, but is NOT an active signature.
  const version = Math.max(1, Number(documentItem?.version || 1));
  const facts = currentConsentFacts(person, documentItem?.id, people);
  const current = facts
    .filter((fact) => Number(fact.documentVersion) === version)
    .sort((a, b) => consentEventTime(b) - consentEventTime(a));
  const accepted = current.find((fact) => fact.status === 'accepted') || null;
  return { active: Boolean(accepted), fact: accepted };
}

export function getPersonConsentDocumentIds(person, people = []) {
  return [...new Set(getConsents()
    .filter(fact => personConsentFactMatches(person, fact, people))
    .map(fact => String(fact.documentId || ''))
    .filter(Boolean))];
}
