import { queueOperationalDataset } from '../business-persistence.js';

let bookingSettingsState = null;

export const BOOKING_SLOT_STEPS = Object.freeze([5, 10, 15, 30, 60]);

export const DEFAULT_BOOKING_SETTINGS = Object.freeze({
  welcomeTitle: 'Рады видеть вас',
  welcomeText: 'Выберите удобное время для встречи — запись займёт всего пару минут.',
  slotStep: 0
});


export function normalizeBookingSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const defaults = DEFAULT_BOOKING_SETTINGS;
  return {
    welcomeTitle: String(source.welcomeTitle || defaults.welcomeTitle).trim().slice(0, 90),
    welcomeText: String(source.welcomeText || defaults.welcomeText).trim().slice(0, 500),
    // Step configuration is intentionally inactive for now. Public booking uses
    // natural starts: exact hours plus real occupied-interval end boundaries.
    slotStep: 0
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
    window.dispatchEvent(new CustomEvent('book:booking-settings-changed', { detail: { settings } }));
  }
  return settings;
}
