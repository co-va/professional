import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const form = readFileSync('core/inventory/inventory.js', 'utf8');
const layout = readFileSync('ui/forms/forms.css', 'utf8');
const sharedCheck = readFileSync('ui/selection/check-list.css', 'utf8');
const disclosure = readFileSync('core/inventory/orders.js', 'utf8');

assert.match(form, /segmentControl\(\[/);
for (const name of ['Жидкость', 'Упаковка', 'Инструмент']) assert.ok(form.includes("label: '"+name+"'"));
assert.match(form, /initSegmentControls\(form\)/);
assert.match(form, /<details/);
assert.match(form, /<summary/);
assert.match(disclosure, /<details data-inventory-order-excluded/);
assert.doesNotMatch(form, /data-accordion-trigger/);
assert.doesNotMatch(form, /data-inventory-conversion/);
assert.doesNotMatch(form, /'1 ' \+ unit \+ ' ='/);
assert.match(form, /massFromVolume/);
assert.match(form, /data-inventory-gross-net-tare/);
assert.match(form, /data-inventory-net-only/);
assert.match(form, /stockPerUnit: 1 \/ net/);
assert.match(form, /data-inventory-usage-check="sale"/);
assert.match(sharedCheck, /border-radius:8px/);
assert.match(sharedCheck, /color:var\(--text\);font-size:19px/);
assert.match(sharedCheck, /width:var\(--ui-compact-size,28px\)/);
assert.doesNotMatch(layout, /\.ui-compact-check__mark/);
assert.doesNotMatch(layout, /\.accordion-chevron/);
console.log('PASS: approved inventory card uses AV segmented control, native disclosure and shared compact white/black check');
