import assert from 'node:assert/strict';
import {paymentAllocationState,selectedPaymentRows,paymentAllocationRemainder,nextPaymentAllocation,paymentMethodsMarkup,initPaymentMethodsAllocation} from '../ui/payment/methods.js';
const total=12000, cash={source:'wallet:cash',amount:5000}, card={source:'wallet:card',amount:7000};
assert.deepEqual(nextPaymentAllocation(total,[]),{needed:true,suggested:null});
assert.deepEqual(nextPaymentAllocation(total,[{source:'',amount:12000}]),{needed:true,suggested:null});
assert.equal(paymentAllocationRemainder(total,[]),12000);
assert.deepEqual(nextPaymentAllocation(total,[{...cash,amount:12000}]),{needed:false,suggested:0});
assert.deepEqual(nextPaymentAllocation(total,[cash]),{needed:true,suggested:7000});
assert.deepEqual(nextPaymentAllocation(total,[cash,{source:'',amount:7000}]),{needed:true,suggested:7000});
assert.deepEqual(selectedPaymentRows([cash,{source:'',amount:7000}]),[cash]);
assert.deepEqual(nextPaymentAllocation(total,[cash,card]),{needed:false,suggested:0});
assert.deepEqual(nextPaymentAllocation(total,[cash,{...card,amount:2000}]),{needed:true,suggested:5000});
assert.equal(paymentAllocationRemainder(.3,[{source:'wallet:cash',amount:.1},{source:'wallet:card',amount:.2}]),0);
assert.deepEqual(nextPaymentAllocation(0,[]),{needed:true,suggested:null});
assert.deepEqual(nextPaymentAllocation(0,[{source:'wallet:cash',amount:100}]),{needed:false,suggested:0});
const wallets=[{id:'cash',name:'Наличные'},{id:'card',name:'Карта'}];
const markup=paymentMethodsMarkup({wallets,total});
assert.equal((markup.match(/data-payment-allocation-row="/g)||[]).length,1);
assert.equal((paymentMethodsMarkup({wallets,total,initialAllocations:[{walletId:'cash',amount:5000},{walletId:'card',amount:7000}]}).match(/data-payment-allocation-row="/g)||[]).length,2);
// Test the real allocator event handlers without relying on an authenticated account.
// Minimal DOM fixture preserves row identity and dispatches selector/input events.
function control(value=''){
 const listeners={};return {value,readOnly:false,addEventListener(type,fn){(listeners[type]??=[]).push(fn)},fire(type){for(const fn of listeners[type]||[])fn({target:this})}};
}
const parts=[];let index=0;
function addRow(){
 const source=control(),amount=control();
 const part={dataset:{paymentAllocationRow:String(index++)},querySelector(query){return query.startsWith('input[data-payment-allocation-source]')?source:amount},remove(){parts.splice(parts.indexOf(part),1)},source,amount};
 parts.push(part);return part;
}
const rowHost={insertAdjacentHTML(){addRow()},get lastElementChild(){return parts.at(-1)},appendChild(part){parts.splice(parts.indexOf(part),1);parts.push(part)}};
const submit=control(),first=addRow();
const root={querySelector(q){return q==='[data-payment-allocation-rows]'?rowHost:q==='[data-payment-allocation-submit]'?submit:null},querySelectorAll(){return parts}};
let latest,paid;const controller=initPaymentMethodsAllocation(root,{wallets,total,onChange:s=>latest=s,onPay:s=>paid=s});
assert.equal(parts.length,1);assert.equal(submit.disabled,true);
first.source.value='wallet:cash';first.source.fire('change');
assert.equal(first.amount.value,'12 000');assert.equal(parts.length,1);assert.equal(submit.disabled,false);
first.amount.value='5000';first.amount.fire('input');
assert.equal(parts.length,2);assert.equal(parts[0],first);assert.equal(parts[1].amount.value,'7 000');assert.equal(parts[1].amount.readOnly,true);assert.equal(latest.received,5000);assert.equal(latest.remaining,7000);assert.equal(submit.disabled,false);
submit.fire('click');assert.equal(paid.appliedAmount,5000);assert.equal(paid.allocations.length,1);
const second=parts[1];second.source.value='wallet:card';second.source.fire('change');
assert.equal(second.amount.value,'7 000');assert.equal(parts.length,2);assert.equal(latest.received,12000);assert.equal(latest.remaining,0);
second.amount.value='2000';second.amount.fire('input');assert.equal(parts.length,3);assert.equal(parts[2].amount.value,'5 000');assert.equal(latest.received,7000);
second.amount.value='7000';second.amount.fire('input');assert.equal(parts.length,2);
second.source.value='';second.source.fire('change');assert.equal(parts.length,2);assert.equal(parts[1].amount.value,'7 000');assert.equal(latest.received,5000);
first.amount.value='12000';first.amount.fire('input');assert.equal(parts.length,1);
first.source.value='';first.source.fire('change');assert.equal(parts.length,1);assert.equal(parts[0].amount.value,'');assert.equal(submit.disabled,true);
assert.equal(controller.state().received,0);
console.log('PASS progressive payment allocation: automatic remainder, optional pending row, selected sources only, stable first field');
