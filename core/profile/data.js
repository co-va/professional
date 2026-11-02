import { apiRequest } from '../../core/auth.js';
import { normalizePhoneForStorage } from '../../core/phone/index.js';

let profileState = null;
let customProfessionsState = [];
let professionCatalogState = [];
let serverReady = false;

function normalizeList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function normalizePhones(values) {
  return [...new Set(normalizeList(values).map((value) => normalizePhoneForStorage(value)).filter(Boolean))];
}

function cropPosition(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : 50;
}

export function normalizeProfile(profile = {}) {
  const phones = normalizePhones(profile.phones?.length ? profile.phones : [profile.phone]);
  const professionValue = String(profile.profession || '').trim();
  const profession = professionValue.toLocaleLowerCase('ru-RU') === 'другая' ? '' : professionValue;
  return {
    id: String(profile.id || ''),
    platformAccountId: String(profile.platformAccountId || ''),
    key: String(profile.key || 'profile'),
    name: String(profile.name || ''),
    surname: String(profile.surname || ''),
    phone: phones[0] || '',
    phones,
    telegrams: normalizeList(profile.telegrams),
    emails: normalizeList(profile.emails),
    about: String(profile.about || ''),
    photo: String(profile.photo || ''),
    photoCropX: cropPosition(profile.photoCropX),
    photoCropY: cropPosition(profile.photoCropY),
    profession,
    experience: String(profile.experience || ''),
    professionAbout: String(profile.professionAbout || ''),
    cardAppearance: profile.cardAppearance && typeof profile.cardAppearance === 'object' && !Array.isArray(profile.cardAppearance) ? profile.cardAppearance : {},
  };
}

function normalizeCustomProfessions(values) {
  return [...new Set(normalizeList(values))];
}

function normalizeProfessionCatalog(values) {
  const byKey = new Map();
  for (const value of normalizeList(values)) {
    const key = value.toLocaleLowerCase('ru-RU');
    if (!byKey.has(key)) byKey.set(key, value);
  }
  return [...byKey.values()];
}

async function responseJson(response, fallbackMessage) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || fallbackMessage);
  return payload;
}

function requireServerReady() {
  if (!serverReady) throw new Error('Данные профиля ещё загружаются. Повторите через несколько секунд.');
}

function notifyProfileChanged(detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('book:profile-changed', { detail }));
}

export function hydrateProfileFromServer(profile = {}, customProfessions = [], professionCatalog = []) {
  profileState = normalizeProfile(profile);
  customProfessionsState = normalizeCustomProfessions(customProfessions);
  professionCatalogState = normalizeProfessionCatalog(professionCatalog);
  return profileState;
}

export function setProfileServerReady(value) {
  serverReady = Boolean(value);
}

export function isProfileServerReady() {
  return serverReady;
}

export function getProfile() {
  return normalizeProfile(profileState || {});
}

export async function saveProfile(profile) {
  requireServerReady();
  const normalized = normalizeProfile(profile);
  const response = await apiRequest('/profile', {
    method: 'PUT',
    body: JSON.stringify({ profile: normalized, customProfessions: customProfessionsState }),
  });
  const payload = await responseJson(response, 'Не удалось сохранить профиль');
  hydrateProfileFromServer(payload.profile, payload.customProfessions, payload.professionCatalog);
  notifyProfileChanged({ action: 'profile-saved' });
  return getProfile();
}

export function getCustomProfessions() {
  return [...customProfessionsState];
}

export function getProfessionCatalog() {
  return [...professionCatalogState];
}
