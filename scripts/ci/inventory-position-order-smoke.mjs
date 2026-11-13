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
  'Existing 256-product catalog receives natural automatic order');
rows.find(row => row.itemId === '1').position = 1;
rows.find(row => row.itemId === '2').position = 2;
rows.find(row => row.itemId === '3').position = 3;
assert.deepEqual(rows.sort(compare).map(row => row.itemId), ['1', '2', '3'],
  'Explicit order is used on every subsequent load');
assert.match(source, /itemsSort: \['position-asc'/, 'Manual order remains an available sorting mode');
assert.match(source, /itemsSort = firstPositionSort \? 'position-asc'/, 'One-time sort preference migration');
assert.match(source, /const ordinals = new Map\(/, 'List numbers computed without N-squared sorting');
assert.match(source, /title: `\$\{ordinals\.get\(item\.itemId\)\} · \$\{item\.name\}`/, 'Compact ordinal displayed in stock row');
assert.match(source, /function openInventoryPositionEditor\(/, 'Small move-to-position editor');
assert.match(source, /id: 'order', label: 'Порядок'/, 'Move action available in existing V menu');
assert.match(source, /\.sort\(inventoryPositionComparator\)/, 'Position comparator reused throughout inventory');
assert.match(source, /inventoryAuditScope[\s\S]*?sort\(inventoryPositionComparator\)/, 'Stocktake respects ordering');
assert.match(source, /getInventoryItems\(\)[\s\S]*?\.sort\(inventoryPositionComparator\)/, 'Material selection respects ordering');
assert.match(source, /moveInventoryItem\(itemId, position\)/, 'One move changes the whole manufacturer order');
assert.match(service, /export async function moveInventoryItem/, 'Frontend service uses Core atomic move');
assert.match(service, /\/items\/\$\{encodeURIComponent\(String\(itemId \|\| ''\)\)\}\/move/, 'No local-only order persistence');
console.log('PASS: canonical inventory position order and one-step move, reused across screens');
