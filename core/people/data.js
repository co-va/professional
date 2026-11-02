import { normalizePhoneForStorage, phonesMatch } from '../phone/index.js';
import { getMembers, getUEI } from '../uei.js';
import { queuePersonDelete, queuePersonUpsert } from '../business-persistence.js';
import { getTags } from '../../settings/tags/data.js';
import { getPersonDepositPriceConditions } from '../loyalty/deposit/data.js';
import { describePriceConditionConflict, resolvePersonPriceCondition } from '../loyalty/price-condition.js';

let peopleState = [];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeTagAssignments(values = []) {
  const catalog = getTags();
  const ids = new Set(catalog.map((tag) => tag.id));
  const byName = new Map(catalog.map((tag) => [tag.name, tag.id]));
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => ids.has(value) ? value : (byName.get(value) || String(value || '').trim()))
    .filter(Boolean))];
}

function normalizeDiscount(person = {}) {
  const raw = person.discountPercent ?? person.discount ?? 0;
  const value = Number(String(raw ?? '').replace(',', '.'));
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function normalizePhones(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizePhoneForStorage(value))
    .filter(Boolean))];
}

function normalizeStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

export function normalizePerson(person = {}) {
  return {
    key: String(person.key || ''),
    id: String(person.id || ''),
    name: String(person.name || ''),
    surname: String(person.surname || ''),
    photo: String(person.photo || ''),
    gender: String(person.gender || ''),
    birthDate: String(person.birthDate || ''),
    phones: normalizePhones(person.phones),
    telegrams: Array.isArray(person.telegrams) ? person.telegrams : [],
    emails: normalizeStrings(person.emails),
    accounts: normalizeStrings(person.accounts),
    identityReview: person.identityReview && typeof person.identityReview === 'object' && !Array.isArray(person.identityReview)
      ? clone(person.identityReview)
      : null,
    links: Array.isArray(person.links) ? person.links : [],
    tags: normalizeTagAssignments(person.tags),
    discountPercent: normalizeDiscount(person),
    visits: Number(person.visits || 0),
    totalSpent: Number(person.totalSpent || 0),
    lastVisit: String(person.lastVisit || ''),
    programs: Array.isArray(person.programs) ? person.programs : [],
    createdAt: String(person.createdAt || ''),
  };
}

export function hydratePeopleFromServer(people = []) {
  peopleState = (Array.isArray(people) ? people : []).map(normalizePerson).filter((person) => person.key);
  return clone(peopleState);
}

export function getAllPeople() {
  const stored = clone(peopleState).map(normalizePerson).filter((person) => person.key);
  return stored.map((person) => ({
    ...person,
    uei: getUEI('person', person.key) || '',
  }));
}

export function getPeople() {
  const people = getAllPeople();
  const linkedSecondary = new Set();

  for (const person of people) {
    if (!person.uei) continue;
    const members = getMembers(person.uei);
    members.slice(1).forEach((member) => {
      linkedSecondary.add(member.startsWith('person:') ? member.slice(7) : member);
    });
  }

  return people.filter((person) => !linkedSecondary.has(person.key));
}

function personKeyFromUEIMember(member) {
  const value = String(member || '');
  if (value.startsWith('person:')) return value.slice(7);
  if (!value.includes(':')) return value;
  return '';
}

function identityKeysForUEI(uei, people = []) {
  if (!uei) return [];
  const known = new Set(people.map((person) => person.key));
  return [...new Set(getMembers(uei)
    .map(personKeyFromUEIMember)
    .filter((key) => key && known.has(key)))];
}

export function getIdentityMemberKeys(key) {
  const target = String(key || '').trim();
  if (!target) return [];
  const people = getAllPeople();
  const person = people.find((item) => item.key === target);
  if (!person) return [target];
  if (!person.uei) return [target];
  const keys = identityKeysForUEI(person.uei, people);
  return keys.length ? keys : [target];
}

export function getIdentityPeople(key) {
  const keys = new Set(getIdentityMemberKeys(key));
  if (!keys.size) return [];
  return getAllPeople().filter((person) => keys.has(person.key));
}

export function getIdentityOwner(key) {
  return getIdentityPeople(key)[0] || null;
}

export function findIdentityOwnerByAccountId(accountId) {
  const person = findPersonByAccountId(accountId);
  return person ? (getIdentityOwner(person.key) || person) : null;
}

export function findPeopleByPhone(phone) {
  const target = String(phone || '').trim();
  if (!target) return [];
  return getAllPeople().filter((person) => (person.phones || []).some((value) => phonesMatch(value, target)));
}

export function findPersonByAccountId(accountId) {
  const id = String(accountId || '').trim();
  if (!id) return null;
  return getAllPeople().find((person) => (person.accounts || []).includes(id)) || null;
}

export function getPeopleCount() {
  return getPeople().length;
}

function assertPersonalPricePercentAvailable(person = null, previous = null) {
  const percent = normalizeDiscount(person || {});
  if (percent <= 0) return;
  const previousPercent = normalizeDiscount(previous || {});
  if (previous && previousPercent === percent) return;
  const programSources = getPersonDepositPriceConditions(person?.key);
  const condition = resolvePersonPriceCondition(person, programSources);
  if (condition.conflict) {
    throw new Error(`Процентная скидка задваивается: ${describePriceConditionConflict(condition)}. Уберите скидку программы или оставьте личную скидку 0%.`);
  }
}

export function savePeople(people = []) {
  const normalized = (Array.isArray(people) ? people : []).map(normalizePerson).filter((person) => person.key);
  const previous = peopleState;
  const previousByKey = new Map(previous.map((person, position) => [person.key, { person, position }]));
  const nextByKey = new Map(normalized.map((person, position) => [person.key, { person, position }]));

  for (const [key, next] of nextByKey) {
    assertPersonalPricePercentAvailable(next.person, previousByKey.get(key)?.person || null);
  }

  peopleState = clone(normalized);

  for (const [key] of previousByKey) {
    if (!nextByKey.has(key)) void queuePersonDelete(key);
  }
  for (const [key, next] of nextByKey) {
    const before = previousByKey.get(key);
    if (!before || before.position !== next.position || JSON.stringify(before.person) !== JSON.stringify(next.person)) {
      void queuePersonUpsert(next.person, next.position);
    }
  }
}

export function createPerson(name, surname, phone = '') {
  const normalizedPhone = normalizePhoneForStorage(phone);
  return normalizePerson({
    key: crypto.randomUUID(),
    name,
    surname,
    phones: normalizedPhone ? [normalizedPhone] : [],
    createdAt: new Date().toISOString(),
  });
}

export function upsertPersonFromAccount(account = {}) {
  const accountId = String(account.id || '').trim();
  if (!accountId) return null;
  const people = getAllPeople();
  const existingIndex = people.findIndex((person) => (person.accounts || []).includes(accountId));
  const previous = existingIndex >= 0 ? people[existingIndex] : null;
  const phone = normalizePhoneForStorage(account.phone);
  const telegramId = String(account.telegramId || '').trim();
  const email = String(account.email || '').trim().toLowerCase();
  const profileData = account.profileData && typeof account.profileData === 'object' ? account.profileData : {};
  const incomingGender = String(profileData.gender || '').trim();
  const incomingBirthDate = String(profileData.birthDate || '').trim();
  const person = normalizePerson({
    ...(previous || {}),
    key: previous?.key || `account-${accountId}`,
    name: String(account.name || previous?.name || ''),
    surname: String(account.surname || previous?.surname || ''),
    photo: String(profileData.photo || ''),
    gender: incomingGender || previous?.gender || '',
    birthDate: incomingBirthDate || previous?.birthDate || '',
    phones: phone ? [...(previous?.phones || []), phone] : previous?.phones || [],
    telegrams: telegramId ? [...(previous?.telegrams || []), telegramId] : previous?.telegrams || [],
    emails: email ? [...(previous?.emails || []), email] : previous?.emails || [],
    accounts: [...(previous?.accounts || []), accountId],
    programs: previous?.programs || [],
    createdAt: previous?.createdAt || new Date().toISOString(),
  });
  if (existingIndex >= 0) people[existingIndex] = person;
  else people.push(person);
  savePeople(people);
  return getAllPeople().find((item) => item.key === person.key) || person;
}
