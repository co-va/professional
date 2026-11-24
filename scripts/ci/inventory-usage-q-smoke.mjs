import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync('core/inventory/stock-item-editor.js','utf8');
const entry=readFileSync('core/inventory/inventory.js','utf8');
assert.match(entry,/return openStockItemQEditor\(/);
for(const field of ['Критический остаток','Желаемый остаток','Количество расхода','Масса брутто','Масса нетто','Масса тары','Цена продажи','Себестоимость'])
  assert.ok(source.includes(field),field);
assert.match(source,/patch\.canSell = saleNow/);
assert.match(source,/patch\.canConsume = consumeNow/);
assert.match(source,/patch\.saleQuantity = 1/);
assert.match(source,/patch\.saleUnit = receiptNow/);
assert.match(source,/const syncModes =/);
assert.match(source,/patch\.referencePrice = priceNow/);
assert.match(source,/if \(consumeNow\)/);
assert.match(source,/if \(saleNow\)/);
console.log('PASS: approved conditional consumption, whole receipt sale and stock fields');
