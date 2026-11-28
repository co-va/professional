// Translate visible canonical article/value into an actual writable Core article ID.
export function manualArticleChoices(raw,catalogue,direction,{preserveId='',allowedIds=null,fullCatalogue=catalogue,allowEmptySystemValue=false}={}){
 const allowed=allowedIds?new Set(allowedIds):null;
 const eligible=raw.filter(a=>a.direction===direction&&a.economicType!=='GROUP'&&(!a.archivedAt||a.articleId===preserveId)&&(!['DEPOSIT_RECEIVED','DEPOSIT_RETURN','PERSONAL_ACCOUNT_LIABILITY_IN','PERSONAL_ACCOUNT_LIABILITY_OUT'].includes(a.economicType)||a.articleId===preserveId)&&(!allowed||!a.systemKey||allowed.has(a.articleId)||a.articleId===preserveId));
 const byId=id=>eligible.find(a=>a.articleId===id);
 const byRoutes=routes=>routes.flatMap(route=>eligible.filter(a=>a.systemKey===route))[0];
 const directory=Array.isArray(catalogue)?catalogue:[];
 const full=Array.isArray(fullCatalogue)?fullCatalogue:[];
 const known=new Set(full.flatMap(a=>[a.articleId,...(a.values||[]).map(v=>v.valueId)]));
 const roots=new Set(['INCOME_ROOT','EXPENSE_ROOT']);
 const fallback=eligible.filter(a=>!a.systemKey&&!known.has(a.articleId)&&(()=>{
   const parent=raw.find(p=>p.articleId===a.parentArticleId);
   return !parent||roots.has(parent.systemKey)||parent.economicType==='GROUP';
 })()).map(a=>({...a,values:eligible.filter(v=>!v.systemKey&&v.parentArticleId===a.articleId).map(v=>({valueId:v.articleId,name:v.name,routes:[]}))}));
 return [...directory,...fallback].flatMap(a=>{
   if(a.archived&&a.articleId!==preserveId&&!a.values?.some(v=>v.valueId===preserveId))return [];
   const direct=byId(a.articleId)||byRoutes(a.routes||[]);
   const values=(a.values||[]).flatMap(v=>{
     if((v.archived&&v.valueId!==preserveId)||v.routes?.includes('SERVICE_PREPAYMENT'))return [];
     const row=byId(v.valueId)||byRoutes(v.routes||[]);
     return row?[{value:v.valueId,label:v.name,rawId:row.articleId}]:[];
   });
   const emptyRaw=direct?.articleId||(allowEmptySystemValue?values.find(v=>v.rawId)?.rawId:'')||'';
   return direct||values.length?[{value:a.articleId,label:a.name,rawId:emptyRaw,values,canonical:known.has(a.articleId)}]:[];
 });
}
export function manualArticleSelection(choices,rawId){
 for(const a of choices){
   const v=a.values.find(v=>v.rawId===rawId);
   if(v)return {articleId:a.value,valueId:v.value};
   if(a.rawId===rawId)return {articleId:a.value,valueId:''};
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
