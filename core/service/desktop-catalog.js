// Desktop is a two-section projection of the existing Service catalogue.
// Keep V2 rows, catalogue disclosure, price format and reorder owner.
import {button,compactButton,field,select,modal,mountModal,emptyState,v2ListEntry,v2ListEntries,initV2ListReorder,openNotice,costListParts,durationText,escapeHtml} from '../../ui/ui.js';
import {checkControl} from '../../ui/selection/check-list.js';
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
const labels={name:'Наименование',price:'Цена',duration:'Время',workplaces:'Рабочие пространства',count:'Количество',minutes:'Затрачено времени',revenue:'Доход'};
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
export function renderDesktopServiceCatalog(host,{root,toolbar,onChanged,state,onCount,loadProceduresModule,loadProductsModule}){
  let disposed=false,statistics=null,serial=0;
  let disposers=[];
  const fail=error=>openNotice({title:'Сервис',message:error?.message||'Не удалось сохранить.'});
  const kinds=['procedures','products'];
  const check=(data,aria,checked=false)=>'<label class="ui-compact-check service-table-check">'+checkControl({data,aria,checked})+'</label>';
  const header=['',...Object.values(labels)];
  host.innerHTML='<section data-service-desktop-group-list data-service-table-kind="combined"><div class="service-desktop-table-track"><div class="service-desktop-group-header">'+check('data-service-select-all','Выбрать все позиции')+header.map(v=>'<span>'+v+'</span>').join('')+'</div><div class="service-desktop-group-body" data-service-group-catalog>'+kinds.map(kind=>'<section data-service-desktop-section="'+kind+'"><details data-service-system-disclosure><summary class="inventory-editor-summary service-table-system-heading" data-table-group-level="system">'+(kind==='procedures'?'Услуги':'Товары')+'</summary><div data-service-table-host></div></details></section>').join('')+'</div></div></section>';
  const sections=[...host.querySelectorAll('[data-service-desktop-section]')];
  const st=state;
  st.selected ||= new Set();
  st.collapsed ||= new Set();
  let selectable=[];
  const selectionKey=(kind,id)=>JSON.stringify([kind,key(id)]);
  const syncSelection=()=>{
    const available=new Set(selectable);
    for(const id of st.selected)if(!available.has(id))st.selected.delete(id);
    host.querySelectorAll('[data-service-select]').forEach(control=>{control.checked=st.selected.has(control.value);});
    const all=host.querySelector('[data-service-select-all]');
    if(all){all.disabled=!selectable.length;all.checked=selectable.length>0&&st.selected.size===selectable.length;all.indeterminate=st.selected.size>0&&!all.checked;}
    onCount(selectable.length,st.selected.size);
  };
  for(const section of sections){
    const kind=section.dataset.serviceDesktopSection;
    const disclosure=section.querySelector('[data-service-system-disclosure]');
    disclosure.open=!st.collapsed.has(kind);
    disclosure.addEventListener('toggle',()=>{if(disclosure.open)st.collapsed.delete(kind);else st.collapsed.add(kind);});
  }
  host.querySelector('[data-service-select-all]')?.addEventListener('change',event=>{
    st.selected=new Set(event.target.checked?selectable:[]);syncSelection();
  });
  const refresh=()=>{
    if(disposed||!host.isConnected)return;
    disposers.forEach(fn=>fn());disposers=[];serial=0;
    selectable=[];
    for(const section of sections){
      const kind=section.dataset.serviceDesktopSection,isService=kind==='procedures',all=dataFor(kind),levels=getServiceGroupLevels(kind);
      const workplaceNames=new Map(getWorkplaces().map(w=>[key(w.key||w.id),w.name]));
      const valueNames=item=>levels.flatMap(g=>item.groupValues?.[g.id]?[g.name,g.values?.find(v=>v.id===item.groupValues[g.id])?.name||'']:[]);
      const stat=item=>statistics?.[kind]?.get(key(item.id));
      const data=item=>({name:item.name,price:priceNumber(item),duration:Number(item.duration)||0,workplaces:ids(item).length,count:stat(item)?.count,minutes:stat(item)?.minutes,revenue:stat(item)?.revenue});
      const rows=all.filter(item=>normalize([item.name,priceText(item),...ids(item).map(id=>workplaceNames.get(id)),...valueNames(item)].join(' ')).includes(normalize(st.query))&&(!st.kind||st.kind===kind)&&(!st.group||levels.some(g=>kind+':'+g.id===st.group&&Boolean(item.groupValues?.[g.id])))&&(!st.workplace||(st.workplace==='none'?!ids(item).length:ids(item).includes(st.workplace))));
      if(st.sort!=='manual'){
        const [column,dir]=st.sort.split(':');
        rows.sort((a,b)=>{const x=data(a)[column],y=data(b)[column];return ((typeof x==='number'&&typeof y==='number')?x-y:compare(x,y))*(dir==='desc'?-1:1)||compare(a.name,b.name)});
      }
      const manual=st.sort==='manual'&&!st.query&&!st.group&&!st.workplace;
      section.hidden=Boolean((st.kind&&st.kind!==kind)||(st.group&&!levels.some(g=>kind+':'+g.id===st.group)));
      selectable.push(...rows.map(item=>selectionKey(kind,item.id)));
      const {tree,criteria}=serviceTree(rows,levels);
      const scopes=[];
      const row=(item,scope)=>{
        const stats=stat(item),price=costListParts(item.cost);
        const cells=[isService?durationText(item.duration):'—',String(ids(item).length),stats?String(stats.count):'—',isService?(stats?serviceSpentText(stats.minutes):'—'):'—',stats?money(stats.revenue):'—'];
        const values='<span class="list-entry__right service-desktop-price">'+[price.rightTop,price.rightBottom].filter(Boolean).map((v,i)=>'<'+(i?'small':'strong')+'>'+escapeHtml(v)+'</'+(i?'small':'strong')+'>').join('')+'</span>'+cells.map(v=>'<span class="service-desktop-value">'+escapeHtml(v)+'</span>').join('');
        let html=v2ListEntry({title:item.name||'',subtitle:'',omitEmptySubtitle:true,image:isService?procedureCardPhoto(item):productCardPhoto(item),initial:(item.name||'?').slice(0,1).toUpperCase(),interactive:true,reorderHandle:manual,reorderAria:'Изменить порядок',data:'data-service-position="'+escapeHtml(item.id)+'" data-reorder-id="'+escapeHtml(item.id)+'" data-service-reorder-scope="'+scope+'"',aria:'Открыть '+item.name});
        // The shared checkbox is a real input, not a nested control in a button.
        const selectedId=selectionKey(kind,item.id);
        const checkbox='<label class="ui-compact-check service-table-check">'+checkControl({data:'data-service-select',aria:'Выбрать '+item.name,value:selectedId,checked:st.selected.has(selectedId)})+'</label>';
        html=html.replace(/^<button\b/,'<div role="group"').replace(/ type="button"/,'').replace(/ aria-pressed="[^"]*"/,'').replace(/ aria-label="[^"]*"/,'').replace(/<\/button>\s*$/,'</div>');
        html=html.replace('<span class="list-entry__content">','<span class="list-entry__content">'+checkbox);
        html=html.replace(/(\s*<\/span>\s*<\/div>)$/,values+'$1');
        html=html.replace('<span class="list-entry__main','<span tabindex="0" role="button" data-service-open aria-label="'+escapeHtml('Открыть '+item.name)+'" class="list-entry__main');
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
            let block=catalogDisclosure(child.value,walk(child),Boolean(node.key),child.items.length,'',manual?id:'').replace('<section ','<section data-table-group-level="'+(groupOrder?'group':'value')+'" ');
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
      const table=section.querySelector('[data-service-table-host]');
      table.innerHTML=rows.length?walk(tree):emptyState(all.length?'Ничего не найдено':isService?'Услуг пока нет':'Товаров пока нет');
      table.querySelectorAll('details').forEach(el=>{el.open=true});
      table.querySelectorAll('[data-service-select]').forEach(control=>control.addEventListener('change',()=>{
        if(control.checked)st.selected.add(control.value);else st.selected.delete(control.value);syncSelection();
      }));
      table.querySelectorAll('[data-service-position]').forEach(el=>{
        const openRow=async()=>{
          try{const m=await (isService?loadProceduresModule():loadProductsModule());if(disposed)return;const open=isService?m.openProcedureOverview:m.openProductOverview;open(root,el.dataset.servicePosition,{onChanged});}catch(e){fail(e)}
        };
        el.addEventListener('click',event=>{if(!event.target.closest('.service-table-check,[data-reorder-handle]'))void openRow();});
        el.querySelector('[data-service-open]')?.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();void openRow();}});
      });
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
    toolbar.querySelector('[data-service-filter]')?.setAttribute('aria-pressed',String(Boolean(st.kind||st.group||st.workplace)));
    toolbar.querySelector('[data-service-sort]')?.setAttribute('aria-pressed',String(st.sort!=='manual'));
    syncSelection();
  };
  toolbar.querySelector('[data-service-search]')?.addEventListener('input',e=>{st.query=e.target.value;refresh()});
  toolbar.querySelector('[data-service-filter]')?.addEventListener('click',e=>{
    const anchor=e.currentTarget;anchor.dataset.v2AnchorWidth='360';
    const none={value:'',label:'Без фильтра'};
    const active=()=>Boolean(st.kind||st.group||st.workplace);
    const fields=()=>'<div class="form-grid">'+
      select({label:'Раздел',name:'kind',value:st.kind,options:[none,{value:'procedures',label:'Услуги'},{value:'products',label:'Товары'}]})+
      select({label:'Группа',name:'group',value:st.group,options:[none,...getServiceGroupEntries().filter(g=>!st.kind||g.kind===st.kind).map(g=>({value:g.key,label:g.name}))]})+
      select({label:'Рабочие пространства',name:'workplace',value:st.workplace,options:[none,{value:'none',label:'Без рабочего пространства'},...getWorkplaces().map(w=>({value:key(w.key||w.id),label:w.name}))]})+'</div>';
    const layer=mountModal(anchor,modal('<div data-people-filter-fields>'+fields()+'</div><div class="modal-actions" data-people-filter-actions'+(active()?'':' hidden')+'>'+button('Сбросить',{variant:'secondary',data:'data-people-filter-action'})+'</div>',{title:'Фильтр',variant:'x',surface:'app',className:'people-action-popup people-filter-popup'}));
    if(!layer)return;
    const actions=layer.querySelector('[data-people-filter-actions]');
    layer.addEventListener('change',ev=>{
      if(!['kind','group','workplace'].includes(ev.target.name))return;
      st[ev.target.name]=ev.target.value;
      if(ev.target.name==='kind'){if(st.group&&st.kind&&!st.group.startsWith(st.kind+':'))st.group='';layer.querySelector('[data-people-filter-fields]').innerHTML=fields();}
      actions.hidden=!active();refresh();
    });
    layer.querySelector('[data-people-filter-action]')?.addEventListener('click',()=>{st.kind='';st.group='';st.workplace='';layer.querySelector('[data-people-filter-fields]').innerHTML=fields();actions.hidden=true;refresh()});
  });
  toolbar.querySelector('[data-service-sort]')?.addEventListener('click',e=>{
    const options=[['manual','Ручной порядок'],['name:asc','Наименование — от А до Я'],['name:desc','Наименование — от Я до А'],...Object.keys(labels).filter(k=>k!=='name').flatMap(k=>['desc','asc'].map(d=>[k+':'+d,labels[k]+' — '+(d==='asc'?'по возрастанию':'по убыванию')]))];
    const layer=mountModal(e.currentTarget,modal('<div class="people-action-menu">'+options.map(([v,l])=>button(l,{variant:'secondary',data:'data-service-sort-choice="'+v+'" aria-pressed="'+(st.sort===v)+'"'})).join('')+'</div>',{title:'Сортировка',variant:'x',surface:'app',xRole:'action',className:'people-action-popup people-sort-popup'}));
    layer?.querySelectorAll('[data-service-sort-choice]').forEach(el=>el.addEventListener('click',()=>{st.sort=el.dataset.serviceSortChoice;layer.v2Close?.();refresh()}));
  });
  toolbar.querySelector('[data-service-add-position]')?.addEventListener('click',e=>{
    const menu=mountModal(e.currentTarget,modal('<div class="people-action-menu">'+button('Услугу',{variant:'secondary',data:'data-service-create="procedures"'})+button('Товар',{variant:'secondary',data:'data-service-create="products"'})+'</div>',{title:'Добавить',variant:'x',surface:'app',xRole:'action',className:'people-action-popup'}));
    menu?.querySelectorAll('[data-service-create]').forEach(control=>control.addEventListener('click',async()=>{
      const isService=control.dataset.serviceCreate==='procedures';menu.v2Close?.();
      try{await loadAuxiliaryState('service');const m=await (isService?loadProceduresModule():loadProductsModule());if(disposed)return;if(isService)m.openProcedureEditor(root,null,{onSaved:saved=>{onChanged();if(root.isConnected)m.openProcedureOverview(root,saved.id,{onChanged})}});else await m.openStockSaleCreate(root,{onChanged});}catch(error){fail(error)}
    }));
  });
  refresh();
  void Promise.all([loadInventory(),loadAuxiliaryState('service')]).then(()=>{if(!disposed)refresh();return loadServiceStatistics()}).then(()=>{if(disposed)return;statistics=serviceCatalogStatistics(getProcedures(),getProducts());refresh()}).catch(e=>{if(!disposed)console.error('Service statistics unavailable',e)});
  return ()=>{disposed=true;disposers.forEach(fn=>fn());};
}
