import { recordPaymentCalendarPhase } from '../time/payment-date.js';
// Read-only compatibility check against the actual Core snapshot, not Git SHA.
export function supportsFinancePrepayment(catalog){
 return Array.isArray(catalog)&&catalog.some(a=>a.articleId==='mechanism-services'&&a.values?.some(v=>v.valueId==='services-prepayment'&&v.routes?.includes('SERVICE_PREPAYMENT')));
}
const cents=value=>Math.round(Number(value||0)*100);
export function manualWalletAllocation(rows,total){
 const target=cents(total),seen=new Set();
 const allocations=[];
 for(const row of rows){
   const walletId=String(row.walletId||''),amount=cents(row.amount);
   if(!walletId||seen.has(walletId)||!Number.isSafeInteger(amount)||amount<=0)return null;
   seen.add(walletId);allocations.push({walletId,walletName:String(row.walletName||''),amount:amount/100});
 }
 return Number.isSafeInteger(target)&&target>0&&allocations.reduce((sum,row)=>sum+cents(row.amount),0)===target?allocations:null;
}
export function netRecordPrepayment(operations,recordIds){
 const ids=new Set(recordIds.map(String));
 const relevant=operations.filter(o=>o.status==='completed'&&o.source?.type==='record'&&ids.has(String(o.source.id)));
 const advances=new Map(relevant.filter(o=>o.kind==='payment'&&o.data?.paymentTiming==='prepayment').map(o=>[o.operationId,cents(o.data.serviceAmount)]));
 for(const o of relevant)if(o.kind==='refund'&&advances.has(o.originalOperationId))advances.set(o.originalOperationId,Math.max(0,advances.get(o.originalOperationId)-cents(o.data?.serviceAmount)));
 return [...advances.values()].reduce((s,n)=>s+n,0)/100;
}
// Only display verified wallet facts. Never manufacture a wallet allocation
// from the invoice total or count prior advances a second time.
export function recordPaymentReport(operations,ledger,recordIds){
 const ids=new Set(recordIds.map(String));
 const relevant=operations.filter(o=>o.status==='completed'&&o.source?.type==='record'&&ids.has(String(o.source.id)));
 const advanceIds=new Set(relevant.filter(o=>o.kind==='payment'&&o.data?.paymentTiming==='prepayment').map(o=>o.operationId));
 const regular=relevant.filter(o=>['payment','refund'].includes(o.kind)&&!advanceIds.has(o.operationId)&&!advanceIds.has(o.originalOperationId));
 const byWallet=new Map();
 let complete=true;
 for(const op of regular){
   const entries=ledger.filter(e=>e.operationId===op.operationId&&e.walletId&&e.component==='service');
   const expected=cents(op.data?.cashServiceAmount??(Number(op.data?.cashTotal||0)-Number(op.data?.tips||0)));
   if(!Number.isSafeInteger(expected)||expected<0||entries.reduce((n,e)=>n+cents(e.amount),0)!==expected){complete=false;continue;}
   for(const e of entries){
     const key=e.walletId,prior=byWallet.get(key)||{label:e.walletName||key,amount:0};
     prior.amount+=(e.direction==='OUT'?-1:1)*cents(e.amount);byWallet.set(key,prior);
   }
 }
 return {prepayment:netRecordPrepayment(operations,recordIds),wallets:complete?[...byWallet.values()].filter(w=>w.amount!==0).map(w=>({label:w.label,amount:w.amount/100})):[]};
}

export function supportsRecordPaymentCalendar(state){
 return state?.recordPaymentDateMode==='workplace-calendar-day'&&supportsFinancePrepayment(state.articleCatalog);
}
export function recordPaymentPresentation(record,payment,timeZone,now=new Date(),advance=0){
 const phase=recordPaymentCalendarPhase(record?.date,now,timeZone);
 const action=phase==='before'?'Предоплата':'Оплата';
 const remaining=Math.max(0,Number(payment?.remaining)||0);
 const paid=Math.max(0,Number(payment?.paidTotal)||0);
 if(!phase)return {phase,action:'',status:'',amount:null,outstandingLabel:'К оплате'};
 if(payment?.fullyPaid)return {phase,action,status:'Оплачено',amount:paid,outstandingLabel:'К оплате'};
 const status=phase==='before'?'Предоплата':phase==='after'?'Задолженность':'Оплата';
 return {phase,action,status,amount:phase==='before'?(advance>0?advance:null):remaining,outstandingLabel:phase==='after'?'Задолженность':'К оплате'};
}
