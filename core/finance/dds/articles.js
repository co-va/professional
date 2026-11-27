import { groupValuesMarkup, groupValueDraft, groupEditorActions, confirmGroupRemoval, renderGroupValues, renderGroupDirectory } from '../../../ui/groups/group-values.js';
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
import { getFinanceArticles, getFinanceArticleCatalog } from '../data.js';
import { availableArticleDirectory } from './article-view.js';
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
    ${desktop&&existing&&existing.direction!=='TRANSFER'?groupValuesMarkup({addData:'data-article-value-add',draftData:'data-article-value-draft',listData:'data-article-values'}):''}
    <div class="form-error" role="alert" data-article-error></div>
    ${desktop?groupEditorActions({canDelete:Boolean(existing&&!isSystem),removeData:'data-delete-finance-article',saveData:'data-finance-article-save'}):'<div class="modal-actions finance-receipt-actions finance-receipt-actions--dds">'+(existing&&!isSystem?button('Удалить',{variant:'danger',data:'data-delete-finance-article'}):'')+button('Сохранить',{type:'submit',data:'data-finance-article-save',disabled:true})+'</div>'}
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
    renderGroupValues(valueHost,{
      values:currentValues(),getId:a=>a.articleId,selectedId:valueEdit?.articleId,
      valueData:a=>'data-article-value="'+escapeHtml(a.articleId)+'"',removeData:'data-article-value-delete',
      onEdit:a=>{if(pending||valueEdit||JSON.stringify(read())!==initial)return;valueEdit={articleId:a.articleId,name:a.name};drawDraft();drawValues();draftHost.querySelector('input')?.focus();},
      onRemove:a=>{
        if(pending||valueEdit||JSON.stringify(read())!==initial)return;
        confirmGroupRemoval({title:'Удалить значение?',message:'Значение «'+a.name+'» будет удалено из списка. Проведённые операции останутся в истории.',onConfirm:async()=>{
          if(pending||valueEdit||JSON.stringify(read())!==initial)throw new Error('Завершите редактирование.');
          pending=true;sync();try{return await archiveFinanceArticle(a.articleId);}finally{pending=false;sync();}
        },onSuccess:()=>{onSaved();drawValues();}});
      },
    });
    sync();
  };
  const drawDraft=()=>{
    if(!draftHost)return;
    draftHost.innerHTML=groupValueDraft(valueEdit);
    sync();
  };
  plus?.addEventListener('click',()=>{if(pending||valueEdit||JSON.stringify(read())!==initial)return;valueEdit={articleId:'',name:''};drawDraft();drawValues();draftHost.querySelector('input')?.focus();});
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
    if(desktop){
      confirmGroupRemoval({title:'Удалить статью?',message:articleRemovalMessage(existing),onConfirm:async()=>{
        const fresh=getArticles().find(a=>a.articleId===existing.articleId);
        if(pending||!fresh||fresh.systemKey)throw new Error('Статья недоступна для удаления.');
        pending=true;sync();try{return await archiveFinanceArticle(existing.articleId);}finally{pending=false;sync();}
      },onSuccess:()=>{layer.v2Close?.();onSaved();}});
    }else openFinanceDeleteConfirmation(layer,{message:articleRemovalMessage(existing),onConfirm:()=>archiveFinanceArticle(existing.articleId),onSuccess:onSaved});
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
function openArticleFilters(anchor,items,state,refresh,desktop=false,canonical=false){
  const names=new Map(items.map(item=>[item.articleId,item.name]));
  const none={value:'',label:'Без фильтра'};
  const parents=[...new Set(items.map(item=>item.parentArticleId||''))].map(id=>({value:id?'id:'+id:'root',label:names.get(id)||'Без группы'}));
  const economics=[...new Set(items.map(item=>item.economicType).filter(Boolean))].map(value=>({value,label:economicLabel(value)}));
  const fields=()=>'<div class="form-grid">'
    +(canonical?'':select({label:'Группа',name:'parent',value:state.filters.parent,options:[none,...parents]})
    +select({label:'Направление',name:'direction',value:state.filters.direction,options:[none,...(desktop?DIRECTION_OPTIONS.map(a=>a.value==='IN'?{...a,label:'Приход'}:a.value==='TRANSFER'?{...a,label:'Транзакция'}:a):DIRECTION_OPTIONS)]})
    +(desktop?'':select({label:'Назначение',name:'economicType',value:state.filters.economicType,options:[none,...economics]})))
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
const articleRemovalMessage=item=>'Статья «'+item.name+'» и все её значения будут удалены из доступного справочника. Проведённые операции останутся в истории.';
function renderDesktopArticleTable(host,rows,collapsed,onOpen,onDelete,canonical=false){
  return renderGroupDirectory(host,{
    rows,sections:canonical?[['system','СИСТЕМНЫЕ'],['custom','ПОЛЬЗОВАТЕЛЬСКИЕ']]:[['IN','ПРИХОД'],['OUT','РАСХОД'],['TRANSFER','ТРАНЗАКЦИЯ']],collapsed,caption:'Статьи',
    getId:a=>a.articleId,getSection:a=>canonical?(a.systemKey?'system':'custom'):a.direction,getCount:a=>a.childCount,getDepth:a=>a.depth,
    canOpen:a=>canonical||!a.systemKey||a.direction!=='TRANSFER',canDelete:a=>!a.systemKey,
    nameData:a=>'data-article-row="'+escapeHtml(a.articleId)+'"'+(canonical||!a.systemKey||a.direction!=='TRANSFER'?' data-finance-article="'+escapeHtml(a.articleId)+'"':''),
    deleteData:'data-article-row-delete',deleteLabel:'Удалить статью',openLabel:'Открыть статью',onOpen,onDelete,
  });
}
function canonicalDirectoryRows(items,state){
  const words=normalized(state.query).split(/\s+/).filter(Boolean);
  const rows=items.filter(a=>(!state.filters.system||state.filters.system===(a.systemKey?'system':'custom'))&&words.every(word=>normalized([a.name,...a.values.map(v=>v.name)].join(' ')).includes(word))).map(a=>({...a,depth:0,childCount:a.values.length}));
  if(state.sort!=='tree')rows.sort((a,b)=>{const key=state.sort.startsWith('system')?'systemKey':'name';return String(a[key]||'').localeCompare(String(b[key]||''),'ru',{numeric:true})*(state.sort.endsWith('Desc')?-1:1);});
  return rows;
}
// Registered system actions are not editable custom values. Existing custom
// values remain editable/deletable by their original persisted identity.
function openMechanismArticleX(article,onSaved,getArticles){
  const content='<div class="compact-form">'+field({label:'Название',name:'articleName',value:article.name,readonly:true})+groupValuesMarkup({add:false,listData:'data-mechanism-values'})+groupEditorActions({saveData:'data-finance-article-save'})+'</div>';
  const layer=mountModal(document.body,modal(content,{title:'Статья',variant:'x',surface:'app',xRole:'editor',className:'desktop-service-group-editor-x'}));
  if(!layer)return null;
  const host=layer.querySelector('[data-mechanism-values]');
  const draw=()=>{
    const fresh=getFinanceArticleCatalog()?.find(a=>a.articleId===article.articleId);
    const values=(fresh?.values||article.values||[]).filter(v=>!v.archived);
    renderGroupValues(host,{values,getId:v=>v.valueId,canEdit:v=>Boolean(v.custom),canRemove:v=>Boolean(v.custom),onEdit:v=>{
      const raw=getArticles().find(a=>a.articleId===v.valueId);if(!raw)return;
      layer.v2Close?.();openArticleX(raw,onSaved,getArticles,true);
    },onRemove:v=>confirmGroupRemoval({title:'Удалить значение?',message:'Значение «'+v.name+'» будет удалено из списка. Проведённые операции останутся в истории.',onConfirm:()=>archiveFinanceArticle(v.valueId),onSuccess:()=>{onSaved();draw();}})});
  };
  draw();return layer;
}
// The DDS directory is a tool, not a navigation destination. The same Q
// and compact X editor are used on desktop and mobile; persisted Core article
// IDs and mutation rules are unchanged until the classification contract changes.
export function openFinanceArticlesQ(root, {onSaved=()=>{}}={}) {
  const desktop=financeDesktop(root);
  const getArticles=()=>desktopAvailableArticles(getFinanceArticles(),canUseCapability);
  const getDirectory=()=>availableArticleDirectory(getFinanceArticleCatalog(),getArticles(),canUseCapability);
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
  let busy=false;
  const syncDirectory=()=>{if(add)add.disabled=busy;host.querySelectorAll('[data-article-row-delete]').forEach(control=>control.disabled=busy);};
  const deleteFromDirectory=id=>{
    const item=getArticles().find(a=>a.articleId===id);
    if(busy||!item||item.systemKey)return;
    confirmGroupRemoval({title:'Удалить статью?',message:articleRemovalMessage(item),onConfirm:async()=>{const fresh=getArticles().find(a=>a.articleId===id);if(busy||!fresh||fresh.systemKey)throw new Error('Статья недоступна для удаления.');busy=true;syncDirectory();try{return await archiveFinanceArticle(id);}finally{busy=false;syncDirectory();}},onSuccess:()=>changed()});
  };
  const openRow=id=>{
    if(busy)return;
    const mechanism=getDirectory()?.find(a=>a.articleId===id&&a.capability);
    if(mechanism){openMechanismArticleX(mechanism,changed,getArticles);return;}
    const item=getArticles().find(a=>a.articleId===id);if(item)openArticleX(item,changed,getArticles,true);
  };
  const refresh=()=>{
    const directory=getDirectory(),canonical=Array.isArray(directory);
    const items=getArticles();
    const rows=canonical?canonicalDirectoryRows(directory,state):desktopArticleRows(items,state);
    count.textContent=String(rows.length);
    filter?.setAttribute('aria-pressed',String(Object.values(state.filters).some(Boolean)));
    sort?.setAttribute('aria-pressed',String(state.sort!=='tree'));
    if(desktop&&rows.length){renderDesktopArticleTable(host,rows,collapsed,openRow,deleteFromDirectory,canonical);syncDirectory();return;}
    host.innerHTML=rows.length?list({items:rows.map(a=>canonical?{title:a.name,secondary:a.values.map(v=>v.name).join(' · '),interactive:true,data:'data-finance-article="'+escapeHtml(a.articleId)+'"',aria:'Открыть статью '+a.name}:({...row(a),interactive:a.direction!=='TRANSFER'||!a.systemKey,data:a.direction==='TRANSFER'&&a.systemKey?'':'data-finance-article="'+escapeHtml(a.articleId)+'"'}))}):emptyState(items.length?'Статьи не найдены':'Статей пока нет');
    host.querySelectorAll('[data-finance-article]').forEach(control=>control.addEventListener('click',()=>{
      openRow(control.dataset.financeArticle);
    }));
  };
  const changed=()=>{refresh();onSaved();};
  search?.addEventListener('input',()=>{state.query=search.value;refresh();});
  filter?.addEventListener('click',()=>{const directory=getDirectory();openArticleFilters(filter,directory|| (desktop?getArticles().filter(a=>!['INCOME_ROOT','EXPENSE_ROOT'].includes(a.systemKey)).map(a=>({...a,parentArticleId:['system-income','system-expense'].includes(a.parentArticleId)?'':a.parentArticleId})):getArticles()),state,refresh,desktop||Boolean(directory),Boolean(directory));});
  sort?.addEventListener('click',()=>openArticleSort(sort,state,refresh,desktop||Boolean(getDirectory())));
  add?.addEventListener('click',()=>{if(!busy)openArticleX(null,changed,getArticles,true);});
  refresh();
  return layer;
}
