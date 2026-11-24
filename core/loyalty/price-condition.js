function numberValue(value) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
}

export function clampPricePercent(value) {
  return Math.max(0, Math.min(100, numberValue(value)));
}

export function personalPricePercentSource(person = null) {
  const percent = clampPricePercent(person?.discountPercent);
  if (percent <= 0) return null;
  return {
    type: 'personal',
    id: 'personal',
    name: 'Личные условия',
    percent,
  };
}

function normalizeSource(source = null) {
  if (!source || typeof source !== 'object') return null;
  const percent = clampPricePercent(source.percent);
  if (percent <= 0) return null;
  return {
    ...source,
    type: String(source.type || 'program').trim() || 'program',
    name: String(source.name || 'Программа').trim() || 'Программа',
    percent,
  };
}

export function resolvePriceConditionSources(sources = []) {
  const normalized = (Array.isArray(sources) ? sources : [])
    .map(normalizeSource)
    .filter(Boolean);
  const conflict = normalized.length > 1;
  const source = normalized.length === 1 ? normalized[0] : null;
  return {
    percent: source ? source.percent : 0,
    source: source ? { ...source } : null,
    sources: normalized.map((item) => ({ ...item })),
    conflict,
  };
}

export function resolvePersonPriceCondition(person = null, programSources = []) {
  const sources = [];
  const personal = personalPricePercentSource(person);
  if (personal) sources.push(personal);
  if (Array.isArray(programSources)) sources.push(...programSources);
  return resolvePriceConditionSources(sources);
}

export function describePriceConditionConflict(condition = null) {
  const sources = Array.isArray(condition?.sources) ? condition.sources : [];
  return sources
    .map((source) => `${String(source?.name || 'Условие').trim()} — ${clampPricePercent(source?.percent)}%`)
    .join('; ');
}
