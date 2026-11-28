import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../core/payment/record-payment.js', import.meta.url), 'utf8');
const read = readFileSync(new URL('../../core/finance/read.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('function openPaymentCorrectionSelection('), source.indexOf('async function openPaymentRefund('));
const payments = [
  {id:'p1',total:5000,occurredAt:'2026-11-27T09:00:00Z',allocations:[{walletName:'Наличные',amount:5000}]},
  {id:'p2',total:7000,occurredAt:'2026-11-28T09:00:00Z',allocations:[{walletName:'Карта',amount:7000}]},
];
const controls = payments.map(p=>({dataset:{recordPaymentCorrectionId:p.id},addEventListener(name,fn){this[name]=fn;}}));
const host = {innerHTML:'',querySelectorAll:()=>controls};
let closed = 0, selected = null, opened = 0;
const deps = {
  openPaymentCorrection:(_r,p)=>{selected=p.id;},
  mountPaymentQ:()=>{opened++;return {querySelector:()=>host,v2Close:()=>closed++};},
  zonedDateTimeParts: value=>({date:value.slice(0,10),time:'12:00'}),
  paymentWorkplaceTimeZone:()=> 'Europe/Moscow',
  paymentAllocations:p=>p.allocations || [],
  paymentDepositAllocations:p=>p.depositAllocations || [],
  money:String,
  escapeHtml:String,
  v2ListEntry:x=>JSON.stringify(x),
  v2ListEntries:x=>x.join('\n'),
};
const open = new Function(...Object.keys(deps), block+'\nreturn openPaymentCorrectionSelection;')(...Object.values(deps));
open({}, {payments}, ()=>{});
assert.equal(opened,1);
for(const value of ['p1','p2','27.11.2026','28.11.2026','Наличные','Карта','5000','7000']) assert.ok(host.innerHTML.includes(value),value);
assert.equal(selected,null,'Opening correction never posts or selects a payment');
controls[0].click();
assert.equal(selected,'p1','Earlier payment can be selected');
assert.equal(closed,1);
open({}, {payments:[payments[1]]}, ()=>{});
assert.equal(selected,'p2','Single payment retains direct editor');
assert.equal(opened,1,'Single payment needs no extra picker');
assert.match(read,/depositAllocations: Array\.isArray\(data\.depositAllocations\)/);
assert.match(read,/personalAccountAmount: Math\.max\(0, financialNumber\(data\.personalAccountAmount\)\)/);
const entry = source.slice(source.indexOf('async function openPaymentEntry('),source.indexOf('async function openPaymentCorrection('));
assert.doesNotMatch(entry,/state\.payments|openPaymentCorrectionSelection/,'Quick payment X must not show history');
assert.match(entry,/if \(paymentInFlightRecords\.has\(recordId\)\) return;\s*const selected/);
assert.match(entry,/if \(!submit \|\| paymentInFlightRecords\.has\(recordId\)\) return/);
assert.match(entry,/allocations: selected\.allocations/);
assert.match(entry,/if \(allocationHost\) allocationHost\.inert = true/);
assert.match(entry,/finally \{\s*paymentInFlightRecords\.delete\(recordId\);/);
console.log('PASS: existing correction lists every editable payment and preserves direct single-payment path; quick X has no history and uses a frozen in-flight allocation');
