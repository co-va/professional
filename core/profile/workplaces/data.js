import { apiRequest } from '../../../core/auth.js';
import { normalizePhoneForStorage } from '../../../core/phone/index.js';

const WORKPLACE_FALLBACK_COLOR = '#212529';
let workplacesState = [];
let referenceDataState = { cities: [], currencies: [], defaults: { currency: '', from: '', to: '', timeZone: '' } };
let serverReady = false;

function normalizeLinks(values) {
  return (Array.isArray(values) ? values : [])
    .filter((value) => value && typeof value === 'object' && !Array.isArray(value))
    .map((value) => ({ type: String(value.type || ''), url: String(value.url || '') }));
}

function cropPosition(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : 50;
}

function normalizeReferenceData(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const defaults = source.defaults && typeof source.defaults === 'object' && !Array.isArray(source.defaults) ? source.defaults : {};
  return {
    cities: [...new Set((Array.isArray(source.cities) ? source.cities : []).map((item) => String(item || '').trim()).filter(Boolean))],
    currencies: (Array.isArray(source.currencies) ? source.currencies : [])
      .map((item) => ({
        value: String(item?.value || '').trim(),
        label: String(item?.label || item?.value || '').trim(),
      }))
      .filter((item) => item.value),
    defaults: {
      currency: String(defaults.currency || ''),
      from: String(defaults.from || ''),
      to: String(defaults.to || ''),
      timeZone: String(defaults.timeZone || ''),
    },
  };
}

export function normalizeWorkplace(workplace = {}) {
  const defaults = referenceDataState.defaults;
  return {
    key: String(workplace.key || ''),
    profileId: String(workplace.profileId || 'profile'),
    photo: String(workplace.photo || ''),
    photoCropX: cropPosition(workplace.photoCropX),
    photoCropY: cropPosition(workplace.photoCropY),
    name: String(workplace.name || ''),
    color: String(workplace.color || ''),
    city: String(workplace.city || ''),
    address: String(workplace.address || ''),
    phone: normalizePhoneForStorage(workplace.phone),
    currency: String(workplace.currency || defaults.currency || ''),
    timeZone: String(workplace.timeZone || defaults.timeZone || ''),
    from: String(workplace.from || defaults.from || ''),
    to: String(workplace.to || defaults.to || ''),
    links: normalizeLinks(workplace.links),
    about: String(workplace.about || ''),
    cardAppearance: workplace.cardAppearance && typeof workplace.cardAppearance === 'object' && !Array.isArray(workplace.cardAppearance) ? workplace.cardAppearance : {},
    visibleInPublicBooking: workplace.visibleInPublicBooking !== false,
    createdAt: String(workplace.createdAt || ''),
    updatedAt: String(workplace.updatedAt || ''),
  };
}

function withPresentationFallback(workplace) {
  return { ...workplace, indicatorColor: workplace.color || WORKPLACE_FALLBACK_COLOR };
}

function requireServerReady() {
  if (!serverReady) throw new Error('Данные профиля ещё загружаются. Повторите через несколько секунд.');
}

function notifyWorkplacesChanged(detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('book:workplaces-changed', { detail }));
  window.dispatchEvent(new CustomEvent('book:time-usage-changed', { detail }));
}

async function responseJson(response, fallbackMessage) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || fallbackMessage);
  return payload;
}

export function hydrateWorkplacesFromServer(values = [], referenceData = null) {
  if (referenceData && typeof referenceData === 'object' && !Array.isArray(referenceData)) {
    referenceDataState = normalizeReferenceData(referenceData);
  }
  workplacesState = (Array.isArray(values) ? values : []).map(normalizeWorkplace);
  return getWorkplaces();
}

export function getWorkplaceReferenceData() {
  return normalizeReferenceData(referenceDataState);
}

export function setWorkplacesServerReady(value) {
  serverReady = Boolean(value);
}

export function isWorkplacesServerReady() {
  return serverReady;
}

export function getWorkplaces() {
  return workplacesState.map((value) => withPresentationFallback(normalizeWorkplace(value)));
}

export async function saveWorkplaces(values) {
  requireServerReady();
  const next = (Array.isArray(values) ? values : []).map(normalizeWorkplace);
  const currentKeys = new Set(workplacesState.map((value) => value.key));
  const nextKeys = new Set(next.map((value) => value.key));

  for (const key of currentKeys) {
    if (nextKeys.has(key)) continue;
    const response = await apiRequest(`/profile/workplaces/${encodeURIComponent(key)}`, { method: 'DELETE' });
    const payload = await responseJson(response, 'Не удалось удалить рабочее пространство');
    hydrateWorkplacesFromServer(payload.workplaces, payload.workplaceReferenceData);
  }
  for (const workplace of next) {
    const response = await apiRequest(`/profile/workplaces/${encodeURIComponent(workplace.key)}`, {
      method: 'PUT',
      body: JSON.stringify(workplace),
    });
    const payload = await responseJson(response, 'Не удалось сохранить рабочее пространство');
    hydrateWorkplacesFromServer(payload.workplaces, payload.workplaceReferenceData);
  }
  notifyWorkplacesChanged({ action: 'workplaces-saved' });
  return getWorkplaces();
}

export async function reorderWorkplaces(keys) {
  requireServerReady();
  const orderedKeys = [...new Set((Array.isArray(keys) ? keys : []).map((value) => String(value || '')).filter(Boolean))];
  if (orderedKeys.length !== workplacesState.length) throw new Error('Некорректный порядок рабочих пространств');
  const response = await apiRequest('/profile/workplaces-order', {
    method: 'PUT',
    body: JSON.stringify({ keys: orderedKeys }),
  });
  const payload = await responseJson(response, 'Не удалось сохранить порядок рабочих пространств');
  hydrateWorkplacesFromServer(payload.workplaces, payload.workplaceReferenceData);
  notifyWorkplacesChanged({ action: 'workplaces-reordered' });
  return getWorkplaces();
}

export async function upsertWorkplace(workplace) {
  requireServerReady();
  const item = normalizeWorkplace(workplace);
  if (!item.key) throw new Error('Не удалось определить рабочее пространство');
  const response = await apiRequest(`/profile/workplaces/${encodeURIComponent(item.key)}`, {
    method: 'PUT',
    body: JSON.stringify(item),
  });
  const payload = await responseJson(response, 'Не удалось сохранить рабочее пространство');
  hydrateWorkplacesFromServer(payload.workplaces, payload.workplaceReferenceData);
  notifyWorkplacesChanged({ action: 'workplace-saved', workplaceId: item.key });
  return getWorkplaces().find((value) => value.key === item.key) || null;
}

export async function deleteWorkplace(key) {
  requireServerReady();
  const target = String(key || '');
  if (!target) return false;
  const response = await apiRequest(`/profile/workplaces/${encodeURIComponent(target)}`, { method: 'DELETE' });
  if (response.status === 404) return false;
  const payload = await responseJson(response, 'Не удалось удалить рабочее пространство');
  hydrateWorkplacesFromServer(payload.workplaces, payload.workplaceReferenceData);
  notifyWorkplacesChanged({ action: 'workplace-deleted', workplaceId: target });
  return true;
}
