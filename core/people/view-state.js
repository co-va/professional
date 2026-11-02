const SORT_KEY = 'book.people.sort';
const FILTER_KEY = 'book.people.filters';
const DEFAULT_SORT = 'nameAsc';
const SORT_MODES = new Set(['nameAsc', 'nameDesc', 'ueiAsc', 'ueiDesc', 'lastAsc', 'lastDesc']);
const DEFAULT_FILTERS = Object.freeze({
  gender: '',
  birthday: '',
  tag: '',
  tagColor: '',
  noEmail: '',
  noVisits: '',
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
    return { ...DEFAULT_FILTERS, ...(value && typeof value === 'object' ? value : {}) };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

export function setPeopleFilters(value = {}) {
  const next = Object.fromEntries(Object.keys(DEFAULT_FILTERS).map((key) => [key, String(value?.[key] || '')]));
  localStorage.setItem(FILTER_KEY, JSON.stringify(next));
  return next;
}
