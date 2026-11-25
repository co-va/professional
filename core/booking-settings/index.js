import { queueOperationalDataset, isBusinessServerReady, flushBusinessPersistence } from '../business-persistence.js';
import { apiRequest } from '../auth.js';

let bookingSettingsState = null;

export const BOOKING_SLOT_STEPS = Object.freeze([0, 15, 30]);

function normalizePreferredStep(value, fallback = 15) {
  if (value === null || value === undefined || value === '') return fallback;
  const step = Number(value);
  if (BOOKING_SLOT_STEPS.includes(step)) return step;
  if (step === 60) return 0;
  if (step === 5 || step === 10) return 15;
  return fallback;
}

export const DEFAULT_BOOKING_SETTINGS = Object.freeze({
  welcomeTitle: 'Рады видеть вас',
  welcomeText: 'Выберите удобное время для встречи — запись займёт всего пару минут.',
  slotStep: 0,
  // Saved preferences for the upcoming shared booking-rules workflow.
  // Do not activate booking time-step or client actions until User/API enforce them.
  preferredSlotStep: 15,
  allowClientCancellation: false,
  allowClientRescheduling: false
});


export function normalizeWorkplaceBookingRules(value = {}, fallback = DEFAULT_BOOKING_SETTINGS) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    preferredSlotStep: normalizePreferredStep(source.preferredSlotStep,normalizePreferredStep(fallback.preferredSlotStep)),
    allowClientCancellation: typeof source.allowClientCancellation === 'boolean' ? source.allowClientCancellation : fallback.allowClientCancellation === true,
    allowClientRescheduling: typeof source.allowClientRescheduling === 'boolean' ? source.allowClientRescheduling : fallback.allowClientRescheduling === true,
  };
}

export function normalizeBookingSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const defaults = DEFAULT_BOOKING_SETTINGS;
  return {
    welcomeTitle: String(source.welcomeTitle || defaults.welcomeTitle).trim().slice(0, 90),
    welcomeText: String(source.welcomeText || defaults.welcomeText).trim().slice(0, 500),
    // Active booking remains unchanged until the server and User honor the preferences.
    // Public booking continues to use natural starts.
    slotStep: 0,
    preferredSlotStep: normalizePreferredStep(source.preferredSlotStep,defaults.preferredSlotStep),
    allowClientCancellation: source.allowClientCancellation === true,
    allowClientRescheduling: source.allowClientRescheduling === true,
    // Keep the same server-owned operational dataset; no local shadow store.
    workplaceRules: Object.fromEntries(Object.entries(source.workplaceRules && typeof source.workplaceRules === 'object' && !Array.isArray(source.workplaceRules) ? source.workplaceRules : {})
      .filter(([key,rules])=>key && rules && typeof rules==='object' && !Array.isArray(rules))
      .map(([key,rules])=>[key,normalizeWorkplaceBookingRules(rules)])),
  };
}

export function hydrateBookingSettingsFromServer(value = null) {
  bookingSettingsState = normalizeBookingSettings(value || {});
  return getBookingSettings();
}

export function getBookingSettings() {
  return normalizeBookingSettings(bookingSettingsState || {});
}

export function saveBookingSettings(value = {}) {
  const settings = normalizeBookingSettings(value);
  bookingSettingsState = settings;
  void queueOperationalDataset('bookingSettings', settings);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('professional:booking-settings-changed', { detail: { settings } }));
  }
  return settings;
}

export function getWorkplaceBookingRules(workplaceId, settings = getBookingSettings()) {
  const key = String(workplaceId || '');
  const fallback = normalizeWorkplaceBookingRules(settings);
  return normalizeWorkplaceBookingRules(Object.hasOwn(settings.workplaceRules || {},key) ? settings.workplaceRules[key] : {},fallback);
}

export async function saveWorkplaceBookingRules(workplaceId, rules) {
  const key = String(workplaceId || '');
  if(!key || !isBusinessServerReady()) throw Error('Рабочие данные ещё не готовы к сохранению.');
  // Flush older welcome/rules mutations, then merge into the current server value.
  await flushBusinessPersistence();
  const response = await apiRequest('/business-state/operational');
  const remote = await response.json().catch(()=>null);
  if(!response.ok || !remote || !Array.isArray(remote.procedures)) throw Error(remote?.message || 'Не удалось загрузить правила онлайн-записи.');
  const current = normalizeBookingSettings(remote.bookingSettings || {});
  const next = {...current,workplaceRules:{...current.workplaceRules,[key]:normalizeWorkplaceBookingRules(rules)}};
  const result = await queueOperationalDataset('bookingSettings',next);
  if(!result || result.ok===false || !result.bookingSettings) throw result?.error || Error('Сервер не подтвердил сохранение правил.');
  const confirmed = normalizeBookingSettings(result.bookingSettings);
  if(JSON.stringify(confirmed.workplaceRules[key])!==JSON.stringify(next.workplaceRules[key])) throw Error('Сервер не подтвердил правила рабочего пространства.');
  hydrateBookingSettingsFromServer(confirmed);
  if(typeof window!=='undefined') window.dispatchEvent(new CustomEvent('professional:booking-settings-changed',{detail:{settings:confirmed}}));
  return getWorkplaceBookingRules(key,confirmed);
}
