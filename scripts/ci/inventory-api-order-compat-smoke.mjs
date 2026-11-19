import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('core/inventory/service.js', 'utf8');
const ui = readFileSync('core/inventory/inventory.js', 'utf8');
const body = source.replace(/^import [^\n]+\n/gm, '').replace(/^export /gm, '');
const makeService = new Function('apiRequest', 'applyInventorySnapshot', 'getInventoryItem',
  body + '\nreturn {updateInventoryItem, reorderInventoryItems};');

let response = null;
let refreshed = 0;
let editedPosition = 0;
const service = makeService(
  async (path, options) => {
    assert.equal(options.method, path.endsWith('/reorder') ? 'POST' : 'PUT');
    return {ok: response.ok, status:response.status, json:async()=>response.payload};
  },
  payload => {refreshed++; return payload;},
  itemId => ({itemId, position:editedPosition}),
);

response = {ok:false,status:404,payload:{message:'Cannot POST /inventory/items/reorder'}};
await assert.rejects(() => service.reorderInventoryItems('CHI',['a','b']),
  /Сервер склада ещё не обновлён\. Порядок не сохранён/);
assert.equal(refreshed,0, 'HTTP 404 never changes inventory snapshot');

response = {ok:true,status:200,payload:{items:[{itemId:'x',name:'shade'}]}};
await assert.rejects(() => service.updateInventoryItem('x',{position:4}),
  /Номер не сохранился\. Сервер склада ещё не обновлён/);
assert.equal(refreshed,0,'Server ignoring number does not lead to false-success refresh');

response = {ok:true,status:200,payload:{items:[{itemId:'x',position:4}]}};
await service.updateInventoryItem('x',{position:4});
assert.equal(refreshed,1,'Server-acknowledged number change updates state');

response = {ok:true,status:200,payload:{items:[
  {itemId:'a',manufacturer:'CHI',position:1},
  {itemId:'b',manufacturer:'CHI',position:2},
]}};
await service.reorderInventoryItems('CHI',['a','b']);
assert.equal(refreshed,2,'Verified reorder response refreshes the state once');

response = {ok:true,status:200,payload:{items:[{itemId:'a',manufacturer:'CHI',position:1}]}};
await assert.rejects(()=>service.reorderInventoryItems('CHI',['a','b']),
  /Порядок не сохранён/);
assert.equal(refreshed,2,'Incomplete reorder response is not accepted');

assert.match(ui, /data-inventory-item-save-error role="alert" hidden/,
  'Save errors are visible in the existing Q instead of being dismissed');
assert.match(ui, /saveError\.hidden = false/, 'Save error is persisted until user edits');
assert.match(ui, /message\.dataset\.inventoryReorderError = ''/,
  'Reorder errors remain visible within the current Z without new modal');
assert.doesNotMatch(ui, /onError: \(error\) => openNotice/,
  'Reorder failures no longer rely on a transient modal');
console.log('PASS: old API 404, ignored PUT position, verified saves, durable errors, no false successes');
