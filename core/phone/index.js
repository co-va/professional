const COUNTRY_DEFINITIONS = Object.freeze([
  { iso: 'RU', name: 'Россия', dialCode: '7', minLength: 10, maxLength: 10, trunkPrefixes: ['8'] },
  { iso: 'KZ', name: 'Казахстан', dialCode: '7', minLength: 10, maxLength: 10, trunkPrefixes: ['8'] },
  { iso: 'BY', name: 'Беларусь', dialCode: '375', minLength: 9, maxLength: 9, trunkPrefixes: ['0'] },
  { iso: 'AM', name: 'Армения', dialCode: '374', minLength: 8, maxLength: 8, trunkPrefixes: ['0'] },
  { iso: 'AZ', name: 'Азербайджан', dialCode: '994', minLength: 9, maxLength: 9, trunkPrefixes: ['0'] },
  { iso: 'GE', name: 'Грузия', dialCode: '995', minLength: 9, maxLength: 9, trunkPrefixes: ['0'] },
  { iso: 'KG', name: 'Кыргызстан', dialCode: '996', minLength: 9, maxLength: 9, trunkPrefixes: ['0'] },
  { iso: 'UZ', name: 'Узбекистан', dialCode: '998', minLength: 9, maxLength: 9, trunkPrefixes: ['0'] },
  { iso: 'UA', name: 'Украина', dialCode: '380', minLength: 9, maxLength: 9, trunkPrefixes: ['0'] },
  { iso: 'MD', name: 'Молдова', dialCode: '373', minLength: 8, maxLength: 8, trunkPrefixes: ['0'] },
  { iso: 'US', name: 'США', dialCode: '1', minLength: 10, maxLength: 10, trunkPrefixes: [] },
  { iso: 'CA', name: 'Канада', dialCode: '1', minLength: 10, maxLength: 10, trunkPrefixes: [] },
  { iso: 'DE', name: 'Германия', dialCode: '49', minLength: 10, maxLength: 11, trunkPrefixes: ['0'] },
  { iso: 'GB', name: 'Великобритания', dialCode: '44', minLength: 10, maxLength: 10, trunkPrefixes: ['0'] },
  { iso: 'FR', name: 'Франция', dialCode: '33', minLength: 9, maxLength: 9, trunkPrefixes: ['0'] },
  { iso: 'IT', name: 'Италия', dialCode: '39', minLength: 9, maxLength: 10, trunkPrefixes: [] },
  { iso: 'ES', name: 'Испания', dialCode: '34', minLength: 9, maxLength: 9, trunkPrefixes: [] },
  { iso: 'TR', name: 'Турция', dialCode: '90', minLength: 10, maxLength: 10, trunkPrefixes: ['0'] },
  { iso: 'IL', name: 'Израиль', dialCode: '972', minLength: 9, maxLength: 9, trunkPrefixes: ['0'] },
  { iso: 'AE', name: 'ОАЭ', dialCode: '971', minLength: 9, maxLength: 9, trunkPrefixes: ['0'] },
]);

export const DEFAULT_PHONE_COUNTRY = 'RU';

function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

export function getPhoneCountries() {
  return COUNTRY_DEFINITIONS.map((country) => ({ ...country, trunkPrefixes: [...country.trunkPrefixes] }));
}

export function getPhoneCountry(iso = DEFAULT_PHONE_COUNTRY) {
  return COUNTRY_DEFINITIONS.find((country) => country.iso === String(iso || '').toUpperCase())
    || COUNTRY_DEFINITIONS[0];
}

export function phoneCountryOptions() {
  return COUNTRY_DEFINITIONS.map((country) => ({
    value: country.iso,
    label: `${country.name} +${country.dialCode}`,
  }));
}

function plusSevenCountry(nationalDigits, preferredIso = '') {
  if (preferredIso === 'KZ' || preferredIso === 'RU') return getPhoneCountry(preferredIso);
  return /^[67]/.test(nationalDigits) ? getPhoneCountry('KZ') : getPhoneCountry('RU');
}

function internationalCountry(digits, preferredIso = '') {
  const candidates = COUNTRY_DEFINITIONS
    .filter((country) => digits.startsWith(country.dialCode))
    .sort((a, b) => b.dialCode.length - a.dialCode.length);
  if (!candidates.length) return null;

  const longest = candidates[0].dialCode.length;
  const sameCode = candidates.filter((country) => country.dialCode.length === longest);
  const preferred = sameCode.find((country) => country.iso === preferredIso);
  if (preferred) return preferred;

  if (sameCode[0]?.dialCode === '7') {
    const national = digits.slice(1);
    return plusSevenCountry(national, preferredIso);
  }

  return sameCode[0];
}

function stripKnownPrefix(digits, country) {
  if (digits.length <= country.maxLength) return digits;

  if (digits.startsWith(country.dialCode)) {
    return digits.slice(country.dialCode.length);
  }

  for (const prefix of country.trunkPrefixes) {
    if (digits.startsWith(prefix)) return digits.slice(prefix.length);
  }

  return digits;
}

function groupByPattern(digits, pattern) {
  const groups = [];
  let offset = 0;
  for (const size of pattern) {
    if (offset >= digits.length) break;
    groups.push(digits.slice(offset, offset + size));
    offset += size;
  }
  if (offset < digits.length) groups.push(digits.slice(offset));
  return groups.filter(Boolean).join(' ');
}

export function formatNationalPhone(value, countryIso = DEFAULT_PHONE_COUNTRY) {
  const country = getPhoneCountry(countryIso);
  const digits = digitsOnly(value).slice(0, country.maxLength);
  if (!digits) return '';
  if (country.iso === 'RU' || country.iso === 'KZ') {
    const first = digits.slice(0, 3);
    const second = digits.slice(3, 6);
    const third = digits.slice(6, 8);
    const fourth = digits.slice(8, 10);
    return [first, second, third, fourth].filter(Boolean).join(' ')
      .replace(/(\d{3}) (\d{3}) (\d{2}) (\d{2})$/, '$1 $2-$3-$4');
  }
  if (country.iso === 'US' || country.iso === 'CA') return groupByPattern(digits, [3, 3, 4]);
  return groupByPattern(digits, [3, 3, 3, 3]);
}

export function phoneInputState(rawValue = '', countryIso = DEFAULT_PHONE_COUNTRY) {
  const text = String(rawValue ?? '').trim();
  let country = getPhoneCountry(countryIso);
  let digits = digitsOnly(text);

  if (text.startsWith('+') && digits) {
    const detected = internationalCountry(digits, country.iso);
    if (detected) {
      country = detected;
      digits = digits.slice(country.dialCode.length);
    }
  } else {
    digits = stripKnownPrefix(digits, country);
  }

  digits = digits.slice(0, country.maxLength);
  const complete = digits.length >= country.minLength && digits.length <= country.maxLength;
  const canonical = complete ? `+${country.dialCode}${digits}` : '';

  return {
    countryIso: country.iso,
    dialCode: `+${country.dialCode}`,
    national: digits,
    displayNational: formatNationalPhone(digits, country.iso),
    canonical,
    complete,
    minLength: country.minLength,
    maxLength: country.maxLength,
  };
}

export function normalizePhone(value, { countryIso = DEFAULT_PHONE_COUNTRY } = {}) {
  return phoneInputState(value, countryIso).canonical;
}

export function normalizePhoneForStorage(value, { countryIso = DEFAULT_PHONE_COUNTRY } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return normalizePhone(text, { countryIso }) || text;
}

export function formatPhone(value, { countryIso = DEFAULT_PHONE_COUNTRY } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const state = phoneInputState(text, countryIso);
  if (!state.complete) return text;
  return `${state.dialCode} ${state.displayNational}`;
}

export function phonesMatch(left, right) {
  const a = normalizePhone(left);
  const b = normalizePhone(right);
  return Boolean(a && b && a === b);
}
