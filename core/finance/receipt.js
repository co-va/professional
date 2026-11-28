import { formatSignedMoney } from '../../ui/utils/values.js';
import { shortDateTimeParts } from '../../ui/ui.js';
import { readOnlyReceipt } from '../../ui/receipt/index.js';
import { getFinanceOperation, getFinanceArticleCatalog } from './data.js';
import { registeredLedgerArticle, registeredRoute } from './dds/article-view.js';
import { getLedgerEntries } from './read.js';
import { depositArticleLabel, isDepositCashDocument } from './dds/classification.js';
import { loyaltyDocumentFacts } from './dds/documents.js';

function formatMoney(value = 0, { signed = false } = {}) {
  return formatSignedMoney(value, signed);
}

function walletText(item) {
  return item?.walletName || item?.walletId || '';
}
function personText(item) {
  return [item?.person?.name, item?.person?.surname].filter(Boolean).join(' ').trim();
}
function operationTotal(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const declared = Math.max(0, Number(rows[0]?.operationTotal) || 0);
  if (declared > 0) return declared;
  if (rows[0]?.operationKind === 'transfer') {
    return Math.max(0, ...rows.map((item) => Math.max(0, Number(item?.amount) || 0)));
  }
  return rows.reduce((sum, item) => sum + Math.max(0, Number(item?.amount) || 0), 0);
}
function operationReceiptItems(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const first = rows[0] || {};
  const items = [];

  const articles = [...new Set(rows.map((item) => String(item?.articleName || '')).filter(Boolean))];
  const catalog=getFinanceArticleCatalog();
  if(Array.isArray(catalog)){
    const registered=new Map();for(const row of rows){const a=registeredLedgerArticle(row,catalog);if(a)registered.set(JSON.stringify([a.articleId,a.valueId]),a);}
    for(const a of registered.values())items.push({label:'Статья',value:[a.articleName,a.valueName].filter(Boolean).join(' · ')});
  }else if (articles.length && first?.operationKind !== 'transfer') {
    for(const article of articles)items.push({ label: 'Статья', value: article });
  }

  const person = personText(first);
  const uei = String(first?.person?.uei || '').trim();
  if (uei) items.push({ label: uei, value: '' });
  if (person) items.push({ label: person, value: '' });
  if (first?.workplace) items.push({ label: first.workplace, value: '' });

  const wallets = [...new Set(rows.map((item) => walletText(item)).filter(Boolean))];
  if (first?.operationKind === 'transfer') {
    const from = rows.find((item) => item?.direction === 'OUT');
    const to = rows.find((item) => item?.direction === 'IN');
    if (walletText(from)) items.push({ label: `Из кошелька · ${walletText(from)}`, value: '' });
    if (walletText(to)) items.push({ label: `В кошелёк · ${walletText(to)}`, value: '' });
  } else if (wallets.length === 1) {
    items.push({ label: wallets[0], value: '' });
  } else if (wallets.length > 1) {
    items.push({ label: wallets.join(' + '), value: '' });
  }

  if (first?.counterparty) items.push({ label: first.counterparty, value: '' });
  if (first?.note) items.push({ label: first.note, value: '' });

  const lines = first?.operationKind === 'transfer'
    ? []
    : rows
      .filter((item) => String(item?.lineName || '').trim())
      .map((item) => ({
        label: String(item.lineName),
        value: formatMoney(Math.max(0, Number(item?.amount) || 0)),
      }));

  items.push(...lines);
  return { items, lineCount: lines.length };
}

function paymentGroups(rows, data, { walletOnly = false, walletEntries = [], facts = null } = {}) {
  const first = rows[0] || {};
  const person = first.person || data.person || {};
  const when = shortDateTimeParts(first.occurredAt || '');
  const quote = data.sourceQuote || {};
  const settlement = data.settlement || {};
  const items = Array.isArray(settlement.items) && settlement.items.length ? settlement.items : (first.settlementItems || []);
  const identity = [
    { label: 'Рабочее пространство', value: first.workplace || data.workplaceName || data.workplace || '' },
    { label: first.operationKind==='refund'?'Дата и время возврата':'Дата и время оплаты', value: [when.date, when.time].filter(Boolean).join(' · ') },
    { label: 'Код', value: person.uei || '' },
    { label: 'Клиент', value: [person.name, person.surname].filter(Boolean).join(' ') },
  ].filter(row => row.value);
  const breakdown = items.map(item => {
    const amount = item.price ?? item.cost;
    return { label: String(item.name || 'Услуга'), value: amount != null && Number.isFinite(Number(amount)) ? formatMoney(Number(amount)) : '—' };
  });
  if (!breakdown.length) {
    const subject = String(quote.subject || data.subject || first.sourceDetails || '').trim();
    breakdown.push({ label: subject || 'Состав услуг не сохранён', value: '' });
  }
  if (settlement.serviceTotal != null && settlement.planTotal != null && Number(settlement.serviceTotal) > Number(settlement.planTotal)) {
    breakdown.push({ label: facts?.discount||facts?.discountUnknown?'Выгода по депозиту':'Скидка', value: formatMoney(Number(settlement.serviceTotal) - Number(settlement.planTotal)) });
  }
  if (settlement.planTotal != null) breakdown.push({ label: 'К оплате', value: formatMoney(settlement.planTotal), strong: true });
  if(walletOnly){
    const tips=walletEntries.filter(e=>e.component==='tips'||e.economicType==='TIPS'||e.economicType==='TIPS_REFUND').reduce((n,e)=>n+Math.round(Number(e.amount||0)*100),0)/100;
    return [identity,breakdown,...(tips?[[{label:'Чаевые',value:formatMoney(tips)}]]:[])].filter(group=>group.length);
  }
  const tips = data.tips != null ? Math.max(0, Number(data.tips) || 0) : rows.filter(item => item.economicType === 'TIPS').reduce((sum,item) => sum + Math.max(0, Number(item.amount)||0),0);
  const payment = [{ label: 'Оплата', value: formatMoney(data.total ?? operationTotal(rows)), strong: true }];
  if(facts?.discount){payment.unshift({label:'Стоимость до выгоды',value:formatMoney(facts.discount.grossAmount)},{label:'Выгода по депозиту',value:formatMoney(-Number(facts.discount.benefitAmount),{signed:true})});}
  if (tips > 0) payment.push({ label: 'Чаевые', value: formatMoney(tips) });
  const distribution = [];
  const allocations = Array.isArray(data.allocations) && data.allocations.length ? data.allocations : (first.allocations || []);
  if (allocations.length) allocations.filter(item => Number(item.amount)>0).forEach(item => distribution.push({ label: item.walletName || item.walletId || 'Кошелёк', value: formatMoney(item.amount) }));
  else {
    const wallets = new Map();
    for (const item of rows) {
      const label = walletText(item);
      if (label) wallets.set(label, (wallets.get(label)||0) + Math.max(0, Number(item.amount)||0));
    }
    for (const [label,amount] of wallets) distribution.push({ label, value: formatMoney(amount) });
  }
  if(facts){
    for(const item of facts.allocations){
      distribution.push({label:item.name.split(' · остаток ')[0],value:formatMoney(item.amount)});
      distribution.push(...depositAllocationDetails(item));
    }
  }else for (const item of (Array.isArray(data.depositAllocations) ? data.depositAllocations : [])) {
    if (Number(item.amount)>0) distribution.push({ label: item.name || 'Депозит', value: formatMoney(item.amount) });
  }
  if (Number(data.personalAccountAmount)>0) distribution.push({ label: 'Личный счёт', value: formatMoney(data.personalAccountAmount) });
  return [identity,breakdown,payment,distribution].filter(group => group.length);
}

function depositAllocationDetails(item){
 if(item.accounting){const a=item.accounting;return [
  {label:'Сумма до выгоды',value:formatMoney(a.grossAmount)},
  {label:'Денежная часть',value:formatMoney(a.realDelta,{signed:true})},
  ...(a.benefitUsed?[{label:'Использовано бонусов',value:formatMoney(-a.benefitUsed,{signed:true})}]:[]),
  ...(a.benefitGranted?[{label:'Предоставлена выгода',value:formatMoney(a.benefitGranted,{signed:true})}]:[]),
  ...(a.benefitRestored?[{label:'Восстановлено бонусов',value:formatMoney(a.benefitRestored,{signed:true})}]:[]),
  ...(a.benefitReversed?[{label:'Аннулирована выгода',value:formatMoney(-a.benefitReversed,{signed:true})}]:[]),
  {label:'Итог движения по депозиту',value:formatMoney(Number(a.realDelta)+Number(a.benefitDelta),{signed:true})},
 ];}
 return [{label:'Денежная часть',value:item.principal===null?'Не определено':formatMoney(item.principal)},{label:'Бонусная часть',value:item.bonus===null?'Не определено':String(item.bonus)}];
}
function depositCashGroups(rows,data,facts=null){
  const first=rows[0]||{},person=data.person||first.person||{};
  const when=shortDateTimeParts(first.occurredAt||'');
  const identity=[
    {label:'Дата и время',value:[when.date,when.time].filter(Boolean).join(' · ')},
    {label:'Код',value:person.uei||''},
    {label:'Клиент',value:[person.name,person.surname].filter(Boolean).join(' ')},
  ].filter(row=>row.value);
  const catalog=getFinanceArticleCatalog(),classification=registeredRoute(catalog,first.operationKind==='deposit-withdrawal'?'DEPOSIT_RETURN':'DEPOSIT_RECEIVED');
  const subject=[{label:'Статья',value:classification?[classification.articleName,classification.valueName].filter(Boolean).join(' · '):depositArticleLabel(first)},{label:'Депозит',value:String(data.programName||first.lineName||'Не указано')}];
  const movement=[{label:'Кошелёк',value:String(data.walletName||first.walletName||'Не определён')},{label:first.operationKind==='deposit-withdrawal'?'Возвращено':'Внесено',value:formatMoney(operationTotal(rows)),strong:true}];
  if(facts&&first.operationKind==='deposit-funding'&&facts.bonus!==0)movement.push({label:'Начислено бонусов',value:facts.bonus===null?'Не определено':String(facts.bonus)});
  if(facts&&first.operationKind==='deposit-withdrawal'){
   if(data.balanceBefore!=null)movement.unshift({label:'Доступный остаток',value:formatMoney(data.balanceBefore)});
   if(facts.conditionalWrittenOff>0)movement.splice(movement.length-1,0,{label:'Аннулирование выгоды по депозиту',value:formatMoney(-facts.conditionalWrittenOff,{signed:true})});
   if(facts.bonus===null)movement.push({label:'Списано бонусов',value:'Не определено'});
   else if(Math.abs(facts.bonus)>Number(facts.conditionalWrittenOff||0))movement.push({label:'Списано бонусов',value:String(Math.abs(facts.bonus)-Number(facts.conditionalWrittenOff||0))});
   if(facts.conditionalWrittenOff>0)movement.push({label:'Основание',value:'Досрочное расторжение: условия депозитного договора не выполнены в части возвращаемых средств.'});
  }
  if(first.operationKind==='deposit-withdrawal'&&data.reason)movement.push({label:'Причина',value:String(data.reason)});
  return [identity,subject,movement].filter(group=>group.length);
}
function loyaltyOtherGroups(first,data,facts){
 const when=shortDateTimeParts(first.occurredAt||'');
 const person=data.person||first.person||{};
 const identity=[{label:'Дата и время',value:[when.date,when.time].filter(Boolean).join(' · ')},{label:'Код',value:person.uei||''},{label:'Клиент',value:personText({person})}].filter(r=>r.value);
 const catalog=getFinanceArticleCatalog(),details=[];
 if(Array.isArray(catalog)){
  const refund=facts.kind==='refund',keys=[];
  if(facts.allocations.length||facts.discount||facts.discountUnknown)keys.push(refund?'DEPOSIT_PAYMENT_REFUND':'DEPOSIT_SPEND');
  if(facts.personal)keys.push(refund?'PERSONAL_ACCOUNT_PAYMENT_REFUND':'PERSONAL_ACCOUNT_SPEND');
  const cashKey={'deposit-funding':'DEPOSIT_RECEIVED','deposit-withdrawal':'DEPOSIT_RETURN','personal-account-funding':'PERSONAL_ACCOUNT_LIABILITY_IN','personal-account-withdrawal':'PERSONAL_ACCOUNT_LIABILITY_OUT','personal-account-debt-settlement':'PERSONAL_ACCOUNT_DEBT_SETTLEMENT'}[facts.kind];
  if(cashKey)keys.push(cashKey);
  for(const key of new Set(keys)){const a=registeredRoute(catalog,key);if(a)details.push({label:'Статья',value:[a.articleName,a.valueName].filter(Boolean).join(' · ')});}
 }else details.push({label:'Статья',value:facts.article});
 if(facts.discount&&first.operationKind==='refund')details.push({label:'Стоимость возвращаемого обслуживания',value:formatMoney(facts.discount.grossAmount)},{label:'Аннулирование выгоды по депозиту',value:formatMoney(-Number(facts.discount.benefitAmount),{signed:true})},{label:'К возврату',value:formatMoney(facts.discount.netAmount),strong:true});
 for(const item of facts.allocations){
  details.push({label:item.name.split(' · остаток ')[0],value:formatMoney(item.amount)},...depositAllocationDetails(item));
 }
 if(facts.personal)details.push({label:'Личный счёт',value:formatMoney(facts.personal,{signed:true})});
 if(facts.cash)details.push({label:data.walletName||first.walletName||'Движение по кошельку',value:formatMoney(facts.cash,{signed:true})});
 if(facts.cashUnknown)details.push({label:'Кошелёк',value:'Не определён'});
 if(data.reason)details.push({label:'Причина',value:String(data.reason)});
 return [identity,details,[{label:'Итого',value:formatMoney(facts.amount||Math.abs(facts.cash)),strong:true}]];
}
// Use the historical operation snapshot, not the current price list or record.
export function financeReceipt(operationId, title, { entries = [], wallet = null, desktop = false, document = null } = {}) {
  const id = String(operationId || '');
  const all = getLedgerEntries().filter(item => String(item.operationId || '') === id);
  const rows = all.length ? all : entries;
  const first = rows[0] || document?.first || {};
  const operation=getFinanceOperation(id);
  const data = operation?.data || {};
  const facts=(desktop||document)?(document?.facts||(operation?loyaltyDocumentFacts(operation,rows):null)):null;
  const receiptRows=rows.length?rows:[first];
  const when = shortDateTimeParts(first.occurredAt || '');
  if((desktop||document)&&isDepositCashDocument(first))return readOnlyReceipt({groups:depositCashGroups(receiptRows,data,facts)});
  if(facts&&first.operationKind!=='payment'&&!(wallet&&first.operationKind==='refund'))return readOnlyReceipt({groups:loyaltyOtherGroups(first,data,facts)});
  const walletEntries=wallet?(wallet.id?receiptRows.filter(e=>e.walletId===wallet.id):entries):[];
  const groups = first.operationKind === 'payment'||(wallet&&first.operationKind==='refund') ? paymentGroups(receiptRows,data,{ walletOnly: Boolean(wallet),walletEntries,facts }) : [];
  const walletTotal = wallet ? [{ label: 'Движение по кошельку · ' + wallet.name, value: formatMoney(wallet.total), strong: true }] : [];
  if (groups.length) {
    const movement = Number(wallet?.total) || 0;
    return readOnlyReceipt({ groups, totals: wallet ? [{ label: movement < 0 ? 'Списано' : 'Поступило', value: formatMoney(Math.abs(movement)), strong: true }] : [] });
  }
  const details = operationReceiptItems(rows).items;
  if (data.financeEntityName) details.push({ label: 'Наименование', value: data.financeEntityName });
  return readOnlyReceipt({ date: when.date || '—', time: when.time || '—', items: details, totals: [{label:'Итого',value:formatMoney(operationTotal(rows)),strong:true},...walletTotal] });
}
