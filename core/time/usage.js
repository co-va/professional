// Neutral occupancy contract between business owners and Professional time mechanisms.
// Every Record/Event is strict occupied time. There is no soft usage and no silent release.
import { containsRange, isValidRange, timeToMinutes } from './math.js';

let timeUsageSource = () => [];

export function configureTimeUsageSource(source) {
  timeUsageSource = typeof source === 'function' ? source : () => [];
}

export function normalizeTimeUsage(usage = {}) {
  const from = String(usage?.from || '');
  const to = String(usage?.to || '');
  const start = timeToMinutes(from);
  const end = timeToMinutes(to);
  if (start == null || end == null || start === end) return null;
  return {
    ...usage,
    type: String(usage?.type || 'usage'),
    sourceId: String(usage?.sourceId ?? usage?.id ?? ''),
    from,
    to,
  };
}

export function getTimeUsagesForScope(options = {}) {
  const values = timeUsageSource(options);
  return (Array.isArray(values) ? values : []).map(normalizeTimeUsage).filter(Boolean);
}

export function getWorkingTimeUsageConflicts({ operation = 'resize', from, to, ...scope } = {}) {
  const usages = getTimeUsagesForScope(scope);
  if (operation === 'remove') return usages;
  if (!isValidRange(from, to)) return [];
  return usages.filter((usage) => !containsRange(from, to, usage.from, usage.to));
}

export function notifyTimeUsageChanged(detail = {}) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('professional:time-usage-changed', { detail }));
}
