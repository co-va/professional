import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { miniCard, miniCardRail } from '../../ui/cards/mini-card.js';

const css = readFileSync('ui/cards/mini-card.css', 'utf8');
const js = readFileSync('ui/cards/mini-card.js', 'utf8');
const card = miniCard({
  title: 'Рабочее пространство',
  rows: [
    { label: 'Кол-во', value: '2' },
    { label: 'Время', value: '1 ч' },
    { label: 'Сумма', value: '3 000 ₽' },
  ],
});
assert.match(card, /<strong class="mini-card__title"[^>]*>Рабочее пространство<\/strong>/);
assert.equal((card.match(/class="mini-card__row"/g) || []).length, 3, 'All original Professional rows must remain');
assert.match(card, /<span class="mini-card__row-label">Кол-во<\/span>/);
assert.match(card, /<span class="mini-card__row-label">Время<\/span>/);
assert.match(card, /<span class="mini-card__row-label">Сумма<\/span>/);
assert.match(card, /mini-card__rows/, 'Professional service values remain in their existing rows');
assert.match(miniCardRail([card]), /data-mini-card-rail/, 'Shared rail remains unchanged');

const expanded = miniCard({ title: 'Пространство', rows: Array.from({ length: 12 }, (_, i) => ({
  label: 'Строка ' + i, value: 'Значение ' + i,
})) });
assert.equal((expanded.match(/class="mini-card__row"/g) || []).length, 12, 'Markup retains all supplied rows; the fixed User paper height is unchanged');
assert.match(css, /\.mini-card\{[^}]*--mini-card-width:238px;[^}]*max-width:var\(--mini-card-width\)/,
  'Paper width must remain 238px');
assert.match(css, /\.mini-card:has\(>\.mini-card__rows\):not\(\.mini-card--lines\)\s*\{[^}]*height:auto;[^}]*max-height:none;/,
  'Regular MiniCard factual rows must grow vertically');
assert.match(css, /\.mini-card--lines\{height:auto;min-height:176px;max-height:none;/,
  'Extended line MiniCards retain their existing variable height');
assert.match(css, /\.mini-card\{[^}]*border-radius:16px;/, 'User-rounded card geometry must be retained');

const paired = miniCard({ lines: [{ value: 'Запись', rightValue: '1 500 ₽', variant: 'moment' }] });
assert.match(paired, /mini-card__line--pair/);
assert.match(paired, /mini-card__line--moment/);
assert.match(paired, /mini-card__line-right/);
assert.match(js, /const hasCompactAction = Boolean/, 'User shared compact-action semantics must be used');
console.log('PASS: User MiniCard markup and fixed base geometry, Professional labels, rounded corners and variable-height line variant');
