import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync('core/inventory/stock-item-editor.js','utf8');
// Execute the actual calculation from the current Q, not the removed text parser.
const start=source.indexOf('const salePrice = price == null');
const end=source.indexOf(';',start);
assert.ok(start>=0&&end>start);
const calc=new Function('price','markup','read',source.slice(start,end+1)+';return salePrice;');
assert.equal(calc(200,20,()=> 'percent'),240);
assert.equal(calc(200,20,()=> 'amount'),220);
assert.equal(calc(200,0,()=> 'percent'),200);
assert.equal(calc(200,null,()=> 'percent'),null);
assert.equal(calc(null,20,()=> 'amount'),null);
assert.match(source,/patch\.saleMarkupMode = mode/);
assert.match(source,/patch\.saleMarkupValue = markup/);
assert.match(source,/Критический остаток/);
assert.match(source,/Желаемый остаток/);
console.log('PASS: actual stock markup computation and persisted mode/value');
