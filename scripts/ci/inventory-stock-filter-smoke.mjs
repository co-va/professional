import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const code = readFileSync('core/inventory/stock-filters.js', 'utf8');
const ui = readFileSync('core/inventory/inventory.js', 'utf8');
const helper = readFileSync('core/inventory/completeness.js', 'utf8');
const source = code.replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '');
const fn = new Function('inventoryStockBalanceInThresholdUnits',
  source + '\nreturn {emptyStockFilters,hasStockFilters,matchesStockFilters,stockFilterOptions};');
const getBalance = new Function(helper.replace(/^export /gm, '')
  + '\nreturn inventoryStockBalanceInThresholdUnits;')();
const {emptyStockFilters,hasStockFilters,matchesStockFilters,stockFilterOptions} = fn(getBalance);
const items = [
 {name:'Кр–8A',productType:'Крем',category:'Красители',location:'Шкаф',unit:'г',sku:'CHI1015',barcode:'4567',position:4,
  balance:20,packageQuantity:60,minStock:0.5,targetStock:1,referencePrice:230,tareWeight:null,
  canConsume:true,canSell:false,supplierOffers:[{supplier:'Поставщик X'}]},
 {name:'Лак',productType:'Спрей',category:'Укладка',location:'Полка',unit:'шт.',sku:'',barcode:'',position:5,
  balance:0,packageQuantity:1,minStock:null,targetStock:null,tareWeight:0,
  canConsume:true,canSell:true,supplierOffers:[]},
];
assert.equal(hasStockFilters(emptyStockFilters()),false);
assert.deepEqual(stockFilterOptions(items,x=>x.productType),['Крем','Спрей']);
const cases=[
 [{type:'Крем'},[true,false]], [{category:'Укладка'},[false,true]],
 [{location:'Шкаф'},[true,false]], [{unit:'г'},[true,false]],
 [{supplier:'Поставщик X'},[true,false]], [{usage:'both'},[false,true]],
 [{sku:'chi10'},[true,false]], [{barcode:'45'},[true,false]],
 [{name:'8a'},[true,false]], [{availability:'zero'},[false,true]],
 [{availability:'minimum'},[true,false]], [{availability:'target'},[true,false]],
 [{price:'known'},[true,false]], [{price:'missing'},[false,true]],
 [{tare:'known'},[false,true]], [{position:'4'},[true,false]],
 [{minStock:'0.5'},[true,false]], [{targetStock:'1'},[true,false]],
 [{packageQuantity:'60'},[true,false]], [{grossWeight:'88'},[false,false]],
];
for (const [filter, expected] of cases) {
 assert.deepEqual(items.map(item=>matchesStockFilters(item,{...emptyStockFilters(),...filter})),expected,
   'Filter mismatch '+JSON.stringify(filter));
}
assert.match(ui,/matchesStockFilters\(item, STOCK_VIEW\.itemsFilters\)/);
assert.match(ui,/data-inventory-stock-filter-action/);
assert.match(ui,/itemsFilters: emptyStockFilters\(\)/);
console.log('PASS: all item fields, combined filters and live stock thresholds');
