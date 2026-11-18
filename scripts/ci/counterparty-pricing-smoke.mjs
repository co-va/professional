import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('core/inventory/counterparties.js', 'utf8');
const part = source.slice(source.indexOf('function supplierEffectivePrice('),
  source.indexOf('function openSupplierBatchPrices('));
assert.ok(part.startsWith('function supplierEffectivePrice('), 'Supplier price calculation exists');
const { supplierEffectivePrice, supplierDiscount } = new Function(part +
  '\nreturn {supplierEffectivePrice,supplierDiscount};')();
assert.equal(supplierEffectivePrice({listPrice:1500}, {discountPercent:10}), 1350);
assert.equal(supplierEffectivePrice({listPrice:1500,discountPercent:0}, {discountPercent:10}), 1500,
  'Explicit product exception overrides general contract discount');
assert.equal(supplierEffectivePrice({listPrice:1500,appliedDiscountPercent:12.5},
  {discountPercent:10}), 1312.5);
assert.equal(supplierEffectivePrice({listPrice:1500}, {}),1500);
assert.equal(supplierEffectivePrice({listPrice:null},{}),null);
assert.equal(supplierDiscount({discountPercent:0}, {discountPercent:10}), '0%');
assert.match(source, /label: 'Скидка по договору, %', name: 'discountPercent'/,
  'Agreement percentage is edited as part of the counterparty');
assert.match(source, /input\.discountPercent = discount;/,
  'Counterparty edit sends the validated percentage to Core');
assert.doesNotMatch(source, /purchasePriceSample|listPriceSample|openSupplierAgreement/,
  'Obsolete sample-price calculator and its separate Q must not return');
assert.doesNotMatch(source, /id: 'discount'|id: 'excluded'/,
  'Company V contains only company-level actions');
assert.match(source, /openCounterpartyFiles\(currentCompanies\)/,
  'Upload history is available from the Counterparties list V');
assert.match(source, /data-company-excluded-open/,
  'Existing excluded product data remains recoverable in the assortment');
assert.match(source, /\/catalog\/prices/);
assert.match(source, /function openSupplierProductEditor\(/);
assert.match(source, /function openSupplierBatchPrices\(/);
assert.match(source, /data-company-selection-prices/);
assert.match(source, /if \(row\) openCatalogProductDetails|openCatalogProductDetails\(row,/);
assert.doesNotMatch(source, /if \(check\) check\.click\(\);/);
const detail = source.slice(source.indexOf('function openCatalogProductDetails('),
  source.indexOf('function catalogItemList('));
for (const label of ["'Прайсовая цена'","'Скидка'","'Цена со скидкой'","'РРЦ'"])
  assert.ok(detail.includes(label), 'Supplier detail missing ' + label);
assert.doesNotMatch(detail, /row\.actualPrice|updateInventoryItem/);
console.log('PASS: supplier list price, agreement discount, item exception, bulk update and stock isolation');
