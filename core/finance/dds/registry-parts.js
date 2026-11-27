// DDS Desktop: actual article movements, linked to one original financial document.
// Read-only projection. Never invent allocations or add ledger entries.
import { desktopArticleName } from './classification.js';
import { registeredRoute, registeredLedgerArticle, registeredArticle } from './article-view.js';
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
function legacyRegistryParts(document,catalog=[]){
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

 // Single mechanism + value per row. Money and bonuses are independent fields.
 // The catalogue is supplied by Core; unresolved history remains visible.
 export function ddsRegistryParts(document,catalog=[],canonical=null,{walletOnly=false}={}){
  if(!Array.isArray(canonical))return legacyRegistryParts(document,catalog);
  const {id,entries=[],first={},facts:f,operation}=document;
  const movements=Array.isArray(operation?.data?.positionMovements)?operation.data.positionMovements:[];
  const rows=new Map();
  const add=({classification=null,missing='',direction='mixed',sourceKey='',sources=[],money=0,bonus=undefined,meta={},movementId='',position='',positionId=''})=>{
   const key=JSON.stringify([classification?.articleId||'missing:'+missing,classification?.valueId||'',direction,sourceKey,movementId]);
   let p=rows.get(key);
   if(!p){
    p={articleId:classification?.articleId||'',article:classification?.articleName||'',articleValueId:classification?.valueId||'',articleValue:classification?.valueName||'',direction,partKey:key,sources:[],money:0,bonus:undefined,meta:{},position,positionId,movementId};
    rows.set(key,p);
   }
   p.money=sum(p.money,money);
   if(bonus!==undefined)p.bonus=p.bonus===undefined?bonus:sum(p.bonus,bonus);
   p.sources=unique([...p.sources,...sources]);
   for(const [k,v] of Object.entries(meta))p.meta[k]=Object.hasOwn(p.meta,k)?sum(p.meta[k],v):v;
   return p;
  };
  const route=key=>registeredRoute(canonical,key);
  const wallet=e=>e.walletName||'';
  const walletKey=e=>'wallet:'+String(e.walletId||e.walletName||'');
  const directionFor=e=>e.direction==='OUT'?'out':'in';
  const isTransfer=first.operationKind==='transfer'||entries.some(e=>e.economicType==='TRANSFER');
  if(isTransfer&&!walletOnly){
   const out=entries.find(e=>e.direction==='OUT'),incoming=entries.find(e=>e.direction==='IN');
   add({classification:route('TRANSFER'),missing:'TRANSFER',direction:'transfer',sourceKey:'transfer',sources:[wallet(out||{}),wallet(incoming||{})],money:Math.max(cents(first.operationTotal),...entries.map(e=>cents(e.amount)),0),meta:{cashIn:entries.filter(e=>e.direction==='IN').reduce((n,e)=>n+cents(e.amount),0),cashOut:entries.filter(e=>e.direction==='OUT').reduce((n,e)=>n+cents(e.amount),0)}});
  }else{
   for(const [entryIndex,e] of entries.entries()){
    const out=e.direction==='OUT',amount=cents(e.amount);
    const slices=walletOnly?[]:movements.filter(p=>p.sourceKind==='wallet'&&p.entryId===e.entryId&&p.sourceId===e.walletId);
    // Core's registered position links must reconcile to this exact wallet
    // entry. Never multiply a payment by the count of invoice positions.
    if(slices.length&&slices.every(p=>p.id&&cents(p.amount)>0)&&slices.reduce((n,p)=>n+cents(p.amount),0)===amount){
     for(const p of slices){
      const n=cents(p.amount);
      add({classification:registeredArticle(canonical,p.articleClass),missing:e.entryId,direction:directionFor(e),sourceKey:walletKey(e),sources:[wallet(e)],movementId:p.id,position:p.positionName||'',positionId:p.positionId||'',money:(out?-1:1)*n,meta:{cashIn:out?0:n,cashOut:out?n:0}});
     }
    }else{
     // Purchasing/manual lines already have their own ledger entry; do not
     // collapse multiple items of the same article into one row.
     const cashKind=Object.hasOwn(cashKeys,first.operationKind);
     add({classification:registeredLedgerArticle(e,canonical),missing:e.articleId||e.economicType||e.entryId||'ledger',direction:isTransfer?'transfer':directionFor(e),sourceKey:walletKey(e),sources:[wallet(e)],movementId:cashKind?'':String(e.entryId||entryIndex),position:String(e.lineName||''),money:(out?-1:1)*amount,meta:{cashIn:out?0:amount,cashOut:out?amount:0}});
    }
   }
  }
  if(f&&!walletOnly){
   const cashKey=cashKeys[f.kind],cashClass=route(cashKey);
   if(cashKey){
    const direction=f.kind.endsWith('withdrawal')?'out':'in';
    if(f.cashUnknown)add({classification:cashClass,missing:cashKey,direction,sourceKey:'wallet:'+String(f.walletId||f.walletName||''),sources:[f.walletName],money:(direction==='out'?-1:1)*cents(f.amount),meta:{cashIn:null,cashOut:null}});
    if(f.kind.startsWith('deposit-')){
     // Funding and withdrawal are single cash operations, not extra bonus articles.
     const candidates=[...rows.values()].filter(p=>p.articleId===cashClass?.articleId&&p.articleValueId===cashClass?.valueId&&p.direction===direction);
     const meta={benefitWrittenOff:f.conditionalWrittenOff==null?null:cents(f.conditionalWrittenOff)};
     if(candidates.length===1){const p=candidates[0];p.bonus=f.bonus===null?null:cents(f.bonus);Object.assign(p.meta,meta);}
     else if(f.bonus===null||f.bonus!==0)add({classification:cashClass,missing:cashKey,direction,sourceKey:'deposit:'+String(f.depositSourceId||''),sources:[f.programName],bonus:f.bonus===null?null:cents(f.bonus),meta});
    }
   }
   const refund=f.kind==='refund',sign=refund?1:-1;
   const depositKey=refund?'DEPOSIT_PAYMENT_REFUND':'DEPOSIT_SPEND';
   const depositClass=route(depositKey);
   for(const a of f.allocations||[]){
    const ac=a.accounting;
    const principal=a.principal===null?null:cents(a.principalMovement??sign*a.principal);
    const bonus=a.bonus===null?null:cents(a.bonusMovement??sign*a.bonus);
    const slices=movements.filter(p=>p.sourceKind==='deposit'&&p.sourceId===String(a.depositId||''));
    const matches=slices.length&&slices.reduce((n,p)=>n+cents(p.amount),0)===cents(a.amount);
    const base={classification:depositClass,missing:depositKey,sourceKey:'deposit:'+String(a.depositId||''),sources:[String(a.name||'').split(' · остаток ')[0]]};
    const metadata={depositPrincipal:principal,depositNet:sign*cents(a.amount),grossAmount:ac?cents(ac.grossAmount):null,benefitGranted:ac?cents(ac.benefitGranted):0,benefitReversed:ac?cents(ac.benefitReversed):0,bonusUsed:ac?cents(ac.benefitUsed):(!refund&&a.bonus!=null?cents(a.bonus):null),bonusRestored:ac?cents(ac.benefitRestored):(refund&&a.bonus!=null?cents(a.bonus):null)};
    // Core may additionally provide exact real/benefit components for each
    // position. Without them preserve the actual source-level amounts.
    const detailed=matches&&slices.every(p=>p.depositComponents&&Number.isFinite(p.depositComponents.money)&&Number.isFinite(p.depositComponents.bonus))&&principal!==null&&bonus!==null&&slices.reduce((n,p)=>n+cents(p.depositComponents.money),0)===principal&&slices.reduce((n,p)=>n+cents(p.depositComponents.bonus),0)===bonus;
    if(detailed){
     for(const p of slices){
      const c=p.depositComponents;
      add({...base,movementId:p.id,position:p.positionName||'',positionId:p.positionId||'',money:cents(c.money),bonus:cents(c.bonus),meta:{depositPrincipal:cents(c.money),depositNet:sign*cents(p.amount),grossAmount:c.grossAmount==null?null:cents(c.grossAmount),benefitGranted:cents(c.benefitGranted),benefitReversed:cents(c.benefitReversed),bonusUsed:cents(c.bonusUsed),bonusRestored:cents(c.bonusRestored)}});
     }
    }else if(matches&&slices.length===1){
     const p=slices[0];add({...base,movementId:p.id,position:p.positionName||'',positionId:p.positionId||'',money:principal,bonus,meta:metadata});
    }else add({...base,money:principal,bonus,meta:metadata});

   }
   if((f.kind==='payment'||refund)&&(f.discount||f.discountUnknown)){
    const credited=(f.allocations||[]).reduce((n,a)=>n+cents(a.accounting?.[refund?'benefitReversed':'benefitGranted']),0);
    const declared=cents(refund?f.conditionalReversed:f.conditionalGranted);
    const external=f.discountUnknown?null:Math.max(0,declared-credited);
    if(external===null||external!==0){
     const depositId=String(f.discount?.depositId||f.priceDepositId||'');
     const allocated=(f.allocations||[]).find(a=>a.depositId===depositId);
     // A conditional bonus on the same deposit merges into its payment/refund row.
     const meta=refund?{benefitReversed:external}:{benefitGranted:external};
     const same=[...rows.values()].filter(p=>p.articleId===depositClass?.articleId&&p.articleValueId===depositClass?.valueId&&p.direction==='mixed'&&JSON.parse(p.partKey)[3]==='deposit:'+depositId);
     if(same.length===1){const p=same[0],delta=external===null?null:(refund?-external:external);p.bonus=p.bonus===undefined?delta:sum(p.bonus,delta);for(const [k,v] of Object.entries(meta))p.meta[k]=Object.hasOwn(p.meta,k)?sum(p.meta[k],v):v;}
     else add({classification:depositClass,missing:depositKey,sourceKey:'deposit:'+depositId,sources:[allocated?String(allocated.name||'').split(' · остаток ')[0]:f.priceDepositName],bonus:external===null?null:(refund?-external:external),meta});
    }
   }
   if(f.personal){
    const key=refund?'PERSONAL_ACCOUNT_PAYMENT_REFUND':'PERSONAL_ACCOUNT_SPEND';
    const slices=movements.filter(p=>p.sourceKind==='personal');
    if(slices.length&&slices.reduce((n,p)=>n+cents(p.amount),0)===Math.abs(cents(f.personal))){
     for(const p of slices){const n=sign*cents(p.amount);add({classification:route(key),missing:key,sourceKey:'personal-account',sources:['Личный счёт'],movementId:p.id,position:p.positionName||'',positionId:p.positionId||'',money:n,meta:{personal:n}});}
    }else add({classification:route(key),missing:key,sourceKey:'personal-account',sources:['Личный счёт'],money:cents(f.personal),meta:{personal:cents(f.personal)}});
   }
  }
  if(!rows.size)add({classification:registeredLedgerArticle(first,canonical),missing:first.operationKind||'document',money:null});
  const number=v=>v==null?v:v/100;
  return [...rows.values()].map(p=>({...p,id:JSON.stringify([id,p.partKey]),documentId:id,money:number(p.money),bonus:number(p.bonus),meta:Object.fromEntries(Object.entries(p.meta).map(([k,v])=>[k,number(v)]))}));
 }
