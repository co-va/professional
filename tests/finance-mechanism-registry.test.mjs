import assert from 'node:assert/strict';
import {sortArticleDirectory,mergeArticleSectionOrder,orderDDSArticleRows} from '../core/finance/dds/article-order.js';
import { ddsRegistryParts } from '../core/finance/dds/registry-parts.js';
import { registeredRoute, availableArticleDirectory, mechanismValueParents } from '../core/finance/dds/article-view.js';
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
const directory=[{articleId:'services',capability:'journal',systemKey:'MECHANISM_SERVICES',name:'Оказание услуг',values:[]},{articleId:'deposit',capability:'loyalty.deposit.access',systemKey:'MECHANISM_DEPOSIT',name:'Депозит',values:[{name:'Оплата'},{name:'Старое значение',archived:true}]},{articleId:'loan',deferred:true,systemKey:'LOAN_RECEIVED',name:'Займ',values:[]},{articleId:'retired',archived:true,name:'Прочие расходы',values:[]},{articleId:'custom',name:'Моя статья',values:[]}];
const available=availableArticleDirectory(directory,[],key=>key==='loyalty.deposit.access');
assert.deepEqual(available.map(a=>a.articleId),['deposit','custom']);assert.deepEqual(available[0].values.map(v=>v.name),['Оплата']);
assert.equal(availableArticleDirectory(null,[],()=>true),null);
const paidEntry={...entry('SERVICE_REVENUE',10000),entryId:'wallet1'};
const paidTip={...entry('TIPS',2000),entryId:'wallet2'};
const secondEntry={...entry('SERVICE_REVENUE',8000),walletId:'bank',walletName:'Сбербанк',entryId:'wallet3'};
const productArticle={articleId:'products',name:'Продажа товаров',values:[{valueId:'product-payment',name:'Оплата товаров',routes:['PRODUCT_REVENUE']}],routes:[]};
const fullCatalog=[...canonical,productArticle];
const position=(id,entryId,sourceId,positionName,amount,route)=>({id,entryId,sourceKind:'wallet',sourceId,positionName,amount,articleClass:registeredRoute(fullCatalog,route)});
const moves=[position('p1','wallet1','cash','Стрижка',4000,'SERVICE_REVENUE'),position('p2','wallet1','cash','Окрашивание',6000,'SERVICE_REVENUE'),position('p3','wallet2','cash','',2000,'TIPS'),position('p4','wallet3','bank','Окрашивание',2000,'SERVICE_REVENUE'),position('p5','wallet3','bank','Товар',6000,'PRODUCT_REVENUE')];
const itemized=ddsRegistryParts({id:'pay',entries:[paidEntry,paidTip,secondEntry],first:{operationKind:'payment'},operation:{data:{positionMovements:moves}}},[],fullCatalog);
assert.deepEqual(itemized.map(p=>[p.position,p.money,p.article]),[['Стрижка',4000,'Оказание услуг'],['Окрашивание',6000,'Оказание услуг'],['',2000,'Оказание услуг'],['Окрашивание',2000,'Оказание услуг'],['Товар',6000,'Продажа товаров']]);
assert.equal(itemized.reduce((n,p)=>n+p.money,0),20000);
const purchases=ddsRegistryParts({id:'buy',first:{operationKind:'manual-expense'},entries:[{...entry('MATERIALS_REFUND',1200),entryId:'a',lineName:'Краситель'},{...entry('MATERIALS_REFUND',700),entryId:'b',lineName:'Шампунь'}]},[],canonical);
assert.equal(purchases.length,2);
assert.deepEqual(purchases.map(p=>p.position),['Краситель','Шампунь']);
console.log('PASS mechanism registry and position movement rows');

const rawParents=[
 {articleId:'system-service-revenue',systemKey:'SERVICE_REVENUE',direction:'IN',economicType:'OPERATING_REVENUE'},
 {articleId:'system-tips',systemKey:'TIPS',direction:'IN',economicType:'TIPS'},
 {articleId:'system-refund',systemKey:'REFUND',direction:'OUT',economicType:'REFUND'},
 {articleId:'system-deposit-spend',systemKey:'DEPOSIT_SPEND',direction:'TRANSFER',economicType:'DEPOSIT_SPEND'},
 {articleId:'system-transfer',systemKey:'TRANSFER',direction:'TRANSFER',economicType:'TRANSFER'}
];
const servicesMechanism={...canonical[1],capability:'journal',systemKey:'MECHANISM_SERVICES',values:[...canonical[1].values,{name:'Возврат',routes:['REFUND']},{name:'Ложный маршрут',custom:true,routes:['TRANSFER']}]};
assert.deepEqual(mechanismValueParents(servicesMechanism,rawParents).map(a=>a.articleId),['system-service-revenue','system-refund']);
assert.deepEqual(mechanismValueParents({...servicesMechanism,values:[{routes:['DEPOSIT_SPEND']}]},rawParents),[]);
assert.deepEqual(mechanismValueParents({...servicesMechanism,values:[{routes:['SERVICE_REVENUE']}]},rawParents.map(a=>({...a,archivedAt:'2026-11-28'}))),[]);
assert.deepEqual(mechanismValueParents({systemKey:'MECHANISM_TRANSFER',capability:'finance.special.access',values:[],routes:['TRANSFER']},rawParents),[]);
console.log('PASS custom mechanism values use existing writable route owners');

const orderCatalog=[{articleId:'services',systemKey:'s'},{articleId:'products',systemKey:'p'},{articleId:'rent',systemKey:''},{articleId:'tax',systemKey:''}];
assert.deepEqual(sortArticleDirectory(orderCatalog,['tax','products','services','rent']).map(a=>a.articleId),['products','services','tax','rent']);
const savedOrder=mergeArticleSectionOrder(orderCatalog,['services','products','rent','tax','hidden'],'system',['products','services']);
assert.deepEqual(savedOrder,['products','services','rent','tax','hidden']);
assert.throws(()=>mergeArticleSectionOrder(orderCatalog,[],'system',['rent','services']));
assert.deepEqual(orderDDSArticleRows([{id:'s1',articleId:'services'},{id:'r',articleId:'rent'},{id:'p',articleId:'products'},{id:'s2',articleId:'services'},{id:'x',articleId:''}],orderCatalog,savedOrder).map(r=>r.id),['p','s1','s2','r','x']);
console.log('PASS article display order and section boundaries');
