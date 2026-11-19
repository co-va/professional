import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../core/presence.js', import.meta.url), 'utf8')
  .replace(/^import [^\n]+\n/, '')
  .replaceAll('export const', 'const')
  .replaceAll('export function', 'function');
const handlers = new Map();
let interval = null;
let intervalCount = 0;
let token = 'valid-token';
let visibilityState = 'visible';
let at = 100_000;
const calls = [];
const window = {
  setInterval(fn, milliseconds) { assert.equal(milliseconds, 45_000); interval = fn; intervalCount++; return 1; },
  clearInterval() { interval = null; },
  addEventListener(name, fn) { handlers.set('window:' + name, fn); },
  removeEventListener(name) { handlers.delete('window:' + name); },
};
const document = {
  get visibilityState() { return visibilityState; },
  addEventListener(name, fn) { handlers.set('document:' + name, fn); },
  removeEventListener(name) { handlers.delete('document:' + name); },
};
const apiRequest = (path, options) => {
  calls.push({path, options});
  return Promise.resolve({ status: 204 });
};
const context = {
  Date: { now: () => at }, window, document, apiRequest, getAuthToken: () => token,
};
const runtime = runInNewContext(source + '\n({ startProfessionalPresence, stopProfessionalPresence })', context);
const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
runtime.startProfessionalPresence();
await settle();
assert.equal(calls.length, 1, 'First heartbeat does not wait for interval');
assert.equal(calls[0].path, '/auth/presence');
assert.equal(calls[0].options.timeoutMs, 5_000);
runtime.startProfessionalPresence();
assert.equal(intervalCount, 1, 'Repeated workspace entry cannot stack timers');
at += 45_000;
visibilityState = 'hidden';
interval();
await settle();
assert.equal(calls.length, 1, 'Hidden tab must not report online');
at += 45_000;
visibilityState = 'visible';
handlers.get('document:visibilitychange')();
await settle();
assert.equal(calls.length, 2, 'Foreground wake resumes immediately');
at += 3_000;
handlers.get('window:focus')();
await settle();
assert.equal(calls.length, 2, 'Focus cannot burst heartbeat requests');
runtime.stopProfessionalPresence();
assert.equal(interval, null);
assert.equal(handlers.size, 0, 'Logout removes all listeners');
runtime.startProfessionalPresence();
await settle();
assert.equal(calls.length, 3, 'Authenticated reentry restarts telemetry');
runtime.stopProfessionalPresence();
token = '';
runtime.startProfessionalPresence();
await settle();
assert.equal(interval, null, 'Logged-out session never sends heartbeat');
assert.equal(calls.length, 3);
console.log('Professional presence: foreground-only, idempotent, 45s, bounded and logout-safe PASS');
