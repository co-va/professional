// Desktop-only presentation. Canonical finance data remains in Core.
const labels={SERVICE_REVENUE:'Оплата услуг',LOAN_RECEIVED:'Получение займа',MATERIALS:'Закупка материалов',TRANSFER:'Транзакция',INVESTMENT_RECEIVED:'Получение инвестиции'};
export const desktopArticleName=a=>labels[a?.systemKey]||a?.name||'';
export function desktopAvailableArticles(articles,can){
 const journal=['journal.day.access','journal.month.access','journal.list.access'].some(can);
 const special=can('finance.special.access');
 const raise=can('finance.investment.raise.access'),invest=can('finance.investment.self.access')||can('finance.investment.external.access');
 const allowed={RENT:false,TAX:false,INCOME_ROOT:true,EXPENSE_ROOT:true,SERVICE_REVENUE:journal,PRODUCT_REVENUE:journal,TIPS:journal,REFUND:journal,MATERIALS:can('inventory.stock.access')||can('inventory.order.access'),OTHER_INCOME:false,OTHER_EXPENSE:false,LOAN_RECEIVED:special,LOAN_REPAYMENT:special,TRANSFER:special,INVESTMENT_RECEIVED:raise,INVESTMENT_RETURN:raise,INVESTMENT_INCOME_PAYMENT:raise,INVESTMENT_CAPITAL_RETURN:invest,INVESTMENT_INCOME:invest,INVESTMENT_CONTRIBUTION:invest,INVESTMENT_EXPENSE:invest};
 return articles.filter(a=>!a.archivedAt&&(!a.systemKey||allowed[a.systemKey]===true)).map(a=>({...a,name:desktopArticleName(a)}));
}
export const desktopOperationDirection=d=>({in:'Приход',out:'Расход',transfer:'Транзакция',mixed:'Транзакция'})[d]||'—';
// Existing historical economic types are authoritative when articleId is absent.
// Never allocate a combined document's money to inferred individual items.
export function desktopDocumentArticles(entries,catalog){
 const byId=new Map(catalog.map(a=>[a.articleId,a])),byKey=new Map(catalog.filter(a=>a.systemKey).map(a=>[a.systemKey,a]));
 const found=new Set();
 const add=k=>{const a=byKey.get(k);if(a)found.add(desktopArticleName(a));};
 for(const e of entries){
  const a=byId.get(e.articleId);
  if(e.economicType==='SERVICE_REVENUE'&&(!e.articleId||a?.systemKey==='SERVICE_REVENUE')){
   const types=new Set((e.settlementItems||[]).map(i=>i.sourceType));
   if(types.has('product')&&types.has('procedure')){add('SERVICE_REVENUE');add('PRODUCT_REVENUE');continue;}
   if(types.has('product')&&types.size===1){add('PRODUCT_REVENUE');continue;}
  }
  if(e.articleName){found.add(a?.systemKey?desktopArticleName(a):e.articleName);continue;}
  if(a){found.add(desktopArticleName(a));continue;}
  const k=({SERVICE_REFUND:'REFUND',TIPS_REFUND:'REFUND'})[e.economicType]||e.economicType;
  add(k);
 }
 return [...found].filter(Boolean).sort((a,b)=>a.localeCompare(b,'ru'));
}
