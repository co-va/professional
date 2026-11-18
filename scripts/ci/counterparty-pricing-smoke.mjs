import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeEntityCardAppearance, entityVisualCard } from '../../ui/cards/entity-card-constructor.js';

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
assert.match(source, /label: 'Скидка по договору', name: 'discountPercent'/,
  'Agreement percentage is edited as part of the counterparty');
assert.match(source, /class="inventory-editor-number__suffix" aria-hidden="true">%<\/span>/,
  'Agreement numeric input must have a visible percent suffix, not only an external label');
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
assert.doesNotMatch(source, /Скидка по договору: не указана/,
  'Missing optional agreement must not appear as technical text');
const detailsMarkup = source.slice(source.indexOf('function counterpartyInformation('),
  source.indexOf('// Tapping a supplier product'));
const counterpartyInformation = new Function('escapeHtml',
  detailsMarkup + '\nreturn counterpartyInformation;')(value => String(value));
const contactOnly = counterpartyInformation({
  name: 'Компания Альфа', contactName: 'Светлана',
  phone: '+7 900 000 00 00', email: 'svetlana@example.com',
  discountPercent: 15, website: 'hidden.example', note: 'Private note',
});
for (const value of ['Светлана', '+7 900 000 00 00', 'svetlana@example.com'])
  assert.match(contactOnly, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\assert.match(source, /<strong class="ui-list__title">Скидка по договору:/,
  'Z2 must show a stored agreement prominently');')),
    'Z2 shows contact details');
for (const value of ['Компания Альфа', '15%', 'hidden.example', 'Private note', 'Менеджер'])
  assert.ok(!contactOnly.includes(value), 'Z2 must not duplicate supplier card data: ' + value);
assert.match(source, /title: company\.name,/,
  'Z2 header must use the company name without generic title');


// Agreement must be available both as a selectable field and on the face of
// supplier cards, even when an older custom layout has unused slots.
const defaultSource = source.slice(source.indexOf('const COUNTERPARTY_CARD_SCOPE ='),
  source.indexOf('const TYPES ='));
const supplierCardSource = source.slice(source.indexOf('function counterpartyCardFields('),
  source.indexOf('function openCounterpartyAppearance('));
const buildCard = new Function('getCardAppearanceTemplate', 'normalizeEntityCardAppearance',
  'kindLabel', defaultSource + supplierCardSource +
  '\nreturn { counterpartyCardFields, counterpartyCardAppearance };');
const companyWithDiscount = { name: 'Тест поставщик', discountPercent: 15 };
const base = buildCard(() => null, normalizeEntityCardAppearance, kind => kind);
assert.equal(base.counterpartyCardFields(companyWithDiscount)
  .find(item => item.value === 'discountPercent')?.text, '15%',
  'Agreement field must be available to the shared card constructor');
assert.equal(base.counterpartyCardFields({ discountPercent: 0 })
  .find(item => item.value === 'discountPercent')?.text, '0%',
  'Explicit zero discount is displayed, not hidden');
assert.equal(base.counterpartyCardFields({})
  .find(item => item.value === 'discountPercent')?.text, '',
  'No agreement must leave the supplier card field empty');
assert.equal(normalizeEntityCardAppearance(base.counterpartyCardAppearance())
  .lines[6].cells.left.field, 'discountPercent', 'Default card shows the discount immediately');
const rendered = entityVisualCard({
  appearance: base.counterpartyCardAppearance(),
  fields: base.counterpartyCardFields(companyWithDiscount),
});
assert.match(rendered, />15%<\/span>/, 'Actual supplier card HTML must show 15% without clipping-prone prose');
assert.doesNotMatch(rendered, /Скидка по договору: 15%/,
  'Card field is compact; the field selector retains its full label');
const savedLayout = normalizeEntityCardAppearance({ lines: [
  { cells: { left: { field: 'name' }, right: { field: 'files' } } },
  {}, {}, {}, {}, {}, { cells: { left: { field: 'contactName' } } }, {}, {},
] });
const savedCopy = JSON.stringify(savedLayout);
const custom = buildCard(() => ({ appearance: savedLayout }),
  normalizeEntityCardAppearance, kind => kind);
const customAppearance = custom.counterpartyCardAppearance();
assert.equal(customAppearance.lines[0].cells.left.field, 'name');
assert.equal(customAppearance.lines[0].cells.right.field, 'files');
assert.equal(customAppearance.lines[6].cells.left.field, 'contactName',
  'Existing custom card fields must not be moved or replaced');
assert.ok(customAppearance.lines.some(row =>
  Object.values(row.cells).some(cell => cell.field === 'discountPercent')),
  'Legacy custom cards must show the agreement in an unused cell');
assert.equal(JSON.stringify(savedLayout), savedCopy,
  'The stored custom card cannot be mutated when rendering');

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
assert.match(source, /openCounterpartyFiles\(currentCompanies\)/,
  'Upload history is global and grouped by counterparty');
const supplierMenu = source.slice(source.indexOf("layer.querySelector('[data-company-actions]')"),
  source.indexOf('  void refresh();\n  return layer;', source.indexOf("layer.querySelector('[data-company-actions]')")));
assert.match(supplierMenu, /id: 'edit', label: 'Редактировать', variant: 'primary'/,
  'Edit is the primary action within each counterparty');
assert.match(supplierMenu, /id: 'excluded', label: 'Исключённые позиции'/,
  'Only excluded positions remain in supplier V beside editing');
assert.doesNotMatch(supplierMenu, /id: 'excel'|id: 'upload'|id: 'history'|id: 'template'/,
  'Supplier V must not contain any Excel operation');
const globalMenu = source.slice(source.indexOf("root.querySelector('[data-counterparty-view-menu]')"),
  source.indexOf("root.querySelector('[data-counterparty-add]')"));
assert.match(globalMenu, /id: 'appearance', label: 'Вид'/,
  'Global V retains View');
assert.match(globalMenu, /id: 'excel', label: 'Excel'/,
  'Global V contains all supplier Excel operations');
assert.match(globalMenu, /id: 'upload', label: 'Загрузить', variant: 'primary'/,
  'Excel X has the black Upload action');
assert.ok(globalMenu.indexOf("id: 'upload'") < globalMenu.indexOf("id: 'template'")
  && globalMenu.indexOf("id: 'template'") < globalMenu.indexOf("id: 'history'"),
  'Excel X order: Upload, Template, History');
assert.match(globalMenu, /'Шаблон Excel'/);
assert.match(globalMenu, /'История загрузок'/);
assert.match(source, /importExcel\('\/preview', file\)/,
  'Preview is sent to Core before choosing a supplier');
assert.match(source, /counterpartyId = chosenCompany\(\)/,
  'User must choose an existing supplier or enter a name');
assert.match(source, /importExcel\('', file,/,
  'Global import must use the Core global upload endpoint');
assert.doesNotMatch(source, /openImportGuidance|data-counterparty-pick-file|openImport\(company/,
  'Old supplier-scoped upload flow must be absent');
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
