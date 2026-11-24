import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { procedureEditorSignature } from '../../core/service/editor-signature.js';

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
  "procedureGroupBookingFields({",
  "data-procedure-online-check",
  "serviceGroupFields('procedures',",
  "serviceWorkplaceAssignmentList()",
];
const positions = markerOrder.map((marker) => source.indexOf(marker));
assert.ok(positions.every((position) => position >= 0), 'All current form sections must exist');
assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'Field sections must use the approved order');
assert.match(readFileSync('core/service/procedures/group-booking-ui.js', 'utf8'), /title: 'Групповая запись'/, 'Group booking label belongs to its shared UI owner');
assert.match(source, /createServiceSaveController\(primary, \{/);
const sharedActions = readFileSync('core/service/editor-actions.js', 'utf8');
assert.match(sharedActions, /setSharedActionVisible\(actions, changed\)/, 'Shared Save visibility must follow dirty state');
assert.match(source, /if \(saving \|\| assignmentSaving \|\| !syncDirty\(\)\) return null/, 'Unchanged or busy form must not submit');
assert.match(source, /onChange: \(workplaces\) => \{[\s\S]*?syncDirty\(\)/, 'Workplace changes must sync');
assert.match(source, /if \(event\.target\.closest\('\[data-cost-mode\]'\)\) syncDirty\(\)/, 'Cost-mode changes must sync');
assert.match(source, /form\.addEventListener\('input', syncDirty\)/, 'Text changes must sync');
assert.match(source, /form\.addEventListener\('change', syncDirty\)/, 'Input changes must sync');
assert.match(readFileSync('ui/duration/index.js', 'utf8'),
  /hidden\.dispatchEvent\(new Event\('change',\{bubbles:true\}\)\)/,
  'Duration picker must emit a shared form change event');
console.log('PASS: Procedure fields ordered and Save shown only when substantive edits exist');

// Run the real shared action owner in a browser, including actual FormData
// and the common UI visibility/disabled mechanisms.
const { build } = await import('esbuild');
const { chromium } = await import('playwright');
const bundle = await build({
  stdin: {
    contents: "import { bindServiceNameSave, createServiceSaveController } from './core/service/editor-actions.js'; globalThis.serviceActions = { bindServiceNameSave, createServiceSaveController };",
    resolveDir: process.cwd(), loader: 'js',
  },
  bundle: true, write: false, format: 'iife', platform: 'browser',
});
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  await page.setContent('<form id="group"><input name="name" value="Группа"><button id="group-save">Сохранить</button><button id="group-delete" type="button">Удалить</button></form><form id="value"><input name="name"><button id="value-save">Сохранить</button></form><div class="modal-actions"><button id="primary">Сохранить</button></div>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(() => {
    const { bindServiceNameSave, createServiceSaveController } = globalThis.serviceActions;
    const group=document.querySelector('#group');
    const value=document.querySelector('#value');
    globalThis.groupChanged=bindServiceNameSave(group,document.querySelector('#group-save'),{name:'Группа'});
    globalThis.valueChanged=bindServiceNameSave(value,document.querySelector('#value-save'),null);
    globalThis.state={signature:'original',baseline:'original',saving:false,assignmentSaving:false};
    globalThis.controller=createServiceSaveController(document.querySelector('#primary'),{
      signature:()=>state.signature, baseline:()=>state.baseline,
      busy:()=>state.saving||state.assignmentSaving,
    });
    controller.syncDirty();
  });
  assert.equal(await page.locator('#group-save').isVisible(),false);
  assert.equal(await page.locator('#group-delete').isVisible(),true);
  assert.equal(await page.locator('#value-save').isVisible(),false);
  await page.locator('#group input').fill('  Группа  ');
  assert.equal(await page.locator('#group-save').isVisible(),false);
  await page.locator('#group input').fill('Новое имя');
  assert.equal(await page.locator('#group-save').isVisible(),true);
  assert.equal(await page.evaluate(()=>groupChanged()),true);
  await page.locator('#group input').fill('');
  assert.equal(await page.locator('#group-save').isVisible(),false);
  await page.locator('#value input').fill('Значение');
  assert.equal(await page.locator('#value-save').isVisible(),true);
  assert.equal(await page.evaluate(()=>valueChanged()),true);
  await page.locator('#value input').fill('   ');
  assert.equal(await page.locator('#value-save').isVisible(),false);
  const snap = async (patch={}) => page.evaluate(p=>{
    Object.assign(state,p);
    const changed=controller.syncDirty();
    const primary=document.querySelector('#primary');
    return [changed,controller.currentVisibility(),primary.dataset.v2PrimaryVisible,primary.disabled,primary.parentElement.hasAttribute('data-ui-action-hidden')];
  },patch);
  assert.deepEqual(await snap(),[false,false,'false',false,true]);
  assert.deepEqual(await snap({signature:'edit'}),[true,true,'true',false,false]);
  assert.deepEqual(await snap({saving:true}),[true,true,'true',true,false]);
  assert.deepEqual(await snap({saving:false,assignmentSaving:true}),[true,true,'true',true,false]);
  assert.deepEqual(await snap({assignmentSaving:false}),[true,true,'true',false,false]);
  assert.deepEqual(await snap({baseline:'edit'}),[false,false,'false',false,true]);
  assert.deepEqual(await snap({signature:'new edit'}),[true,true,'true',false,false]);
  assert.deepEqual(await snap({signature:'edit'}),[false,false,'false',false,true]);
} finally { await browser.close(); }
const products=readFileSync('core/service/products/products.js','utf8');
const grouping=readFileSync('core/service/catalog-grouping.js','utf8');
assert.match(products,/createServiceSaveController\(primary, \{/);
assert.equal((grouping.match(/bindServiceNameSave\(form, saveButton, previous\)/g)||[]).length,2);
assert.doesNotMatch(source,/const syncDirty = \(\) =>/);
assert.doesNotMatch(products,/const syncDirty = \(\) =>/);
console.log('PASS: real shared Service Save actions, empty/reverted names, independent delete, dirty state, busy and baseline rebase');
