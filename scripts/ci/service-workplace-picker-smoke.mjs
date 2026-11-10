import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Exercise the existing Shared UI implementation, not a copy of its selection rules.
const read = (path) => readFileSync(path, 'utf8');
const shared = read('ui/workplaces/index.js');
const helper = read('core/service/workplace-selection.js');
const procedure = read('core/service/procedures/form.js');
const products = read('core/service/products/products.js');
const service = read('core/service/procedures/procedures.js');
const productOverview = read('core/service/products/products.js');

const start = shared.indexOf('function workplaceOptions(');
const end = shared.indexOf('\nexport function initWorkplaceSelectors(', start);
assert.ok(start >= 0 && end > start, 'Existing Shared workplaceSelector must remain the UI owner');
const region = shared.slice(start, end).replace('export function workplaceSelector', 'function workplaceSelector');
const rendered = [];
const workplaceSelector = new Function('select', 'escapeHtml', 'workplaceAddButton', 'costField',
  region + '\nreturn workplaceSelector;')(
  (options) => {
    rendered.push(options);
    return `<div data-value="${options.value}"></div>`;
  },
  (value) => String(value ?? '').replaceAll('"', '&quot;'),
  ({ label }) => `<button type="button" data-add-workplace>${label}</button>`,
  () => '<div data-cost-field></div>',
);

const workplaces = [{ key: 'a', name: 'Бьюти тория' }, { key: 'b', name: 'Фея' }];
const markup = workplaceSelector({
  name: 'serviceWorkplaces',
  selected: [{ workplaceId: 'a' }, { workplaceId: 'b' }],
  workplaces,
  rowLabel: '',
  placeholder: 'Выберите рабочее пространство',
  addLabel: '+ Рабочее пространство',
});
assert.deepEqual(rendered.map((item) => item.value), ['a', 'b'],
  'Both existing assignments must be visible, not only the first');
assert.match(markup, /data-add-workplace/);
assert.doesNotMatch(markup, /app-notification-row|app-notification-list|type="checkbox"/,
  'Never use the huge notification-checkbox list in the service Q');
rendered.length = 0;
workplaceSelector({ selected: [], workplaces });
assert.deepEqual(rendered.map((item) => item.value), [''],
  'An empty Q must offer exactly one placeholder selection');

const check = shared.slice(shared.indexOf('export function collectWorkplaceSelections('),
  shared.indexOf('\nfunction statsRows(', shared.indexOf('export function collectWorkplaceSelections(')));
assert.match(check, /const used = new Set\(\)/, 'Shared selector must deduplicate workplace IDs');
assert.match(check, /\.\.\.\(costHost \? \{ cost:/,
  'Do not clear per-workplace prices when selection does not edit cost');

const bindSource = helper
  .replace(/^import\s+[\s\S]*?\sfrom\s+['"][^'"]+['"];\s*/gm, '')
  .replace(/^export\s+/gm, '');
const host = {
  callbacks: {},
  addEventListener(event, callback) { this.callbacks[event] = callback; },
};
const root = { querySelector() { return host; } };
let chosen = [{ workplaceId: 'a', name: 'Бьюти тория' }];
const snapshots = [];
const bind = new Function('workplaceSelector', 'getWorkplaces',
  'initWorkplaceSelectors', 'collectWorkplaceSelections', bindSource +
  '\nreturn bindServiceWorkplaceSelection;')(
  () => markup,
  () => workplaces,
  () => {},
  () => chosen,
);
bind(root, {
  selected: [{ workplaceId: 'a', cost: { mode: 'from-to', from: '1500', to: '3000' } }],
  onChange: (value) => snapshots.push(value),
});
host.callbacks.change();
assert.equal(snapshots.at(-1)[0]?.cost?.from, '1500');
chosen = [];
host.callbacks.change();
chosen = [{ workplaceId: 'a', name: 'Бьюти тория' }];
host.callbacks.change();
assert.equal(snapshots.at(-1)[0]?.cost?.to, '3000',
  'Temporary removal/re-add must preserve workspace-specific prices');
assert.equal(snapshots.at(-1).length, 1);

for (const [name, source] of [['service', procedure], ['product', products]]) {
  assert.match(source, /serviceWorkplaceSelector\((?:procedure|product)\.workplaces\)/,
    `${name} Q must use the existing Shared workplace picker`);
  assert.doesNotMatch(source, /serviceWorkplaceChecklist|notificationSettings\(/,
    `${name} Q must not render notification checkbox lists`);
  assert.match(source, /bindServiceWorkplaceSelection\(/);
}
for (const [name, source] of [['service', service], ['product', productOverview]]) {
  assert.match(source, /data-(?:procedure|product)-open-editor/,
    `${name} visual card must open editor Q`);
  assert.match(source, /variant: 'q'/, `${name} editor must be Q`);
  assert.match(source, /data-(?:procedure|product)-editor-delete/,
    `${name} deletion must remain in Q`);
  assert.doesNotMatch(source, /data-(?:procedure|product)-settings|openServiceWorkplaceSelection/,
    `${name} editor must not return to the old V route`);
}
console.log('PASS: service/product Q uses Shared compact workplace picker; multiple assignments and price overrides survive');
