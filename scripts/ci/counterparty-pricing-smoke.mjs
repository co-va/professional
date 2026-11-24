import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeEntityCardAppearance, entityVisualCard } from '../../ui/cards/entity-card-constructor.js';

const source = readFileSync('core/inventory/counterparties.js', 'utf8');
const part = source.slice(source.indexOf('function supplierEffectivePrice('),
  source.indexOf('const SUPPLIER_CATALOG_EDIT_FIELDS ='));
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
  assert.ok(contactOnly.includes(value), 'Z2 shows contact details: ' + value);
assert.ok(contactOnly.includes('<strong class="ui-list__title">Светлана</strong>'),
  'Representative name is content, not a combined section heading');
assert.ok(!contactOnly.includes('Представитель'),
  'The representative section title belongs exclusively to v2Section');
assert.match(source, /v2Section\('Представитель', counterpartyInformation\(company\)\)/,
  'Representative is rendered through the shared section component');
assert.match(source, /v2Section\('Ассортимент', '<div data-company-catalog-list><\/div>'\)/,
  'Assortment uses the same section component');
assert.match(source, /v2Section\('Представитель', counterpartyInformation\(company\)\) \+\s*v2Section\('Ассортимент'/,
  'Two sections appear consecutively and share the standard spacing');
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
assert.match(source, /id: 'excluded', label: 'Скрытые'/,
  'Excluded offers remain in the selected counterparty V');
assert.match(source, /const excludedPath = '\/'\+urlId\(companyId\)\+'\/catalog\?excluded=true'/,
  'Excluded offers are queried separately by counterparty');
assert.match(source, /rowIds: ids, excluded: true/,
  'Exclusions are stored using Core selection endpoint');
assert.match(source, /openCounterpartyFiles\(currentCompanies\)/,
  'Upload history is global and grouped by counterparty');
const supplierMenu = source.slice(source.indexOf("layer.querySelector('[data-company-actions]')"),
  source.indexOf('  // No second GET to open a company already present in the source list.', source.indexOf("layer.querySelector('[data-company-actions]')")));
assert.match(supplierMenu, /id: 'edit', label: 'Редактировать', variant: 'primary'/,
  'Edit is the primary action within each counterparty');
assert.match(supplierMenu, /id: 'excluded', label: 'Скрытые'/,
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
assert.match(source, /function openSupplierProductEditor\(/,
  'The single-position editor is retained');
assert.match(source, /function openSupplierBulkEditor\(/,
  'The selected-position editor is present');
assert.match(source, /data-company-selection-bulk/,
  'The selected-position button opens mass editing');
assert.doesNotMatch(source, /openSupplierBatchPrices|data-company-selection-prices/,
  'Old price-only mass editor must not exist');
assert.doesNotMatch(source, /json\('\/' \+ urlId\(company\.id\) \+ '\/catalog\/prices'/,
  'No second bulk price mutation path from Professional');
const selectedActions = source.slice(source.indexOf('function catalogBrandMarkup('),
  source.indexOf('// Matching is a hint'));
assert.match(selectedActions,
  /button\('Создать карточку', \{ data: 'data-company-selection-card' \}\)/,
  'Selected catalog offers exactly one main action');
assert.match(selectedActions,
  /button\('Изменить данные', \{ variant: 'secondary', data: 'data-company-selection-bulk' \}\)/,
  'Mass editing is secondary, not a second black button');
assert.ok(selectedActions.indexOf("button('Скрыть'")
  > selectedActions.indexOf("button('Изменить данные'"),
  'Hide action must be last');
assert.match(source, /Скрыть ' \+ ids\.length \+ ' позиций\? Их можно восстановить через «Скрытые»\./,
  'X confirmation has one short explanatory sentence');
const hideAction = source.slice(source.indexOf("brandLayer?.querySelector('[data-company-selection-delete]')"),
  source.indexOf("brandLayer?.querySelectorAll('[data-company-product]')", source.indexOf("brandLayer?.querySelector('[data-company-selection-delete]')")));
assert.match(hideAction, /variant: 'x', xRole: 'action', surface: 'app'/,
  'Hide confirmation is a compact X action modal, not a full-height Q');
assert.doesNotMatch(hideAction, /variant: 'q'|<h[1-6]|v2-q-title|modal-title/,
  'X body has no visible heading, only description and confirmation');
assert.match(hideAction, /button\('Скрыть', \{ variant: 'delete-outline'/,
  'Hide confirmation uses the short red-outline action');
assert.match(hideAction, /rowIds: ids, excluded: true/,
  'Hide continues to use existing supplier exclusion API');
assert.match(source, /rowIds: \[\.\.\.selected\], excluded: false/,
  'Hidden items remain recoverable through the existing restore action');
assert.doesNotMatch(source, /Массовое изменение|Исключить из ассортимента|Исключённые позиции/,
  'Obsolete long labels are removed from the supplier UI');
const massSource = source.slice(source.indexOf('const SUPPLIER_CATALOG_EDIT_FIELDS ='),
  source.indexOf('function openSupplierProductEditor('));
const editor = new Function(massSource +
  '\nreturn {SUPPLIER_CATALOG_EDIT_FIELDS, supplierCatalogEditValue, supplierCatalogValueMatches};')();
assert.equal(editor.SUPPLIER_CATALOG_EDIT_FIELDS.length, 12,
  'Exactly the existing twelve editable supplier fields are offered to the batch editor');
assert.deepEqual(editor.SUPPLIER_CATALOG_EDIT_FIELDS.map(item => item.value), [
  'name', 'supplierSku', 'barcode', 'manufacturer', 'brand', 'category',
  'listPrice', 'retailPrice', 'discountPercent', 'unit', 'packageQuantity', 'supplierNote',
]);
const discountField = editor.SUPPLIER_CATALOG_EDIT_FIELDS.find(item => item.value === 'discountPercent');
const priceField = editor.SUPPLIER_CATALOG_EDIT_FIELDS.find(item => item.value === 'listPrice');
const packageField = editor.SUPPLIER_CATALOG_EDIT_FIELDS.find(item => item.value === 'packageQuantity');
assert.equal(editor.supplierCatalogEditValue(discountField, '12,5'), 12.5);
assert.equal(editor.supplierCatalogEditValue(discountField, '0'), 0);
assert.equal(editor.supplierCatalogEditValue(discountField, ''), null,
  'Empty individual bulk field must leave its record untouched');
assert.throws(() => editor.supplierCatalogEditValue(discountField, '120'), /Проверьте значение/);
assert.throws(() => editor.supplierCatalogEditValue(priceField, '-3'), /Проверьте значение/);
assert.throws(() => editor.supplierCatalogEditValue(packageField, '0'), /Проверьте значение/);
assert.equal(editor.supplierCatalogValueMatches('12.5000', 12.5, discountField), true);
assert.doesNotMatch(massSource,
  /twoColumnLayout\(|inventory-audit-value-heading|inventory-audit-value-line|data-edit-row|v2Section\(row\.name/,
  'Do not recreate stocktake geometry or per-item selector forms');
assert.match(massSource, /select\(\{ label: 'Что изменить', name: 'supplierBulkField'/,
  'Only one shared field selector is rendered');
assert.match(massSource, /supplierCatalogDataControl\(def, 'supplierBulkValue',\s*'', 'На что изменить'\)/,
  'Active input for the new value is always visible');
assert.match(massSource, /compactCheck\(\{ checked: true, label: 'Выбрать все'/,
  'Only one select-all control exists');
assert.match(massSource, /supplierCatalogBulkRow\(row, def, selected\.has\(String\(row\.id\)\)\)/,
  'Each chosen item is listed once, with its own checkbox');
assert.match(massSource, /right: \[supplierCatalogBulkDisplay\(row\[definition\.value\], definition\)\]/,
  'Every row displays the current selected-field value on the right');
assert.match(massSource, /selected\.has\(id\) && next !== null \? next : row\[def\.value\]/,
  'Typing a valid new value previews it on the right for checked rows only');
assert.match(massSource, /method: 'POST', body: \{ rowIds: ids, field: def\.value, value \}/,
  'One atomic Core bulk request per batch');
assert.match(massSource, /supplierCatalogValueMatches\(saved\.get\(String\(row\.id\)\)\?\.\[def\.value\], value, def\)/,
  'Returned authoritative rows are verified');
assert.match(massSource, /if \(current\) Object\.assign\(row, current\)/,
  'Same list retains persisted rows');
assert.match(massSource, /valueInput\(\)\.value = '';\s*renderList\(\)/,
  'Value input clears while selection and table remain for another field');
assert.doesNotMatch(massSource, /mountModal\(layer|layer\.v2Close\?\.\(\);\s*onSaved\(\)/,
  'Applying must not close the editor or clear the selected items');

const liveRows = [
  { id: 'a', name: 'Шампунь 250 мл', category: 'Уход', supplierSku: 'A01', listPrice: 1500 },
  { id: 'b', name: 'Шампунь 1000 мл', category: 'Уход', supplierSku: 'A02', listPrice: 3000 },
];
const serverRows = liveRows.map(row => ({ ...row }));
const mockRequests = [];
let markup = '';
let closeCount = 0;
let callbackCount = 0;
const events = () => ({ handlers: {},
  addEventListener(name, callback) { this.handlers[name] = callback; },
  emit(name, event = {}) { return this.handlers[name]?.(event); },
});
const selectorNode = Object.assign(events(), { value: 'supplierSku' });
const valueNode = { value: '', isConnected: true };
const valueHostNode = Object.assign(events(), {
  innerHTML: '',
  querySelector() { return valueNode; },
});
const allNode = Object.assign(events(), { checked: true });
const rightNodes = new Map(liveRows.map(row => [row.id, { textContent: '' }]));
const listNode = Object.assign(events(), {
  innerHTML: '',
  querySelectorAll() { return liveRows.map(row => ({
    dataset: { companyBulkItem: row.id },
    querySelector() { return rightNodes.get(row.id); },
  })); },
});
const submitNode = { disabled: false, isConnected: true };
const countNode = { textContent: '' };
const errorNode = { textContent: '' };
const resultNode = { textContent: '' };
const formNode = Object.assign(events(), {
  querySelector(name) { return ({
    '[name="supplierBulkField"]': selectorNode,
    '[data-company-bulk-value]': valueHostNode,
    '[data-company-bulk-all]': allNode,
    '[data-company-bulk-count]': countNode,
    '[data-company-bulk-list]': listNode,
    '[data-company-bulk-error]': errorNode,
    '[data-company-bulk-result]': resultNode,
    '[data-company-bulk-save]': submitNode,
  })[name]; },
});
const mockLayer = {
  isConnected: true,
  querySelector(name) { return name === '[data-company-bulk-editor]' ? formNode : null; },
  v2Close() { closeCount++; this.isConnected = false; },
};
const bulkMocks = {
  document: { body: {} },
  mountModal: (_, html) => { markup = html; return mockLayer; },
  modal: markup => markup,
  select: ({ name }) => '<select name="' + name + '"></select>',
  compactCheck: ({ label = '', checked = false }) =>
    '<label><input type="checkbox"' + (checked ? ' checked' : '') + '>' + label + '</label>',
  field: ({ name, label = '' }) => '<label>' + label + '<input name="' + name + '"></label>',
  list: ({ items }) => '<div class="ui-list__title">' + items[0].title + '</div>' +
    '<div class="ui-list__right-secondary"><span>' + items[0].right[0] + '</span></div>',
  money: amount => String(amount) + ' ₽',
  escapeHtml: value => String(value),
  actionBlock: value => value,
  button: label => '<button>' + label + '</button>',
  urlId: value => String(value),
  errText: cause => cause.message,
  openNotice: () => {},
  json: async (path, options = {}) => {
    mockRequests.push({ path, options });
    if (options.method === 'POST' && path.endsWith('/catalog/bulk')) {
      const {rowIds, field, value} = options.body;
      const updated = serverRows.filter(row => rowIds.includes(row.id));
      updated.forEach(row => { row[field] = value; });
      return {items: updated.map(row => ({...row}))};
    }
    if (path.includes('/catalog?skip='))
      return { count: serverRows.length, items: serverRows.map(row => ({ ...row })) };
    throw new Error('Unexpected API request ' + path);
  },
};
const mockBulkEditor = new Function(...Object.keys(bulkMocks),
  massSource + '\nreturn {openSupplierBulkEditor,supplierCatalogBulkDisplay,supplierCatalogBulkRow};')(
  ...Object.values(bulkMocks));
mockBulkEditor.openSupplierBulkEditor({ id: 'supplier-1' }, liveRows,
  () => { callbackCount++; });
assert.equal((markup.match(/name="supplierBulkField"/g) || []).length, 1,
  'Exactly one field selector in the supplier editor');
assert.equal((markup.match(/Выбрать все/g) || []).length, 1,
  'Exactly one select-all checkbox');
assert.equal((markup.match(/Что изменить/g) || []).length, 0,
  'Selector label is supplied by the canonical selector, not manually duplicated');
assert.equal(countNode.textContent, 'Выбрано 2 из 2');
assert.match(listNode.innerHTML, /Шампунь 250 мл/);
assert.match(listNode.innerHTML, /Шампунь 1000 мл/);
assert.match(listNode.innerHTML, /A01|A02/,
  'Right column shows the stored article before editing');
assert.equal(mockBulkEditor.supplierCatalogBulkDisplay(1500, priceField), '1500 ₽');

assert.equal(rightNodes.get('a').textContent, 'A01',
  'Current article appears at right before typing');
assert.equal(rightNodes.get('b').textContent, 'A02');
valueNode.value = 'NEW-ART';
valueHostNode.emit('input');
assert.equal(rightNodes.get('a').textContent, 'NEW-ART',
  'Typing previews new article on the right before saving');
assert.equal(rightNodes.get('b').textContent, 'NEW-ART');
await formNode.emit('submit', { preventDefault() {} });
assert.equal(serverRows[0].supplierSku, 'NEW-ART');
assert.equal(serverRows[1].supplierSku, 'NEW-ART');
assert.equal(selectorNode.value, 'supplierSku', 'Editor remains on current field after saving');
assert.equal(valueNode.value, '', 'Input clears after saving to enable another field');
assert.equal(countNode.textContent, 'Выбрано 2 из 2', 'Selected set must not be reset');
assert.equal(callbackCount, 0, 'Parent selection/list must not be closed on Apply');
assert.equal(closeCount, 0, 'Q must stay open after applying article');
assert.match(listNode.innerHTML, /NEW-ART/, 'Saved article is visible in the same list');
assert.match(resultNode.textContent, /Сохранено: 2 из 2/, 'Result is confirmed');
selectorNode.value = 'listPrice';
selectorNode.emit('change');
assert.match(listNode.innerHTML, /1500 ₽/, 'Choosing price shows saved prices on the right');
assert.equal(rightNodes.get('a').textContent, '1500 ₽');
assert.equal(rightNodes.get('b').textContent, '3000 ₽');
valueNode.value = '2700';
await formNode.emit('submit', { preventDefault() {} });
assert.equal(serverRows[0].listPrice, 2700);
assert.equal(serverRows[1].listPrice, 2700);
assert.equal(serverRows[0].supplierSku, 'NEW-ART', 'Second edit does not erase first edit');
assert.equal(callbackCount, 0);
assert.equal(closeCount, 0);
assert.match(listNode.innerHTML, /2700 ₽/, 'New price stays visible after second Apply');
// Only a subset can be selected for the next field change without reopening Q.
allNode.checked = false;
allNode.emit('change');
assert.equal(countNode.textContent, 'Выбрано 0 из 2');
const firstCheck = { checked: true, dataset: { companyBulkCheck: 'a' } };
firstCheck.closest = () => firstCheck;
listNode.emit('change', { target: firstCheck });
assert.equal(countNode.textContent, 'Выбрано 1 из 2');
valueNode.value = '2850';
valueHostNode.emit('input');
assert.equal(rightNodes.get('a').textContent, '2850 ₽',
  'Only a checked row previews the edited price');
assert.equal(rightNodes.get('b').textContent, '2700 ₽',
  'Unchecked row keeps its own price');
await formNode.emit('submit', { preventDefault() {} });
assert.equal(serverRows[0].listPrice, 2850);
assert.equal(serverRows[1].listPrice, 2700, 'Unchecked row is not written');
assert.equal(countNode.textContent, 'Выбрано 1 из 2', 'Subset remains selected after save');
assert.equal(closeCount, 0);
const posts = mockRequests.filter(request => request.options.method === 'POST');
assert.equal(posts.length, 3, 'Three edits use exactly three requests');
assert.deepEqual(posts.map(request=>request.options.body.rowIds),[['a','b'],['a','b'],['a']]);
assert.ok(posts.every(request => request.path === '/supplier-1/catalog/bulk'));
mockLayer.v2Close();
assert.equal(callbackCount, 1, 'Parent refresh happens once after explicit close');
assert.equal(closeCount, 1);
assert.match(source, /if \(row\) openCatalogProductDetails|openCatalogProductDetails\(row,/);
assert.doesNotMatch(source, /if \(check\) check\.click\(\);/);
const detail = source.slice(source.indexOf('function openCatalogProductDetails('),
  source.indexOf('function catalogItemList('));
for (const label of ["'Прайсовая цена'","'Скидка'","'Цена со скидкой'","'РРЦ'"])
  assert.ok(detail.includes(label), 'Supplier detail missing ' + label);
assert.doesNotMatch(detail, /row\.actualPrice|updateInventoryItem/);

// Counterparty detail performance contract: repeat opening does not repeat the
// same catalog/warehouse requests, and the list paints before link hydration.
assert.match(source, /const catalogCache = new Map\(\)/,
  'Catalog view cache belongs to Counterparties page, not a global account leak');
assert.match(source, /initialCompanies: currentCompanies, catalogCache/,
  'The loaded company list is reused when opening the supplier detail');
assert.match(source, /catalogCache\.clear\(\)/,
  'Cache must be invalidated after supplier create, edit or Excel import');
assert.match(source, /catalogCache\?\.delete\(key\)/,
  'Editing or hiding supplier products must bypass the previous catalog snapshot');
const companyPart = source.slice(source.indexOf('async function openCompany('),
  source.indexOf('export async function openSupplierAssociation('));
assert.match(companyPart, /for \(let skip = 100; skip < count; skip \+= 400\)/,
  'Catalog pages load in bounded batches, not one-by-one');
assert.match(companyPart, /renderCatalog\(entries, list\);\s*\/\/ The stock snapshot/,
  'Ready brands must paint before waiting on optional link-status information');

const catalogCalls = [];
const catalogLayers = [];
const catalogCache = new Map();
let stockReads = 0;
let deferStatuses = null;
const catalogRows = offset => Array.from({ length: Math.min(100, 250 - offset) },
  (_, index) => ({
    id: 'row' + (offset + index), name: 'Product ' + (offset + index),
    brand: 'BRAND', supplierSku: String(offset + index),
  }));
const mockCatalogJson = async path => {
  catalogCalls.push(path);
  if (path.endsWith('/catalog/link-status')) {
    if (deferStatuses) await new Promise(resolve => { deferStatuses.resolve = resolve; });
    return { statuses: [] };
  }
  if (path.includes('/catalog?skip=')) {
    const skip = Number(path.split('skip=')[1]);
    return { count: 250, items: catalogRows(skip) };
  }
  throw new Error('Redundant counterparty list or unexpected request: ' + path);
};
function mockSupplierLayer() {
  const list = { isConnected: true, innerHTML: '', querySelectorAll: () => [] };
  const host = { innerHTML: '',
    querySelector: selector => selector === '[data-company-catalog-list]' ? list : null };
  const layer = { isConnected: true,
    querySelector: selector => selector === '[data-counterparty-detail]' ? host
      : selector === '[data-company-actions]' ? { addEventListener() {} } : null,
    v2Close() { this.isConnected = false; } };
  catalogLayers.push({ layer, list, host });
  return layer;
}
const mockOpenCompany = new Function('json', 'workspaceHeaderContext',
  'mountV2ZLayer', 'v2ZLayer', 'v2Section', 'counterpartyInformation', 'emptyState',
  'catalogBrands', 'catalogGroupsMarkup', 'urlId', 'escapeHtml', 'openNotice',
  'getInventoryItems', 'loadInventory', companyPart + '\nreturn openCompany;')(
  mockCatalogJson, ({ title }) => title, mockSupplierLayer, content => content,
  (title, content) => '<section>' + title + ': ' + content + '</section>',
  company => company.contactName, () => '<LOADING>',
  entries => new Map([['BRAND', new Map([['', entries]])]]),
  brands => '<READY>' + brands.size,
  value => value, value => value, () => null, () => [],
  async () => { stockReads++; });
const supplierForCache = { id: 'test-company', name: 'Supplier', contactName: 'Svetlana' };
const tickCatalog = async () => { for (let n = 0; n < 50; n++) await Promise.resolve(); };
deferStatuses = {};
await mockOpenCompany(supplierForCache.id, {}, () => {},
  { initialCompanies: [supplierForCache], catalogCache });
await tickCatalog();
assert.match(catalogLayers[0].list.innerHTML, /<READY>/,
  'Previously imported catalog is visible before the link-status request finishes');
assert.equal(catalogCache.size, 0, 'Incomplete status hydration must not mark cache as fully ready');
deferStatuses.resolve();
deferStatuses = null;
await tickCatalog();
assert.equal(catalogCache.get(supplierForCache.id)?.entries?.length, 250);
assert.equal(catalogCalls.length, 4,
  'First opening requests three pages and statuses, not supplier list or entire stock');
assert.equal(stockReads, 0,
  'Stock API must never block an ordinary supplier browse when Core link status works');
const requestCount = catalogCalls.length;
await mockOpenCompany(supplierForCache.id, {}, () => {},
  { initialCompanies: [supplierForCache], catalogCache });
assert.equal(catalogCalls.length, requestCount,
  'Repeat opening a fresh supplier must not refetch the same unchanged catalog');
assert.match(catalogLayers[1].list.innerHTML, /<READY>/,
  'Cached assortment is rendered before any async round-trip');
catalogCache.get(supplierForCache.id).at = Date.now() - 61_000;
await mockOpenCompany(supplierForCache.id, {}, () => {},
  { initialCompanies: [supplierForCache], catalogCache });
assert.match(catalogLayers[2].list.innerHTML, /<READY>/,
  'Old cached assortment remains visible while silently refreshing it');
await tickCatalog();
assert.equal(catalogCalls.length, requestCount + 4, 'Older cache must refresh from server');
catalogCache.delete(supplierForCache.id);
await mockOpenCompany(supplierForCache.id, {}, () => {},
  { initialCompanies: [supplierForCache], catalogCache });
await tickCatalog();
assert.equal(catalogCalls.length, requestCount + 8,
  'Invalidating after a mutation must refetch the updated catalog');

console.log('PASS: supplier list price, agreement discount, item exception, bulk update and stock isolation');
