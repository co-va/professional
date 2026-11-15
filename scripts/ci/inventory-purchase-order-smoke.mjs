import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dataSource = readFileSync('core/inventory/data.js', 'utf8');
const orderSource = readFileSync('core/inventory/orders.js', 'utf8');
const inventoryUI = readFileSync('core/inventory/inventory.js', 'utf8');
const service = readFileSync('core/inventory/service.js', 'utf8');
const excel = readFileSync('core/inventory/excel-v2.js', 'utf8');
const inventoryEntrypoint = readFileSync('core/inventory/index.js', 'utf8');
const thresholdHelpers = readFileSync('core/inventory/completeness.js', 'utf8');
const layoutCss = readFileSync('ui/layout/layout.css', 'utf8');
const strip = value => value.replace(/^export /gm, '');
const data = new Function('window', 'CustomEvent',
  strip(thresholdHelpers) + strip(dataSource.replace(/^import[^\n]+\n/gm, ''))
    + 'return {applyInventorySnapshot,inventoryOrderSuggestions,getInventoryOrders};')(
    { dispatchEvent: () => {} }, class CustomEvent {},
  );

data.applyInventorySnapshot({ items: [
  { itemId: 'target-only', balance: 100, minStock: 1.5, targetStock: 4, unit: 'г', packageQuantity: 60 },
  { itemId: 'needed', balance: 50, minStock: 1, targetStock: 3, unit: 'г', packageQuantity: 60 },
  { itemId: 'irrelevant', balance: 0, minStock: 0, targetStock: 0, unit: 'г', packageQuantity: 60 },
  { itemId: 'manual', balance: 300, minStock: 30, targetStock: 100, unit: 'шт.' },
] });
assert.deepEqual(data.inventoryOrderSuggestions('target').map(x => x.itemId), ['target-only', 'needed']);
assert.deepEqual(data.inventoryOrderSuggestions('minimum').map(x => x.itemId), ['needed']);
assert.ok(!data.inventoryOrderSuggestions('target').some(x => x.itemId === 'irrelevant'));
assert.deepEqual(data.getInventoryOrders(), []);

// People enter whole tubes and fractions, not grams of minimum/target stock.
const threshold = new Function(thresholdHelpers.replace(/^export /gm, '')
  + '\nreturn { inventoryStockThresholdInput, inventoryStockThresholdStored, inventoryStockBalanceInThresholdUnits };')();
const colour = { unit: 'г', packageQuantity: 60 };
assert.equal(threshold.inventoryStockThresholdStored(colour, 0.5), 0.5);
assert.equal(threshold.inventoryStockThresholdStored(colour, 1), 1);
assert.equal(threshold.inventoryStockThresholdStored(colour, 1.5), 1.5);
assert.equal(threshold.inventoryStockThresholdInput(colour, 0.5), 0.5);
assert.equal(threshold.inventoryStockThresholdInput(colour, 1), 1);
assert.equal(threshold.inventoryStockThresholdStored({ unit: 'шт.', packageQuantity: 1 }, 3), 3);
assert.equal(threshold.inventoryStockThresholdStored({unit:'г'}, 0.5), 0.5);
assert.equal(threshold.inventoryStockBalanceInThresholdUnits({unit:'г',balance:30,packageQuantity:60}), 0.5);
assert.equal(threshold.inventoryStockBalanceInThresholdUnits({unit:'г',balance:0,packageQuantity:null}), 0);

// 0.5 tube is already urgent; above 0.5 but below 1 is recommended;
// every suggestion replenishes to target and buys whole packages.
data.applyInventorySnapshot({ items: [
  { itemId:'half-tube',unit:'г',packageQuantity:60,balance:30,minStock:0.5,targetStock:1 },
  { itemId:'three-quarter',unit:'г',packageQuantity:60,balance:45,minStock:0.5,targetStock:1 },
  { itemId:'full-tube',unit:'г',packageQuantity:60,balance:60,minStock:0.5,targetStock:1 },
  { itemId:'no-threshold',unit:'г',packageQuantity:60,balance:0,minStock:0,targetStock:0 },
  { itemId:'never-configured-absent-colour',unit:'г',packageQuantity:60,balance:0,minStock:null,targetStock:null },
  { itemId:'zero-without-size',unit:'г',packageQuantity:null,balance:0,minStock:0.5,targetStock:1 },
  { itemId:'large-stock',unit:'г',packageQuantity:60,balance:90,minStock:1.5,targetStock:3 },
] });
assert.deepEqual(data.inventoryOrderSuggestions('minimum').map(x=>x.itemId), ['half-tube','zero-without-size','large-stock','never-configured-absent-colour']);
assert.deepEqual(data.inventoryOrderSuggestions('target').map(x=>x.itemId), ['half-tube','three-quarter','zero-without-size','large-stock','never-configured-absent-colour']);
assert.equal(data.inventoryOrderSuggestions('minimum')[0].suggestedQuantity, 30);
assert.equal(data.inventoryOrderSuggestions('target')[1].urgency, 'normal');
assert.equal(data.inventoryOrderSuggestions('target')[0].urgency, 'urgent');
assert.deepEqual(data.getInventoryOrders(), []);


// Z1 must be a list of persisted order documents, not the automatic
// replenishment suggestions from InventoryItem. Test the rendered result.
const listStart = orderSource.indexOf('function orderListMarkup(');
const listEnd = orderSource.indexOf('function refreshOrderList(', listStart);
assert.ok(listStart >= 0 && listEnd > listStart, 'Missing Orders Z1 document list');
const makeOrderList = (orders) => new Function(
  'getInventoryOrders', 'emptyState', 'v2ListEntries', 'v2ListEntry',
  'dateLabel', 'statusLabel', 'rubles', 'escapeHtml',
  orderSource.slice(listStart, listEnd) + '\nreturn orderListMarkup;',
)(
  () => orders,
  (title, description) => `EMPTY: ${title} | ${description}`,
  items => items.join('\n'),
  row => JSON.stringify(row),
  value => String(value || ''),
  value => ({ formed:'Сформирован', paid:'Оплачен', received:'Получен' })[value] || value,
  value => String(value) + ' ₽',
  value => String(value),
);
const emptyOrderList = makeOrderList([])({dataset:{}});
assert.match(emptyOrderList, /Заказов пока нет/);
assert.doesNotMatch(emptyOrderList, /Осталось|Жид–8C|Купить/);
const orderDocument = makeOrderList([{
  orderId:'test-order-1',supplier:'Поставщик',status:'formed',
  createdAt:'2026-11-15T10:00:00Z',lines:[{itemId:'colour-1'}],total:2500,
}])({dataset:{}});
assert.match(orderDocument, /Поставщик/);
assert.match(orderDocument, /Сформирован/);
assert.match(orderDocument, /data-inventory-order/);
assert.doesNotMatch(orderDocument, /Осталось 0/);
assert.match(orderSource, /c:\s*\{\s*label:\s*'\+'/,
  'Orders Z1 must have an actual + action for creation');

// Q1 is only criteria; Q2 immediately shows checked lines and the collapsed
// full catalog. No third selection step and no filtering to recommended-only.
assert.match(orderSource, /title: 'Критерии'/);
assert.match(orderSource, /name: 'orderReviewMode'/);
assert.match(orderSource, /const ORDER_MODES = \[/);
assert.match(orderSource, /\{ value: 'minimum', label: 'Минимум' \}/);
assert.match(orderSource, /\{ value: 'all', label: 'Весь каталог' \}/);
assert.doesNotMatch(orderSource, /label: 'Срочно'/);
assert.match(orderSource, /data-inventory-order-active/);
assert.match(orderSource, /data-inventory-order-excluded-list/);
assert.match(orderSource, /data-inventory-order-include/);
assert.doesNotMatch(orderSource, /name: 'orderScope'/);
assert.match(layoutCss, /:is\(\[data-inventory-audit-criteria\],\[data-inventory-order-review\]\) \.field-inline-label>\.ui-compact-check/);
assert.match(layoutCss, /:is\(\[data-inventory-audit-result\],\[data-inventory-order-balance\]\)/);
assert.match(orderSource, /data-inventory-order-balance/);
assert.match(orderSource, /const orderItemLabel =/);
assert.match(orderSource, /const orderItemBalance =/);
assert.match(orderSource, /class="data-edit-row"/);
assert.match(orderSource, /'data-inventory-order-fields'/);
assert.match(orderSource, /class="data-edit-row__name"/);
assert.ok(orderSource.indexOf('<details data-inventory-order-excluded') <
  orderSource.indexOf('<div data-inventory-order-active'), 'Catalog above order rows');
assert.doesNotMatch(orderSource, /'Купить ' \+ suggestedPacks\(item\)/);
const headingStart = orderSource.indexOf('const orderItemLabel =');
const headingEnd = orderSource.indexOf('const dateLabel =', headingStart);
assert.ok(headingStart >= 0 && headingEnd > headingStart);
const presentation = new Function('isTube',
  orderSource.slice(headingStart, headingEnd)
  + '\nreturn { orderItemLabel, orderItemBalance };')(
  row => ['г', 'гр', 'гр.', 'грамм', 'граммы'].includes(String(row.unit || '').toLocaleLowerCase('ru-RU')),
);
assert.equal(presentation.orderItemLabel({position:7,name:'Кр–5N'}), '№ 7 · Кр–5N');
assert.equal(presentation.orderItemBalance({unit:'Гр',balance:0,containerCount:null}), '— тюб. · 0 Гр');
assert.equal(presentation.orderItemBalance({unit:'Гр',balance:88,containerCount:2}), '2 тюб. · 88 Гр');
const planStart = orderSource.indexOf('function initialOrderLines(');
const planEnd = orderSource.indexOf('function openInventoryOrderReview(', planStart);
const plan = new Function('manufacturer', 'suggestedPacks',
  orderSource.slice(planStart, planEnd) + '\nreturn initialOrderLines;')(
  row => row.manufacturer || 'Без производителя',
  row => Math.max(1, Math.ceil(row.suggestedQuantity / (row.packageQuantity || 1))),
);
const planCatalog = [
  {itemId:'colour',manufacturer:'CHI',name:'57R',unit:'г',packageQuantity:60},
  {itemId:'lacquer',manufacturer:'Other',name:'Лак',unit:'шт.',packageQuantity:1},
];
const chosen = plan(planCatalog, [{itemId:'colour',suggestedQuantity:30,packageQuantity:60}], '', null);
assert.equal(chosen.selected.get('colour'), 1);
assert.equal(chosen.selected.has('lacquer'), false);
assert.equal(planCatalog.length, 2, 'Hidden catalog must retain all nonrecommended products');
const existingPlan = plan(planCatalog, [], '', {lines:[{itemId:'lacquer',packages:2}]});
assert.equal(existingPlan.selected.get('lacquer'), 2);
assert.equal(existingPlan.selected.has('colour'), false);

const before = orderSource.indexOf('const packSize =');
const after = orderSource.indexOf('// Q1 owns selection criteria', before);
assert.ok(before > 0 && after > before);
const packs = new Function(orderSource.slice(before, after)
  + '\nreturn suggestedPacks;')();
assert.equal(packs({ suggestedQuantity: 5, packageQuantity: 60, unit: 'г' }), 1);
assert.equal(packs({ suggestedQuantity: 61, packageQuantity: 60, unit: 'г' }), 2);
assert.equal(packs({ suggestedQuantity: 0.8, packageQuantity: 0.5, unit: 'г' }), 2);
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
// Regression: Excel used to overwrite real Orders Z1 with a flat list of
// InventoryItem suggestions, destroying the creation + and saved documents.
assert.doesNotMatch(excel, /function enhanceOrders\(|function orderListMarkup\(/,
  'Obsolete Excel Order renderer must not return');
assert.doesNotMatch(excel, /inventoryOrderSuggestions/,
  'Excel extensions must never treat stock suggestions as saved Orders');
assert.match(inventoryEntrypoint, /if \(target !== 'orders'\)/,
  'Orders must bypass the Excel extender completely');
assert.equal(inventoryUI.split('openInventoryAuditSelection(').length - 1, 2,
  'Only one stocktake action remains in Movement and one implementation');
assert.match(inventoryUI, /\{ value: 'ADJUSTMENT', label: 'Инвентаризация' \}/);
for (const route of ['/orders', '/pay', '/receive'])
  assert.ok(service.includes(route), 'Missing persisted Core action: ' + route);
assert.match(service, /verifyOrderState/);
console.log('PASS: order Z1/Q/Z2 reuse, minimum/target, no zero clutter, whole packs, single stocktake');
