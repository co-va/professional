// Presentation-only article sequence. IDs are canonical and account-scoped.
// Never change ledger routing, article parentage, or amounts to change order.
import {getProfile} from '../../profile/data.js';

function key(){
 const profile=getProfile(),id=profile.platformAccountId||profile.id;
 return id?'professional.finance.article-order.v1:'+id:'';
}
export function readArticleOrder(){
 try{const id=key();if(!id)return [];const value=JSON.parse(localStorage.getItem(id)||'[]');
  return Array.isArray(value)?[...new Set(value.filter(id=>typeof id==='string'&&id))]:[];
 }catch{return [];}
}
export function sortArticleDirectory(items,order=[]){
 const rank=new Map(order.map((id,index)=>[id,index]));
 return items.map((item,index)=>({item,index})).sort((a,b)=>
  Number(!a.item.systemKey)-Number(!b.item.systemKey)||
  (rank.get(a.item.articleId)??Number.MAX_SAFE_INTEGER)-(rank.get(b.item.articleId)??Number.MAX_SAFE_INTEGER)||
  a.index-b.index).map(row=>row.item);
}
export function mergeArticleSectionOrder(items,order,section,ids){
 if(!['system','custom'].includes(section))throw new Error('Неизвестный раздел статей.');
 const displayed=sortArticleDirectory(items,order);
 const matches=a=>(a.systemKey?'system':'custom')===section;
 const expected=new Set(displayed.filter(matches).map(a=>a.articleId));
 if(ids.length!==expected.size||new Set(ids).size!==expected.size||ids.some(id=>!expected.has(id)))throw new Error('Список статей изменился. Откройте его повторно.');
 let i=0;
 const visible=displayed.map(a=>matches(a)?ids[i++]:a.articleId);
 // Retain unavailable/historical IDs rather than clearing their preference.
 const known=new Set(visible);
 return [...visible,...order.filter(id=>!known.has(id))];
}
export function saveArticleSectionOrder(items,section,ids){
 const id=key();if(!id)throw new Error('Профиль ещё не загружен.');
 const next=mergeArticleSectionOrder(items,readArticleOrder(),section,ids);
 localStorage.setItem(id,JSON.stringify(next));return next;
}
export function orderDDSArticleRows(rows,catalog,order=[]){
 const rank=new Map(sortArticleDirectory(catalog||[],order).map((a,i)=>[a.articleId,i]));
 return rows.map((row,index)=>({row,index})).sort((a,b)=>
  (rank.get(a.row.articleId)??Number.MAX_SAFE_INTEGER)-(rank.get(b.row.articleId)??Number.MAX_SAFE_INTEGER)||a.index-b.index).map(x=>x.row);
}
