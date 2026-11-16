import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stock = readFileSync('core/inventory/inventory.js', 'utf8');
const sale = readFileSync('core/sale/sale.js', 'utf8');
const completeness = readFileSync('core/inventory/completeness.js', 'utf8');

// Existing shared movement controls retain their canonical units.
const options = stock.match(/const UNIT_OPTIONS = \[[\s\S]*?\n\];/);
assert.ok(options);
const stockUnits = new Function(options[0] + '\nreturn UNIT_OPTIONS;')();
assert.deepEqual(stockUnits.map(row => row.value), ['г', 'мл', 'шт.', 'уп.']);
assert.match(stock, /const STOCK_DISPOSAL_UNITS = UNIT_OPTIONS;/);
assert.match(stock, /\['шт\.', 'уп\.'\]\.includes\(inputUnit\)/);
assert.match(stock, /quantityUnit: inputUnit/);
assert.match(sale, /\['шт\.', 'уп\.'\]\.includes\(product\.unit\)/);

// A product creation card has distinct dimensions.
const choices = stock.slice(stock.indexOf('const INVENTORY_RECEIPT_UNITS'),
  stock.indexOf('function inventoryPackPieceCount'));
const { INVENTORY_RECEIPT_UNITS: receiptUnits, INVENTORY_PACK_CONTENT_UNITS: packUnits,
  INVENTORY_PIECE_NOMINAL_UNITS: nominalUnits, INVENTORY_CONSUMPTION_UNITS: consumptionUnits } =
  new Function(choices + '\nreturn { INVENTORY_RECEIPT_UNITS, INVENTORY_PACK_CONTENT_UNITS, INVENTORY_PIECE_NOMINAL_UNITS, INVENTORY_CONSUMPTION_UNITS };')();
assert.deepEqual(receiptUnits.map(row => row.value), ['шт.', 'уп.']);
assert.deepEqual(packUnits.map(row => row.value), ['шт.', 'г', 'кг', 'мл', 'л']);
assert.deepEqual(nominalUnits.map(row => row.value), ['шт.', 'г', 'кг', 'мл', 'л']);
assert.deepEqual(consumptionUnits.map(row => row.value), ['шт.', 'мл', 'г', 'л', 'кг']);
assert.match(stock, /pack\.hidden = receipt !== 'уп\.'/);
assert.match(stock, /data-inventory-one-piece-nominal/);
assert.match(stock, /name: 'packContentQuantity'/);
assert.match(stock, /name: 'packContentUnit'/);
assert.match(stock, /name: 'thresholdUnit'/);
assert.match(stock, /let consumptionUnitEdited = !creating/);
assert.match(stock, /setSelectValue\('consumeUnit', preferred\)/);
assert.match(stock, /setSelectValue\('thresholdUnit', preferredThreshold\)/);
assert.doesNotMatch(stock, /data-inventory-package-fields/);
assert.doesNotMatch(stock, /Списать после ресурса/);

// Unknown measurements cannot block creating a catalogue item.
assert.doesNotMatch(stock, /if \(mustMeasure && !containerMode\)/);
assert.doesNotMatch(stock, /if \(mustMeasure && !\(net > 0\)\)/);
assert.doesNotMatch(stock, /if \(unsupported\.length\)/);
assert.doesNotMatch(stock, /if \(sale && enteredPrice == null && calculatedPrice == null\)/);

const helperCode = stock.slice(stock.indexOf('const INVENTORY_PACK_CONTENT_UNITS'),
  stock.indexOf('const RESOURCE_UNIT_OPTIONS'));
const pricingCode = stock.slice(stock.indexOf('function salePurchaseCost'),
  stock.indexOf('function inventoryCalculationUnit'));
const { inventoryPackContent, inventoryPackPieceCount, inventoryNewStockUnit,
  inventoryStockPerPiece, inventoryContentInBaseUnits, salePurchaseCost, markedUpSalePrice } =
  new Function(helperCode + '\n' + pricingCode +
    '\nreturn { inventoryPackContent, inventoryPackPieceCount, inventoryNewStockUnit, inventoryStockPerPiece, inventoryContentInBaseUnits, salePurchaseCost, markedUpSalePrice };')();

// Multi-piece packaging has count; bulk packaging has measured contents.
assert.deepEqual(inventoryPackContent({ receiptUnit: 'уп.', unit: 'шт.', packageQuantity: 10 }),
  { quantity: '10', unit: 'шт.' });
assert.deepEqual(inventoryPackContent({ receiptUnit: 'уп.', unit: 'мл', packageQuantity: 50,
  nominalQuantity: 5, nominalUnit: 'мл',
  conversionRules: [{ unit: 'шт.', stockPerUnit: 5 }] }), { quantity: '10', unit: 'шт.' });
assert.deepEqual(inventoryPackContent({ receiptUnit: 'уп.', unit: 'г', packageQuantity: 5000,
  nominalQuantity: 5, nominalUnit: 'кг', conversionRules: [] }), { quantity: '5', unit: 'кг' });
assert.deepEqual(inventoryPackContent({ receiptUnit: 'уп.', unit: 'г', packageQuantity: 900,
  nominalQuantity: 900, nominalUnit: 'г' }), { quantity: '900', unit: 'г' });
assert.deepEqual(inventoryPackContent({ receiptUnit: 'шт.', unit: 'мл', packageQuantity: 80,
  nominalQuantity: 80, nominalUnit: 'мл' }), { quantity: '', unit: 'шт.' });

const stockBase = (receipt, packUnit, nominalUnit, nominalQuantity, consumeUnit, netWeight = null) =>
  inventoryNewStockUnit({ receipt, packUnit, nominalUnit, nominalQuantity, consumeUnit, netWeight });
assert.equal(stockBase('шт.', 'шт.', '', 0, 'шт.'), 'шт.');              // Lacquer, no measurements
assert.equal(stockBase('шт.', 'шт.', 'мл', 80, 'г'), 'шт.');            // Dye, mass not yet known
assert.equal(stockBase('шт.', 'шт.', 'мл', 80, 'г', 74), 'г');          // Dye, weighed net
assert.equal(stockBase('шт.', 'шт.', 'мл', 80, 'мл'), 'мл');           // Dye, measured ml
assert.equal(stockBase('уп.', 'шт.', 'мл', 5, 'мл'), 'мл');            // Ampoules, liquid usage
assert.equal(stockBase('уп.', 'шт.', 'мл', 5, 'г'), 'шт.');            // Ampoules, grams unknown
assert.equal(stockBase('уп.', 'шт.', '', 0, 'шт.'), 'шт.');            // Gloves and files
assert.equal(stockBase('уп.', 'кг', null, null, 'кг'), 'г');         // Soil (5kg)
assert.equal(stockBase('уп.', 'г', null, null, 'г'), 'г');           // Powder (900g)
assert.equal(inventoryContentInBaseUnits(5, 'кг'), 5000);
assert.equal(inventoryContentInBaseUnits(0.5, 'л'), 500);
assert.equal(inventoryStockPerPiece('г', 'мл', 80, 74), 74);
assert.equal(inventoryStockPerPiece('мл', 'мл', 80, null), 80);
assert.equal(inventoryStockPerPiece('г', 'кг', 5, null), 5000);

const ampoules = { purchasePrice: 200, receiptUnit: 'уп.', packPieces: 10,
  stockUnit: 'мл', packageQuantity: 50, nominalQuantity: 5, nominalUnit: 'мл' };
assert.equal(salePurchaseCost({ ...ampoules, saleUnit: 'шт.', saleQuantity: 1 }), 20);
assert.equal(salePurchaseCost({ ...ampoules, saleUnit: 'мл', saleQuantity: 5 }), 20);
assert.equal(salePurchaseCost({ purchasePrice: 200, receiptUnit: 'уп.', packPieces: null,
  stockUnit: 'г', packageQuantity: 1000, nominalQuantity: 1000, nominalUnit: 'г',
  saleUnit: 'г', saleQuantity: 5 }), 1);
assert.equal(salePurchaseCost({ purchasePrice: 200, receiptUnit: 'уп.', packPieces: null,
  stockUnit: 'г', packageQuantity: 5000, nominalQuantity: 5, nominalUnit: 'кг',
  saleUnit: 'кг', saleQuantity: 2 }), 80);
assert.equal(markedUpSalePrice(20, { mode: 'percent', value: 50 }), 30);

const thresholdSource = completeness.slice(completeness.indexOf('export function inventoryStockThresholdInput'),
  completeness.indexOf('// Actual balance is stored in grams'))
  .replaceAll('export function ', 'function ');
const { inventoryStockThresholdInput, inventoryStockThresholdStored } = new Function(thresholdSource +
  '\nreturn { inventoryStockThresholdInput, inventoryStockThresholdStored };')();
assert.equal(inventoryStockThresholdInput({}, 1.05), 1.05);
assert.equal(inventoryStockThresholdStored({}, 1.05), 1.05);
// A complete item can be recorded without knowing net weight; a later
// measurement supplies a gram conversion without changing stock base.
assert.match(stock, /if \(net > 0\) setConversion\('г', perPiece \/ net\)/);
assert.match(stock, /Остальные сведения можно заполнить позже/);
assert.match(stock, /opened: Boolean\(item\.itemId\)/);

// Actual date of arrival or finishing is entered in the existing movement Q.
assert.match(stock, /name: 'occurredDate', type: 'date', value: inventoryToday\(\)/);
assert.match(stock, /kind: actualKind,\s*occurredAt,/);
const dateHelpers = stock.slice(stock.indexOf('function editorDate'),
  stock.indexOf('// Shared input and selector owners supply the controls.'));
const { inventoryOccurredAt } = new Function(dateHelpers + '\nreturn { inventoryOccurredAt };')();
const recorded = inventoryOccurredAt('2026-11-16');
assert.ok(recorded);
assert.equal(new Date(recorded).getFullYear(), 2026);
assert.equal(new Date(recorded).getMonth(), 10);
assert.equal(new Date(recorded).getDate(), 16);
assert.equal(inventoryOccurredAt('2026-02-30'), null);
assert.equal(inventoryOccurredAt(''), null);
console.log('PASS: dated arrival and completion, optional knowledge, late measured conversion');

console.log('PASS: 12 inventory types, unknown measurements, bulk packaging, threshold 1.05 and sale costs');
