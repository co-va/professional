import { queueOperationalDataset } from '../business-persistence.js';

let bookingSettingsState = null;

export const BOOKING_SLOT_STEPS = Object.freeze([5, 10, 15, 30, 60]);

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


export function normalizeBookingSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const defaults = DEFAULT_BOOKING_SETTINGS;
  return {
    welcomeTitle: String(source.welcomeTitle || defaults.welcomeTitle).trim().slice(0, 90),
    welcomeText: String(source.welcomeText || defaults.welcomeText).trim().slice(0, 500),
    // Active booking remains unchanged until the server and User honor the preferences.
    // Public booking continues to use natural starts.
    slotStep: 0,
    preferredSlotStep: BOOKING_SLOT_STEPS.includes(Number(source.preferredSlotStep))
      ? Number(source.preferredSlotStep) : defaults.preferredSlotStep,
    allowClientCancellation: source.allowClientCancellation === true,
    allowClientRescheduling: source.allowClientRescheduling === true
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
