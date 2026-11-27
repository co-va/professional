// DDS Desktop: actual article movements, linked to one original financial document.
// Read-only projection. Never invent allocations or add ledger entries.
import { desktopDocumentArticles, desktopArticleName } from './classification.js';
const cents=v=>Math.round(Number(v||0)*100);
const unique=values=>[...new Set(values.map(v=>String(v||'').trim()).filter(Boolean))];
const sum=(a,b)=>a===null||b===null?null:a+b;
function ledgerArticle(entry,catalog){
 const saved=catalog.find(a=>a.articleId===entry.articleId);
 const types=new Set((entry.settlementItems||[]).map(item=>item.sourceType));
 if(entry.economicType==='SERVICE_REVENUE'&&types.has('procedure')&&types.has('product')){
   if(saved)return desktopArticleName(saved);
   return entry.articleName||desktopDocumentArticles([{...entry,settlementItems:[]}],catalog)[0]||'';
 }
 return desktopDocumentArticles([entry],catalog)[0]||'';
}
export function ddsRegistryParts(document,catalog=[]){
 const {id,entries=[],first={},facts:f}=document;
 const parts=new Map();
 const push=({article='',direction='mixed',money=0,bonus=0,sources=[]})=>{
   const key=JSON.stringify([article,direction]);
   const old=parts.get(key);
   if(old){old.money=sum(old.money,money);old.bonus=sum(old.bonus,bonus);old.sources=unique([...old.sources,...sources]);}
   else parts.set(key,{article,direction,money,bonus,sources:unique(sources)});
 };
 const wallet=e=>e.walletName||e.walletId||'';
 if(first.operationKind==='transfer'){
   const out=entries.find(e=>e.direction==='OUT'),incoming=entries.find(e=>e.direction==='IN');
   push({article:ledgerArticle(first,catalog)||'Транзакция',direction:'transfer',money:Math.max(cents(first.operationTotal),...entries.map(e=>cents(e.amount)),0),sources:[wallet(out||{}),wallet(incoming||{})]});
 }else{
   for(const e of entries)push({article:ledgerArticle(e,catalog),direction:e.direction==='OUT'?'out':'in',money:(e.direction==='OUT'?-1:1)*cents(e.amount),sources:[wallet(e)]});
 }
 if(f){
   const cashKind=['deposit-funding','deposit-withdrawal','personal-account-funding','personal-account-withdrawal','personal-account-debt-settlement'].includes(f.kind);
   const depositSources=unique(f.allocations.map(a=>a.name.split(' · остаток ')[0]));
   const benefitSources=unique([...depositSources,f.discount?.programName,...f.sources.filter(s=>!entries.some(e=>wallet(e)===s)&&s!=='Личный счёт')]);
   if(f.cashUnknown)push({article:f.article,direction:f.kind.endsWith('withdrawal')?'out':'in',money:(f.kind.endsWith('withdrawal')?-1:1)*cents(f.amount)});
   const grant=cents(f.conditionalGranted),reversed=cents(f.conditionalReversed),writtenOff=cents(f.conditionalWrittenOff);
   if(f.kind==='payment'&&(grant||f.discountUnknown))push({article:'Предоставление выгоды по депозиту',bonus:f.discountUnknown?null:grant,sources:benefitSources});
   if(f.kind==='refund'&&(reversed||f.discountUnknown))push({article:'Аннулирование выгоды по депозиту',bonus:f.discountUnknown?null:-reversed,sources:benefitSources});
   if(f.kind==='deposit-withdrawal'&&writtenOff)push({article:'Аннулирование выгоды по депозиту',bonus:-writtenOff,sources:benefitSources});
   // The separate conditional event plus the residual equals the original bonus movement.
   const residual=f.bonus===null?null:cents(f.bonus)-grant+reversed+writtenOff;
   if(f.allocations.length)push({article:f.kind==='refund'?'Возврат на депозит':'Списание с депозита',money:f.principal===null?null:cents(f.principal),bonus:residual,sources:depositSources});
   else if(cashKind&&(residual===null||residual!==0)){
     const direction=f.kind.endsWith('withdrawal')?'out':'in';
     const cashPart=[...parts.values()].find(p=>p.direction===direction&&p.article===f.article);
     if(cashPart)cashPart.bonus=sum(cashPart.bonus,residual);
     else push({article:f.article,direction,bonus:residual,sources:f.sources});
   }
   if(f.personal)push({article:f.kind==='refund'?'Возврат на личный счёт':'Списание с личного счёта',money:cents(f.personal),sources:['Личный счёт']});
 }
 if(!parts.size)push({article:f?.article||ledgerArticle(first,catalog),direction:'mixed',money:null,bonus:f?.bonus===null?null:0,sources:f?.sources||[]});
 return [...parts.values()].map(part=>({...part,id:JSON.stringify([id,part.article,part.direction]),documentId:id,money:part.money===null?null:part.money/100,bonus:part.bonus===null?null:part.bonus/100}));
}
