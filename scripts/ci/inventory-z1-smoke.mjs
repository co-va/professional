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
assert.match(page, /v: \{ data: 'data-inventory-stock-menu'/, 'Canonical V action');
const appearanceIndex = page.indexOf("{ id: 'appearance', label: 'Вид'");
const sortingIndex = page.indexOf("{ id: 'controls', label: 'Сортировка и фильтр'");
assert.ok(appearanceIndex >= 0 && sortingIndex > appearanceIndex, 'View is the first item of the menu');
assert.match(page, /openSharedProfileSettingsMenu\(/, 'Reuse existing settings action menu');
assert.match(page, /stockSearchField\(\)/, 'Existing stock search');
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
