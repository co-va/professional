import {
  actionBlock,
  button,
  compactButton,
  compactAddButton,
  compactRemoveButton,
  dataTable,
  modal,
  mountModal,
  emptyState,
  escapeHtml,
  field,
  formValidationMessage,
  list,
  openNotice,
  select,
} from '../../../ui/ui.js';
import { openFinanceDeleteConfirmation, financeDesktop } from '../desktop.js';
import { canUseCapability } from '../../access.js';
import { desktopAvailableArticles, desktopArticleGroups, desktopArticleValues } from './classification.js';
import { moveDesktopQTool } from '../../../ui/v2/z-layout.js';
import { getFinanceArticles } from '../data.js';
import { archiveFinanceArticle, createFinanceArticle, updateFinanceArticle } from '../service.js';

const ECONOMIC_OPTIONS = [
  { value: 'OPERATING_REVENUE', label: 'Операционный доход' },
  { value: 'PRODUCT_REVENUE', label: 'Продажа товаров' },
  { value: 'TIPS', label: 'Чаевые' },
  { value: 'LOAN_RECEIVED', label: 'Полученный займ' },
  { value: 'INVESTMENT_RECEIVED', label: 'Полученная инвестиция' },
  { value: 'OPERATING_EXPENSE', label: 'Операционный расход' },
  { value: 'TAX', label: 'Налог' },
  { value: 'REFUND', label: 'Возврат' },
  { value: 'LOAN_REPAYMENT', label: 'Возврат займа' },
  { value: 'INVESTMENT_RETURN', label: 'Возврат инвестиций' },
  { value: 'TRANSFER', label: 'Перевод' },
];

const DIRECTION_OPTIONS = [
  { value: 'IN', label: 'Доход' },
  { value: 'OUT', label: 'Расход' },
  { value: 'TRANSFER', label: 'Перевод' },
];

function treeRows(items = []) {
  const children = new Map();
  items.forEach((item) => {
    const key = String(item.parentArticleId || '');
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(item);
  });
  const result = [];
  const visit = (parentId = '', depth = 0, visited = new Set()) => {
    (children.get(parentId) || []).forEach((item) => {
      if (visited.has(item.articleId)) return;
      const nextVisited = new Set(visited);
      nextVisited.add(item.articleId);
      result.push({ ...item, depth });
      visit(item.articleId, depth + 1, nextVisited);
    });
  };
  visit('');
  items.filter((item) => !result.some((row) => row.articleId === item.articleId))
    .forEach((item) => result.push({ ...item, depth: 0 }));
  return result;
}

function directionLabel(value) {
  return DIRECTION_OPTIONS.find((item) => item.value === value)?.label || value;
}

function economicLabel(value) {
  if (value === 'GROUP') return 'Группа';
  const labels = {INVESTMENT_CAPITAL_RETURN:'Возврат капитала',INVESTMENT_INCOME:'Доход инвестиции',INVESTMENT_CONTRIBUTION:'Вложение',INVESTMENT_EXPENSE:'Расход инвестиции',INVESTMENT_INCOME_PAYMENT:'Выплата дохода инвестору'};
  return ECONOMIC_OPTIONS.find((item) => item.value === value)?.label || labels[value] || value;
}

function parentOptions(items, currentId = '') {
  return [
    { value: '', label: 'Без группы' },
    ...treeRows(items)
      .filter((item) => item.articleId !== currentId)
      .map((item) => ({
        value: item.articleId,
        label: `${'— '.repeat(item.depth)}${item.name}`,
      })),
  ];
}

function row(item) {
  return {
    overline: `${directionLabel(item.direction)} · ${economicLabel(item.economicType)}`,
    title: `${'— '.repeat(item.depth)}${item.name}`,
    secondary: '',
    right: item.direction === 'IN' ? '+' : item.direction === 'OUT' ? '−' : '⇄',
    interactive: !item.systemKey,
    data: item.systemKey ? '' : `data-finance-article="${escapeHtml(item.articleId)}"`,
    aria: item.systemKey ? item.name : `Открыть статью ${item.name}`,
  };
}

function openArticleX(existing = null, onSaved = () => {}, getArticles = getFinanceArticles, desktop = false) {
  if(existing?.systemKey&&(!desktop||existing.direction==='TRANSFER'||existing.economicType==='GROUP'))return null;
  const items = getArticles();
  const isSystem = Boolean(existing?.systemKey);
  const title = desktop&&existing?'Статья':existing?'Редактирование статьи':'Новая статья';
  const direction = existing?.direction || 'OUT';
  const desktopDirections=[{value:'IN',label:'Приход'},{value:'OUT',label:'Расход'}];
  // Legacy user-created transfer articles remain editable without silently changing their direction.
  if(existing?.direction==='TRANSFER')desktopDirections.push({value:'TRANSFER',label:'Транзакция'});
  const roots=new Set(items.filter(a=>['INCOME_ROOT','EXPENSE_ROOT'].includes(a.systemKey)).map(a=>a.articleId));
  const descendants=new Set(existing?[existing.articleId]:[]);
  for(let changed=true;changed;){changed=false;for(const a of items)if(descendants.has(a.parentArticleId)&&!descendants.has(a.articleId)){descendants.add(a.articleId);changed=true;}}
  const existingParent=String(existing?.parentArticleId||'');
  const economicType = existing?.economicType || 'OPERATING_EXPENSE';
  const economicOptions = ECONOMIC_OPTIONS.some(item=>item.value===economicType)
    ? ECONOMIC_OPTIONS : [...ECONOMIC_OPTIONS,{value:economicType,label:economicLabel(economicType)}];
  const content = `<form class="compact-form" data-finance-article-form novalidate>
    ${field({label:'Название',name:'articleName',value:existing?.name||'',required:true,readonly:isSystem,placeholder:'Например, Краска'})}
    ${desktop?select({label:'Направление',name:'direction',value:direction,options:desktopDirections}):select({label:'Группа',name:'parentArticleId',value:existingParent,options:parentOptions(items,existing?.articleId||'')})+select({label:'Направление',name:'direction',value:direction,options:DIRECTION_OPTIONS})}
    ${desktop?'':select({label:'Назначение',name:'economicType',value:economicType,options:economicOptions})}
    ${desktop&&existing&&existing.direction!=='TRANSFER'?'<div class="desktop-group-values"><div class="stock-position-group-heading"><span>Значения</span>'+compactAddButton({data:'data-article-value-add',aria:'Добавить значение'})+'</div><div data-article-value-draft></div><div data-article-values></div></div>':''}
    <div class="form-error" role="alert" data-article-error></div>
    ${desktop?actionBlock((existing&&!isSystem?button('Удалить',{variant:'danger',data:'data-delete-finance-article'}):'')+button('Сохранить',{type:'submit',data:'data-finance-article-save',disabled:true}),{className:'desktop-group-editor-actions'}):'<div class="modal-actions finance-receipt-actions finance-receipt-actions--dds">'+(existing&&!isSystem?button('Удалить',{variant:'danger',data:'data-delete-finance-article'}):'')+button('Сохранить',{type:'submit',data:'data-finance-article-save',disabled:true})+'</div>'}
  </form>`;
  const layer=mountModal(document.body,modal(content,{title,variant:'x',surface:'app',...(desktop?{xRole:'editor',className:'desktop-service-group-editor-x'}:{className:'modal--form-sheet'})}));
  if(!layer)return null;
  const form=layer.querySelector('[data-finance-article-form]');
  const save=form.querySelector('[data-finance-article-save]');
  const remove=form.querySelector('[data-delete-finance-article]');
  const plus=form.querySelector('[data-article-value-add]');
  const draftHost=form.querySelector('[data-article-value-draft]');
  const valueHost=form.querySelector('[data-article-values]');
  const errorHost=form.querySelector('[data-article-error]');
  let valueEdit=null;
  const currentValues=()=>desktopArticleValues(getArticles(),existing?.articleId);
  const valueName=()=>String(draftHost?.querySelector('[name="valueName"]')?.value||'').trim();
  // A saved Desktop article must keep its direction for historical corrections.
  const directionLocked=desktop&&Boolean(existing);
  if(isSystem||directionLocked)for(const name of ['direction','economicType']){
    const trigger=form.querySelector('input[name="'+name+'"]')?.closest('.ui-select')?.querySelector('[data-ui-select-trigger]');
    if(trigger)trigger.disabled=true;
  }
  const read=()=>{
    if(isSystem)return {name:existing.name,parentArticleId:existingParent,direction,economicType};
    const data=new FormData(form);
    const nextDirection=directionLocked?direction:String(data.get('direction')||'');
    let parentArticleId=String(data.get('parentArticleId')||'');
    if(desktop)parentArticleId=existing&&nextDirection===direction?existingParent:(items.find(a=>roots.has(a.articleId)&&a.direction===nextDirection)?.articleId||'');
    if(desktop&&existing&&nextDirection===direction&&!String(data.get('parentArticleId')||'')&&!existingParent)parentArticleId='';
    const nextEconomic=desktop?(directionLocked?economicType:({IN:'OPERATING_REVENUE',OUT:'OPERATING_EXPENSE',TRANSFER:'TRANSFER'})[nextDirection]):String(data.get('economicType')||'');
    return {name:String(data.get('articleName')||'').trim(),parentArticleId,direction:nextDirection,economicType:nextEconomic};
  };
  const initial=JSON.stringify(read());
  let pending=false;
  const sync=()=>{
    const value=read(),parent=items.find(a=>a.articleId===value.parentArticleId);
    const invalid=desktop&&(!desktopDirections.some(a=>a.value===value.direction)||(parent&&parent.direction!==value.direction)||((descendants.size>1||currentValues().length>0||valueEdit)&&value.direction!==direction));
    const duplicate=valueEdit&&currentValues().some(a=>a.articleId!==valueEdit.articleId&&normalized(a.name)===normalized(valueName()));
    const valueChanged=valueEdit&&valueName()&&!duplicate&&(!valueEdit.articleId||valueName()!==valueEdit.name);
    const groupChanged=JSON.stringify(value)!==initial;
    save.disabled=pending||(isSystem&&!valueEdit)||!value.name||invalid||Boolean(valueEdit&&(!valueChanged||groupChanged))||Boolean(existing&&!valueEdit&&!groupChanged);
    if(remove){remove.disabled=pending;remove.hidden=Boolean(valueEdit);}
    if(plus)plus.disabled=pending||Boolean(valueEdit)||groupChanged;
    valueHost?.querySelectorAll('[data-article-value-delete]').forEach(a=>a.disabled=pending||Boolean(valueEdit)||groupChanged);
  };
  const drawValues=()=>{
    if(!valueHost)return;
    const values=currentValues();
    valueHost.innerHTML=values.length?list({className:'ui-list--dense list-entries',items:values.map(a=>({title:a.name,interactive:true,selected:valueEdit?.articleId===a.articleId,data:'data-article-value="'+escapeHtml(a.articleId)+'"',aria:'Изменить значение '+a.name}))}):emptyState('Значений пока нет');
    for(const node of valueHost.querySelectorAll('[data-article-value]')){
      const a=values.find(v=>v.articleId===node.dataset.articleValue);
      node.addEventListener('click',event=>{if(event.target.closest('[data-article-value-delete]')||pending||valueEdit||JSON.stringify(read())!==initial)return;valueEdit={articleId:a.articleId,name:a.name};drawDraft();});
      node.insertAdjacentHTML('beforeend',compactRemoveButton({data:'data-article-value-delete',aria:'Удалить значение '+a.name}));
      node.querySelector('[data-article-value-delete]')?.addEventListener('click',event=>{
        event.stopPropagation();if(pending||valueEdit||JSON.stringify(read())!==initial)return;
        // The confirmation closes its owner after success; reopen the same group.
        openFinanceDeleteConfirmation(layer,{message:'Значение «'+a.name+'» будет удалено из списка. Проведённые операции останутся в истории.',onConfirm:()=>archiveFinanceArticle(a.articleId),onSuccess:()=>{onSaved();const fresh=getArticles().find(v=>v.articleId===existing.articleId);if(fresh)openArticleX(fresh,onSaved,getArticles,true);}});
      });
    }
    sync();
  };
  const drawDraft=()=>{
    if(!draftHost)return;
    draftHost.innerHTML=valueEdit?field({label:'Наименование значения',name:'valueName',value:valueEdit.name,required:true})+button('Отмена',{type:'button',variant:'secondary',data:'data-article-value-cancel'}):'';
    draftHost.querySelector('[data-article-value-cancel]')?.addEventListener('click',()=>{valueEdit=null;drawDraft();drawValues();});
    draftHost.querySelector('input')?.focus();sync();
  };
  plus?.addEventListener('click',()=>{if(pending||valueEdit||JSON.stringify(read())!==initial)return;valueEdit={articleId:'',name:''};drawDraft();});
  form.addEventListener('input',sync);
  form.addEventListener('change',sync);
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    sync();
    if(pending||save.disabled)return;
    const validation=formValidationMessage(form);
    if(validation){openNotice({message:validation});return;}
    pending=true;sync();
    try{
      if(desktop&&valueEdit){
        const payload={name:valueName(),direction,parentArticleId:existing.articleId,economicType:existing.economicType};
        const result=valueEdit.articleId?await updateFinanceArticle(valueEdit.articleId,payload):await createFinanceArticle(payload);
        if(!result)throw new Error('Сервер не подтвердил сохранение значения.');
        valueEdit=null;drawDraft();onSaved();drawValues();return;
      }
      if(isSystem)return;
      const payload=read();
      const result=existing?await updateFinanceArticle(existing.articleId,payload):await createFinanceArticle(payload);
      if(!result)throw new Error('Сервер не подтвердил сохранение статьи.');
      layer.v2Close?.();onSaved();
    }catch(error){openNotice({message:String(error?.message||'Не удалось сохранить статью')});}
    finally{pending=false;sync();}
  });
  remove?.addEventListener('click',()=>{
    if(pending)return;
    openFinanceDeleteConfirmation(layer,{
      message:'Статья будет удалена из списка доступных статей. Ранее проведённые операции останутся в истории. Вы уверены?',
      onConfirm:()=>archiveFinanceArticle(existing.articleId),
      onSuccess:onSaved,
    });
  });
  drawValues();sync();
  return layer;
}

const ARTICLE_SORTS=[
  ['tree','По структуре'],
  ...[['name','Название'],['parent','Группа'],['direction','Направление'],['economicType','Назначение'],['system','Тип']].flatMap(([key,label])=>[[key+'Asc',label+' — от А до Я'],[key+'Desc',label+' — от Я до А']]),
];
const articleFilters=()=>({parent:'',direction:'',economicType:'',system:''});
const normalized=value=>String(value??'').toLocaleLowerCase('ru').replace(/ё/g,'е').trim();
function articleValues(item,names){
  return {name:String(item.name||''),parent:names.get(item.parentArticleId)||'Без группы',direction:directionLabel(item.direction),economicType:economicLabel(item.economicType),system:item.systemKey?'Системная':'Пользовательская'};
}
function visibleArticles(items,state){
  const names=new Map(items.map(item=>[item.articleId,item.name]));
  const words=normalized(state.query).split(/\s+/).filter(Boolean);
  const f=state.filters;
  const rows=treeRows(items).filter(item=>{
    const v=articleValues(item,names);
    return words.every(word=>normalized(Object.values(v).join(' ')).includes(word))
      &&(!f.parent||f.parent===(item.parentArticleId?'id:'+item.parentArticleId:'root'))
      &&(!f.direction||f.direction===item.direction)
      &&(!f.economicType||f.economicType===item.economicType)
      &&(!f.system||f.system===(item.systemKey?'system':'custom'));
  });
  if(state.sort==='tree')return rows;
  const key=state.sort.replace(/Asc$|Desc$/,'');
  const sign=state.sort.endsWith('Desc')?-1:1;
  return rows.sort((a,b)=>String(articleValues(a,names)[key]||'').localeCompare(String(articleValues(b,names)[key]||''),'ru',{numeric:true})*sign||String(a.name).localeCompare(String(b.name),'ru'));
}
function openArticleFilters(anchor,items,state,refresh,desktop=false){
  const names=new Map(items.map(item=>[item.articleId,item.name]));
  const none={value:'',label:'Без фильтра'};
  const parents=[...new Set(items.map(item=>item.parentArticleId||''))].map(id=>({value:id?'id:'+id:'root',label:names.get(id)||'Без группы'}));
  const economics=[...new Set(items.map(item=>item.economicType).filter(Boolean))].map(value=>({value,label:economicLabel(value)}));
  const fields=()=>'<div class="form-grid">'
    +select({label:'Группа',name:'parent',value:state.filters.parent,options:[none,...parents]})
    +select({label:'Направление',name:'direction',value:state.filters.direction,options:[none,...(desktop?DIRECTION_OPTIONS.map(a=>a.value==='IN'?{...a,label:'Приход'}:a.value==='TRANSFER'?{...a,label:'Транзакция'}:a):DIRECTION_OPTIONS)]})
    +(desktop?'':select({label:'Назначение',name:'economicType',value:state.filters.economicType,options:[none,...economics]}))
    +select({label:'Тип',name:'system',value:state.filters.system,options:[none,{value:'system',label:'Системная'},{value:'custom',label:'Пользовательская'}]})+'</div>';
  anchor.dataset.v2AnchorWidth='360';
  const popup=mountModal(anchor,modal('<div data-people-filter-fields>'+fields()+'</div><div class="modal-actions" data-people-filter-actions'+(Object.values(state.filters).some(Boolean)?'':' hidden')+'>'+button('Сбросить',{variant:'secondary',data:'data-people-filter-action'})+'</div>',{title:'Фильтр',variant:'x',surface:'app',className:'people-action-popup people-filter-popup'}));
  if(!popup)return;
  const actions=popup.querySelector('[data-people-filter-actions]');
  popup.addEventListener('change',event=>{
    const key=event.target?.name;
    if(!Object.prototype.hasOwnProperty.call(state.filters,key))return;
    state.filters[key]=String(event.target.value||'');
    actions.hidden=!Object.values(state.filters).some(Boolean);
    refresh();
  });
  popup.querySelector('[data-people-filter-action]')?.addEventListener('click',()=>{
    state.filters=articleFilters();
    popup.querySelector('[data-people-filter-fields]').innerHTML=fields();
    actions.hidden=true;refresh();
  });
}
function openArticleSort(anchor,state,refresh,desktop=false){
  const content='<div class="people-action-menu">'+(desktop?ARTICLE_SORTS.filter(([key])=>key==='tree'||key.startsWith('name')||key.startsWith('system')):ARTICLE_SORTS).map(([value,label])=>button(label,{variant:'secondary',data:'data-article-sort-choice="'+value+'" aria-pressed="'+(value===state.sort)+'"'})).join('')+'</div>';
  const popup=mountModal(anchor,modal(content,{title:'Сортировка',variant:'x',surface:'app',xRole:'action',className:'people-action-popup people-sort-popup'}));
  popup?.querySelectorAll('[data-article-sort-choice]').forEach(control=>control.addEventListener('click',()=>{
    state.sort=control.dataset.articleSortChoice;popup.v2Close?.();refresh();
  }));
}
// Use the same compact table and system disclosure geometry as Service Groups.
function desktopArticleRows(items,state){
  const roots=new Set(items.filter(a=>['INCOME_ROOT','EXPENSE_ROOT'].includes(a.systemKey)).map(a=>a.articleId));
  const articles=items.filter(a=>!roots.has(a.articleId)).map(a=>({...a,parentArticleId:roots.has(a.parentArticleId)?'':a.parentArticleId}));
  const query=normalized(state.query).split(/\s+/).filter(Boolean);
  const names=new Map(articles.map(a=>[a.articleId,a.name]));
  const f=state.filters;
  const count=new Map();for(const a of articles)count.set(a.parentArticleId,(count.get(a.parentArticleId)||0)+1);
  const groups=desktopArticleGroups(articles);
  const sorted=state.sort==='tree'?groups:[...groups].sort((a,b)=>{
    const key=state.sort.startsWith('system')?'systemKey':'name';
    const value=a=>key==='systemKey'?(a.systemKey?'Системная':'Пользовательская'):a.name;
    return String(value(a)).localeCompare(String(value(b)),'ru',{numeric:true})*(state.sort.endsWith('Desc')?-1:1);
  });
  return treeRows(sorted).filter(a=>{
    const direction=({IN:'Приход',OUT:'Расход',TRANSFER:'Транзакция'})[a.direction]||'';
    const type=a.systemKey?'Системная':'Пользовательская';
    return query.every(word=>normalized([a.name,names.get(a.parentArticleId),direction,type,...desktopArticleValues(articles,a.articleId).map(v=>v.name)].join(' ')).includes(word))
      &&(!f.direction||a.direction===f.direction)
      &&(!f.system||f.system===(a.systemKey?'system':'custom'))
      &&(!f.parent||f.parent===(a.parentArticleId?'id:'+a.parentArticleId:'root'));
  }).map(a=>({...a,childCount:desktopArticleValues(articles,a.articleId).length}));
}
function renderDesktopArticleTable(host,rows,collapsed,onOpen){
  const columns=[
    {key:'name',label:'Наименование',sortable:false,render:a=>{
      const name=escapeHtml(a.name);
      const content=a.systemKey&&a.direction==='TRANSFER'?name:button(name,{variant:'secondary',className:'desktop-group-table-name',data:'data-finance-article="'+escapeHtml(a.articleId)+'"',aria:'Открыть статью '+a.name});
      return '<div style="padding-inline-start:'+Math.min(a.depth,5)*12+'px" data-article-row="'+escapeHtml(a.articleId)+'">'+content+'</div>';
    }},
    {key:'type',label:'Тип',sortable:false,render:a=>a.systemKey?'Системная':'Пользовательская'},
    {key:'values',label:'Значения',sortable:false,render:a=>String(a.childCount)},
  ];
  host.innerHTML='<div class="desktop-table-popup">'+dataTable({columns,rows,caption:'Статьи',compact:true})+'</div>';
  const original=host.querySelector('tbody');if(!original)return;
  const table=original.closest('table'),doc=host.ownerDocument;
  const byId=new Map([...original.querySelectorAll('[data-article-row]')].map(e=>[e.dataset.articleRow,e.closest('tr')]));
  for(const [direction,label] of [['IN','ПРИХОД'],['OUT','РАСХОД'],['TRANSFER','ТРАНЗАКЦИЯ']]){
    const members=rows.filter(a=>a.direction===direction);
    if(!members.length)continue;
    const heading=doc.createElement('tbody'),row=heading.insertRow();row.dataset.tableGroupLevel='system';
    const cell=row.insertCell();cell.colSpan=columns.length;
    cell.innerHTML='<button type="button" class="desktop-group-section-toggle" aria-expanded="'+!collapsed.has(direction)+'"><span aria-hidden="true">'+(collapsed.has(direction)?'▸':'▾')+'</span><span>'+label+'</span></button>';
    table.append(heading);
    const body=doc.createElement('tbody');table.append(body);body.hidden=collapsed.has(direction);
    const toggle=cell.querySelector('button');toggle.addEventListener('click',()=>{
      if(collapsed.has(direction))collapsed.delete(direction);else collapsed.add(direction);
      body.hidden=collapsed.has(direction);toggle.setAttribute('aria-expanded',String(!body.hidden));toggle.firstElementChild.textContent=body.hidden?'▸':'▾';
    });
    for(const a of members){const tr=byId.get(a.articleId);if(!tr)continue;body.append(tr);if(!a.systemKey||a.direction!=='TRANSFER')tr.addEventListener('click',()=>onOpen(a.articleId));}
  }
  original.remove();
}
// The DDS directory is a tool, not a navigation destination. The same Q
// and compact X editor are used on desktop and mobile; persisted Core article
// IDs and mutation rules are unchanged until the classification contract changes.
export function openFinanceArticlesQ(root, {onSaved=()=>{}}={}) {
  const desktop=financeDesktop(root);
  const getArticles=()=>desktop?desktopAvailableArticles(getFinanceArticles(),canUseCapability):getFinanceArticles();
  const state={query:'',filters:articleFilters(),sort:'tree'};
  const collapsed=new Set();
  const layer=mountModal(root,modal(
    '<div class="form-grid">'
    +'<div style="display:flex;align-items:center;gap:8px">'
    +field({name:'articleSearch',type:'search',placeholder:'Поиск',autocomplete:'off',value:'',data:'data-article-search'})
    +compactButton({kind:'filter',data:'data-article-filter title="Фильтр" aria-haspopup="dialog" aria-pressed="false"'})
    +compactButton({kind:'sort',data:'data-article-sort title="Сортировка" aria-haspopup="dialog" aria-pressed="false"'})
    +'</div>'
    +'<output data-article-count aria-label="Количество статей" aria-live="polite"></output>'
    +'<div data-finance-article-list></div></div>'
    +compactButton({kind:'add',className:'v2-desktop-tool-primary',data:'data-add-finance-article title="Добавить статью"',aria:'Добавить статью'}),
    {title:'Статьи',variant:'q',surface:'app'}
  ));
  if(!layer)return null;
  const host=layer.querySelector('[data-finance-article-list]');
  const count=layer.querySelector('[data-article-count]');
  const search=layer.querySelector('[data-article-search]');
  const filter=layer.querySelector('[data-article-filter]');
  const sort=layer.querySelector('[data-article-sort]');
  const add=layer.querySelector('[data-add-finance-article]');
  moveDesktopQTool(add);
  const refresh=()=>{
    const items=getArticles();
    const rows=desktop?desktopArticleRows(items,state):visibleArticles(items,state);
    count.textContent=String(rows.length);
    filter?.setAttribute('aria-pressed',String(Object.values(state.filters).some(Boolean)));
    sort?.setAttribute('aria-pressed',String(state.sort!=='tree'));
    if(desktop&&rows.length){renderDesktopArticleTable(host,rows,collapsed,id=>{const item=getArticles().find(a=>a.articleId===id);if(item)openArticleX(item,changed,getArticles,true);});return;}
    host.innerHTML=rows.length?list({items:rows.map(row)}):emptyState(items.length?'Статьи не найдены':'Статей пока нет');
    host.querySelectorAll('[data-finance-article]').forEach(control=>control.addEventListener('click',()=>{
      const item=getArticles().find(candidate=>candidate.articleId===control.dataset.financeArticle);
      if(item)openArticleX(item,changed,getArticles);
    }));
  };
  const changed=()=>{refresh();onSaved();};
  search?.addEventListener('input',()=>{state.query=search.value;refresh();});
  filter?.addEventListener('click',()=>openArticleFilters(filter,desktop?getArticles().filter(a=>!['INCOME_ROOT','EXPENSE_ROOT'].includes(a.systemKey)).map(a=>({...a,parentArticleId:['system-income','system-expense'].includes(a.parentArticleId)?'':a.parentArticleId})):getArticles(),state,refresh,desktop));
  sort?.addEventListener('click',()=>openArticleSort(sort,state,refresh,desktop));
  add?.addEventListener('click',()=>openArticleX(null,changed,getArticles,desktop));
  refresh();
  return layer;
}
