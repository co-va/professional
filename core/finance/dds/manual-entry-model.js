// Translate visible canonical article/value into an actual writable Core article ID.
export function manualArticleChoices(raw,catalogue,direction,{preserveId='',allowedIds=null}={}){
 const allowed=allowedIds?new Set(allowedIds):null;
 const eligible=raw.filter(a=>a.direction===direction&&a.economicType!=='GROUP'&&(!a.archivedAt||a.articleId===preserveId)&&(!['DEPOSIT_RECEIVED','DEPOSIT_RETURN','PERSONAL_ACCOUNT_LIABILITY_IN','PERSONAL_ACCOUNT_LIABILITY_OUT'].includes(a.economicType)||a.articleId===preserveId)&&(!allowed||allowed.has(a.articleId)||a.articleId===preserveId));
 const byId=id=>eligible.find(a=>a.articleId===id);
 const byRoutes=routes=>routes.flatMap(route=>eligible.filter(a=>a.systemKey===route))[0];
 if(!Array.isArray(catalogue))return [];
 return catalogue.flatMap(a=>{
   if(a.archived&&a.articleId!==preserveId&&!a.values?.some(v=>v.valueId===preserveId))return [];
   const direct=byId(a.articleId)||byRoutes(a.routes||[]);
   const values=(a.values||[]).flatMap(v=>{
     if(v.archived&&v.valueId!==preserveId)return [];
     const row=byId(v.valueId)||byRoutes(v.routes||[]);
     return row?[{value:v.valueId,label:v.name,rawId:row.articleId}]:[];
   });
   return direct||values.length?[{value:a.articleId,label:a.name,rawId:direct?.articleId||'',values}]:[];
 });
}
export function manualArticleSelection(choices,rawId){
 for(const a of choices){
   if(a.rawId===rawId)return {articleId:a.value,valueId:''};
   const v=a.values.find(v=>v.rawId===rawId);
   if(v)return {articleId:a.value,valueId:v.value};
 }
 return {articleId:'',valueId:''};
}
export function manualRawArticle(choices,articleId,valueId){
 const a=choices.find(a=>a.value===articleId);
 return !a?'':valueId?a.values.find(v=>v.value===valueId)?.rawId||'':a.rawId;
}
export function manualDetailTotal(lines){
 return lines.reduce((sum,row)=>{
   const q=Number(row.quantity),p=Number(row.unitPrice);
   return !Number.isFinite(q)||!Number.isFinite(p)||q<=0||p<=0?sum:sum+Math.round(q*Math.round(p*100));
 },0)/100;
}
export function validManualLine(row){
 return Boolean(row.name&&Number.isFinite(row.quantity)&&Number.isFinite(row.unitPrice)&&row.quantity>0&&row.unitPrice>0&&Math.round(row.quantity*Math.round(row.unitPrice*100))>0);
}
