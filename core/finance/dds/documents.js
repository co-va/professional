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
 const accounting=new Map(arr(data.depositAccounting).map(a=>[String(a.depositId||''),a]));
 const discount=data.depositDiscount&&data.depositDiscount.depositId&&Number.isFinite(Number(data.depositDiscount.benefitAmount))?data.depositDiscount:null;
 const discountUnknown=!discount&&data.priceCondition?.programType==='deposit'&&money(data.settlement?.pricePercentTotal)>0;
 const allocations=arr(data.depositAllocations).filter(a=>money(a.amount)>0).map(a=>{
  const depositId=String(a.depositId||a.sourceId||a.id||''),part=depositParts(a),record=accounting.get(depositId);
  const relatedDiscount=discount?.depositId===depositId||(discountUnknown&&data.priceCondition?.depositId===depositId);
  const valid=record?.confirmed===true&&Number.isFinite(Number(record.realDelta))&&Number.isFinite(Number(record.benefitDelta))&&cents(record.realDelta)+cents(record.benefitDelta)===(kind==='refund'?1:-1)*cents(part.amount);
  const base={...part,depositId,name:String(a.name||data.programName||'Депозит')};
  if(valid)return {...base,principal:Math.abs(Number(record.realDelta)),bonus:Math.abs(Number(record.benefitDelta)),principalMovement:Number(record.realDelta),bonusMovement:Number(record.benefitDelta),accounting:record};
  if(record||relatedDiscount)return {...base,principal:null,bonus:null,accountingUnknown:true};
  return base;
 });
 const personal=kind==='refund'?money(data.personalAccountRestored):kind==='payment'?money(data.personalAccountAmount):0;
 const knownKind=Object.hasOwn(labels,kind);
 const related=knownKind||allocations.length>0||personal>0||discount||discountUnknown;
 if(!related)return null;
 const direction=kind==='refund'?1:-1;
 const principalUnknown=allocations.some(a=>a.principal===null);
 const principal=principalUnknown?null:allocations.reduce((s,a)=>s+cents(a.principalMovement??direction*a.principal),0)/100;
 const partsBonus=principalUnknown?null:allocations.reduce((s,a)=>s+cents(a.bonusMovement??direction*a.bonus),0)/100;
 const grant=kind==='payment'&&discount?money(discount.benefitAmount):0;
 const reversed=kind==='refund'&&discount?money(discount.benefitAmount):0;
 const credited=allocations.reduce((s,a)=>s+cents(a.accounting?.benefitGranted),0)/100;
 const reversedCredit=allocations.reduce((s,a)=>s+cents(a.accounting?.benefitReversed),0)/100;
 const externalDelta=(grant-credited)-(reversed-reversedCredit);
 let bonus=partsBonus===null||discountUnknown?null:(cents(partsBonus)+cents(externalDelta))/100,bonusUnknown=discountUnknown||partsBonus===null;
 if(kind==='deposit-funding'){
  const terms=data.terms;
  if(terms&&Object.hasOwn(terms,'benefitType')){
   bonus=String(terms.benefitType).toLowerCase()==='accrual'?money(money(data.amount??data.total)*Math.max(0,Math.min(100,Number(terms.benefitValue)||0))/100):0;
  }else{bonus=null;bonusUnknown=true;}
 }
 // A withdrawal closes the deposit. Do not invent the prior bonus remainder.
 if(kind==='deposit-withdrawal'){bonus=data.benefitWrittenOff==null?null:-money(data.benefitWrittenOff);bonusUnknown=bonus===null;}
 const cash=entries.reduce((s,e)=>s+(e.direction==='OUT'?-1:1)*cents(e.amount),0)/100;
 const sources=[...new Set([...allocations.map(a=>a.name.split(' · остаток ')[0]),...(personal>0?['Личный счёт']:[]),...(knownKind&&kind.startsWith('deposit-')?[String(data.programName||'Депозит')]:[]),...(knownKind&&kind.startsWith('personal-account-')?['Личный счёт']:[])])];
 const cashUnknown=knownKind&&['deposit-funding','deposit-withdrawal','personal-account-funding','personal-account-withdrawal','personal-account-debt-settlement'].includes(kind)&&!entries.length&&money(data.amount??data.total)>0;
 const benefitArticle=discount?.articleName||(discountUnknown?'Выгода по депозиту':kind==='deposit-withdrawal'&&money(data.conditionalBenefitWrittenOff)>0?data.benefitArticleName||'Аннулирование выгоды по депозиту':'');
 const article=labels[kind]||(allocations.length?(kind==='refund'?'Возврат на депозит':'Списание с депозита'):personal>0?(kind==='refund'?'Возврат на личный счёт':'Списание с личного счёта'):benefitArticle);
 const bonusUsed=allocations.reduce((sum,a)=>sum+cents(a.accounting?a.accounting.benefitUsed:kind!=='refund'?a.bonus:0),0)/100;
 const bonusRestored=allocations.reduce((sum,a)=>sum+cents(a.accounting?a.accounting.benefitRestored:kind==='refund'?a.bonus:0),0)/100;
 return {kind,article,benefitArticle,discount,discountUnknown,allocations,walletId:String(data.walletId||''),walletName:String(data.walletName||''),depositSourceId:String(operation.source?.id||''),programName:String(data.programName||''),priceDepositId:String(data.priceCondition?.depositId||''),priceDepositName:String(data.depositDiscount?.programName||data.priceCondition?.name||data.priceCondition?.programName||''),personal:direction*personal,principal,bonus,bonusUnknown,cash,cashUnknown,sources,internal:allocations.length>0||personal>0,amount:money(data.total??data.amount),hasBonus:bonusUnknown||bonus===null||bonus!==0,conditionalGranted:grant,conditionalReversed:reversed,conditionalWrittenOff:data.conditionalBenefitWrittenOff==null?null:money(data.conditionalBenefitWrittenOff),bonusUsed,bonusRestored,depositNet:direction*allocations.reduce((sum,a)=>sum+cents(a.amount),0)/100};
}
export function desktopDocuments(operations,ledger){
 const groups=new Map();
 for(const entry of ledger){if(!entry.operationId||entry.operationKind==='cancel')continue;if(!groups.has(entry.operationId))groups.set(entry.operationId,[]);groups.get(entry.operationId).push(entry);}
 const byId=new Map(operations.map(o=>[o.operationId,o]));
 const result=[];
 for(const [id,entries] of groups){const operation=byId.get(id);const first=entries[0];if(operation?.data?.personKey&&!first.person)result.push({id,entries,operation,first:{...first,person:{key:operation.data.personKey}},facts:loyaltyDocumentFacts(operation,entries)});else result.push({id,entries,operation,first,facts:operation?loyaltyDocumentFacts(operation,entries):null});}
 for(const operation of operations){
  const id=operation.operationId;if(!id||groups.has(id)||operation.kind==='cancel')continue;
  const facts=loyaltyDocumentFacts(operation,[]);if(!facts)continue;
  const data=operation.data||{};
  // Header facts for a document without wallet movements; not a ledger entry.
  const first={operationId:id,operationKind:operation.kind,operationStatus:operation.status,occurredAt:operation.occurredAt,recordedAt:operation.recordedAt,source:operation.source,person:data.person||{key:data.personKey},workplace:data.workplace||'',operationTotal:facts.amount,settlementItems:arr(data.settlement?.items),sourceDetails:arr(data.settlement?.items).map(i=>i.name).filter(Boolean).join(', ')};
  result.push({id,entries:[],operation,first,facts});
 }
 return result;
}

// Recognize the actual principal once, at settlement, not when money was advanced.
// A mixed payment may have both a physical wallet component and an advance component.
export function loyaltyReportTotals(operations,fromMs=-Infinity,toMs=Infinity){
 const totals={advanceRevenue:0,advanceRefunds:0,bonusAccrued:0,bonusSpent:0,bonusRestored:0,bonusWrittenOff:0,conditionalGranted:0,conditionalReversed:0,conditionalWrittenOff:0,unresolved:0,count:0};
 for(const op of operations){
  const time=Date.parse(op.occurredAt||'');
  if(op.status==='cancelled'||op.kind==='cancel'||!Number.isFinite(time)||time<fromMs||time>toMs)continue;
  const f=loyaltyDocumentFacts(op,[]);
  if(!f)continue;
  totals.count++;
  if(f.principal===null||f.bonus===null)totals.unresolved++;
  if(op.kind==='payment')totals.advanceRevenue+=cents(Math.max(0,-(f.principal??0)))+cents(Math.max(0,-f.personal));
  if(op.kind==='refund')totals.advanceRefunds+=cents(Math.max(0,f.principal??0))+cents(Math.max(0,f.personal));
  if(op.kind==='deposit-funding'&&f.bonus>0)totals.bonusAccrued+=cents(f.bonus);
  if(['payment','deposit-import-spend'].includes(op.kind))totals.bonusSpent+=cents(f.bonusUsed);
  if(op.kind==='refund')totals.bonusRestored+=cents(f.bonusRestored);
  if(op.kind==='deposit-withdrawal'&&f.bonus<0)totals.bonusWrittenOff+=cents(Math.max(0,-f.bonus-(f.conditionalWrittenOff||0)));
  totals.conditionalGranted+=cents(f.conditionalGranted);
  totals.conditionalReversed+=cents(f.conditionalReversed);
  totals.conditionalWrittenOff+=cents(f.conditionalWrittenOff);
 }
 for(const key of Object.keys(totals))if(!['count','unresolved'].includes(key))totals[key]/=100;
 return totals;
}
