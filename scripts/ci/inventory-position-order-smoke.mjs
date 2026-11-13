import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('core/inventory/inventory.js', 'utf8');
const service = readFileSync('core/inventory/service.js', 'utf8');
const start = source.indexOf('function inventoryPositionComparator(');
const end = source.indexOf('function matchesType(', start);
assert.ok(start > 0 && end > start, 'Shared position comparator exists');
const compare = new Function('manufacturerName', 'productTypeText', 'STOCK_VIEW',
  source.slice(start, end) + ';return inventoryPositionComparator;')(
    row => row.manufacturer || 'Без производителя',
    row => row.productType || '',
    { itemsSort: 'position-asc' },
  );
const rows = [
  { itemId: '1', manufacturer: 'CHI', name: '12', position: 0 },
  { itemId: '2', manufacturer: 'CHI', name: '2', position: 0 },
  { itemId: '3', manufacturer: 'CHI', name: '10', position: 0 },
];
assert.deepEqual(rows.sort(compare).map(row => row.itemId), ['2', '3', '1'],
  'Without numbers, names are a fallback but no ordinal is assigned');
assert.ok(rows.every(row => row.position === 0), 'Unassigned positions stay unassigned');
rows.find(row => row.itemId === '1').position = 18;
rows.find(row => row.itemId === '3').position = 4;
assert.deepEqual(rows.sort(compare).map(row => row.itemId), ['3', '1', '2'],
  'Only explicitly numbered goods lead the list');
assert.equal(rows.find(row => row.itemId === '2').position, 0,
  'Changing one item never changes the unnumbered item');
assert.match(source, /itemsSort: \['position-asc'/, 'Manual order is available');
assert.match(source, /positionSortVersion !== 2/, 'Manual order becomes default after migration');
assert.match(source, /value: Number\(item\.position\) > 0 \? item\.position : ''/,
  'Marking number is blank unless assigned by user');
assert.match(source, /field\(\{ label: '№', name: 'position'/,
  'Small number field shares Marking row');
assert.match(source, /columns: 3, ariaLabel: 'Порядок, артикул и штрихкод'/,
  'Marking stays in one row');
assert.match(source, /position: requestedPosition/,
  'Only the edited item receives the exact specified number');
assert.match(source, /requestedPositionText === '' \? 0 : Number\(requestedPositionText\)/,
  'Clearing the input clears the ordering number');
assert.match(source, /await updateInventoryItem\(item\.itemId, value\)/,
  'Number is saved with normal product update');
assert.doesNotMatch(source, /moveInventoryItem|inventoryItemPosition\(/,
  'No artificial numbering or automatic movement');
assert.doesNotMatch(source, /const ordinals = new Map\(/,
  'Stock list never generates fake sequential numbers');
assert.match(source, /title: `\$\{Number\(item\.position\) > 0 \? `\$\{item\.position\} · ` : ''\}\$\{item\.name\}`/,
  'Stock row displays only user-assigned number');
assert.match(source, /inventoryAuditScope[\s\S]*?sort\(inventoryPositionComparator\)/,
  'Inventory count follows manual order');
assert.match(source, /getInventoryItems\(\)[\s\S]*?\.sort\(inventoryPositionComparator\)/,
  'Movement selection follows manual order');
assert.doesNotMatch(source, /function openInventoryPositionEditor\(/, 'No extra editor');
assert.doesNotMatch(source, /id: 'order', label: 'Порядок'/, 'No extra V menu');
assert.doesNotMatch(service, /moveInventoryItem|\/items\/.*\/move/,
  'No action that renumbers hundreds of products');
console.log('PASS: blank until assigned, explicit number sorting, no mass renumbering');
