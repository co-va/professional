import assert from 'node:assert/strict';
import { ddsRegistryParts } from '../core/finance/dds/registry-parts.js';
import { registeredRoute } from '../core/finance/dds/article-view.js';
const canonical=[
{articleId:'deposit',name:'Депозит',values:[{valueId:'fund',name:'Пополнение',routes:['DEPOSIT_RECEIVED']},{valueId:'pay',name:'Оплата',routes:['DEPOSIT_SPEND']},{valueId:'refund',name:'Возврат',routes:['DEPOSIT_RETURN','DEPOSIT_PAYMENT_REFUND']}],routes:[]},
{articleId:'services',name:'Оказание услуг',values:[{valueId:'service',name:'Оплата услуг',routes:['SERVICE_REVENUE']},{valueId:'tip',name:'Чаевые',routes:['TIPS']}],routes:[]},
{articleId:'purchase',name:'Закупка',values:[{valueId:'return',name:'Возврат',routes:['MATERIALS_REFUND']}],routes:[]}
];
const entry=(route,amount,direction='IN')=>({articleClass:registeredRoute(canonical,route),amount,direction,walletId:'cash',walletName:'Наличные'});
const run=(entries,facts,first={})=>ddsRegistryParts({id:'doc',first,entries,facts},[],canonical);
const funding=run([entry('DEPOSIT_RECEIVED',50000)],{kind:'deposit-funding',bonus:0,allocations:[]});
assert.equal(funding.length,1);assert.deepEqual([funding[0].article,funding[0].articleValue,funding[0].money,funding[0].bonus],['Депозит','Пополнение',50000,0]);
const discount={depositId:'d',benefitAmount:2000};
const alloc={depositId:'d',name:'Зима',amount:8000,principal:10000,bonus:2000,principalMovement:-10000,bonusMovement:2000,accounting:{grossAmount:10000,benefitGranted:2000,benefitUsed:0,benefitRestored:0,benefitReversed:0}};
const payment=run([],{kind:'payment',discount,allocations:[alloc],conditionalGranted:2000,bonus:2000});
assert.equal(payment.length,1);assert.deepEqual([payment[0].article,payment[0].articleValue,payment[0].money,payment[0].bonus],['Депозит','Оплата',-10000,2000]);
const external=run([entry('SERVICE_REVENUE',8000)],{kind:'payment',discount,allocations:[],conditionalGranted:2000,bonus:2000,priceDepositName:'Зима'});
assert.equal(external.length,2);assert.equal(external[1].bonus,2000);assert.equal(external[1].money,0);
const refund=run([],{kind:'refund',discount,allocations:[{...alloc,principalMovement:10000,bonusMovement:-2000,accounting:{...alloc.accounting,benefitGranted:0,benefitReversed:2000}}],conditionalReversed:2000,bonus:-2000});
assert.equal(refund.length,1);assert.deepEqual([refund[0].articleValue,refund[0].money,refund[0].bonus],['Возврат',10000,-2000]);
const tips=run([entry('SERVICE_REVENUE',8000),entry('TIPS',500)],null);
assert.equal(tips.length,2);assert.equal(tips.reduce((n,r)=>n+r.money,0),8500);assert.equal(tips[0].articleId,tips[1].articleId);assert.notEqual(tips[0].articleValueId,tips[1].articleValueId);
const purchase=run([entry('MATERIALS_REFUND',1200)],null);
assert.deepEqual([purchase[0].article,purchase[0].articleValue,purchase[0].direction,purchase[0].money],['Закупка','Возврат','in',1200]);
const unresolved=run([{articleClass:null,amount:42,direction:'IN',walletName:'Наличные'}],null);
assert.equal(unresolved[0].article,'');assert.equal(unresolved[0].money,42);
console.log('PASS mechanism registry');
