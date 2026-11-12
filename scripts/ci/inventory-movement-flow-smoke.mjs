import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const inventory = readFileSync('core/inventory/inventory.js', 'utf8');
const start = inventory.indexOf('function movementNoteLabel(');
const end = inventory.indexOf('\n/**\n * Shared material-consumption', start);
assert.ok(start >= 0 && end > start, 'One shared movement editor must exist');
const editorSource = inventory.slice(start, end);
assert.doesNotMatch(inventory, /function openMovementKind\(/, 'No obsolete action-button menu');
assert.match(inventory, /addEventListener\('click', \(\) => openMovementEditor\(root, '', ''\)\)/, 'Plus opens one shared form');
assert.match(editorSource, /name: 'movementKind'/, 'Operation is selected inside the form');
assert.match(inventory, /id: 'inventory', label: 'Инвентаризация'/, 'Stocktake remains under Stock');
assert.doesNotMatch(editorSource, /function movementEditorRow\(|searchableSelect\(/, 'No obsolete per-item dropdown forms');
assert.ok(editorSource.indexOf('data-inventory-movement-selection') < editorSource.indexOf('data-inventory-movement-row'), 'Select items before quantities');

for (const kind of ['RECEIPT', 'CONSUMPTION', 'WRITE_OFF', 'RETURN']) {
  const item = { itemId: 'A', name: 'Краска', manufacturer: 'CHI', balance: 100, unit: 'г', canConsume: true };
  const nodes = {
    choices: { innerHTML: '' },
    search: { value: '', addEventListener() {} },
    count: { textContent: '' },
    next: { disabled: true, addEventListener(name, fn) { this[name] = fn; } },
  };
  let first;
  let second;
  let created;
  let quantityMarkup = '';
  const form = {
    addEventListener(name, fn) { this[name] = fn; },
    querySelectorAll() {
      return [{
        dataset: { itemId: 'A', rowDirection: '' },
        querySelector: selector => selector.includes('quantity') ? { value: '7' } : { value: '2' },
      }];
    },
  };
  const error = { textContent: '' };
  const save = { disabled: false };
  const deps = {
    getInventoryMovement: () => null,
    select: () => '<operation-selector>',
    getInventoryItems: () => [item],
    getInventoryItem: () => item,
    movementTitle: value => value.kind,
    stockSearchField: () => '<search>',
    actionBlock: value => value,
    button: value => '<button>' + value + '</button>',
    modal: value => value,
    mountModal: (root, markup) => {
      if (!first) {
        first = {
          querySelector: selector => selector.includes('choices') ? nodes.choices
            : selector.includes('search') ? nodes.search
              : selector.includes('count') ? nodes.count : nodes.next,
          addEventListener(name, fn) { this[name] = fn; },
          v2Close() { this.closed = true; },
        };
        return first;
      }
      quantityMarkup = markup;
      second = {
        querySelector: selector => selector.includes('movement-form') ? form
          : selector.includes('movement-error') ? error : save,
        v2Close() { this.closed = true; },
      };
      return second;
    },
    compactCheck: () => '<check>',
    emptyState: () => '',
    normalizedSearch: text => text || '',
    manufacturerName: value => value.manufacturer,
    itemSearchText: value => value.name,
    numberText: String,
    escapeHtml: value => String(value || ''),
    field: ({ label }) => '<field>' + label + '</field>',
    isWeighedInventoryItem: value => value?.unit === 'г',
    createInventoryMovement: async value => { created = value; },
    correctInventoryMovement: async () => {},
    renderMovements: () => {},
    openNotice: () => {},
    notifyContext: () => {},
    FormData: class { get(name) { return name === 'supplier' ? 'Поставщик' : ''; } },
  };
  const open = new Function('deps',
    `const { ${Object.keys(deps).join(',')} } = deps; ${editorSource}; return openMovementEditor;`)(deps);

  open({}, '', '');
  assert.equal(nodes.choices.innerHTML, '', `${kind}: no items before selecting operation`);
  assert.equal(nodes.next.disabled, true, `${kind}: disabled without operation`);
  first.change({ target: { matches: selector => selector === 'input[name="movementKind"]', value: kind } });
  assert.match(nodes.choices.innerHTML, /<check>/, `${kind}: item options after selecting operation`);
  assert.equal(nodes.next.disabled, true, `${kind}: cannot advance without a material`);
  first.change({ target: { closest: () => ({ checked: true, dataset: { inventoryMovementItem: 'A' } }) } });
  assert.equal(nodes.next.disabled, false, `${kind}: selected material allows advancing`);
  nodes.next.click();
  assert.match(quantityMarkup, /Количество, г/, `${kind}: correct unit`);
  assert.doesNotMatch(quantityMarkup, /value="0"/, `${kind}: no invented initial quantity`);
  await form.submit({ preventDefault() {} });
  assert.equal(created?.kind, kind);
  assert.equal(created.lines.length, 1);
  assert.equal(created.lines[0].itemId, 'A');
  assert.equal(created.lines[0].quantity, 7);
  assert.equal(created.lines[0].containerDelta,
    ['CONSUMPTION', 'WRITE_OFF'].includes(kind) ? -2 : 2);
  if (kind === 'RECEIPT') assert.equal(created.supplier, 'Поставщик');
  assert.equal(first.closed, true, `${kind}: close selection after save`);
  assert.equal(second.closed, true, `${kind}: close quantities after save`);
}
console.log('PASS: 4 inventory operations select real items, submit quantity/tubes, close both steps');
