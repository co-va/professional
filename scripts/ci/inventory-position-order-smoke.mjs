import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inventoryEndPosition, planInventoryMoveToEnd, planInventoryPositionReorder }
  from '../../core/inventory/position-reorder-plan.js';

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
  'Legacy unnumbered records must remain detectable for repair');
assert.match(source, /itemsSort: \['position-asc'/, 'Manual order is a distinct sort mode');
assert.match(source, /value: Number\(item\.position\) > 0 \? item\.position : ''/,
  'Legacy missing positions remain visible as incomplete data until written');
assert.match(source, /field\(\{ label: '№', name: 'position'/,
  'Small number field is in the Marking row');
assert.match(source, /columns: 3, ariaLabel: 'Порядок, артикул и штрихкод'/,
  'No separate position editor or UI structure');
assert.match(source, /position: requestedPosition/, 'Number is saved with the item');
assert.doesNotMatch(source, /function openInventoryPositionEditor\(/, 'No additional position dialog');
assert.match(source, /function stockListMarkup\(/, 'Existing stock list remains the owner');
assert.match(source, /stockGroupTree\(items, nestedCriteria\)/,
  'Current grouped stock view uses the ordered classification hierarchy');
assert.match(source, /initV2ListReorder\(listHost/, 'Shared gesture handler is used');
assert.match(source, /await reorderInventoryItems\(plan\.manufacturer,plan\.itemIds\)/,
  'Multi-selection uses one scoped Core reorder request');
assert.match(source, /planInventoryPositionReorder\(getInventoryItems\(\),entries\.map/,
  'Manual assignments plan one deterministic position permutation');
assert.match(source, /inventoryAuditValueMatches\(getInventoryItem\(entry\.itemId\)/,
  'Every requested position is checked against the Core snapshot');
assert.match(service, /export async function reorderInventoryItems\(manufacturer, itemIds\)/,
  'Stock sends single reorder request');
assert.match(service, /\/items\/reorder/, 'Company order endpoint is used');
assert.match(source, /inventoryAuditScope[\s\S]*?sort\(inventoryPositionComparator\)/,
  'Inventory count shares manual order');
assert.match(source, /getInventoryItems\(\)[\s\S]*?\.sort\(inventoryPositionComparator\)/,
  'Movement selection shares manual order');

// Regression: a number is a physical insertion point; a blank value is
// a move to the tail with a real positive number, never position = 0.
const company = [
  {itemId:'a',manufacturer:'CHI',name:'A',position:1},
  {itemId:'b',manufacturer:'CHI',name:'B',position:2},
  {itemId:'c',manufacturer:'CHI',name:'C',position:3},
  {itemId:'d',manufacturer:'CHI',name:'D',position:4},
];
assert.deepEqual(planInventoryMoveToEnd(company,'CHI',['b']).itemIds,['a','c','d','b']);
assert.deepEqual(planInventoryMoveToEnd(company,'CHI',['b','d']).itemIds,['a','c','b','d']);
assert.deepEqual(planInventoryPositionReorder(company,[
  {itemId:'b',manufacturer:'CHI',value:4},
  {itemId:'d',manufacturer:'CHI',value:2},
]).itemIds,['a','d','c','b']);
// Twenty rank edits must be planned as ONE final permutation, not twenty
// writes which would shift one another. The same applies to one rank 49.
const sixty=Array.from({length:60},(_,index)=>({
  itemId:'sku'+(index+1),manufacturer:'CHI',name:'Position '+(index+1),position:index+1,
}));
const one=planInventoryPositionReorder(sixty,[
  {itemId:'sku12',manufacturer:'CHI',value:49},
]);
assert.equal(one.itemIds[48],'sku12','A single bulk-editor row moves to requested rank 49');
assert.equal(new Set(one.itemIds).size,60,'No item is duplicated or dropped');
const twenty=planInventoryPositionReorder(sixty,Array.from({length:20},(_,i)=>({
  itemId:'sku'+(i+1),manufacturer:'CHI',value:41+i,
})));
assert.deepEqual(twenty.itemIds.slice(40),Array.from({length:20},(_,i)=>'sku'+(i+1)),
  'Twenty items occupy requested slots 41–60 in one reorder');
assert.equal(new Set(twenty.itemIds).size,60,'All unaffected items remain');
const legacy=[...sixty.slice(0,4),{itemId:'old',manufacturer:'CHI',name:'Old',position:0}];
assert.equal(planInventoryPositionReorder(legacy,[
  {itemId:'old',manufacturer:'CHI',value:2},
]).itemIds[1],'old','Legacy unnumbered items can be assigned a real rank');
assert.equal(planInventoryPositionReorder(sixty,[
  {itemId:'sku1',manufacturer:'CHI',value:61},
]),null,'Out-of-range target never triggers N competing PUTs');

assert.equal(inventoryEndPosition(company,'CHI'),5, 'A new item gets last+1');
assert.equal(inventoryEndPosition(company,'CHI','b'),4, 'Clearing a numbered item goes to last');
assert.equal(inventoryEndPosition([...company,
  {itemId:'old',manufacturer:'CHI',name:'Legacy',position:0}],'CHI','old'),5,
  'A legacy zero gets a positive number at the tail');
assert.match(source, /const requestedPosition = requestedPositionText === ''[\s\S]*?inventoryEndPosition\(/,
  'Blank card number resolves to the end');
assert.match(source, /position: requestedPosition,/, 'New cards explicitly send a positive position');
assert.match(source, /planInventoryMoveToEnd\(getInventoryItems\(\)/,
  'Multi-row tail move uses the canonical reorder');
assert.doesNotMatch(source, /await clearInventoryItemPositions\(/,
  'A clear action must never persist zero through the old endpoint');
assert.match(source, /'В конец'/, 'The action is labelled as movement, not number deletion');

console.log('PASS: manufacturer-local numbering, grouped stock and verified reorder/append');
