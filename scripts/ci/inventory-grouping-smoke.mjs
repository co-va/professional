import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stockGroupTree, sortedStockChildren } from '../../core/inventory/grouping.js';

const criteria = [
  { id: 'manufacturer', name: 'Производитель', legacyField: 'manufacturer' },
  { id: 'category', name: 'Категория', legacyField: 'category',
    values: [{ id: 'a', name: 'А' }, { id: 'b', name: 'Б' }] },
  { id: 'productType', name: 'Тип', legacyField: 'productType',
    values: [{ id: 'x', name: 'Х' }, { id: 'y', name: 'У' }] },
  { id: 'extra', name: 'Третья', values: [{ id: 'v', name: 'В' }, { id: 'g', name: 'Г' }] },
];
const item = (id, category = '', productType = '', criteriaValues = {}) =>
  ({ itemId: id, manufacturer: 'Тест', category, productType, criteriaValues });
const children = (node, groups = criteria.slice(1)) => sortedStockChildren(node, groups);
const find = (node, value, groups) => children(node, groups).find(child => child.value === value);

const mixed = stockGroupTree([
  item('1','А','Х',{extra:'v'}), item('2','А','Х',{extra:'g'}),
  item('3','А','',{extra:'g'}), item('4','','Х'), item('5'),
], criteria.slice(1));
assert.equal(mixed.items.length,5);
assert.equal(find(mixed,'А').items.length,3);
assert.equal(find(find(mixed,'А'),'Х').items.length,2);
assert.equal(find(find(mixed,'А'),'Г').direct[0].itemId,'3');
assert.equal(find(mixed,'Х').direct[0].itemId,'4');
assert.deepEqual(mixed.direct.map(row=>row.itemId),['5']);
assert.equal(find(find(find(mixed,'А'),'Х'),'Г').items.length,1);
assert.equal(find(find(mixed,'А'),'Г').items.length,1);

const twoTypes = stockGroupTree([
  item('plain'), item('typed-1','','Х'), item('typed-2','','Х'),
], criteria.slice(1));
assert.equal(find(twoTypes,'Х').items.length,2);
assert.deepEqual(twoTypes.direct.map(row=>row.itemId),['plain']);

const thirty = stockGroupTree([
  ...Array.from({length:2},(_,i)=>item('a'+i,'А','Х')),
  ...Array.from({length:8},(_,i)=>item('b'+i,'А','У')),
  ...Array.from({length:5},(_,i)=>item('c'+i,'А')),
  ...Array.from({length:5},(_,i)=>item('d'+i,'Б','Х')),
  ...Array.from({length:10},(_,i)=>item('e'+i)),
],criteria.slice(1,3));
assert.equal(thirty.items.length,30);
assert.equal(find(thirty,'А').items.length,15);
assert.equal(find(thirty,'Б').items.length,5);
assert.equal(find(find(thirty,'А'),'Х').items.length,2);
assert.equal(find(find(thirty,'А'),'У').items.length,8);
assert.equal(find(thirty,'А').direct.length,5);
assert.equal(thirty.direct.length,10);

// Neither display labels nor skipped intermediate levels alter criterion IDs.
const renamed = criteria.slice(1).map(group=>({...group,name:'Своя группа'}));
assert.equal(find(stockGroupTree([item('1','А','Х',{extra:'v'})],renamed),'А').items.length,1);
const reversed = [criteria[3],criteria[1],criteria[2]];
assert.equal(children(stockGroupTree([item('1','А','Х',{extra:'v'})],reversed),reversed)[0].value,'В');
assert.equal(stockGroupTree([item('plain')],criteria.slice(1)).children.size,0);

const stock = readFileSync('core/inventory/stock-catalog.js','utf8');
const editor = readFileSync('core/inventory/inventory.js','utf8');
const registry = readFileSync('core/inventory/classification.js','utf8');
assert.match(stock,/stockRootCriterion\(criteria/);
assert.match(editor,/stockGroupTree\(items, nestedCriteria\)/);
const itemEditor=readFileSync('core/inventory/stock-item-editor.js','utf8');
assert.match(editor,/return openStockItemQEditor\(/);
assert.match(itemEditor,/const drawGroups = \(\) =>/);
assert.match(itemEditor,/groupChoices\(item, groups\)/);
assert.match(itemEditor,/patch\.criteriaValues = Object\.fromEntries/);
assert.match(registry,/deleteData:isFixedManufacturerCriterion\(group\) \? '' : group.id/);
assert.match(registry,/if \(isFixedManufacturerCriterion\(group\)\) return;/);
console.log('Inventory grouping: recursive grouping, 30-item mix, skipped levels, root locking PASS');

// Service catalogue reuses the inventory grouping tree without changing assignments.
{
 const {serviceTree,serviceTableColumns,serviceUsageText}=await import('../../core/service/catalog-view.js');
 const levels=[{id:'g1',name:'Группа 1',values:[{id:'v1',name:'Значение'}]},{id:'g2',name:'Группа 2',values:[{id:'v2',name:'Значение'}]}];
const items=[{id:'1',groupValues:{g1:'v1',g2:'v2'}},{id:'2',groupValues:{g1:'v1'}},{id:'3',groupValues:{}},{id:'4',groupValues:{g2:'__service_group_only__'}}];
for(const groupGroups of [false,true])for(const groupValues of [false,true]){
 const {tree,criteria}=serviceTree(items,levels,{groupGroups,groupValues});
 const leaves=node=>[...node.direct,...[...node.children.values()].flatMap(leaves)];
 assert.deepEqual(leaves(tree).map(i=>i.id).sort(),['1','2','3','4']);
 assert.equal(criteria.length,(Number(groupGroups)+Number(groupValues))*2);
 if(!groupGroups&&!groupValues)assert.equal(tree.children.size,0);
 if(!groupGroups&&groupValues)assert.deepEqual([...tree.children.values()].map(n=>n.value),['Группа 1 · Значение']);
}
assert.deepEqual(serviceTableColumns('procedures').map(x=>x[0]),['name','price','duration','usage','minutes','revenue']);
assert.deepEqual(serviceTableColumns('products').map(x=>x[0]),['name','price','usage','revenue']);
assert.equal(serviceUsageText(4,10),'4 / 10');assert.equal(serviceUsageText(3,undefined),'3 / —');
 console.log('PASS Service grouping switches and combined count');
}
