import { apiRequest, getAuthToken } from './auth.js';

// A foreground-only authenticated heartbeat. Never blocks the workspace,
// auth, mutations, data sync or navigation on network failure.
export const PRESENCE_HEARTBEAT_MS = 45_000;
const MIN_SEND_GAP_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;

let timer = null;
let running = false;
let inFlight = false;
let lastSentAt = 0;

function foreground() {
  return typeof document !== 'undefined' && document.visibilityState !== 'hidden';
}

function reportPresence() {
  if (!running || !foreground() || !getAuthToken() || inFlight) return;
  const now = Date.now();
  if (now - lastSentAt < MIN_SEND_GAP_MS) return;

  inFlight = true;
  lastSentAt = now;
  void apiRequest('/auth/presence', {
    method: 'POST',
    timeoutMs: HEARTBEAT_TIMEOUT_MS,
  }).then((response) => {
    if (response.status === 401) stopProfessionalPresence();
  }).catch(() => {
    // Heartbeat is optional telemetry. Network outages must not disrupt app use.
  }).finally(() => { inFlight = false; });
}

export function startProfessionalPresence() {
  if (running || !getAuthToken()) return;
  running = true;
  lastSentAt = 0;
  reportPresence();
  timer = window.setInterval(reportPresence, PRESENCE_HEARTBEAT_MS);
  document.addEventListener('visibilitychange', reportPresence);
  window.addEventListener('focus', reportPresence);
  window.addEventListener('pageshow', reportPresence);
}

export function stopProfessionalPresence() {
  running = false;
  if (timer != null) window.clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', reportPresence);
  window.removeEventListener('focus', reportPresence);
  window.removeEventListener('pageshow', reportPresence);
}
