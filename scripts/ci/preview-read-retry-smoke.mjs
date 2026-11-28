import assert from 'node:assert/strict';
Object.defineProperty(globalThis, 'location', { configurable: true, value: { hostname: 'professional-volokovykh.msk1.amvera.tech' } });
const store = new Map([['va-tools.auth.token', 'synthetic-token']]);
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, value),
  removeItem: key => store.delete(key),
} });
const { apiRequest, getCurrentAccount, getAuthToken } = await import('../../core/auth.js');
const { loadPersonalAccounts } = await import('../../core/loyalty/personal-account/data.js');
let calls = [], statuses = [], result = {};
globalThis.fetch = async (url, options) => {
  calls.push({ url, options });
  assert.ok(statuses.length, 'Unexpected additional request');
  const status = statuses.shift();
  return new Response(JSON.stringify(status === 200 ? result : { message: 'Synthetic error' }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
};
function setup(sequence, value = {}) { calls = []; statuses = [...sequence]; result = value; }
setup([500, 503, 200], { account: { id: 'synthetic-account' } });
assert.equal((await getCurrentAccount()).account.id, 'synthetic-account');
assert.equal(calls.length, 3);
assert.ok(calls.every(c => c.url === '/api/auth/me' && c.options.cache === 'no-store' && c.options.headers.get('Authorization') === 'Bearer synthetic-token'));
assert.equal(getAuthToken(), 'synthetic-token');
setup([500, 200], [{ personKey: 'synthetic-person', balance: 120 }]);
assert.equal((await loadPersonalAccounts())[0].balance, 120);
assert.equal(calls.length, 2);
setup([500, 500, 500]);
await assert.rejects(getCurrentAccount(), /HTTP 500/);
assert.equal(calls.length, 3);
assert.equal(getAuthToken(), 'synthetic-token');
setup([401]);
assert.equal((await apiRequest('/auth/me')).status, 401);
assert.equal(calls.length, 1);
setup([500]);
assert.equal((await apiRequest('/loyalty/personal-accounts', { method: 'POST' })).status, 500);
assert.equal(calls.length, 1);
setup([500]);
assert.equal((await apiRequest('/profile')).status, 500);
assert.equal(calls.length, 1);
globalThis.location.hostname = 'prof.va-tools.ru';
setup([500]);
assert.equal((await apiRequest('/auth/me')).status, 500);
assert.equal(calls.length, 1);
console.log('PASS: preview-only read recovery, bounded persistent error, saved session, no write retry, no other host retry');
