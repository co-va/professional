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
assert.doesNotMatch(source, /id: 'discount'/,
  'Agreement discount is in the company editor rather than a separate menu');
assert.match(source, /id: 'excluded', label: 'Исключённые позиции'/,
  'Excluded offers remain in the selected counterparty V');
assert.match(source, /const excludedPath = '\/'\+urlId\(companyId\)\+'\/catalog\?excluded=true'/,
  'Excluded offers are queried separately by counterparty');
assert.match(source, /rowIds: ids, excluded: true/,
  'Exclusions are stored using Core selection endpoint');
assert.match(source, /openCounterpartyFiles\(company\)/,
  'Price-list history belongs to the selected supplier');
assert.match(source, /id: 'upload', label: 'Загрузить файл', variant: 'primary'/,
  'Price-list upload is the primary action within a supplier');
const globalMenu = source.slice(source.indexOf("root.querySelector('[data-counterparty-view-menu]')"),
  source.indexOf("root.querySelector('[data-counterparty-add]')"));
assert.doesNotMatch(globalMenu, /'Шаблон Excel'|'История загрузок'|'Загрузить файл'/,
  'Global V contains no supplier price-list operations');
const supplierMenu = source.slice(source.indexOf("layer.querySelector('[data-company-actions]')"),
  source.indexOf('  void refresh();\n  return layer;', source.indexOf("layer.querySelector('[data-company-actions]')")));
assert.match(supplierMenu, /'Шаблон Excel'/,
  'Template belongs to the selected supplier');
assert.match(supplierMenu, /'История загрузок'/,
  'Price-list history belongs to the selected supplier');
assert.doesNotMatch(source, /data-company-excluded-open|removedCount/,
  'No duplicate restore action in the supplier catalog surface');
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
