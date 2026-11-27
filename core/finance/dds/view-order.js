// DDS grouping and sorting are independent presentation operations.
import {sortArticleDirectory} from './article-order.js';
export const DDS_SORTS=[
 ['dateDesc','Дата — сначала новые'],['dateAsc','Дата — сначала ранние'],
 ['code','Код клиента'],['person','Клиент / контрагент'],
 ['workplace','Рабочее пространство'],['wallet','Кошелёк'],
 ['amount','Сумма'],['bonus','Бонусы']
];
export function normalizeDDSView(state){
 if(typeof state.groupArticles!=='boolean')state.groupArticles=state.sort==='articleOrder'||!state.sort;
 if(typeof state.groupValues!=='boolean')state.groupValues=false;
 const legacy={articleOrder:'dateDesc',codeAsc:'code',codeDesc:'code',personAsc:'person',personDesc:'person',workplaceAsc:'workplace',workplaceDesc:'workplace',walletAsc:'wallet',walletDesc:'wallet',amountAsc:'amount',amountDesc:'amount',bonusAsc:'bonus',bonusDesc:'bonus'};
 state.sort=legacy[state.sort]||state.sort;
 if(!DDS_SORTS.some(([mode])=>mode===state.sort))state.sort='dateDesc';
 return state;
}
const text=v=>String(v??'').trim();
const compare=(a,b)=>text(a).localeCompare(text(b),'ru',{numeric:true});
const missingLast=(a,b)=>Number(!text(a))-Number(!text(b));
const dateCompare=(a,b)=>(Date.parse(b.occurredAt)||0)-(Date.parse(a.occurredAt)||0)||compare(a.id,b.id);
const rank=(items,key)=>new Map(items.map((item,i)=>[text(key(item)),i]).filter(([k])=>k));
export function sortDDSRows(rows,mode,{wallets=[],workplaces=[],people=[]}={}){
 const byWallet=rank(wallets,w=>w.id),walletNames=rank(wallets,w=>w.name);
 const spaces=rank(workplaces,w=>w.key),spaceNames=rank(workplaces,w=>w.name);
 const clients=rank(people,p=>p.uei),clientKeys=rank(people,p=>p.key);
 const last=Number.MAX_SAFE_INTEGER;
 const walletRank=r=>{
  if(r.walletId&&byWallet.has(text(r.walletId)))return byWallet.get(text(r.walletId));
  return Math.min(last,...(r.wallets||[]).map(name=>walletNames.get(text(name))??last));
 };
 const spaceRank=r=>spaces.get(text(r.workplaceKey))??spaceNames.get(text(r.workplace))??last;
 const clientRank=r=>clients.get(text(r.code))??clientKeys.get(text(r.personKey))??last;
 return [...rows].sort((a,b)=>{
  let n=0;
  if(mode==='dateAsc')return (Date.parse(a.occurredAt)||0)-(Date.parse(b.occurredAt)||0)||compare(a.id,b.id);
  if(mode==='code')n=missingLast(a.code,b.code)||compare(a.code,b.code);
  if(mode==='wallet')n=walletRank(a)-walletRank(b);
  if(mode==='workplace')n=spaceRank(a)-spaceRank(b);
  if(mode==='person')n=clientRank(a)-clientRank(b);
  if(mode==='amount')n=Math.abs(Number(b.value)||0)-Math.abs(Number(a.value)||0);
  if(mode==='bonus')n=Number(Boolean(Number(b.bonusValue)))-Number(Boolean(Number(a.bonusValue)));
  return n||dateCompare(a,b);
 });
}
// Each value retains its registered identity and owning article. The group
// order comes from the catalogue; sorting controls only the leaf rows.
export function buildDDSGroups(rows,{groupArticles=false,groupValues=false,catalog=[],order=[]}={}){
 const sortedCatalog=sortArticleDirectory(catalog||[],order);
 const articles=new Map(sortedCatalog.map((a,i)=>[a.articleId,{rank:i,item:a}]));
 const last=Number.MAX_SAFE_INTEGER;
 const articleRank=r=>articles.get(r.articleId)?.rank??last;
 const valueRank=r=>{const values=articles.get(r.articleId)?.item.values||[],i=values.findIndex(v=>v.valueId===r.articleValueId);return i<0?last:i;};
 const articleKey=r=>text(r.articleId)||text(r.article);
 const valueKey=r=>JSON.stringify([articleKey(r),text(r.articleValueId)||text(r.articleValue)]);
 const split=(items,key,label,compareGroups,level,path=[])=>{
  const groups=new Map();
  for(const row of items){const k=key(row);if(!groups.has(k))groups.set(k,{key:k,label:label(row),rows:[],level,path:[...path,k]});groups.get(k).rows.push(row);}
  return [...groups.values()].sort((a,b)=>compareGroups(a.rows[0],b.rows[0]));
 };
 const values=(items,path=[])=>split(items,valueKey,r=>[text(r.articleValue)||'Без значения',...(!groupArticles&&r.article?[r.article]:[])].join(' · '),(a,b)=>articleRank(a)-articleRank(b)||valueRank(a)-valueRank(b),'value',path);
 if(groupArticles)return split(rows,articleKey,r=>text(r.article)||'—',(a,b)=>articleRank(a)-articleRank(b),'group').map(g=>({...g,children:groupValues?values(g.rows,g.path):[]}));
 if(groupValues)return values(rows);
 return [];
}
export function flattenDDSGroups(groups){return groups.flatMap(g=>g.children?.length?flattenDDSGroups(g.children):g.rows);}
