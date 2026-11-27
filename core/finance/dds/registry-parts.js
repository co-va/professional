// DDS Desktop: actual article movements, linked to one original financial document.
// Read-only projection. Never invent allocations or add ledger entries.
import { desktopArticleName } from './classification.js';
const cents=v=>Math.round(Number(v||0)*100);
const unique=values=>[...new Set(values.map(v=>String(v||'').trim()).filter(Boolean))];
const sum=(a,b)=>a===null||b===null?null:a+b;
// Resolve from the full registered catalogue, not the capability-filtered
// directory. Disabling a feature does not rename its historical movements.
function systemArticle(catalog,key){return catalog.find(a=>a.systemKey===key&&a.economicType!=='GROUP')||null;}
function ledgerArticle(entry,catalog){
 const saved=catalog.find(a=>a.articleId===entry.articleId&&a.economicType!=='GROUP');
 if(saved)return saved;
 if(entry.articleId)return null;
 const types=new Set((entry.settlementItems||[]).map(item=>item.sourceType));
 const key=entry.economicType==='SERVICE_REVENUE'&&types.size===1&&types.has('product')?'PRODUCT_REVENUE':({SERVICE_REFUND:'REFUND',TIPS_REFUND:'REFUND'})[entry.economicType]||entry.economicType;
 return systemArticle(catalog,key);
}
const cashKeys={'deposit-funding':'DEPOSIT_RECEIVED','deposit-withdrawal':'DEPOSIT_RETURN','personal-account-funding':'PERSONAL_ACCOUNT_LIABILITY_IN','personal-account-withdrawal':'PERSONAL_ACCOUNT_LIABILITY_OUT','personal-account-debt-settlement':'PERSONAL_ACCOUNT_DEBT_SETTLEMENT'};
export function ddsRegistryParts(document,catalog=[]){
 const {id,entries=[],first={},facts:f}=document;
 const parts=new Map();
 const push=({article=null,unresolved='',direction='mixed',money=0,bonus=0,sources=[]})=>{
   const articleId=article?.articleId||'';
   const key=JSON.stringify([articleId||'missing:'+unresolved,direction]);
   const old=parts.get(key);
   if(old){old.money=sum(old.money,money);old.bonus=sum(old.bonus,bonus);old.sources=unique([...old.sources,...sources]);}
   else parts.set(key,{articleId,article:article?desktopArticleName(article):'',direction,money,bonus,sources:unique(sources),partKey:key});
 };
 const wallet=e=>e.walletName||e.walletId||'';
 if(first.operationKind==='transfer'){
   const out=entries.find(e=>e.direction==='OUT'),incoming=entries.find(e=>e.direction==='IN');
   push({article:ledgerArticle(first,catalog)||systemArticle(catalog,'TRANSFER'),unresolved:'TRANSFER',direction:'transfer',money:Math.max(cents(first.operationTotal),...entries.map(e=>cents(e.amount)),0),sources:[wallet(out||{}),wallet(incoming||{})]});
 }else{
   for(const e of entries)push({article:ledgerArticle(e,catalog),unresolved:e.articleId||e.economicType||e.entryId||'ledger',direction:e.direction==='OUT'?'out':'in',money:(e.direction==='OUT'?-1:1)*cents(e.amount),sources:[wallet(e)]});
 }
 if(f){
   const cashKind=['deposit-funding','deposit-withdrawal','personal-account-funding','personal-account-withdrawal','personal-account-debt-settlement'].includes(f.kind);
   const depositSources=unique(f.allocations.map(a=>a.name.split(' · остаток ')[0]));
   const benefitSources=unique([...depositSources,f.discount?.programName,...f.sources.filter(s=>!entries.some(e=>wallet(e)===s)&&s!=='Личный счёт')]);
   const cashKey=cashKeys[f.kind],cashArticle=systemArticle(catalog,cashKey);
   if(f.cashUnknown)push({article:cashArticle,unresolved:cashKey,direction:f.kind.endsWith('withdrawal')?'out':'in',money:(f.kind.endsWith('withdrawal')?-1:1)*cents(f.amount)});
   const grant=cents(f.conditionalGranted),reversed=cents(f.conditionalReversed),writtenOff=cents(f.conditionalWrittenOff);
   if(f.kind==='payment'&&(grant||f.discountUnknown))push({article:systemArticle(catalog,'DEPOSIT_BENEFIT_GRANTED'),unresolved:'DEPOSIT_BENEFIT_GRANTED',bonus:f.discountUnknown?null:grant,sources:benefitSources});
   if(f.kind==='refund'&&(reversed||f.discountUnknown))push({article:systemArticle(catalog,'DEPOSIT_BENEFIT_REVERSED'),unresolved:'DEPOSIT_BENEFIT_REVERSED',bonus:f.discountUnknown?null:-reversed,sources:benefitSources});
   if(f.kind==='deposit-withdrawal'&&writtenOff)push({article:systemArticle(catalog,'DEPOSIT_BENEFIT_REVERSED'),unresolved:'DEPOSIT_BENEFIT_REVERSED',bonus:-writtenOff,sources:benefitSources});
   // The separate conditional event plus the residual equals the original bonus movement.
   const residual=f.bonus===null?null:cents(f.bonus)-grant+reversed+writtenOff;
   if(f.allocations.length)push({article:systemArticle(catalog,f.kind==='refund'?'DEPOSIT_PAYMENT_REFUND':'DEPOSIT_SPEND'),unresolved:f.kind==='refund'?'DEPOSIT_PAYMENT_REFUND':'DEPOSIT_SPEND',money:f.principal===null?null:cents(f.principal),bonus:residual,sources:depositSources});
   else if(cashKind&&(residual===null||residual!==0)){
     const direction=f.kind.endsWith('withdrawal')?'out':'in';
     const cashPart=[...parts.values()].find(p=>p.direction===direction&&(cashArticle?p.articleId===cashArticle.articleId:p.partKey===JSON.stringify(['missing:'+cashKey,direction])));
     if(cashPart)cashPart.bonus=sum(cashPart.bonus,residual);
     else push({article:cashArticle,unresolved:cashKey,direction,bonus:residual,sources:f.sources});
   }
   if(f.personal)push({article:systemArticle(catalog,f.kind==='refund'?'PERSONAL_ACCOUNT_PAYMENT_REFUND':'PERSONAL_ACCOUNT_SPEND'),unresolved:f.kind==='refund'?'PERSONAL_ACCOUNT_PAYMENT_REFUND':'PERSONAL_ACCOUNT_SPEND',money:cents(f.personal),sources:['Личный счёт']});
 }
 if(!parts.size)push({article:ledgerArticle(first,catalog),unresolved:f?.kind||first.operationKind||'document',direction:'mixed',money:null,bonus:f?.bonus===null?null:0,sources:f?.sources||[]});
 return [...parts.values()].map(part=>({...part,id:JSON.stringify([id,part.partKey]),documentId:id,money:part.money===null?null:part.money/100,bonus:part.bonus===null?null:part.bonus/100}));
}
