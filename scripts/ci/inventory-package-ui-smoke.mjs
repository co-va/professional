import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const stock = readFileSync('core/inventory/inventory.js', 'utf8');
const sale = readFileSync('core/sale/sale.js', 'utf8');
const options = stock.match(/const UNIT_OPTIONS = \[[\s\S]*?\n\];/);
assert.ok(options);
const source = options[0]+'\nconst STOCK_DISPOSAL_UNITS = UNIT_OPTIONS;\nreturn STOCK_DISPOSAL_UNITS;';
const dropdown = new Function(source)();
assert.deepEqual(dropdown.map(x => x.label), ['г', 'мл', 'шт.', 'уп.']);
assert.match(stock,/const STOCK_DISPOSAL_UNITS = UNIT_OPTIONS;/);
assert.match(stock,/\['шт\.', 'уп\.'\]\.includes\(inputUnit\)/);
assert.match(stock,/quantityUnit: inputUnit/);
assert.match(sale,/\['шт\.', 'уп\.'\]\.includes\(product\.unit\)/);
console.log('PASS: packaging option in consumption and sale, integer quantities, canonical stock conversion');

 // Card-level units are distinct from generic movement units:
 // receipt: only pieces/packs; one-piece nominal and usage: never packs.
const receiptSource = stock.match(/const INVENTORY_RECEIPT_UNITS = \[[^\n]*\];/);
const nominalSource = stock.match(/const INVENTORY_NOMINAL_UNITS = \[[^\n]*\];/);
const consumptionSource = stock.match(/const INVENTORY_CONSUMPTION_UNITS = \[[^\n]*\];/);
for (const row of [receiptSource, nominalSource, consumptionSource]) assert.ok(row);
const receiptOptions = new Function(receiptSource[0] + '\nreturn INVENTORY_RECEIPT_UNITS;')();
const nominalOptions = new Function(nominalSource[0] + '\nreturn INVENTORY_NOMINAL_UNITS;')();
const consumeOptions = new Function(consumptionSource[0] + '\nreturn INVENTORY_CONSUMPTION_UNITS;')();
assert.deepEqual(receiptOptions.map(x => x.value), ['шт.', 'уп.']);
assert.deepEqual(nominalOptions.map(x => x.value), ['шт.', 'мл', 'г']);
assert.deepEqual(consumeOptions.map(x => x.value), ['шт.', 'мл', 'г']);
assert.match(stock, /pack\.hidden = receipt !== 'уп\.'/);
assert.match(stock, /let consumptionUnitEdited = !creating/);
assert.match(stock, /if \(event\.target\?\.name === 'consumeUnit'\) consumptionUnitEdited = true/);
assert.match(stock, /input\('consumeUnit'\)\.value = selectedNominal/);
assert.match(stock, /chosen\.find\(value => value !== 'уп\.'\) \|\| 'шт\.'/);
assert.match(stock, /data-inventory-receipt-row/);
assert.match(stock, /label: 'Количество', name: 'packPieces'/);
assert.doesNotMatch(stock, /data-inventory-package-fields/);
assert.doesNotMatch(stock, /Списать после ресурса/);

const pieceHelpers = stock.slice(stock.indexOf('function inventoryPackPieceCount'), stock.indexOf('const RESOURCE_UNIT_OPTIONS'));
const priceHelpers = stock.slice(stock.indexOf('function salePurchaseCost'), stock.indexOf('function inventoryCalculationUnit'));
const { inventoryPackPieceCount, inventoryStockPerPiece, salePurchaseCost, markedUpSalePrice } =
  new Function(pieceHelpers + '\n' + priceHelpers +
    '\nreturn { inventoryPackPieceCount, inventoryStockPerPiece, salePurchaseCost, markedUpSalePrice };')();
assert.equal(inventoryPackPieceCount({ receiptUnit: 'уп.', unit: 'шт.', packageQuantity: 10 }), '10');
assert.equal(inventoryPackPieceCount({ receiptUnit: 'уп.', unit: 'мл', packageQuantity: 50, nominalUnit: 'мл', nominalQuantity: 5 }), '10');
assert.equal(inventoryPackPieceCount({ receiptUnit: 'шт.', unit: 'мл', packageQuantity: 5, nominalUnit: 'мл', nominalQuantity: 5 }), '');
assert.equal(inventoryStockPerPiece('шт.', 'мл', 5, null), 1);
assert.equal(inventoryStockPerPiece('мл', 'мл', 5, null), 5);
assert.equal(inventoryStockPerPiece('г', 'мл', 5, 4), 4);
const pack = { purchasePrice: 200, receiptUnit: 'уп.', packPieces: 10, nominalUnit: 'мл', nominalQuantity: 5 };
assert.equal(salePurchaseCost({ ...pack, stockUnit: 'шт.', packageQuantity: 10, saleUnit: 'шт.', saleQuantity: 1 }), 20);
assert.equal(salePurchaseCost({ ...pack, stockUnit: 'мл', packageQuantity: 50, saleUnit: 'мл', saleQuantity: 5 }), 20);
assert.equal(salePurchaseCost({ ...pack, stockUnit: 'г', packageQuantity: 40, saleUnit: 'г', saleQuantity: 1 }), 5);
assert.equal(markedUpSalePrice(20, { mode: 'percent', value: 50 }), 30);
console.log('PASS: receipt first, conditional piece count, nominal per piece, pack-aware cost');
