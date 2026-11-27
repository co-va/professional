// The names and identities come exclusively from the Core catalogue.
export function registeredArticle(catalog,identity){
 if(!identity||!Array.isArray(catalog))return null;
 const article=catalog.find(a=>a.articleId===identity.articleId);
 if(!article)return null;
 const value=identity.valueId?(article.values||[]).find(v=>v.valueId===identity.valueId):null;
 if(identity.valueId&&!value)return null;
 return {articleId:article.articleId,articleName:article.name,valueId:value?.valueId||'',valueName:value?.name||''};
}
export function registeredRoute(catalog,route){
 if(!route||!Array.isArray(catalog))return null;
 for(const a of catalog){
  const value=(a.values||[]).find(v=>v.routes?.includes(route));
  if(value)return registeredArticle(catalog,{articleId:a.articleId,valueId:value.valueId});
  if(a.routes?.includes(route))return registeredArticle(catalog,{articleId:a.articleId});
 }
 return null;
}
export function registeredLedgerArticle(entry,catalog){
 // An explicit null from Core is an unresolved historical classification.
 return registeredArticle(catalog,entry?.articleClass);
}
export function articleCellText(article,value=''){return [article,value].filter(Boolean).join('\n');}

 // Capabilities hide a mechanism from the directory, never from its history.
 // Existing unapproved loan/investment rows retain their previous access gates.
 export function availableArticleDirectory(catalog,legacy,can){
  if(!Array.isArray(catalog))return null;
  const legacyIds=new Set(legacy.map(a=>a.articleId));
  return catalog.filter(a=>!a.archived&&(
   a.capability==='journal'?['journal.day.access','journal.month.access','journal.list.access'].some(can):
   a.capability==='inventory'?['inventory.stock.access','inventory.order.access'].some(can):
   a.capability?can(a.capability):
   a.deferred?legacyIds.has(a.articleId):!a.systemKey
  )).map(a=>({...a,values:(a.values||[]).filter(v=>!v.archived)}));
 }
