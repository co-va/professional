// Read-only shared DDS document projection. Never create ledger entries or mutate balances.
const cents=v=>Math.round(Number(v||0)*100);
const money=v=>Number.isFinite(Number(v))?Math.max(0,cents(v))/100:0;
const arr=v=>Array.isArray(v)?v:[];
const labels={
 'deposit-funding':'Пополнение депозита','deposit-withdrawal':'Возврат депозита',
 'deposit-import-spend':'Списание с депозита',
 'personal-account-funding':'Пополнение личного счёта','personal-account-withdrawal':'Возврат с личного счёта',
 'personal-account-debt-settlement':'Погашение задолженности',
};
export function depositParts(item){
 const amount=money(item?.amount);
 const p=item?.principalAmount,b=item?.benefitAmount;
 if(p==null||b==null||!Number.isFinite(Number(p))||!Number.isFinite(Number(b))||Number(p)<0||Number(b)<0||cents(p)+cents(b)!==cents(amount))return {amount,principal:null,bonus:null};
 return {amount,principal:money(p),bonus:money(b)};
}
export function loyaltyDocumentFacts(operation={},entries=[]){
 const data=operation.data||{},kind=operation.kind;
 const allocations=arr(data.depositAllocations).filter(a=>money(a.amount)>0).map(a=>({...depositParts(a),name:String(a.name||data.programName||'Депозит')}));
 const personal=kind==='refund'?money(data.personalAccountRestored):kind==='payment'?money(data.personalAccountAmount):0;
 const knownKind=Object.hasOwn(labels,kind);
 const related=knownKind||allocations.length>0||personal>0;
 if(!related)return null;
 const direction=kind==='refund'?1:-1;
 const principalUnknown=allocations.some(a=>a.principal===null);
 const principal=principalUnknown?null:direction*allocations.reduce((s,a)=>s+cents(a.principal),0)/100;
 const partsBonus=principalUnknown?null:direction*allocations.reduce((s,a)=>s+cents(a.bonus),0)/100;
 let bonus=partsBonus,bonusUnknown=false;
 if(kind==='deposit-funding'){
  const terms=data.terms;
  if(terms&&Object.hasOwn(terms,'benefitType')){
   bonus=String(terms.benefitType).toLowerCase()==='accrual'?money(money(data.amount??data.total)*Math.max(0,Math.min(100,Number(terms.benefitValue)||0))/100):0;
  }else{bonus=null;bonusUnknown=true;}
 }
 // A withdrawal closes the deposit. Do not invent the prior bonus remainder.
 if(kind==='deposit-withdrawal'){bonus=null;bonusUnknown=true;}
 const cash=entries.reduce((s,e)=>s+(e.direction==='OUT'?-1:1)*cents(e.amount),0)/100;
 const sources=[...new Set([...allocations.map(a=>a.name.split(' · остаток ')[0]),...(personal>0?['Личный счёт']:[]),...(knownKind&&kind.startsWith('deposit-')?[String(data.programName||'Депозит')]:[]),...(knownKind&&kind.startsWith('personal-account-')?['Личный счёт']:[])])];
 const cashUnknown=knownKind&&['deposit-funding','deposit-withdrawal','personal-account-funding','personal-account-withdrawal','personal-account-debt-settlement'].includes(kind)&&!entries.length&&money(data.amount??data.total)>0;
 const article=labels[kind]||(allocations.length?(kind==='refund'?'Возврат на депозит':'Списание с депозита'):(kind==='refund'?'Возврат на личный счёт':'Списание с личного счёта'));
 return {kind,article,allocations,personal:direction*personal,principal,bonus,bonusUnknown,cash,cashUnknown,sources,internal:allocations.length>0||personal>0,amount:money(data.total??data.amount),hasBonus:bonusUnknown||bonus===null||bonus!==0};
}
export function desktopDocuments(operations,ledger){
 const groups=new Map();
 for(const entry of ledger){if(!entry.operationId||entry.operationKind==='cancel')continue;if(!groups.has(entry.operationId))groups.set(entry.operationId,[]);groups.get(entry.operationId).push(entry);}
 const byId=new Map(operations.map(o=>[o.operationId,o]));
 const result=[];
 for(const [id,entries] of groups){const operation=byId.get(id);const first=entries[0];if(operation?.data?.personKey&&!first.person)result.push({id,entries,first:{...first,person:{key:operation.data.personKey}},facts:loyaltyDocumentFacts(operation,entries)});else result.push({id,entries,first,facts:operation?loyaltyDocumentFacts(operation,entries):null});}
 for(const operation of operations){
  const id=operation.operationId;if(!id||groups.has(id)||operation.kind==='cancel')continue;
  const facts=loyaltyDocumentFacts(operation,[]);if(!facts)continue;
  const data=operation.data||{};
  // Header facts for a document without wallet movements; not a ledger entry.
  const first={operationId:id,operationKind:operation.kind,operationStatus:operation.status,occurredAt:operation.occurredAt,recordedAt:operation.recordedAt,source:operation.source,person:data.person||{key:data.personKey},workplace:data.workplace||'',operationTotal:facts.amount,settlementItems:arr(data.settlement?.items),sourceDetails:arr(data.settlement?.items).map(i=>i.name).filter(Boolean).join(', ')};
  result.push({id,entries:[],first,facts});
 }
 return result;
}
