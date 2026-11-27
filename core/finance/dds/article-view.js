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
