import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('core/inventory/inventory.js', 'utf8');
const service = readFileSync('core/inventory/service.js', 'utf8');
const start = source.indexOf('function inventoryPositionComparator(');
const end = source.indexOf('function matchesType(', start);
assert.ok(start > 0 && end > start, 'Shared catalog position comparator exists');
const compare = new Function('manufacturerName', 'STOCK_VIEW',
  source.slice(start, end) + ';return inventoryPositionComparator;')(
    item=>item.manufacturer || 'Без производителя',
    {itemsSort:'position-asc'}
  );
const rows = [
  {itemId:'chi1',manufacturer:'CHI',name:'10',position:3},
  {itemId:'wella1',manufacturer:'Wella',name:'2',position:1},
  {itemId:'chi2',manufacturer:'CHI',name:'3',position:1},
  {itemId:'chi3',manufacturer:'CHI',name:'2',position:0},
  {itemId:'wella2',manufacturer:'Wella',name:'1',position:2},
];
assert.deepEqual(rows.sort(compare).map(item=>item.itemId),
  ['chi2','chi1','chi3','wella1','wella2'],
  'Companies are grouped before local manual numbers; duplicate company numbers are allowed');
assert.equal(rows.find(row=>row.itemId==='chi3').position,0,
  'Unnumbered products remain blank');
assert.match(source, /itemsSort: \['position-asc'/, 'Manual order is a distinct sort mode');
assert.match(source, /value: Number\(item\.position\) > 0 \? item\.position : ''/,
  'Marking number is blank until entered');
assert.match(source, /field\(\{ label: '№', name: 'position'/,
  'Small number field is in the Marking row');
assert.match(source, /columns: 3, ariaLabel: 'Порядок, артикул и штрихкод'/,
  'No separate position editor or UI structure');
assert.match(source, /position: requestedPosition/, 'Number is saved with the item');
assert.doesNotMatch(source, /function openInventoryPositionEditor\(/, 'No additional position dialog');
assert.match(source, /function stockListMarkup\(/, 'Existing stock list remains the owner');
assert.match(source, /reorderHandle: canReorder/, 'Same shared handle used in stock list');
assert.match(source, /initV2ListReorder\(listHost/, 'Shared gesture handler is used');
assert.match(source, /await reorderInventoryItems\(manufacturer === EMPTY_MANUFACTURER \? '' : manufacturer, ids\)/,
  'One scoped reorder is saved only after drop');
assert.match(source, /STOCK_VIEW\.itemsSort !== 'position-asc' \|\| STOCK_VIEW\.itemsType \|\| normalizedSearch\(query\)/,
  'Dragging is disabled for filtered/sorted partial lists');
assert.match(source, /querySelector\('\.list-entry__text > strong'\)/,
  'Only numbering text is updated after ACK, not the whole Z');
assert.match(service, /export async function reorderInventoryItems\(manufacturer, itemIds\)/,
  'Stock sends single reorder request');
assert.match(service, /\/items\/reorder/, 'Company order endpoint is used');
assert.match(source, /inventoryAuditScope[\s\S]*?sort\(inventoryPositionComparator\)/,
  'Inventory count shares manual order');
assert.match(source, /getInventoryItems\(\)[\s\S]*?\.sort\(inventoryPositionComparator\)/,
  'Movement selection shares manual order');
console.log('PASS: manufacturer-local numbering, shared drag, one batch save and stable Z');
