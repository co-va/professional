import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const source = read('core/service/workplace-selection.js');
const services = read('core/service/procedures/form.js');
const products = read('core/service/products/products.js');
const serviceOverview = read('core/service/procedures/procedures.js');
const productOverview = read('core/service/products/products.js');
const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function loadHelper(path, fn) {
  const module = read(path)
    .replace(/^import\s+[\s\S]*?\sfrom\s+['"][^'"]+['"];\s*/gm, '')
    .replace(/^export\s+/gm, '');
  return new Function('escapeHtml', module + '\nreturn ' + fn)(escapeHtml);
}

const compactCheck = loadHelper('ui/selection/check-list.js', 'compactCheck');
const selectionTrigger = loadHelper('ui/selectors/index.js', 'selectionTrigger');
const singleSelect = loadHelper('ui/selectors/index.js', 'select');
const workplaces = [
  { key: 'a', name: 'Бьюти тория' },
  { key: 'b', name: 'Фея' },
  { key: 'c', name: 'Дом Анапа' },
  { key: 'd', name: 'Тест не записываться' },
  { key: 'e', name: 'Дом Москва' },
];
const options = { content: '', config: {} };
let inputs = [];
const modal = (content, config) => ({ content, config });
const mountModal = (_root, surface) => {
  options.content = surface.content;
  options.config = surface.config;
  inputs = Array.from(surface.content.matchAll(/<input type="checkbox"([^>]*)>/g), (match) => {
    const id = match[1].match(/data-service-workplace="([^"]*)"/)?.[1] || '';
    return {
      checked: /\bchecked\b/.test(match[1]),
      dataset: { serviceWorkplace: id },
      events: {},
      addEventListener(type, callback) { this.events[type] = callback; },
      change(checked) { this.checked = checked; this.events.change(); },
    };
  });
  return { querySelectorAll: () => inputs };
};
const module = source
  .replace(/^import\s+[\s\S]*?\sfrom\s+['"][^'"]+['"];\s*/gm, '')
  .replace(/^export\s+/gm, '');
const picker = new Function('compactCheck', 'selectionTrigger', 'modal', 'mountModal', 'escapeHtml',
  'getWorkplaces', 'document', module +
  '\nreturn { serviceWorkplaceSelector, bindServiceWorkplaceSelection };')(
    compactCheck, selectionTrigger, modal, mountModal, escapeHtml,
    () => workplaces, { body: {} },
  );

const selected = [{
  workplaceId: 'a', name: 'Бьюти тория', cost: { mode: 'from-to', from: '1500', to: '3000' },
}];
const markup = picker.serviceWorkplaceSelector(selected);
assert.match(markup, /data-service-workplace-open/);
assert.match(markup, /Рабочие пространства/);
assert.match(markup, /Выбрано: 1/);
assert.match(markup, /ui-select__control/);
assert.match(markup, /ui-select__value/);
assert.match(markup, /ui-select__meta/);
assert.doesNotMatch(markup, /ui-list--dense|ui-list__item/);
const profession = singleSelect({ name: 'profession', value: 'Парикмахер', options: ['Парикмахер'] });
assert.match(profession, /ui-select__control/);
assert.match(profession, /ui-select__value/);
assert.match(profession, /ui-select__chevron/);
assert.match(markup, /ui-select__chevron/);
const selectorCss = read('ui/selectors/selectors.css');
assert.match(read('css/style.css'), /--ui-control-height:48px/);
assert.match(selectorCss, /--ui-selector-control-height:var\(--ui-control-height\)/);
assert.match(read('ui/time/time.css'), /\.time-picker__button\{[^}]*min-height:var\(--ui-control-height\)/);
assert.match(read('ui/duration/duration.css'), /\.duration-picker__button\{[^}]*min-height:var\(--ui-control-height\)/);
assert.match(selectorCss, /\.ui-select__control\{[^}]*min-height:var\(--ui-selector-control-height\)/);
assert.doesNotMatch(markup, /type="checkbox"|data-add-workplace|data-workplace-selector|app-notification/);
const count = { textContent: 'Выбрано: 1' };
const trigger = {
  events: {},
  addEventListener(type, callback) { this.events[type] = callback; },
  querySelector() { return count; },
};
const draftChanges = [];
const binding = picker.bindServiceWorkplaceSelection({
  querySelector: () => trigger,
}, { selected, onChange: (data) => draftChanges.push(data) });
assert.equal(binding.read().length, 1);
assert.equal(draftChanges.length, 0, 'Opening Q must not write a new draft or trigger saving');

trigger.events.click();
assert.equal(options.config.variant, 'x');
assert.equal(options.config.xRole, 'picker');
assert.equal(options.config.className, 'modal--form-sheet');
assert.equal(inputs.length, workplaces.length);
assert.deepEqual(inputs.map((input) => input.checked), [true, false, false, false, false]);
assert.match(options.content, /ui-compact-check/);
assert.doesNotMatch(options.content, /app-notification-row|ui-select__control|workplace-select-row/);
assert.equal((options.content.match(/<span class="ui-compact-check__label">Бьюти тория<\/span>/g) || []).length, 1);
assert.equal((options.content.match(/<span class="ui-compact-check__label">Фея<\/span>/g) || []).length, 1);

inputs[0].change(false);
assert.deepEqual(draftChanges.at(-1), []);
assert.equal(count.textContent, 'Не выбрано');
inputs[1].change(true);
assert.equal(draftChanges.at(-1).length, 1);
assert.equal(draftChanges.at(-1)[0].workplaceId, 'b');
assert.equal(count.textContent, 'Выбрано: 1');
inputs[0].change(true);
assert.deepEqual(draftChanges.at(-1).map((item) => item.workplaceId), ['a', 'b']);
assert.equal(draftChanges.at(-1)[0].cost.from, '1500',
  'Removing and re-adding a workplace must preserve its own price');

trigger.events.click();
assert.deepEqual(inputs.map((input) => input.checked), [true, true, false, false, false],
  'Reopen the picker with the current Q draft selection');

for (const [kind, form, overview] of [
  ['procedure', services, serviceOverview],
  ['product', products, productOverview],
]) {
  assert.match(form, new RegExp('serviceWorkplaceSelector\\(' + kind + '\\.workplaces\\)'));
  assert.match(form, /bindServiceWorkplaceSelection\(/);
  assert.doesNotMatch(form, /serviceWorkplaceChecklist|notificationSettings\(|workplaceSelector\(/,
    'No second in-Q picker or expanded checkbox list');
  assert.match(overview, /variant: 'q'/);
  assert.match(overview, /data-(?:procedure|product)-open-editor/);
  assert.match(overview, /data-(?:procedure|product)-editor-delete/);
  assert.doesNotMatch(overview, /openServiceWorkplaceSelection|data-(?:procedure|product)-settings/,
    'Do not restore service V menus');
}
console.log('PASS: one compact Q control, X multi-check list, five workplaces, draft persistence and prices');
