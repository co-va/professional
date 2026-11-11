import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const selection = read('core/service/workplace-selection.js');
const procedureForm = read('core/service/procedures/form.js');
const procedureEditor = read('core/service/procedures/procedures.js');
const productEditor = read('core/service/products/products.js');
const recordEditor = read('core/records/records.js');
const pricing = read('core/service/procedures/selection.js');
const signature = read('core/service/editor-signature.js');
const persistence = read('core/service/workplace-assignment.js');

const moduleSource = (text) => text.replace(/^export\s+/gm, '');
const price = new Function(moduleSource(pricing) +
  'return { procedureDurationForWorkplace, procedureBreakForWorkplace, procedureDescriptionForWorkplace, procedureVisibleInBooking, procedurePricingForWorkplace };')();
const snapshot = new Function(moduleSource(signature) +
  'return { procedureEditorSignature, rebaseWorkplaceAssignmentSignature };')();

assert.match(selection, /data-service-workplace-add/);
assert.match(selection, /data-service-workplace-choose/);
assert.match(selection, /data-service-workplace-prices/);
assert.match(selection, /v2ListEntries\(read\(\)/);
assert.match(selection, /v2ListEntries\(available\.map/);
assert.doesNotMatch(selection, /service-workplace-price-row|service-workplace-add-option/);
assert.match(selection, /data-service-workplace-editor/);
assert.match(selection, /durationPicker\(\{/);
assert.match(selection, /costField\(\{/);
assert.match(selection, /textareaField\(\{/);
assert.match(selection, /data-local-online/);
assert.match(selection, /data-local-group/);
assert.doesNotMatch(selection, /data-service-workplace-options|selectedIds|compactCheck\(\{\s*label: space\.name/);
assert.match(procedureForm, /data-procedure-online-check/);
assert.match(procedureForm, /serviceWorkplaceAssignmentList\(/);
assert.match(procedureForm, /bindServiceWorkplaceAssignments\(/);
assert.match(productEditor, /bindServiceWorkplaceAssignments\(/);
assert.match(persistence, /async function commitServiceCollection/);
assert.match(persistence, /function changeWorkplaceAssignment/);
assert.match(persistence, /function changeServiceItemWorkplace/);
assert.ok(procedureEditor.indexOf('serviceWorkplaceAddButton()') < procedureEditor.indexOf('data-procedure-editor-delete'));
assert.ok(productEditor.indexOf('serviceWorkplaceAddButton()') < productEditor.indexOf('data-product-editor-delete'));
assert.match(recordEditor, /procedureDurationForWorkplace/);

const procedure = {
  name: 'Укладка', duration: 30, breakDuration: 5, description: 'Основа',
  cost: { mode: 'amount', amount: '1000' }, visibleInPublicBooking: true,
  workplaces: [
    { workplaceId: 'r', name: 'Ромашка' },
    {
      workplaceId: 'c', name: 'Чародейка', duration: 60, breakDuration: 10,
      description: 'Другой текст', cost: { mode: 'amount', amount: '2000' },
      visibleInPublicBooking: false,
    },
  ],
};
assert.equal(price.procedureDurationForWorkplace(procedure, 'r'), 30);
assert.equal(price.procedureDurationForWorkplace(procedure, 'c'), 60);
assert.equal(price.procedureBreakForWorkplace(procedure, 'c'), 10);
assert.equal(price.procedureDescriptionForWorkplace(procedure, 'c'), 'Другой текст');
assert.equal(price.procedureVisibleInBooking(procedure, 'r'), true);
assert.equal(price.procedureVisibleInBooking(procedure, 'c'), false);
assert.equal(price.procedurePricingForWorkplace(procedure, 'c').value, '2000');
const old = snapshot.procedureEditorSignature({ ...procedure, workplaces: [procedure.workplaces[0]] });
const rebased = snapshot.rebaseWorkplaceAssignmentSignature(old, 'c', procedure.workplaces[1]);
assert.equal(rebased, snapshot.procedureEditorSignature(procedure));
const removed = snapshot.rebaseWorkplaceAssignmentSignature(rebased, 'c', null);
assert.equal(removed, old);

console.log('PASS: button picker, one Service workplace assignment contract, local price/duration/description/booking and Q rebase');


// ACK-first behavior: rejected requests cannot change the Service data owner.
const collectionSource = read('core/service/workplace-assignment.js')
  .replace(/^import\s+[\s\S]*?\sfrom\s+['"][^'"]+['"];\s*/gm, '')
  .replace(/^export\s+/gm, '');
let serverReady = true;
const collection = new Function('flushBusinessPersistence', 'isBusinessServerReady',
  collectionSource + '\nreturn { commitServiceCollection, changeServiceItemWorkplace };')(
  async () => {}, () => serverReady,
);
const clone = (value) => JSON.parse(JSON.stringify(value));
const original = [{ id: 'hair', name: 'Укладка', workplaces: [
  { workplaceId: 'a', name: 'Ромашка', cost: { amount: '1000' } },
  { workplaceId: 'b', name: 'Чародейка', cost: { amount: '2000' } },
]}];
let owned = clone(original);
let writes = 0;
const mutation = (items) => collection.changeServiceItemWorkplace(items, 'hair', 'a', { duration: 60 });
const readOwner = () => clone(owned);
const hydrateOwner = (items) => { owned = clone(items); };
const rejected = async () => { writes += 1; return { ok: false, error: new Error('Rejected') }; };
await assert.rejects(
  () => collection.commitServiceCollection({
    read: readOwner, persist: rejected, hydrate: hydrateOwner, mutate: mutation,
  }), /Rejected/,
);
assert.deepEqual(owned, original, 'Rejected request must not mutate cached Service data');
assert.equal(writes, 1, 'One request is attempted, never a silent second write');
await collection.commitServiceCollection({
  read: readOwner,
  persist: async () => { writes += 1; return { ok: true }; },
  hydrate: hydrateOwner, mutate: mutation,
});
assert.equal(writes, 2);
assert.equal(owned[0].workplaces[0].duration, 60);
assert.equal(owned[0].workplaces[1].cost.amount, '2000');
serverReady = false;
await assert.rejects(
  () => collection.commitServiceCollection({
    read: readOwner, persist: rejected, hydrate: hydrateOwner, mutate: mutation,
  }), /Нет соединения/,
);
assert.equal(writes, 2, 'Offline must never claim success');
