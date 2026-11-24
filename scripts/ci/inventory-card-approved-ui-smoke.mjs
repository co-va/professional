import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const form = readFileSync('core/inventory/stock-item-editor.js', 'utf8');
const inventory=readFileSync('core/inventory/inventory.js','utf8');
const layout = readFileSync('ui/forms/forms.css', 'utf8');
const sharedCheck = readFileSync('ui/selection/check-list.css', 'utf8');
const disclosure = readFileSync('core/inventory/orders.js', 'utf8');
const counterparties = readFileSync('core/inventory/counterparties.js', 'utf8');
const classification = readFileSync('core/inventory/classification.js', 'utf8');
const storage = readFileSync('core/inventory/storage.js', 'utf8');
// Owner contract 20.11, superseding the 16.11 Q, plus accounting section 22.11.
assert.match(inventory,/return openStockItemQEditor\(/);
assert.doesNotMatch(inventory,/function advancedItemFields\(/);
assert.match(form,/function receiptMarkup\(/);
assert.match(form,/function quantityPriceMarkup\(/);
assert.match(form,/label: 'Шт\. в упаковке'/);
assert.match(form,/label: 'Закупка, ₽'/);
assert.match(form,/disabled: receipt !== 'уп\.'/);
assert.match(form,/disabled: locked/);
assert.match(form,/label: 'Производитель'/);
assert.match(form,/label: '№ позиции'/);
assert.match(form,/data-stock-groups/);
assert.match(form,/label: 'Артикул'/);
assert.match(form,/label: 'Штрихкод'/);
const sections=['Позиция','Классификация','Расход','Продажа','Запас и контроль','Учёт'];
const indices=sections.map(label=>form.indexOf("panel('"+label+"'"));
assert.ok(indices.every((index,i)=>index>=0&&(!i||index>indices[i-1])), 'Six approved sections in order');
assert.match(form,/checked: original\.consumeOn/);
assert.match(form,/checked: original\.saleOn/);
assert.match(form,/numberField\('Количество расхода'/);
assert.match(form,/numberField\('Себестоимость'/);
assert.match(form,/numberField\('Цена продажи'/);
assert.match(form,/numberField\('Критический остаток'/);
assert.match(form,/numberField\('Желаемый остаток'/);
assert.doesNotMatch(form,/label: 'Поставщик'|data-inventory-conversion/);
assert.match(disclosure,/<details data-inventory-order-excluded/);
assert.match(sharedCheck,/border-radius:8px/);
assert.match(sharedCheck,/color:var\(--text\);font-size:19px/);
assert.doesNotMatch(layout,/\.ui-compact-check__mark|\.accordion-chevron/);
// Supplier row opens a data-only Q; only its independent compact check chooses it.
assert.match(counterparties, /if \(row\) openCatalogProductDetails\(row, catalogLinkStatuses\.get/);
assert.doesNotMatch(counterparties, /if \(check\) check\.click\(\);/);
const details = counterparties.slice(counterparties.indexOf('function openCatalogProductDetails('),
  counterparties.indexOf('function catalogItemList('));
assert.match(details, /\['Артикул',/);
assert.match(details, /\['Короткое название',/);
assert.doesNotMatch(details, /data-company-selection-card|data-company-product-check/);
assert.match(counterparties, /catalog\/link-status/);
assert.match(counterparties, /function openSupplierAgreement\(/,
  'Agreement discount belongs to Counterparty, not Stock card');
assert.match(counterparties, /listPriceSample/);
assert.match(counterparties, /purchasePriceSample/);
assert.doesNotMatch(counterparties, /function openSupplierBatchPrices\(/);
assert.match(counterparties, /catalog\/bulk/);
assert.match(counterparties, /function openSupplierProductEditor\(/);
assert.match(counterparties, /data-company-product-edit/);
assert.match(counterparties, /\['Цена со скидкой', money\(supplierEffectivePrice\(row, company\)\)\]/);
const supplierQ = counterparties.slice(counterparties.indexOf('function openCatalogProductDetails('),
  counterparties.indexOf('function catalogItemList('));
assert.doesNotMatch(supplierQ, /row\.actualPrice|inventoryItem\.update/);
assert.match(counterparties, /id: 'discount', label: 'Скидка по договору'/);
assert.match(counterparties, /unitsPerOffer/);
assert.match(classification, /createInventoryClassificationGroup/);
assert.match(classification, /updateInventoryClassificationGroup/);
assert.match(storage, /transferInventoryStock/);
assert.match(storage, /updateInventoryStorageLocation/);
console.log('PASS: compact inventory receipt/nominal/consumption UI and Core group/storage/supplier Q controls');
