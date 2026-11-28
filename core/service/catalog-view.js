import {stockGroupTree} from '../inventory/grouping.js';
export const SERVICE_GROUP_PREFIX='__service_group_';
const key=v=>String(v??'');
// Group and value are separate display switches. Never duplicate a catalogue
// position or modify its assignment to a group.
export function serviceTree(items,levels,{groupGroups=true,groupValues=true}={}){
 const criteria=levels.flatMap(g=>[
  ...(groupGroups?[{id:SERVICE_GROUP_PREFIX+g.id,values:[{id:'selected',name:g.name}]}]:[]),
  ...(groupValues?[{id:g.id,values:(g.values||[]).map(v=>({...v,name:groupGroups?v.name:g.name+' · '+v.name}))}]:[])
 ]);
 const decorated=items.map(item=>{
  const criteriaValues={};
  for(const g of levels){
   const value=key(item.groupValues?.[g.id]);if(!value)continue;
   if(groupGroups)criteriaValues[SERVICE_GROUP_PREFIX+g.id]='selected';
   if(groupValues&&g.values?.some(v=>v.id===value))criteriaValues[g.id]=value;
  }
  return {...item,criteriaValues};
 });
 return {tree:stockGroupTree(decorated,criteria),criteria};
}
export function serviceTableColumns(kind){
 const service=kind==='procedures';
 return [
  ['name','Наименование'],['price','Цена'],
  ...(service?[['duration','Время работы']]:[]),
  ['usage','Пространства / Количество'],
  ...(service?[['minutes','Затрачено времени']]:[]),
  ['revenue','Доход']
 ];
}
export function serviceUsageText(workplaces,count){
 return String(workplaces)+' / '+(count==null?'—':String(count));
}
