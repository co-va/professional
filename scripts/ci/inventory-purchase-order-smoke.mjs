import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dataSource = readFileSync('core/inventory/data.js', 'utf8');
const orderSource = readFileSync('core/inventory/orders.js', 'utf8');
const inventoryUI = readFileSync('core/inventory/inventory.js', 'utf8');
const service = readFileSync('core/inventory/service.js', 'utf8');
const strip = value => value.replace(/^export /gm, '');
const data = new Function('window', 'CustomEvent',
  strip(dataSource) + 'return {applyInventorySnapshot,inventoryOrderSuggestions,getInventoryOrders};')(
    { dispatchEvent: () => {} }, class CustomEvent {},
  );

data.applyInventorySnapshot({ items: [
  { itemId: 'target-only', balance: 100, minStock: 90, targetStock: 220, unit: 'г', packageQuantity: 60 },
  { itemId: 'needed', balance: 50, minStock: 70, targetStock: 170, unit: 'г', packageQuantity: 60 },
  { itemId: 'irrelevant', balance: 0, minStock: 0, targetStock: 0, unit: 'г', packageQuantity: 60 },
  { itemId: 'manual', balance: 300, minStock: 30, targetStock: 100, unit: 'шт.' },
] });
assert.deepEqual(data.inventoryOrderSuggestions('target').map(x => x.itemId), ['target-only', 'needed']);
assert.deepEqual(data.inventoryOrderSuggestions('minimum').map(x => x.itemId), ['needed']);
assert.ok(!data.inventoryOrderSuggestions('target').some(x => x.itemId === 'irrelevant'));
assert.deepEqual(data.getInventoryOrders(), []);

const before = orderSource.indexOf('const packSize =');
const after = orderSource.indexOf('// The same Q selection pattern', before);
assert.ok(before > 0 && after > before);
const packs = new Function(orderSource.slice(before, after)
  + '\nreturn suggestedPacks;')();
assert.equal(packs({ suggestedQuantity: 5, packageQuantity: 60, unit: 'г' }), 1);
assert.equal(packs({ suggestedQuantity: 61, packageQuantity: 60, unit: 'г' }), 2);
assert.equal(packs({ suggestedQuantity: 4, unit: 'шт.' }), 4);

for (const name of [
  'workspaceHeaderContext', 'modal', 'mountModal', 'v2ZLayer', 'mountV2ZLayer',
  'v2ListEntries', 'v2ListEntry', 'compactCheck', 'openSharedProfileSettingsMenu',
]) assert.ok(orderSource.includes(name), 'Shared UI missing: ' + name);
assert.doesNotMatch(orderSource, /<style|\.css'|\.css"/, 'Orders must not invent styles');
assert.match(orderSource, /title: 'Заказы'/);
assert.match(orderSource, /variant: 'q'/);
assert.match(orderSource, /status === 'formed'/);
assert.match(orderSource, /data-inventory-order-receive-save/);
assert.match(inventoryUI, /renderInventoryOrders\(root\)/);
assert.doesNotMatch(inventoryUI, /function orderMarkup\(/, 'Old flat suggestion screen is removed');
assert.equal(inventoryUI.split('openInventoryAuditSelection(').length - 1, 2,
  'Only one stocktake action remains in Movement and one implementation');
assert.match(inventoryUI, /\{ value: 'ADJUSTMENT', label: 'Инвентаризация' \}/);
for (const route of ['/orders', '/pay', '/receive'])
  assert.ok(service.includes(route), 'Missing persisted Core action: ' + route);
assert.match(service, /verifyOrderState/);
console.log('PASS: order Z1/Q/Z2 reuse, minimum/target, no zero clutter, whole packs, single stocktake');
