// Desktop-only presentation. Canonical finance data remains in Core.
const labels={SERVICE_REVENUE:'Оплата услуг',LOAN_RECEIVED:'Получение займа',MATERIALS:'Закупка материалов',TRANSFER:'Транзакция',INVESTMENT_RECEIVED:'Получение инвестиции'};
export const desktopArticleName=a=>labels[a?.systemKey]||a?.name||'';
export function desktopAvailableArticles(articles,can){
 const journal=['journal.day.access','journal.month.access','journal.list.access'].some(can);
 const special=can('finance.special.access');
 const raise=can('finance.investment.raise.access'),invest=can('finance.investment.self.access')||can('finance.investment.external.access');
 const allowed={DEPOSIT_RECEIVED:can('loyalty.deposit.access'),DEPOSIT_RETURN:can('loyalty.deposit.access'),PERSONAL_ACCOUNT_LIABILITY_IN:can('loyalty.personal_account.access'),PERSONAL_ACCOUNT_LIABILITY_OUT:can('loyalty.personal_account.access'),RENT:false,TAX:false,INCOME_ROOT:true,EXPENSE_ROOT:true,SERVICE_REVENUE:journal,PRODUCT_REVENUE:journal,TIPS:journal,REFUND:journal,MATERIALS:can('inventory.stock.access')||can('inventory.order.access'),OTHER_INCOME:false,OTHER_EXPENSE:false,LOAN_RECEIVED:special,LOAN_REPAYMENT:special,TRANSFER:special,INVESTMENT_RECEIVED:raise,INVESTMENT_RETURN:raise,INVESTMENT_INCOME_PAYMENT:raise,INVESTMENT_CAPITAL_RETURN:invest,INVESTMENT_INCOME:invest,INVESTMENT_CONTRIBUTION:invest,INVESTMENT_EXPENSE:invest};
 const hidden=new Set(articles.filter(a=>a.archivedAt||(a.systemKey&&allowed[a.systemKey]!==true)).map(a=>a.articleId));
 // Values follow their owning system article's availability, not their own systemKey.
 for(let changed=true;changed;){changed=false;for(const a of articles)if(hidden.has(a.parentArticleId)&&!hidden.has(a.articleId)){hidden.add(a.articleId);changed=true;}}
 return articles.filter(a=>!hidden.has(a.articleId)).map(a=>({...a,name:desktopArticleName(a)}));
}
export const desktopOperationDirection=d=>({in:'Приход',out:'Расход',transfer:'Транзакция',mixed:'Транзакция'})[d]||'—';
export const depositArticleLabel=entry=>({DEPOSIT_RECEIVED:'Пополнение депозита',DEPOSIT_RETURN:'Возврат депозита'})[entry?.economicType]||({'deposit-funding':'Пополнение депозита','deposit-withdrawal':'Возврат депозита'})[entry?.operationKind]||'';
export const isDepositCashDocument=entry=>['deposit-funding','deposit-withdrawal'].includes(entry?.operationKind);
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
  if(byKey.has(k))add(k);else if(depositArticleLabel(e))found.add(depositArticleLabel(e));
 }
 return [...found].filter(Boolean).sort((a,b)=>a.localeCompare(b,'ru'));
}

// A Desktop article is a group; children of accessible non-root articles are named values.
export function desktopArticleGroups(articles){
 const parents=new Set(articles.filter(a=>a.economicType!=='GROUP'&&!['INCOME_ROOT','EXPENSE_ROOT'].includes(a.systemKey)&&a.direction!=='TRANSFER').map(a=>a.articleId));
 return articles.filter(a=>a.systemKey||!parents.has(a.parentArticleId));
}
export function desktopArticleValues(articles,articleId){
 const parent=articles.find(a=>a.articleId===articleId);
 if(!parent||parent.economicType==='GROUP'||['INCOME_ROOT','EXPENSE_ROOT'].includes(parent.systemKey)||parent.direction==='TRANSFER')return [];
 return articles.filter(a=>!a.systemKey&&a.parentArticleId===articleId&&a.direction===parent.direction&&!a.archivedAt);
}

// These articles belong to their own canonical mechanisms, not manual cash entry.
export const isLoyaltyCashArticle=a=>['DEPOSIT_RECEIVED','DEPOSIT_RETURN','PERSONAL_ACCOUNT_LIABILITY_IN','PERSONAL_ACCOUNT_LIABILITY_OUT'].includes(a?.economicType);
