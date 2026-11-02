import { apiRequest } from '../auth.js';
import { escapeHtml, modal, mountModal } from '../../ui/ui.js';
import { getServiceUnseenState, publishServiceUnseen } from './app-badge.js';

const SERVICE_UNSEEN_ROLLOUT_AT = Date.parse('2026-10-29T17:20:31.000Z');
const REFRESH_INTERVAL_MS = 15_000;
let refreshBusy = false;
let refreshQueued = false;
let initialized = false;

function text(value) {
  return String(value ?? '').trim();
}

function normalizedServiceType(value) {
  return text(value).toLowerCase().replaceAll('_', '.');
}

function isProfessionalJournalMounted() {
  return Boolean(document.querySelector('[data-journal-context="professional"]'));
}

function afterRollout(value) {
  const stamp = Date.parse(String(value || ''));
  return Number.isFinite(stamp) && stamp >= SERVICE_UNSEEN_ROLLOUT_AT;
}

function recordIds(value) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map((item) => text(item)).filter(Boolean))];
}

function normalizeProfessionalItems(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((item) => !item?.readAt)
    .filter((item) => normalizedServiceType(item?.type) === 'booking.created')
    .filter((item) => afterRollout(item?.createdAt))
    .map((item) => {
      const metadata = item?.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata) ? item.metadata : {};
      const ids = recordIds(Array.isArray(metadata.recordIds) ? metadata.recordIds : [metadata.recordId, metadata.entityId]);
      return {
        id: text(item?.id),
        tenantId: text(metadata.tenantId),
        type: 'booking.created',
        entityType: 'record',
        entityId: ids[0] || '',
        recordIds: ids,
        date: text(metadata.date).slice(0, 10),
        createdAt: item?.createdAt || '',
        owner: 'professional',
      };
    })
    .filter((item) => item.id && item.recordIds.length);
}

function professionalDeletedItems(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((item) => !item?.readAt)
    .filter((item) => normalizedServiceType(item?.type) === 'booking.deleted')
    .filter((item) => afterRollout(item?.createdAt))
    .sort((a, b) => Date.parse(b?.createdAt || 0) - Date.parse(a?.createdAt || 0));
}

async function professionalRequest(path, options = {}) {
  const response = await apiRequest(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || 'Не удалось обновить сервисные уведомления');
  return payload;
}

async function loadState() {
  const rows = await professionalRequest('/notifications/service-notices');
  return { items: normalizeProfessionalItems(rows), professionalRows: Array.isArray(rows) ? rows : [] };
}

async function markProfessionalNoticeSeen(id) {
  return professionalRequest(`/notifications/service-notices/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

function unseenRecordIds() {
  return new Set(getServiceUnseenState().items.flatMap((item) => recordIds(item?.recordIds)));
}

function professionalListButton() {
  if (!isProfessionalJournalMounted()) return null;
  return document.querySelector('[data-view-navigation] [data-view="list"]');
}

function syncProfessionalListBadge() {
  if (typeof document === 'undefined') return;
  const state = getServiceUnseenState();
  const button = professionalListButton();
  const label = ` 🔴 ${state.total}`;

  document.querySelectorAll('[data-service-unseen-marker]:not([data-service-unseen-list-badge])').forEach((marker) => marker.remove());
  document.querySelectorAll('[data-service-unseen-list-badge]').forEach((marker) => {
    if (!button || state.total <= 0 || marker.parentElement !== button) marker.remove();
  });

  if (!button || state.total <= 0) return;
  const existing = button.querySelector('[data-service-unseen-list-badge]');
  if (existing) {
    if (existing.textContent !== label) existing.textContent = label;
    return;
  }
  const marker = document.createElement('small');
  marker.dataset.serviceUnseenMarker = 'true';
  marker.dataset.serviceUnseenListBadge = 'true';
  marker.textContent = label;
  button.append(marker);
}

function removeSeenLocally(ids) {
  const seen = new Set(recordIds(ids));
  const current = getServiceUnseenState().items;
  const remaining = current.filter((item) => !item.recordIds.some((id) => seen.has(id)));
  publishServiceUnseen(remaining);
  syncProfessionalListBadge();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('va-tools:service-unseen', { detail: { total: remaining.length, items: remaining } }));
  }
}

async function markRecordsSeen(ids) {
  const values = recordIds(ids);
  if (!values.length) return;
  const items = getServiceUnseenState().items.filter((item) => item.recordIds.some((id) => values.includes(id)));
  if (!items.length) return;
  try {
    await Promise.allSettled(items.map((item) => markProfessionalNoticeSeen(item.id)));
    removeSeenLocally(values);
  } catch {
    // Keep the indicator visible for the next retry.
  }
}

async function showDeletedNotice(rows) {
  if (typeof document === 'undefined') return;
  if (!document.querySelector('[data-v2-app]') || document.querySelector('[data-service-deleted-modal]')) return;
  const item = professionalDeletedItems(rows)[0];
  if (!item) return;
  if (document.querySelector('[data-platform-notice-modal],[data-platform-push-setup-modal]')) return;

  const layer = mountModal(document.body, modal(`<div class="modal-title"><h2>${escapeHtml(item.title || 'Запись удалена')}</h2><p>${escapeHtml(item.body || '')}</p></div>`, {
    title: item.title || 'Запись удалена',
    variant: 's',
    surface: 'app',
  }));
  if (!layer) return;
  layer.dataset.serviceDeletedModal = text(item.id);

  try {
    await markProfessionalNoticeSeen(item.id);
  } catch {
    layer.remove();
    return;
  }

  const observer = new MutationObserver(() => {
    if (layer.isConnected) return;
    observer.disconnect();
    void refreshServiceUnseen();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function publish(items) {
  const state = publishServiceUnseen(items);
  syncProfessionalListBadge();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('va-tools:service-unseen', { detail: state }));
  }
  return state;
}

export async function refreshServiceUnseen() {
  if (refreshBusy) {
    refreshQueued = true;
    return;
  }
  refreshBusy = true;
  try {
    const state = await loadState();
    publish(state.items);
    await showDeletedNotice(state.professionalRows);
  } catch {
    // Auth/network readiness belongs to the Professional runtime.
  } finally {
    refreshBusy = false;
    if (refreshQueued) {
      refreshQueued = false;
      queueMicrotask(() => void refreshServiceUnseen());
    }
  }
}

export function startServiceUnseenRuntime() {
  if (initialized || typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  initialized = true;
  let disposed = false;
  const observer = new MutationObserver(() => {
    if (!disposed) syncProfessionalListBadge();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  const onRefresh = () => void refreshServiceUnseen();
  const onFocus = () => {
    if (!document.hidden) void refreshServiceUnseen();
  };
  const onClick = (event) => {
    const listButton = event.target.closest?.('[data-view-navigation] [data-view="list"]');
    if (!listButton || !isProfessionalJournalMounted()) return;
    const ids = [...unseenRecordIds()];
    if (ids.length) void markRecordsSeen(ids);
  };

  window.addEventListener('va-tools:service-unseen-refresh', onRefresh);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
  document.addEventListener('click', onClick, true);

  void refreshServiceUnseen();
  const interval = window.setInterval(() => {
    if (!document.hidden) void refreshServiceUnseen();
  }, REFRESH_INTERVAL_MS);

  return () => {
    disposed = true;
    observer.disconnect();
    window.clearInterval(interval);
    window.removeEventListener('va-tools:service-unseen-refresh', onRefresh);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onFocus);
    document.removeEventListener('click', onClick, true);
    initialized = false;
  };
}

if (typeof window !== 'undefined') startServiceUnseenRuntime();
