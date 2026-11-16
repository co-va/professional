import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const code = readFileSync('core/inventory/orders.js', 'utf8');
const start = code.indexOf('async function transferMissingOrderLines(');
const end = code.indexOf('function openInventoryOrderCarryOver(', start);
assert.ok(start > 0 && end > start);
assert.match(code, /id: 'unavailable', label: 'Перенести позиции'/);
assert.match(code, /modal\(markup, \{ title: 'Перенести позиции', variant: 'q' \}\)/);
assert.match(code, /data-inventory-carryover-check/);
assert.match(code, /'Перенести в следующий заказ'/);
const copy = v => JSON.parse(JSON.stringify(v));
const lines = [
  {itemId:'a',name:'Краска 7N',packages:2,packPrice:1389.75,offerId:'oa'},
  {itemId:'b',name:'Краска 8N',packages:1,packPrice:999,offerId:'ob'},
  {itemId:'c',name:'Оксид',packages:3,packPrice:100,offerId:'oc'},
];
async function transferScenario(mode) {
  let orders = [{orderId:'source',status:'formed',supplier:'CHI',
    note:'Исходная заметка',lines:copy(lines)}];
  const original = copy(orders[0]);
  const calls = [];
  const dependencies = {
    getInventoryOrder: id => orders.find(o => o.orderId === id),
    getInventoryOrders: () => orders,
    getInventoryItems: () => lines.map(line => ({itemId:line.itemId})),
    orderNumber: id => id,
    createInventoryPurchaseOrder: async payload => {
      calls.push('create');
      orders.push({orderId:'next',status:'formed',...copy(payload)});
    },
    updateInventoryPurchaseOrder: async (id,payload) => {
      calls.push('update');
      if (mode === 'rejected') throw Error('Remote rejected');
      const row = orders.find(o => o.orderId === id);
      row.lines = copy(payload.lines);
      row.note = payload.note;
      if (mode === 'lostResponse') throw Error('Response lost');
    },
    deleteInventoryPurchaseOrder: async id => {
      calls.push('rollback');
      orders = orders.filter(o => o.orderId !== id);
    },
    loadInventory: async () => { calls.push('refresh'); },
  };
  const transfer = new Function(...Object.keys(dependencies),
    code.slice(start, end) + '\nreturn transferMissingOrderLines;')(
      ...Object.values(dependencies));
  let next, error;
  try { next = await transfer(original, new Set(['b','c'])); }
  catch (caught) { error = caught; }
  return {orders,original,next,error,calls};
}
const success = await transferScenario('success');
assert.equal(success.error,undefined);
assert.equal(success.next,'next');
assert.deepEqual(success.orders[0].lines.map(x=>x.itemId), ['a']);
assert.equal(success.orders[0].lines[0].packPrice,1389.75);
assert.match(success.orders[0].note,/Не поставлено/);
assert.deepEqual(success.orders[1].lines.map(x=>x.itemId), ['b','c']);
assert.deepEqual(success.orders[1].lines.map(x=>x.packages), [1,3]);
assert.deepEqual(success.orders[1].lines.map(x=>x.packPrice), [0,0],
  'A new supplier invoice must not inherit the old billed prices');
assert.equal(success.orders[1].supplier,'CHI');
assert.deepEqual(success.calls,['create','update']);
const rejected = await transferScenario('rejected');
assert.match(String(rejected.error),/Remote rejected/);
assert.deepEqual(rejected.orders,[rejected.original], 'Rollback cannot lose lines');
assert.deepEqual(rejected.calls,['create','update','refresh','rollback']);
const ackLost = await transferScenario('lostResponse');
assert.equal(ackLost.next,'next');
assert.equal(ackLost.error,undefined);
assert.deepEqual(ackLost.calls,['create','update','refresh']);
assert.deepEqual(ackLost.orders[0].lines.map(x=>x.itemId),['a']);
assert.deepEqual(ackLost.orders[1].lines.map(x=>x.itemId),['b','c']);
// Next order uses exactly the already-approved "correct order" editor. The
// catalog contains other products that can be selected into the new order.
const chooseStart = code.indexOf('function initialOrderLines(');
const chooseEnd = code.indexOf('function openInventoryOrderReview(',chooseStart);
assert.ok(chooseStart>0 && chooseEnd>chooseStart);
const choose = new Function('manufacturer','suggestedPacks',
  code.slice(chooseStart,chooseEnd)+'\nreturn initialOrderLines;')(
    item=>item.manufacturer||'CHI',
    ()=>1);
const catalog = [
  ...lines.map(l=>({itemId:l.itemId,manufacturer:'CHI'})),
  {itemId:'additional',manufacturer:'CHI',name:'Новый краситель'},
];
const selected = choose(catalog,[], '',success.orders[1]);
assert.deepEqual([...selected.selected.keys()],['b','c']);
assert.ok(catalog.some(item=>item.itemId==='additional'),
  'The new order must still allow additions from the full catalog');
console.log('PASS: transfer Q, next order, history, rollback, lost response, catalog extension');
