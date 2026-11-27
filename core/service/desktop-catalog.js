// Desktop is a two-section projection of the existing Service catalogue.
// Keep V2 rows, catalogue disclosure, price format and reorder owner.
import {button,compactButton,field,select,modal,mountModal,emptyState,v2ListEntry,v2ListEntries,initV2ListReorder,openNotice,costListParts,durationText,escapeHtml} from '../../ui/ui.js';
import {catalogDisclosure} from '../inventory/catalog-ui.js';
import {stockGroupTree,sortedStockChildren} from '../inventory/grouping.js';
import {getProcedures,commitReorderProcedures} from './procedures/data.js';
import {getProducts,commitReorderProducts,getServiceGroupLevels,getServiceGroupEntries,commitServiceGroupOrder,commitServiceGroupLevels} from './products/data.js';
import {getWorkplaces} from '../profile/workplaces/data.js';
import {procedureCardPhoto,productCardPhoto} from './card-presentation.js';
import {loadInventory} from '../inventory/service.js';
import {loadAuxiliaryState} from '../runtime/auxiliary-state.js';
import {loadServiceStatistics,serviceCatalogStatistics,serviceSpentText} from './statistics.js';

const key=v=>String(v??'');
const normalize=v=>key(v).toLocaleLowerCase('ru').replace(/ё/g,'е').trim();
const compare=(a,b)=>key(a).localeCompare(key(b),'ru',{numeric:true,sensitivity:'base'});
const money=v=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(v)+' ₽';
const ids=item=>[...new Set((item.workplaces||[]).map(w=>key(w.workplaceId||w.key||w.id)).filter(Boolean))];
const dataFor=kind=>kind==='procedures'?getProcedures():getProducts();
const priceText=item=>Object.values(costListParts(item.cost)).filter(Boolean).join(' ');
const priceNumber=item=>Number(item.cost?.free?0:item.cost?.from||item.cost?.amount||0);
const prefix='__service_group_';
const labels={name:'Наименование',price:'Цена',duration:'Время',workplaces:'Рабочие пространства',count:'Выполнено',minutes:'Затрачено времени',revenue:'Доход'};
export function mergeServiceOrder(all,changed){
  const set=new Set(changed);
  if(set.size!==changed.length||changed.some(id=>!all.includes(id)))throw Error('Список изменился.');
  let offset=0;return all.map(id=>set.has(id)?changed[offset++]:id);
}
function serviceTree(items,levels){
  const criteria=levels.flatMap(g=>[{id:prefix+g.id,values:[{id:'selected',name:g.name}]},{id:g.id,values:g.values||[]}]);
  const decorated=items.map(item=>{
    const criteriaValues={};
    for(const g of levels){
      const value=key(item.groupValues?.[g.id]);
      if(!value)continue;
      criteriaValues[prefix+g.id]='selected';
      if(g.values?.some(v=>v.id===value))criteriaValues[g.id]=value;
    }
    return {...item,criteriaValues};
  });
  return {tree:stockGroupTree(decorated,criteria),criteria};
}
export function renderDesktopServiceCatalog(host,{root,onChanged,state,onCount,loadProceduresModule,loadProductsModule}){
  let disposed=false,statistics=null,ready=false,serial=0;
  let disposers=[];
  const fail=error=>openNotice({title:'Сервис',message:error?.message||'Не удалось сохранить.'});
  host.innerHTML=['procedures','products'].map(kind=>{
    const title=kind==='procedures'?'Услуги':'Товары';
    return '<section data-service-desktop-section="'+kind+'"><div class="v2-desktop-tool-row service-desktop-section-tools"><div class="v2-desktop-tool-context"><strong>'+title+'</strong><output data-service-section-count></output></div><div class="people-desktop-tools">'+field({name:kind+'Search',type:'search',placeholder:'Поиск',autocomplete:'off',value:state[kind].query,data:'data-service-search'})+'<div class="people-desktop-actions people-desktop-query-tools">'+compactButton({kind:'filter',data:'data-service-filter title="Фильтр"',aria:'Фильтр'})+compactButton({kind:'sort',data:'data-service-sort title="Сортировка"',aria:'Сортировка'})+'</div><div class="people-desktop-actions people-desktop-actions--right">'+button('+',{variant:'secondary',className:'people-desktop-icon people-desktop-add',data:'data-service-add-position',aria:kind==='procedures'?'Добавить услугу':'Добавить товар'})+'</div></div></div><div data-service-table-host></div></section>';
  }).join('');
  const sections=[...host.querySelectorAll('[data-service-desktop-section]')];
  const refresh=()=>{
    if(disposed||!host.isConnected)return;
    disposers.forEach(fn=>fn());disposers=[];serial=0;
    let total=0;
    for(const section of sections){
      const kind=section.dataset.serviceDesktopSection,isService=kind==='procedures',st=state[kind],all=dataFor(kind),levels=getServiceGroupLevels(kind);
      total+=all.length;
      const workplaceNames=new Map(getWorkplaces().map(w=>[key(w.key||w.id),w.name]));
      const valueNames=item=>levels.flatMap(g=>item.groupValues?.[g.id]?[g.name,g.values?.find(v=>v.id===item.groupValues[g.id])?.name||'']:[]);
      const stat=item=>statistics?.[kind]?.get(key(item.id));
      const data=item=>({name:item.name,price:priceNumber(item),duration:Number(item.duration)||0,workplaces:ids(item).length,count:stat(item)?.count,minutes:stat(item)?.minutes,revenue:stat(item)?.revenue});
      const rows=all.filter(item=>normalize([item.name,priceText(item),...ids(item).map(id=>workplaceNames.get(id)),...valueNames(item)].join(' ')).includes(normalize(st.query))&&(!st.group||Boolean(item.groupValues?.[st.group]))&&(!st.workplace||(st.workplace==='none'?!ids(item).length:ids(item).includes(st.workplace))));
      if(st.sort!=='manual'){
        const [column,dir]=st.sort.split(':');
        rows.sort((a,b)=>{const x=data(a)[column],y=data(b)[column];return ((typeof x==='number'&&typeof y==='number')?x-y:compare(x,y))*(dir==='desc'?-1:1)||compare(a.name,b.name)});
      }
      const manual=st.sort==='manual'&&!st.query&&!st.group&&!st.workplace;
      section.querySelector('[data-service-section-count]').textContent=String(rows.length);
      section.querySelector('[data-service-filter]').setAttribute('aria-pressed',String(Boolean(st.group||st.workplace)));
      section.querySelector('[data-service-sort]').setAttribute('aria-pressed',String(st.sort!=='manual'));
      const {tree,criteria}=serviceTree(rows,levels);
      const scopes=[];
      const row=(item,scope)=>{
        const stats=stat(item),price=costListParts(item.cost);
        const cells=[isService?durationText(item.duration):null,String(ids(item).length),stats?String(stats.count):'—',isService?(stats?serviceSpentText(stats.minutes):'—'):null,stats?money(stats.revenue):'—'].filter(x=>x!==null);
        const values='<span class="list-entry__right service-desktop-price">'+[price.rightTop,price.rightBottom].filter(Boolean).map((v,i)=>'<'+(i?'small':'strong')+'>'+escapeHtml(v)+'</'+(i?'small':'strong')+'>').join('')+'</span>'+cells.map(v=>'<span class="service-desktop-value">'+escapeHtml(v)+'</span>').join('');
        let html=v2ListEntry({title:item.name||'',subtitle:'',omitEmptySubtitle:true,image:isService?procedureCardPhoto(item):productCardPhoto(item),initial:(item.name||'?').slice(0,1).toUpperCase(),interactive:true,reorderHandle:manual,reorderAria:'Изменить порядок',data:'data-service-position="'+escapeHtml(item.id)+'" data-reorder-id="'+escapeHtml(item.id)+'" data-service-reorder-scope="'+scope+'"',aria:'Открыть '+item.name});
        html=html.replace(/(\s*<\/span>\s*<\/button>)$/,values+'$1');
        return html.replace('data-reorder-handle','data-reorder-handle data-service-handle="'+scope+'"');
      };
      const walk=node=>{
        const children=sortedStockChildren(node,criteria);
        // Group definitions and values reorder in separate sibling scopes.
        const batches=[];
        for(const child of children){
          const groupId=child.group.id;
          const type=groupId.startsWith(prefix)?'groups':'values:'+groupId;
          if(batches.at(-1)?.type!==type)batches.push({type,children:[]});
          batches.at(-1).children.push(child);
        }
        let html='';
        for(const batch of batches){
          const scope='s'+(++serial),groupOrder=batch.type==='groups';
          scopes.push({scope,type:batch.type});
          html+='<div class="list-entries service-desktop-branch" data-service-scope="'+scope+'">'+batch.children.map(child=>{
            const id=groupOrder?kind+':'+child.group.id.slice(prefix.length):child.valueId;
            let block=catalogDisclosure(child.value,walk(child),Boolean(node.key),child.items.length,'',manual?id:'');
            if(manual){
              block=block.replace('data-stock-category','data-stock-category data-service-reorder-scope="'+scope+'"');
              const at=block.lastIndexOf('data-reorder-handle');
              if(at>=0)block=block.slice(0,at)+'data-reorder-handle data-service-handle="'+scope+'"'+block.slice(at+'data-reorder-handle'.length);
            }
            return block;
          }).join('')+'</div>';
        }
        if(node.direct.length){
          const scope='s'+(++serial);scopes.push({scope,type:'items'});
          html+='<div class="list-entries" data-service-scope="'+scope+'">'+node.direct.map(item=>row(item,scope)).join('')+'</div>';
        }
        return html;
      };
      const header=['','Наименование','Цена',...(isService?['Время']:[]),'Рабочие пространства',isService?'Выполнено':'Продаж',...(isService?['Затрачено времени']:[]),'Доход'];
      const table=section.querySelector('[data-service-table-host]');
      table.innerHTML='<section data-service-desktop-group-list data-service-table-kind="'+kind+'"><div class="service-desktop-group-header">'+header.map(v=>'<span>'+v+'</span>').join('')+'</div><div class="service-desktop-group-body" data-service-group-catalog>'+(rows.length?walk(tree):emptyState(all.length?'Ничего не найдено':isService?'Услуг пока нет':'Товаров пока нет'))+'</div></section>';
      table.querySelectorAll('details').forEach(el=>{el.open=true});
      table.querySelectorAll('[data-service-position]').forEach(el=>el.addEventListener('click',async()=>{
        try{const m=await (isService?loadProceduresModule():loadProductsModule());if(disposed)return;const open=isService?m.openProcedureOverview:m.openProductOverview;open(root,el.dataset.servicePosition,{onChanged});}catch(e){fail(e)}
      }));
      if(manual)for(const {scope,type} of scopes){
        const list=table.querySelector('[data-service-scope="'+scope+'"]');
        if(!list)continue;
        disposers.push(initV2ListReorder(list,{selector:'[data-service-reorder-scope="'+scope+'"]',handleSelector:'[data-service-handle="'+scope+'"]',onReorder:async ordered=>{
          if(type==='items'){
            const merged=mergeServiceOrder(dataFor(kind).map(i=>key(i.id)),ordered);
            await (isService?commitReorderProcedures(merged):commitReorderProducts(merged));
          }else if(type==='groups'){
            await commitServiceGroupOrder(mergeServiceOrder(getServiceGroupEntries().map(g=>g.key),ordered));
          }else{
            const gid=type.slice(7),fresh=getServiceGroupLevels(kind),g=fresh.find(v=>v.id===gid);
            if(!g)throw Error('Группа больше не существует.');
            const byId=new Map(g.values.map(v=>[v.id,v]));
            const order=mergeServiceOrder(g.values.map(v=>v.id),ordered);
            await commitServiceGroupLevels(kind,fresh.map(v=>v.id===gid?{...v,values:order.map(id=>byId.get(id))}:v));
          }
          refresh();
        },onError:fail}));
      }
    }
    onCount(total);
  };
  for(const section of sections){
    const kind=section.dataset.serviceDesktopSection,isService=kind==='procedures',st=state[kind];
    section.querySelector('[data-service-search]').addEventListener('input',e=>{st.query=e.target.value;refresh()});
    section.querySelector('[data-service-filter]').addEventListener('click',e=>{
      const choices=[{value:'',label:'Без фильтра'}];
      const fields=()=>select({label:'Группа',name:'group',value:st.group,options:[...choices,...getServiceGroupLevels(kind).map(g=>({value:g.id,label:g.name}))]})+select({label:'Рабочие пространства',name:'workplace',value:st.workplace,options:[...choices,{value:'none',label:'Без рабочего пространства'},...getWorkplaces().map(w=>({value:key(w.key||w.id),label:w.name}))]});
      const layer=mountModal(e.currentTarget,modal('<div class="form-grid" data-service-filter-fields>'+fields()+'</div><div class="modal-actions">'+button('Сбросить',{variant:'secondary',data:'data-service-reset'})+'</div>',{title:'Фильтр',variant:'x',surface:'app',className:'people-action-popup people-filter-popup'}));
      layer?.addEventListener('change',ev=>{if(['group','workplace'].includes(ev.target.name)){st[ev.target.name]=ev.target.value;refresh()}});
      layer?.querySelector('[data-service-reset]')?.addEventListener('click',()=>{st.group='';st.workplace='';layer.querySelector('[data-service-filter-fields]').innerHTML=fields();refresh()});
    });
    section.querySelector('[data-service-sort]').addEventListener('click',e=>{
      const keys=['name','price',...(isService?['duration']:[]),'workplaces','count',...(isService?['minutes']:[]),'revenue'];
      const options=[['manual','Ручной порядок'],...keys.flatMap(k=>['asc','desc'].map(d=>[k+':'+d,(k==='count'&&!isService?'Продаж':labels[k])+' — '+(d==='asc'?'по возрастанию':'по убыванию')]))];
      const layer=mountModal(e.currentTarget,modal('<div class="people-action-menu">'+options.map(([v,l])=>button(l,{variant:'secondary',data:'data-service-sort-choice="'+v+'" aria-pressed="'+(st.sort===v)+'"'})).join('')+'</div>',{title:'Сортировка',variant:'x',surface:'app',xRole:'action',className:'people-action-popup people-sort-popup'}));
      layer?.querySelectorAll('[data-service-sort-choice]').forEach(el=>el.addEventListener('click',()=>{st.sort=el.dataset.serviceSortChoice;layer.v2Close?.();refresh()}));
    });
    section.querySelector('[data-service-add-position]').addEventListener('click',async()=>{
      try{await loadAuxiliaryState('service');const m=await (isService?loadProceduresModule():loadProductsModule());if(disposed)return;if(isService)m.openProcedureEditor(root,null,{onSaved:saved=>{onChanged();if(root.isConnected)m.openProcedureOverview(root,saved.id,{onChanged})}});else await m.openStockSaleCreate(root,{onChanged});}catch(e){fail(e)}
    });
  }
  refresh();
  void Promise.all([loadInventory(),loadAuxiliaryState('service')]).then(()=>{if(!disposed)refresh()}).catch(fail);
  void loadServiceStatistics().then(()=>{if(disposed)return;statistics=serviceCatalogStatistics(getProcedures(),getProducts());refresh()}).catch(e=>{if(!disposed)console.error('Service statistics unavailable',e)});
  return ()=>{disposed=true;disposers.forEach(fn=>fn());};
}
