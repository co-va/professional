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
assert.match(css, /\.mini-card\{--mini-card-width:290px;--mini-card-height:200px;/, 'Every MiniCard has the approved fixed 290 × 200 geometry');
assert.ok(css.includes('grid-template-rows:auto minmax(0,1fr) auto'), 'All MiniCards share fixed header, scroll centre, fixed footer');
assert.ok(css.includes('.mini-card__record-center{min-height:0;min-width:0;overflow-y:auto'), 'Only the center owns vertical scroll');
assert.doesNotMatch(css, /238px|144px|176px/, 'Alternative MiniCard dimensions must never return');
assert.equal((css.match(/\.mini-card\{/g) || []).length, 1, 'MiniCard geometry must have one CSS owner');
const examples = [
  card,
  expanded,
  miniCard({title:'История',value:'9 000 ₽',subtitle:'21.10.26',interactive:true,data:'data-history'}),
  miniCard({lines:[{value:'Окраска',rightValue:'9 000 ₽'}]}),
];
for (const html of examples) {
  assert.equal((html.match(/data-mini-card-ui="shared"/g) || []).length, 1, 'All formats must use one mini-card renderer');
  for (const zone of ['head','center','footer']) {
    assert.equal((html.match(new RegExp('class="mini-card__record-' + zone + '"','g')) || []).length, 1,
      'Every format must have exactly one shared ' + zone + ' zone');
  }
}
assert.match(css, /\.mini-card\{[^}]*border-radius:16px;/, 'User-rounded card geometry must be retained');

const paired = miniCard({ lines: [{ value: 'Запись', rightValue: '1 500 ₽', variant: 'moment' }] });
assert.match(paired, /mini-card__line--pair/);
assert.match(paired, /mini-card__line--moment/);
assert.match(paired, /mini-card__line-right/);
assert.match(js, /const hasCompactAction = Boolean/, 'User shared compact-action semantics must be used');

const paidViewerLayout = {
  headerMode: 'person',
  identity: '0050 Ира',
  phone: '+7 903 000-84-37',
  moment: '21.10.26 · 12:00–16:00',
  services: [{value: 'Стрижка · 1 ч', rightValue: '9 000 ₽'}, {value:'Окраска · 2 ч', rightValue: '9 000 ₽'}],
  duration: '4 ч',
  discount: '2 000 ₽',
  total: '25 000 ₽',
  footerLayout: 'three-column',
  rightAction: { label: '↻', data: 'data-record-view-repeat' },
};
const paidViewer = miniCard({ recordLayout: paidViewerLayout });
const editableViewer = miniCard({ recordLayout: {
  ...paidViewerLayout,
  leftAction: { label: 'Услуги', icon: 'settings', variant: 'secondary', data: 'data-record-view-service-settings' },
} });
assert.ok(paidViewer.includes('mini-card--record-no-left'), 'Paid viewer must reclaim left action slot');
assert.ok(paidViewer.includes('mini-card__record-top--no-left'));
assert.ok(paidViewer.includes('mini-card__record-action-placeholder--left'));
assert.ok(!paidViewer.includes('data-record-view-service-settings'));
assert.ok(editableViewer.includes('mini-card__record-action--secondary'));
assert.ok(editableViewer.includes('data-record-view-service-settings'));
assert.ok(!editableViewer.includes('mini-card--record-no-left'));
assert.ok(paidViewer.includes('mini-card__record-footer--triple'));
for(const [label,value] of [['Время','4 ч'],['Скидка','2 000 ₽'],['Итого','25 000 ₽']]){
  assert.ok(paidViewer.includes('mini-card__record-stat-label">' + label + '</span>'), 'Stat label ' + label);
  assert.ok(paidViewer.includes('mini-card__record-stat-value">' + value + '</strong>'), 'Stat value ' + value);
}
assert.equal(paidViewer.split('>Скидка</span>').length - 1, 1, 'Discount label cannot duplicate');
assert.ok(css.includes('.mini-card__record-stat-value{font-size:16px;line-height:20px;font-weight:800'));
assert.ok(css.includes('.mini-card--record-person .mini-card__record-top--no-left{grid-template-columns:minmax(0,1fr) 44px}'));
assert.ok(css.includes('.mini-card__record-footer--triple{grid-template-columns:'));
assert.ok(paidViewer.includes('Стрижка · 1 ч') && paidViewer.includes('Окраска · 2 ч'));


const timedViewer = miniCard({ recordLayout: {
  ...paidViewerLayout,
  momentParts: { date:'21.10.26', start:'12:00', end:'16:00' },
  moment: '21.10.26 · 12:00–16:00',
} });
assert.ok(timedViewer.includes('mini-card__record-moment--parts'), 'Date/start must use the fixed header row');
assert.ok(timedViewer.includes('mini-card__record-date">21.10.26</span>'), 'Date is visible and accessible');
assert.ok(timedViewer.includes('mini-card__record-time-start">12:00</span>'), 'Start time must be prominent');
assert.ok(timedViewer.includes('mini-card__record-time-end">–16:00</span>'), 'End time must be secondary');
assert.ok(timedViewer.indexOf('mini-card__record-moment--parts') <
  timedViewer.indexOf('mini-card__record-center'), 'Date and start are outside the scroll region');
assert.ok(!timedViewer.includes('mini-card__record-workplace'), 'Person header keeps duplicate workplace absent');
assert.ok(css.includes('.mini-card--record-person .mini-card__record-head{border-bottom:1px solid #c7c7c7;'),
  'Fixed header must have a visible bottom separator');
assert.ok(css.includes('.mini-card--record-person .mini-card__record-center{padding-top:4px;overflow-anchor:none}'),
  'Services must not touch or overlap the fixed header');
assert.ok(css.includes('.mini-card--record-person .mini-card__record-time-start{font-size:16px;'),
  'Start time must be readable');
assert.ok(css.includes('.mini-card--record-person .mini-card__record-time-end{font-size:12px;'),
  'End time must be visually secondary');
assert.ok(css.includes('width:min(290px,100%)') && css.includes('height:200px'),
  'Record card geometry must remain 290 × 200');

console.log('PASS: one 290×200 shared MiniCard shell for Record, services, products, loyalty history and long data');
