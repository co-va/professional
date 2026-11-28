import { queueAuxiliaryDataset } from './business-persistence.js';

const SCOPES = new Set(['person', 'workplace', 'wallet', 'loan', 'investment', 'procedure', 'product', 'inventory-manufacturer', 'inventory-counterparty', 'inventory-item']);
SCOPES.add('loyalty-deposit');
SCOPES.add('loyalty-personal-account');
SCOPES.add('loyalty-certificate');
SCOPES.add('loyalty-subscription');
SCOPES.add('loyalty-referral');
SCOPES.add('loyalty-bonus');
let templatesState = [];

function validScope(scope) {
  if (SCOPES.has(scope)) return true;
  // Named program views share the existing server-owned template dataset.
  // Deposit uses its canonical program record instead; Personal Account is not a program.
  const [base, id, ...extra] = scope.split(':');
  return !extra.length && Boolean(id) && base.startsWith('loyalty-')
    && SCOPES.has(base) && base !== 'loyalty-deposit' && base !== 'loyalty-personal-account';
}

// Card templates are account-scoped. A second login must never inherit the
// first account's visual template through the local timestamp merge.
if (typeof window !== 'undefined') {
  window.addEventListener('professional:auth-logout', () => {
    templatesState = [];
  });
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function objectValue(value = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeTemplate(value = {}) {
  const source = objectValue(value);
  const scope = String(source.scope || '').trim();
  if (!validScope(scope)) return null;
  return {
    scope,
    appearance: clone(objectValue(source.appearance)),
    photo: String(source.photo || ''),
    photoPosition: String(source.photoPosition || '50% 50%'),
    updatedAt: String(source.updatedAt || ''),
  };
}

function normalized(values = []) {
  const byScope = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const item = normalizeTemplate(value);
    if (item) byScope.set(item.scope, item);
  }
  return [...byScope.values()];
}

function updatedAtValue(value = '') {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : 0;
}

export function hydrateCardAppearanceTemplates(values = []) {
  const incoming = normalized(values);
  const merged = new Map(incoming.map((item) => [item.scope, item]));
  for (const local of templatesState) {
    const remote = merged.get(local.scope);
    if (!remote || updatedAtValue(local.updatedAt) > updatedAtValue(remote.updatedAt)) {
      merged.set(local.scope, local);
    }
  }
  templatesState = [...merged.values()];
  return getCardAppearanceTemplates();
}

export function getCardAppearanceTemplates() {
  return clone(templatesState);
}

export function getCardAppearanceTemplate(scope = '') {
  const key = String(scope || '').trim();
  const item = templatesState.find((value) => value.scope === key);
  return item ? clone(item) : null;
}

export function saveCardAppearanceTemplate(scope = '', {
  appearance = {},
  photo = '',
  photoPosition = '50% 50%',
} = {}) {
  const key = String(scope || '').trim();
  if (!validScope(key)) throw new Error('Неизвестный тип карты');
  const next = {
    scope: key,
    appearance: clone(objectValue(appearance)),
    photo: String(photo || ''),
    photoPosition: String(photoPosition || '50% 50%'),
    updatedAt: new Date().toISOString(),
  };
  templatesState = normalized([
    ...templatesState.filter((item) => item.scope !== key),
    next,
  ]);
  void queueAuxiliaryDataset('cardAppearanceTemplates', templatesState);
  return clone(next);
}
