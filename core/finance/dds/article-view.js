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

// The catalogue mechanism IDs are projections, not writable Core article IDs.
 // Pick a persisted route owner for each allowed cash direction. Never create
 // a synthetic parent or turn a user label into a new system route.
 export function mechanismValueParents(article,raw){
  if(!article?.capability||!article.systemKey)return [];
  const routes=(article.values||[]).filter(v=>!v.custom&&!v.archived).flatMap(v=>v.routes||[]);
  const result=[];
  for(const route of routes){
   const parent=raw.find(a=>a.systemKey===route&&!a.archivedAt&&['IN','OUT'].includes(a.direction)&&a.economicType&&a.economicType!=='GROUP');
   if(parent&&!result.some(a=>a.direction===parent.direction))result.push(parent);
  }
  return result;
 }
