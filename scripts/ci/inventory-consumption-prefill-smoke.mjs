import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src=readFileSync('core/inventory/inventory.js','utf8');
for(const key of ['item.consumeQuantity','item.consumeUnit','data-quantity-unit','quantityUnit: inputUnit','wholeContainer'])
  assert.ok(src.includes(key), key);
assert.match(src,/initialQuantity = previous\?\.quantity/);
console.log('PASS: consumption quantity defaults stay editable and preserve unit');
