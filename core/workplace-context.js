const CONTEXT_PREFIX = 'book:workplace-context';

function contextKey(scope = '') {
  const value = String(scope || '').trim();
  return value ? `${CONTEXT_PREFIX}:${value}` : CONTEXT_PREFIX;
}

function readContext(scope = '') {
  try {
    const value = JSON.parse(localStorage.getItem(contextKey(scope)) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeContext(scope, value) {
  localStorage.setItem(contextKey(scope), JSON.stringify(value || {}));
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getWorkplaceContext(workplaces = [], { scope = '' } = {}) {
  const items = Array.isArray(workplaces) ? workplaces : [];
  const context = readContext(scope);
  const first = items[0]?.key || '';
  const workplaceId = items.some((item) => item.key === context.workplaceId) ? context.workplaceId : first;
  const parsedDate = typeof context.date === 'string' ? new Date(`${context.date}T00:00:00`) : null;
  const date = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : new Date();
  return { workplaceId, date };
}

export function setWorkplaceContext({ workplaceId, date, scope = '' } = {}) {
  const next = { ...readContext(scope) };
  if (workplaceId !== undefined) next.workplaceId = String(workplaceId || '');
  if (date instanceof Date && !Number.isNaN(date.getTime())) next.date = dateKey(date);
  writeContext(scope, next);
  return next;
}
