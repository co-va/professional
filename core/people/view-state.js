const SORT_KEY = 'professional.people.sort';
const FILTER_KEY = 'professional.people.filters';
const DEFAULT_SORT = 'nameAsc';
const SORT_MODES = new Set(['nameAsc', 'nameDesc', 'ueiAsc', 'ueiDesc', 'lastAsc', 'lastDesc']);
const DEFAULT_FILTERS = Object.freeze({
  gender: '',
  birthday: '',
  tag: '',
  procedure: '',
  workplace: '',
  noEmail: '',
  recordPeriod: '',
});

export function getPeopleSortMode() {
  const value = localStorage.getItem(SORT_KEY) || DEFAULT_SORT;
  return SORT_MODES.has(value) ? value : DEFAULT_SORT;
}

export function setPeopleSortMode(value) {
  const mode = SORT_MODES.has(value) ? value : DEFAULT_SORT;
  localStorage.setItem(SORT_KEY, mode);
  return mode;
}

export function getPeopleFilters() {
  try {
    const value = JSON.parse(localStorage.getItem(FILTER_KEY) || '{}');
    const stored = value && typeof value === 'object' ? value : {};
    const result = Object.fromEntries(Object.keys(DEFAULT_FILTERS).map((key) => [key, String(stored[key] || '')]));
    // Migrate saved visit-filter settings without changing the user's active selection.
    if (!result.recordPeriod && stored.noVisits === 'recent') {
      const months = Math.max(1, Math.min(6, Math.floor(Number(stored.visitMonths) || 1)));
      result.recordPeriod = String(months * 30);
    } else if (!result.recordPeriod && stored.noVisits === 'yes') {
      result.recordPeriod = 'none';
    }
    if (result.birthday === 'month') result.birthday = String(new Date().getMonth() + 1);
    return result;
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

export function setPeopleFilters(value = {}) {
  const next = Object.fromEntries(Object.keys(DEFAULT_FILTERS).map((key) => [key, String(value?.[key] || '')]));
  localStorage.setItem(FILTER_KEY, JSON.stringify(next));
  return next;
}
