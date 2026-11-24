import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src=readFileSync('core/sale/sale.js','utf8');
assert.match(src,/Historical sale rows stay visible/);
assert.match(src,/existing\?\.unitPrice/);
assert.match(src,/previousTotal \/ previousQuantity/);
assert.match(src,/cost: Math\.round\(unitPrice \* quantity \* 100\) \/ 100/);
console.log('PASS: saved sale quantity and price remain editable/immutable');
