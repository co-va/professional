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
const mismatchSource = source.slice(source.indexOf('function counterpartyFieldMismatch('),
  source.indexOf('function openCompanyEditor('));
const counterpartyFieldMismatch = new Function(mismatchSource +
  '\nreturn counterpartyFieldMismatch;')();
const savedCompany = {
  name: 'Supplier', kind: 'SUPPLIER', contactName: 'Representative',
  phone: '+7', email: 'test@example.com', website: 'site.test', note: 'Agreement',
  discountPercent: '12.5000',
};
assert.equal(counterpartyFieldMismatch({ ...savedCompany, discountPercent: 12.5 }, savedCompany), '',
  'Core decimals serialized as strings must compare numerically');
assert.equal(counterpartyFieldMismatch({ ...savedCompany, discountPercent: 13 }, savedCompany),
  'Скидка по договору', 'An ignored Core discount must be detected');
assert.equal(counterpartyFieldMismatch({ ...savedCompany, website: 'other.example', discountPercent: 12.5 },
  savedCompany), 'Сайт', 'Every other form field must also be verified');
assert.equal(counterpartyFieldMismatch({ ...savedCompany, discountPercent: null },
  { ...savedCompany, discountPercent: null }), '', 'Unset discount is valid');
assert.match(source, /const stored = \(await json\(\)\)\.find/,
  'Editor must re-read persisted Core data after a successful HTTP request');
assert.match(source, /if \(mismatch\) throw new Error/,
  'Missing server-side fields must not be silently accepted');
assert.match(source, /Скидка по договору: не указана/,
  'Z2 must state explicitly when no agreement is stored');
assert.match(source, /<strong class="ui-list__title">Скидка по договору:/,
  'Z2 must show a stored agreement prominently');

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
const supplierMenu = source.slice(source.indexOf("layer.querySelector('[data-company-actions]')"),
  source.indexOf('  void refresh();\n  return layer;', source.indexOf("layer.querySelector('[data-company-actions]')")));
for (const label of ["id: 'edit'", "id: 'excel'", "id: 'history'", "id: 'excluded'"]) {
  assert.ok(supplierMenu.includes(label), 'Supplier V must include ' + label);
}
const supplierActionOrder = ["id: 'edit'", "id: 'excel'", "id: 'history'", "id: 'excluded'"]
  .map(action => supplierMenu.indexOf(action));
assert.ok(supplierActionOrder.every((value, index) => value >= 0 &&
  (!index || value > supplierActionOrder[index - 1])), 'Supplier V must have exactly the approved action order');
assert.match(supplierMenu, /id: 'edit', label: 'Редактировать', variant: 'primary'/,
  'Edit must be the black first action');
assert.match(supplierMenu, /id: 'excel', label: 'Excel'/,
  'Excel must open nested X');
assert.match(supplierMenu, /id: 'upload', label: 'Загрузить', variant: 'primary'/,
  'Nested Excel X must have primary Upload');
assert.ok(supplierMenu.indexOf("id: 'upload'") < supplierMenu.indexOf("id: 'template'"),
  'Nested Excel X must show Upload before Template');
assert.doesNotMatch(source, /openImportGuidance|data-counterparty-pick-file/,
  'Obsolete extra instruction screen and select-file action must be removed');
const globalMenu = source.slice(source.indexOf("root.querySelector('[data-counterparty-view-menu]')"),
  source.indexOf("root.querySelector('[data-counterparty-add]')"));
assert.doesNotMatch(globalMenu, /'Шаблон Excel'|'История загрузок'|'Загрузить файл'/,
  'Global V contains no supplier price-list operations');
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
