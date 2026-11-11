import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { procedureEditorSignature } from '../../core/service/procedures/editor-signature.js';

const original = {
  name: 'Укладка', duration: 30, breakDuration: 0,
  cost: { mode: 'from-to', from: '1500', to: '3000', free: false },
  description: 'Укладка', groupEnabled: false, groupCapacity: 2,
  workplaces: [{ workplaceId: 'one', name: 'Первое' }],
};
const signature = procedureEditorSignature(original);
const changed = (patch) => procedureEditorSignature({ ...original, ...patch }) !== signature;
assert.equal(changed({}), false, 'Unchanged form must hide Save');
assert.equal(changed({ name: 'Новая укладка' }), true, 'Name edit enables Save');
assert.equal(changed({ name: 'Укладка ' }), false, 'Insignificant whitespace is not dirty');
assert.equal(changed({ duration: 45 }), true, 'Duration edits enable Save');
assert.equal(changed({ breakDuration: 15 }), true, 'Break edits enable Save');
assert.equal(changed({ cost: { ...original.cost, from: '1700' } }), true, 'Price edits enable Save');
assert.equal(changed({ cost: { mode: 'amount', amount: '1500' } }), true, 'Price mode edits enable Save');
assert.equal(changed({ description: 'Другое описание' }), true, 'Description edits enable Save');
assert.equal(changed({ groupEnabled: true }), true, 'Group toggle enables Save');
assert.equal(changed({ groupCapacity: 8 }), false, 'Hidden capacity is irrelevant while group booking is off');
assert.equal(changed({ workplaces: [{ workplaceId: 'two' }] }), true, 'Workplace selection enables Save');
assert.equal(changed({ workplaces: [{ workplaceId: 'one', name: 'Переименовано' }] }), false, 'Workspace display names are not edits');
assert.equal(changed({ workplaces: [...original.workplaces, { workplaceId: 'two' }] }), true);
assert.equal(procedureEditorSignature({ ...original, name: 'Укладка' }), signature, 'Reverting an edit hides Save');
const enabled = { ...original, groupEnabled: true, groupCapacity: 2 };
assert.notEqual(procedureEditorSignature({ ...enabled, groupCapacity: 4 }), procedureEditorSignature(enabled),
  'Capacity changes are meaningful when group booking is on');

const source = readFileSync('core/service/procedures/form.js', 'utf8');
const markerOrder = [
  "name: 'procedureName'",
  "name: 'procedureDuration'",
  "name: 'procedureCost'",
  "name: 'procedureDescription'",
  "title: 'Групповая запись'",
  "serviceWorkplaceSelector(procedure.workplaces)",
];
const positions = markerOrder.map((marker) => source.indexOf(marker));
assert.ok(positions.every((position) => position >= 0), 'All six form sections must exist');
assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'Field sections must use the approved order');
assert.match(source, /setSharedActionVisible\(actions, changed\)/, 'Shared Save visibility must follow dirty state');
assert.match(source, /if \(saving \|\| !syncDirty\(\)\) return null/, 'Unchanged form must not submit');
assert.match(source, /onChange: \(workplaces\) => \{[\s\S]*?syncDirty\(\)/, 'Workplace changes must sync');
assert.match(source, /if \(event\.target\.closest\('\[data-cost-mode\]'\)\) syncDirty\(\)/, 'Cost-mode changes must sync');
assert.match(source, /form\.addEventListener\('input', syncDirty\)/, 'Text changes must sync');
assert.match(source, /form\.addEventListener\('change', syncDirty\)/, 'Input changes must sync');
assert.match(readFileSync('ui/duration/index.js', 'utf8'),
  /hidden\.dispatchEvent\(new Event\('change',\{bubbles:true\}\)\)/,
  'Duration picker must emit a shared form change event');
console.log('PASS: Procedure fields ordered and Save shown only when substantive edits exist');
