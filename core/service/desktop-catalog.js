// Desktop projects one active section of the existing Service catalogue.
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
const numberOrMissing=value=>value==null||key(value).trim()===''?undefined:(Number.isFinite(Number(value))?Number(value):undefined);
const priceNumber=item=>{
  const cost=item.cost||{};
  if(cost.free)return 0;
  return numberOrMissing(cost.mode==='from'||cost.mode==='from-to'?(cost.from!==''&&cost.from!=null?cost.from:cost.amount):(cost.amount!==''&&cost.amount!=null?cost.amount:cost.from));
};
const prefix='__service_group_';
const labels={name:'Наименование',price:'Цена',duration:'Время',workplaces:'Рабочие пространства',count:'Количество',minutes:'Затрачено времени',revenue:'Доход'};
const rangeKeys=['price','duration','count','minutes','revenue'];
const hasRange=range=>Boolean(range&&(key(range.min)!==''||key(range.max)!==''));
const filtersActive=state=>Boolean(state.group||state.value||state.workplace||rangeKeys.some(k=>hasRange(state.ranges?.[k])));
export function matchesServiceRanges(data,ranges={}){
  return rangeKeys.every(k=>{
    const range=ranges[k];
    if(!hasRange(range))return true;
    const value=data[k],min=numberOrMissing(range.min),max=numberOrMissing(range.max);
    if(!Number.isFinite(value))return false;
    return (min===undefined||value>=min)&&(max===undefined||value<=max);
  });
}
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
export function renderDesktopServiceCatalog(host,{root,toolbar,onChanged,state,kind:activeKind,onCount,loadProceduresModule,loadProductsModule}){
  let disposed=false,statistics=null,serial=0;
  let disposers=[];
  const fail=error=>openNotice({title:'Сервис',message:error?.message||'Не удалось сохранить.'});
  const kinds=[activeKind==='products'?'products':'procedures'];
  const check=(data,aria,checked=false)=>'<label class="ui-compact-check service-table-check">'+checkControl({data,aria,checked})+'</label>';
  const columns=Object.entries(labels).filter(([id])=>kinds[0]==='procedures'||!['duration','minutes'].includes(id));
  const activeRangeKeys=rangeKeys.filter(id=>columns.some(([column])=>column===id));
  const header=columns.map(([,label])=>label);
  host.innerHTML='<section data-service-desktop-group-list data-service-table-kind="combined" data-service-table-mode="'+kinds[0]+'"><div class="service-desktop-table-track"><div class="service-desktop-group-header">'+'<span aria-hidden="true"></span>'+check('data-service-select-all','Выбрать все позиции')+header.map(v=>'<span>'+v+'</span>').join('')+'<span aria-hidden="true"></span>'+'</div><div class="service-desktop-group-body" data-service-group-catalog>'+kinds.map(kind=>'<section data-service-desktop-section="'+kind+'"><div data-service-table-host></div></section>').join('')+'</div></div></section>';
  const sections=[...host.querySelectorAll('[data-service-desktop-section]')];
  const st=state;
  st.selected ||= new Set();
  st.ranges ||= {};
  for(const id of Object.keys(st.ranges))if(!activeRangeKeys.includes(id))delete st.ranges[id];
  if(!activeRangeKeys.includes(st.rangeMetric))st.rangeMetric='';
  if(st.sort!=='manual'&&!columns.some(([id])=>id===st.sort.split(':')[0]))st.sort='manual';
  st.groupCollapsed ||= new Set();
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
      const data=item=>({name:item.name,price:priceNumber(item),duration:isService?numberOrMissing(item.duration):undefined,workplaces:ids(item).length,count:stat(item)?.count,minutes:isService?stat(item)?.minutes:undefined,revenue:stat(item)?.revenue});
      const rows=all.filter(item=>normalize([item.name,priceText(item),...ids(item).map(id=>workplaceNames.get(id)),...valueNames(item)].join(' ')).includes(normalize(st.query)) &&(!st.group||levels.some(g=>kind+':'+g.id===st.group&&Boolean(item.groupValues?.[g.id])))&&(!st.value||levels.some(g=>kind+':'+g.id===st.group&&key(item.groupValues?.[g.id])===st.value))&&(!st.workplace||(st.workplace==='none'?!ids(item).length:ids(item).includes(st.workplace)))&&matchesServiceRanges(data(item),st.ranges));
      if(st.sort!=='manual'){
        const [column,dir]=st.sort.split(':');
        rows.sort((a,b)=>{const x=data(a)[column],y=data(b)[column];if(x==null||y==null)return x==null?(y==null?compare(a.name,b.name):1):-1;return ((typeof x==='number'&&typeof y==='number')?x-y:compare(x,y))*(dir==='desc'?-1:1)||compare(a.name,b.name)});
      }
      const manual=st.sort==='manual'&&!st.query&&!filtersActive(st);
      selectable.push(...rows.map(item=>selectionKey(kind,item.id)));
      const {tree,criteria}=serviceTree(rows,levels);
      const scopes=[];
      const row=(item,scope)=>{
        const stats=stat(item),price=costListParts(item.cost);
        const cells={duration:isService?durationText(item.duration):'',workplaces:String(ids(item).length),count:stats?String(stats.count):'—',minutes:isService?(stats?serviceSpentText(stats.minutes):'—'):'',revenue:stats?money(stats.revenue):'—'};
        const values='<span class="list-entry__right service-desktop-price">'+[price.rightTop,price.rightBottom].filter(Boolean).map((v,i)=>'<'+(i?'small':'strong')+'>'+escapeHtml(v)+'</'+(i?'small':'strong')+'>').join('')+'</span>'+columns.filter(([id])=>Object.hasOwn(cells,id)).map(([id])=>'<span class="service-desktop-value" data-service-column="'+id+'">'+escapeHtml(cells[id])+'</span>').join('');
        let html=v2ListEntry({title:item.name||'',subtitle:'',omitEmptySubtitle:true,image:isService?procedureCardPhoto(item):productCardPhoto(item),initial:(item.name||'?').slice(0,1).toUpperCase(),interactive:true,reorderHandle:manual,reorderAria:'Изменить порядок',data:'data-service-position="'+escapeHtml(item.id)+'" data-reorder-id="'+escapeHtml(item.id)+'" data-service-reorder-scope="'+scope+'"',aria:'Открыть '+item.name});
        // The shared checkbox is a real input, not a nested control in a button.
        const selectedId=selectionKey(kind,item.id);
        const checkbox='<label class="ui-compact-check service-table-check">'+checkControl({data:'data-service-select',aria:'Выбрать '+item.name,value:selectedId,checked:st.selected.has(selectedId)})+'</label>';
        html=html.replace(/^<button\b/,'<div role="group"').replace(/ type="button"/,'').replace(/ aria-pressed="[^"]*"/,'').replace(/ aria-label="[^"]*"/,'').replace(/<\/button>\s*$/,'</div>');
        html=html.replace('<span class="list-entry__main',checkbox+'<span class="list-entry__main');
        const edit=button('✎',{variant:'secondary',className:'ui-compact-button service-table-edit',data:'data-service-edit title="Редактировать"',aria:'Редактировать '+item.name});
        html=html.replace(/(\s*<\/span>\s*<\/div>)$/,values+edit+'$1');
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
            const collapseKey=JSON.stringify([kind,child.key]);
            let block=catalogDisclosure(child.value,walk(child),Boolean(node.key),child.items.length,'',manual?id:'').replace('<section ','<section data-service-collapse-key="'+escapeHtml(collapseKey)+'" data-table-group-level="'+(groupOrder?'group':'value')+'" ');
            if(manual){
              block=block.replace('data-stock-category','data-stock-category data-service-reorder-scope="'+scope+'"');
              // Move only this branch's existing handle, never any descendant handle.
              const at=block.lastIndexOf('<span class="list-entry__reorder-handle"');
              const tail=at<0?-1:block.indexOf('</span></span>',at);
              if(tail>=0){
                const end=tail+'</span></span>'.length;
                const handle=block.slice(at,end).replace('data-reorder-handle','data-reorder-handle data-service-handle="'+scope+'"');
                block=block.slice(0,at)+block.slice(end);
                const start=block.indexOf('>');
                block=block.slice(0,start+1)+handle+block.slice(start+1);
              }
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
      table.querySelectorAll('[data-service-collapse-key]').forEach(panel=>{
        const details=panel.querySelector(':scope > details');
        if(!details)return;
        const id=panel.dataset.serviceCollapseKey;
        details.open=!st.groupCollapsed.has(id);
        details.addEventListener('toggle',()=>{if(details.open)st.groupCollapsed.delete(id);else st.groupCollapsed.add(id);});
      });
      table.querySelectorAll('[data-service-select]').forEach(control=>control.addEventListener('change',()=>{
        if(control.checked)st.selected.add(control.value);else st.selected.delete(control.value);syncSelection();
      }));
      table.querySelectorAll('[data-service-position]').forEach(el=>{
        const openRow=async()=>{
          try{const m=await (isService?loadProceduresModule():loadProductsModule());if(disposed)return;const open=isService?m.openProcedureOverview:m.openProductOverview;open(root,el.dataset.servicePosition,{onChanged});}catch(e){fail(e)}
        };
        el.addEventListener('click',event=>{if(!event.target.closest('.service-table-check,[data-reorder-handle],[data-service-edit]'))void openRow();});
        el.querySelector('[data-service-edit]')?.addEventListener('click',async event=>{
          event.stopPropagation();
          try{
            const m=await (isService?loadProceduresModule():loadProductsModule());
            if(disposed)return;
            const item=dataFor(kind).find(row=>key(row.id)===el.dataset.servicePosition);
            if(!item)return;
            const edit=isService?m.openProcedureEditor:m.openProductEditor;
            edit(root,item,{onChanged});
          }catch(error){fail(error)}
        });
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
    toolbar.querySelector('[data-service-filter]')?.setAttribute('aria-pressed',String(filtersActive(st)));
    toolbar.querySelector('[data-service-sort]')?.setAttribute('aria-pressed',String(st.sort!=='manual'));
    syncSelection();
  };
  toolbar.querySelector('[data-service-search]')?.addEventListener('input',e=>{st.query=e.target.value;refresh()});
  toolbar.querySelector('[data-service-filter]')?.addEventListener('click',e=>{
    const anchor=e.currentTarget;anchor.dataset.v2AnchorWidth='360';
    const none={value:'',label:'Без фильтра'};
    const rangeLabels={price:'Цена, ₽',duration:'Время, мин',count:'Количество',minutes:'Затраченное время, мин',revenue:'Доход, ₽'};
    const rangeFields=()=>{
      const k=st.rangeMetric||'';
      const range=st.ranges[k]||{};
      const integer=k==='count'||k==='duration'||k==='minutes';
      const bound=(side,label)=>field({name:'range_'+side,type:'number',inputmode:integer?'numeric':'decimal',placeholder:label,value:key(range[side]),disabled:!k,step:integer?'1':'0.01',min:k==='revenue'?'':'0',data:'data-service-range="'+escapeHtml(k)+'" data-service-bound="'+side+'" aria-label="'+escapeHtml((rangeLabels[k]||'Показатель')+' '+label.toLowerCase())+'"'});
      return select({name:'rangeMetric',value:k,options:[{value:'',label:'Выбрать показатель'},...activeRangeKeys.map(value=>({value,label:rangeLabels[value]}))]})+
        '<div class="service-filter-range">'+bound('min','От')+bound('max','До')+'</div>';
    };
    const selectors=()=>{
      const entries=getServiceGroupEntries().filter(g=>g.kind===kinds[0]);
      const group=entries.find(g=>g.key===st.group);
      return select({label:'Группа',name:'group',value:st.group,options:[none,...entries.map(g=>({value:g.key,label:g.name}))]})+
      (group?.values?.length?select({label:'Значение',name:'value',value:st.value,options:[none,...group.values.map(v=>({value:v.id,label:v.name}))]}):'')+
      select({label:'Рабочие пространства',name:'workplace',value:st.workplace,options:[none,{value:'none',label:'Без рабочего пространства'},...getWorkplaces().map(w=>({value:key(w.key||w.id),label:w.name}))]});
    };
    const fields=()=>'<div class="form-grid"><div class="form-grid" data-service-filter-selectors>'+selectors()+'</div><div class="form-grid" data-service-range-fields>'+rangeFields()+'</div></div>';
    const layer=mountModal(anchor,modal('<div data-people-filter-fields>'+fields()+'</div><div class="modal-actions" data-people-filter-actions'+(filtersActive(st)?'':' hidden')+'>'+button('Сбросить',{variant:'secondary',data:'data-people-filter-action'})+'</div>',{title:'Фильтр',variant:'x',surface:'app',className:'people-action-popup people-filter-popup'}));
    if(!layer)return;
    const actions=layer.querySelector('[data-people-filter-actions]');
    const apply=()=>{actions.hidden=!filtersActive(st);refresh()};
    layer.addEventListener('change',ev=>{
      if(ev.target.name==='rangeMetric'){
        const metric=ev.target.value;
        if(!activeRangeKeys.includes(metric)&&metric!=='')return;
        if(metric!==st.rangeMetric){st.rangeMetric=metric;st.ranges={};}
        layer.querySelector('[data-service-range-fields]').innerHTML=rangeFields();
        apply();return;
      }
      if(!['group','value','workplace'].includes(ev.target.name))return;
      st[ev.target.name]=ev.target.value;
       if(ev.target.name==='group')st.value='';
      if(ev.target.name==='group')layer.querySelector('[data-service-filter-selectors]').innerHTML=selectors();
      apply();
    });
    layer.addEventListener('input',ev=>{
      const input=ev.target;
      const k=input.dataset.serviceRange,side=input.dataset.serviceBound;
      if(!activeRangeKeys.includes(k)||!['min','max'].includes(side)||!input.validity.valid)return;
      const next={...(st.ranges[k]||{}),[side]:input.value};
      st.ranges[k]=next;
      apply();
    });
    layer.querySelector('[data-people-filter-action]')?.addEventListener('click',()=>{
      st.group='';st.value='';st.workplace='';st.ranges={};st.rangeMetric='';
      layer.querySelector('[data-people-filter-fields]').innerHTML=fields();apply();
    });
  });
  toolbar.querySelector('[data-service-sort]')?.addEventListener('click',e=>{
    const anchor=e.currentTarget;
    const options=[['manual','Ручной порядок'],...columns.flatMap(([id,label])=>[
      [id+':asc',label+' — '+(id==='name'?'от А до Я':'по возрастанию')],
      [id+':desc',label+' — '+(id==='name'?'от Я до А':'по убыванию')]
    ])];
    const markup='<div class="people-action-menu">'+options.map(([value,label])=>
      button(escapeHtml(label),{variant:'secondary',data:'data-service-sort-choice="'+escapeHtml(value)+'" aria-pressed="'+(value===st.sort)+'"'})).join('')+'</div>';
    const layer=mountModal(anchor,modal(markup,{title:'Сортировка',variant:'x',surface:'app',xRole:'action',className:'people-action-popup people-sort-popup'}));
    layer?.querySelectorAll('[data-service-sort-choice]').forEach(control=>control.addEventListener('click',()=>{
      const next=control.dataset.serviceSortChoice;
      if(!options.some(([value])=>value===next))return;
      st.sort=next;layer.v2Close?.();refresh();
    }));
  });
  refresh();
  void Promise.all([loadInventory(),loadAuxiliaryState('service')]).then(()=>{if(!disposed)refresh();return loadServiceStatistics()}).then(()=>{if(disposed)return;statistics=serviceCatalogStatistics(getProcedures(),getProducts());refresh()}).catch(e=>{if(!disposed)console.error('Service statistics unavailable',e)});
  return ()=>{disposed=true;disposers.forEach(fn=>fn());};
}
