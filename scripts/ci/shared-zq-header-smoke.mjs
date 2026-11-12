import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { v2ZFrame, v2QFrame } from '../../ui/v2/z-layout.js';

const read = (path) => readFileSync(path, 'utf8');
const src = read('ui/v2/z-layout.js');
const css = read('ui/v2/v2.css');
const surface = read('ui/v2/surface-header.css');
const people = read('core/people/people.js');
const inventory = read('core/inventory/inventory.js');
const card = read('ui/cards/entity-card-constructor.css');
const arrow = read('ui/v2/z-affordance.js');

const getStyle = (html, kind, slot = 'header') => {
  const pattern = new RegExp('<div data-v2-' + kind + '-' + slot + ' style="([^"]+)"');
  const value = html.match(pattern)?.[1];
  assert.ok(value, 'Missing Shared ' + kind + ' ' + slot);
  return value;
};

for (const count of [0, 1, 2, 3, 4]) {
  const rows = Array.from({ length: count }, (_, i) => '<div data-fixture-row="' + i + '">control</div>').join('');
  const z = v2ZFrame('Z BODY', { header: rows });
  const q = v2QFrame('Q BODY', { header: rows });
  const zStyle = getStyle(z, 'z');
  const qStyle = getStyle(q, 'q');
  assert.equal(zStyle, qStyle, 'Z/Q header geometry differs at ' + count + ' controls');
  assert.match(zStyle, /--v2-surface-header-spacing:12px/, 'One X = 12px');
  assert.match(zStyle, /padding-top:var\(--v2-surface-header-spacing\)/);
  assert.match(zStyle, /padding-bottom:var\(--v2-surface-header-spacing\)/);
  assert.match(zStyle, /grid-template-columns:24px minmax\(0,1fr\)/);
  assert.match(zStyle, /align-items:center/, 'Back arrow must stay centered');
  const zContent = getStyle(z, 'z', 'header-content');
  const qContent = getStyle(q, 'q', 'header-content');
  assert.match(zContent, /gap:var\(--v2-surface-header-spacing\)/);
  assert.match(qContent, /gap:var\(--v2-surface-header-spacing\)/);
  assert.doesNotMatch(getStyle(q, 'q', 'body'), /padding-top/, 'Q must not have second gap');
}

assert.match(css, /\.v2-layer-portal\.is-q>\.v2-layer-backdrop\[data-v2-q="true"\]>\.v2-layer--standard\{[^}]*padding-top:0\}/);
assert.match(arrow, /'margin:0 0 0 18px'/);
assert.match(surface, /\.ui-search-field\{padding:0\}/);
assert.match(surface, /\.segment-control\{margin:0\}/);
assert.doesNotMatch(surface, /margin-bottom:8px|padding-bottom:0!important/);
assert.doesNotMatch(src, /Q_HEADER_BODY_GAP|Z_HEADER_BODY_GAP|Q_HEADER_STYLE/, 'No competing per-modal geometry');
assert.doesNotMatch(people, /people-search-divider ui-search-divider/, 'Contacts/History cannot inject separators');
assert.doesNotMatch(inventory, /people-search-divider ui-search-divider/, 'Stock Z1 cannot inject extra separator');
assert.match(inventory, /setV2ZHeaderRows\(layer, \[stockSearchField\(/, 'Stock Z2 search belongs in its header');
assert.match(card, /\.entity-card-appearance-q__selectors\{display:grid;gap:var\(--v2-surface-header-spacing\)/, 'Nested Q selectors must use X');

console.log('PASS: one Z/Q header for 0–4 controls; X=12px; arrows centered; no redundant search lines or Q gaps.');
