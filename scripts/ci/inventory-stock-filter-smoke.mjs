import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const code = readFileSync('core/inventory/stock-filters.js', 'utf8');
const ui = readFileSync('core/inventory/inventory.js', 'utf8');
const helper = readFileSync('core/inventory/completeness.js', 'utf8');
const source = code.replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '');
const fn = new Function('inventoryStockBalanceInThresholdUnits',
  source + '\nreturn {emptyStockFilters,hasStockFilters,matchesStockFilters,stockFilterOptions,STOCK_FILLED,STOCK_EMPTY};');
const getBalance = new Function(helper.replace(/^export /gm, '')
  + '\nreturn inventoryStockBalanceInThresholdUnits;')();
const {emptyStockFilters,hasStockFilters,matchesStockFilters,stockFilterOptions,STOCK_FILLED,STOCK_EMPTY} = fn(getBalance);
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
 [{type:'Крем'},[true,false]], [{type:STOCK_FILLED},[true,true]],
 [{type:STOCK_EMPTY},[false,false]], [{category:'Укладка'},[false,true]],
 [{category:STOCK_FILLED},[true,true]], [{location:'Шкаф'},[true,false]],
 [{location:STOCK_EMPTY},[false,false]], [{unit:'г'},[true,false]],
 [{supplier:'Поставщик X'},[true,false]], [{supplier:STOCK_FILLED},[true,false]],
 [{supplier:STOCK_EMPTY},[false,true]], [{usage:'both'},[false,true]],
 [{name:STOCK_FILLED},[true,true]], [{name:STOCK_EMPTY},[false,false]],
 [{sku:STOCK_FILLED},[true,false]], [{sku:STOCK_EMPTY},[false,true]],
 [{barcode:STOCK_FILLED},[true,false]], [{barcode:STOCK_EMPTY},[false,true]],
 [{availability:'zero'},[false,true]], [{availability:'minimum'},[true,false]],
 [{availability:'target'},[true,false]], [{price:'known'},[true,false]],
 [{price:'missing'},[false,true]], [{tare:'known'},[false,true]],
 [{tare:'missing'},[true,false]], [{position:STOCK_FILLED},[true,true]],
 [{position:STOCK_EMPTY},[false,false]], [{minStock:STOCK_FILLED},[true,false]],
 [{minStock:STOCK_EMPTY},[false,true]], [{targetStock:STOCK_FILLED},[true,false]],
 [{targetStock:STOCK_EMPTY},[false,true]], [{packageQuantity:STOCK_FILLED},[true,true]],
 [{grossWeight:STOCK_EMPTY},[true,true]],
 [{name:STOCK_FILLED,sku:STOCK_EMPTY,availability:'zero'},[false,true]],
];
for (const [filter, expected] of cases) {
 assert.deepEqual(items.map(item=>matchesStockFilters(item,{...emptyStockFilters(),...filter})),expected,
   'Filter mismatch '+JSON.stringify(filter));
}
assert.match(ui,/matchesStockFilters\(item, STOCK_VIEW\.itemsFilters\)/);
assert.match(ui,/data-inventory-stock-filter-action/);
assert.match(ui,/itemsFilters: emptyStockFilters\(\)/);
const uiFilters = ui.slice(ui.indexOf('function openStockControls('),ui.indexOf('function bindManufacturerCards('));
assert.doesNotMatch(uiFilters, /field\(\{label:'(?:Наименование|Артикул|Штрихкод|Порядковый №|Минимум|Цель|Упаковка|Брутто)/);
assert.match(uiFilters, /name:'inventoryFilterSku', value:draft.sku, options:presenceOptions/);
const search = ui.slice(ui.indexOf('function itemSearchText('),ui.indexOf('function manufacturerName('));
assert.match(search, /item\.name,[\s\S]*item\.sku,[\s\S]*item\.barcode,/);
console.log('PASS: all item fields, combined filters and live stock thresholds');
