import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compactButton, compactAddButton, compactRemoveButton, button, smallActionButton } from '../../ui/buttons/index.js';
import { repeatedField } from '../../ui/repeated-fields/index.js';
import { links } from '../../ui/links/index.js';
import { miniCard } from '../../ui/cards/mini-card.js';
import { dateNavigator, calendar } from '../../ui/calendar/calendar.js';

// A single 28x28 renderer is shared across all small buttons.
for (const kind of ['add', 'remove', 'info', 'copy', 'settings', 'repeat', 'card', 'previous', 'next']) {
  const markup = compactButton({ kind, symbol: '↻', data: 'data-compact-smoke', aria: 'Проверка' });
  assert.match(markup, new RegExp('ui-compact-button--' + kind));
  assert.match(markup, /data-compact-smoke/);
  assert.match(markup, /aria-label="Проверка"/);
  assert.doesNotMatch(markup, /class="ui-button/);
}
assert.match(compactRemoveButton(), /ui-compact-button--remove/);
assert.match(smallActionButton({ icon:'info' }), /ui-compact-button--info/);
assert.match(smallActionButton({ icon:'copy' }), /ui-compact-button--copy/);

const compact = compactAddButton({ className:'array-row__add', data:'data-repeated-add="phones"', aria:'Добавить телефон' });
assert.match(compact, /ui-compact-button--add/);
assert.match(compact, /array-row__add/);
assert.match(compact, /data-repeated-add="phones"/);
const phone = repeatedField({ label:'Телефон', name:'phones', values:['+79990000000'], type:'tel', addInHeader:true });
assert.match(phone, /class="array-group__header"/);
assert.match(phone, /ui-compact-button--add/);
const email = repeatedField({ label:'Email', name:'email', values:['a@example.com','b@example.com'], addInHeader:true });
assert.match(email, /ui-compact-button--remove/);
assert.match(email, /data-repeated-remove/);
assert.match(repeatedField({ label:'Заметка', name:'notes', addInHeader:false }), /ui-compact-button--add/);
assert.match(links({ name:'links', compact:true, addInHeader:true }), /ui-compact-button--add/);
assert.match(links({ name:'links',compact:false }), /ui-links__add/);
assert.match(button('Сохранить'), /class="ui-button /);

const record = miniCard({ recordLayout: {
  headerMode: 'person', identity:'Тест', moment:'13 11 26', duration:'1 ч', total:'1 000 ₽',
  leftAction: { label:'Настроить услуги', icon:'settings', variant:'secondary', data:'data-record-view-service-settings', aria:'Услуги записи' },
  rightAction: { label:'↻', data:'data-record-view-repeat', aria:'Повторить запись' },
} });
assert.match(record, /ui-compact-button--settings/);
assert.match(record, /mini-card__record-action-icon/);
assert.match(record, /mini-card__record-action--secondary/);
assert.match(record, /data-record-view-service-settings/);
assert.match(record, /ui-compact-button--repeat/);
assert.match(record, /data-record-view-repeat/);
assert.match(record, />↻<\/button>/);
const corner = miniCard({ title:'Программа', interactive:true, data:'data-open-card', compactAction:{label:'↻',data:'data-card-repeat'} });
assert.match(corner, /ui-compact-button--card/);
assert.match(corner, /mini-card__compact-action/);
assert.match(corner, /data-card-repeat/);
assert.match(corner, /data-open-card/);

const day = dateNavigator({ date: new Date(2026,10,13) });
const month = calendar({ value:'2026-11-13' });
for (const [markup,left,right] of [
  [day,'data-date-navigator-prev','data-date-navigator-next'],
  [month,'data-calendar-prev','data-calendar-next'],
]) {
  assert.match(markup, /ui-compact-button--previous/);
  assert.match(markup, /ui-compact-button--next/);
  assert.ok(markup.includes(left) && markup.includes(right), 'Existing navigation handlers must remain');
}

const css = readFileSync('ui/buttons/buttons.css','utf8');
const inputs = readFileSync('ui/inputs/inputs.css','utf8');
const cards = readFileSync('ui/cards/mini-card.css','utf8');
const dates = readFileSync('ui/calendar/calendar.css','utf8');
assert.match(css, /--ui-compact-size:28px/);
assert.equal((css.match(/\.ui-compact-button\{/g)||[]).length,1,'Only one Compact geometry owner');
assert.match(css, /\.ui-compact-button--settings\{/);
assert.match(css, /\.ui-compact-button--repeat\{/);
assert.match(css, /\.ui-compact-button--previous,\.ui-compact-button--next\{/);
assert.match(cards, /\.mini-card\{--mini-card-width:290px;--mini-card-height:200px/);
assert.match(cards, /\.mini-card__compact-action\{position:absolute;top:10px;right:10px;z-index:2\}/);
assert.doesNotMatch(cards, /\.mini-card__compact-action\{[^}]*width:30px/);
assert.doesNotMatch(cards, /\.mini-card__record-action\{[^}]*width:44px/);
assert.match(dates, /grid-template-columns:var\(--ui-compact-size\) minmax\(0,1fr\) var\(--ui-compact-size\)/);
assert.doesNotMatch(dates, /\.calendar__month-button\{[^}]*width:36px/);
assert.match(inputs, /\.array-group\[data-repeated-add-placement="header"\] \.array-group__header\{display:flex;align-items:center;justify-content:space-between/);
console.log('PASS: Compact 28px across add/remove/info/copy, MiniCard actions and day/month arrows');
