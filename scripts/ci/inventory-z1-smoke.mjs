import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inventoryManufacturerCompletion } from '../../core/inventory/completeness.js';

const inventory = readFileSync('core/inventory/inventory.js', 'utf8');
const templates = readFileSync('core/card-appearance-templates.js', 'utf8');

const z1 = inventory.slice(inventory.indexOf('function stockManufacturerCardsMarkup('), inventory.indexOf('function stockListMarkup('));
assert.ok(z1.startsWith('function stockManufacturerCardsMarkup('), 'Z1 card section must be present');
assert.match(z1, /return entityCardStack\(cards\);/, 'Existing vertical entity card stack');
assert.doesNotMatch(z1, /entity-card-rail|entityCardRail|miniCard/, 'Z1 must not use a horizontal rail');
assert.match(z1, /appearance: manufacturerCardAppearance\(\)/);
assert.match(z1, /fields: manufacturerCardFields\(group\)/);

const page = inventory.slice(inventory.indexOf('function renderStock(root) {'), inventory.indexOf('function renderMovements(root)'));
assert.match(page, /root\.innerHTML = page\(\[/, 'Shared vertical page spacing');
assert.doesNotMatch(page.slice(page.indexOf('root.innerHTML = page(['), page.indexOf('const [searchRow]')), /stockSearchField\(\)/, 'Search must never be in Z1 body');
assert.match(page, /setV2ZHeaderRows\(root,/, 'Use canonical Z1 header rows');
assert.match(page, /class="people-search ui-search-field"/, 'Use the exact Contacts header search wrapper');
assert.match(page, /class="people-search-divider ui-search-divider"/, 'Use the exact Contacts header divider');
assert.match(page, /searchInput\?\.addEventListener\('input', renderManufacturers\)/, 'Header search filters Z1 cards');
assert.doesNotMatch(page, /label: 'Поиск'/, 'Header search has no visible label');
assert.match(page, /v: \{ data: 'data-inventory-stock-menu'/, 'Canonical V action');
const appearanceIndex = page.indexOf("{ id: 'appearance', label: 'Вид'");
const sortingIndex = page.indexOf("{ id: 'controls', label: 'Сортировка'");
assert.ok(appearanceIndex >= 0 && sortingIndex > appearanceIndex, 'View is the first item of the menu');
assert.doesNotMatch(page, /label: 'Фильтр'|label: 'Сортировка и фильтр'/, 'Z1 V has only View and Sort');
const sortModal = inventory.slice(inventory.indexOf('function openStockControls('), inventory.indexOf('function bindManufacturerCards('));
assert.match(sortModal, /level === 'items' \? select\(\{/, 'Z2 filter is unchanged');
assert.match(sortModal, /saveInventorySortMode\(sortKey, event\.target\.value\)/, 'Sort selections persist');
const stored = new Map();
const localStorage = {
  getItem: (key) => stored.has(key) ? stored.get(key) : null,
  setItem: (key, value) => stored.set(key, value),
};
const stateSource = inventory.slice(inventory.indexOf('const INVENTORY_SORT_KEY ='), inventory.indexOf('const MANUFACTURER_CARD_APPEARANCE ='));
const state = new Function('localStorage', stateSource + '\nreturn { STOCK_VIEW, saveInventorySortMode };');
const first = state(localStorage);
assert.equal(first.STOCK_VIEW.manufacturersSort, 'name-asc');
first.saveInventorySortMode('manufacturersSort', 'count-desc');
first.saveInventorySortMode('itemsSort', 'balance-asc');
assert.equal(state(localStorage).STOCK_VIEW.manufacturersSort, 'count-desc', 'Manufacturer sort survives a fresh session');
assert.equal(state(localStorage).STOCK_VIEW.itemsSort, 'balance-asc', 'Item sort survives independently');
first.saveInventorySortMode('manufacturersSort', 'name-desc');
assert.equal(state(localStorage).STOCK_VIEW.manufacturersSort, 'name-desc', 'Sort changes only when selected');
first.saveInventorySortMode('itemsSort', 'invalid');
assert.equal(state(localStorage).STOCK_VIEW.itemsSort, 'balance-asc', 'Invalid sort is ignored');
assert.match(page, /openSharedProfileSettingsMenu\(/, 'Reuse existing settings action menu');
assert.match(page, /setV2ZHeaderRows\(root,/, 'Existing header search');
assert.match(page, /bindManufacturerCards\(root, listHost\)/, 'All brand cards remain interactive');

const view = inventory.slice(inventory.indexOf('function openManufacturerAppearance('), inventory.indexOf('function stockListMarkup('));
assert.match(view, /openEntityCardAppearanceQ\(/, 'Canonical 9-row Q appearance constructor');
assert.match(view, /saveCardAppearanceTemplate\('inventory-manufacturer'/, 'Existing shared template persistence');
assert.match(view, /allowPhoto: false/, 'No invented brand images');
assert.match(templates, /'inventory-manufacturer'/);
assert.match(inventory, /loadAuxiliaryState\('service'\)/, 'Persisted view loaded before first stock render');

const complete = { name:'Color', manufacturer:'CHI', category:'Краска', sku:'CHI001', unit:'г', packageQuantity:85, grossWeight:100, tareWeight:15 };
const group = inventoryManufacturerCompletion([complete, { ...complete, tareWeight:null }]);
assert.equal(group.count, 2);
assert.equal(group.incomplete, 1);
assert.ok(group.percentage < 100);
assert.equal(inventoryManufacturerCompletion([complete]).percentage, 100);
console.log('PASS: stock Z1 vertical canonical cards, menu/View Q, persisted fields, accurate completion');
