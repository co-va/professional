import {
  actionBlock,
  button,
  compactButton,
  modal,
  mountModal,
  setV2ZHeaderRows,
  dataTable,
  emptyState,
  escapeHtml,
  field,
  formValidationMessage,
  list,
  mountV2ZLayer,
  openNotice,
  select,
  v2ZLayer,
  workspaceHeaderContext,
} from '../../../ui/ui.js';
import { financeDesktop, financeZSave, openFinanceDeleteConfirmation } from '../desktop.js';
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
    secondary: item.systemKey ? 'Системная статья' : '',
    right: '',
    interactive: true,
    data: `data-finance-article="${escapeHtml(item.articleId)}"`,
    aria: `Открыть статью ${item.name}`,
  };
}

function openArticleX(root, existing = null) {
  const items = getFinanceArticles();
  const isSystem = Boolean(existing?.systemKey);
  const title = existing ? 'Редактирование статьи' : 'Новая статья';
  const direction = existing?.direction || 'OUT';
  const economicType = existing?.economicType || 'OPERATING_EXPENSE';
  const economicOptions = ECONOMIC_OPTIONS.some(item=>item.value===economicType)
    ? ECONOMIC_OPTIONS : [...ECONOMIC_OPTIONS,{value:economicType,label:economicLabel(economicType)}];
  const content = `<form class="compact-form" data-finance-article-form novalidate>
    ${field({label:'Название',name:'articleName',value:existing?.name||'',required:true,placeholder:'Например, Краска'})}
    ${select({label:'Группа',name:'parentArticleId',value:existing?.parentArticleId||'',options:parentOptions(items,existing?.articleId||'')})}
    ${select({label:'Направление',name:'direction',value:direction,options:DIRECTION_OPTIONS})}
    ${select({label:'Назначение',name:'economicType',value:economicType,options:economicOptions})}
    <div class="modal-actions finance-receipt-actions finance-receipt-actions--dds">
      ${existing&&!isSystem?button('Удалить',{variant:'danger',data:'data-delete-finance-article'}):''}
      ${button('Сохранить',{type:'submit',data:'data-finance-article-save',disabled:true})}
    </div>
  </form>`;
  const layer=mountModal(root,modal(content,{title,variant:'x',surface:'app',className:'modal--form-sheet'}));
  if(!layer)return null;
  const form=layer.querySelector('[data-finance-article-form]');
  const save=form.querySelector('[data-finance-article-save]');
  const remove=form.querySelector('[data-delete-finance-article]');
  if(isSystem)for(const name of ['direction','economicType']){
    const trigger=form.querySelector('input[name="'+name+'"]')?.closest('.ui-select')?.querySelector('[data-ui-select-trigger]');
    if(trigger)trigger.disabled=true;
  }
  const read=()=>{
    const data=new FormData(form);
    return {name:String(data.get('articleName')||'').trim(),parentArticleId:String(data.get('parentArticleId')||''),direction:String(data.get('direction')||''),economicType:String(data.get('economicType')||'')};
  };
  const initial=JSON.stringify(read());
  let pending=false;
  const sync=()=>{const value=read();save.disabled=pending||!value.name||Boolean(existing&&JSON.stringify(value)===initial);if(remove)remove.disabled=pending;};
  form.addEventListener('input',sync);
  form.addEventListener('change',sync);
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(pending||save.disabled)return;
    const validation=formValidationMessage(form);
    if(validation){openNotice({message:validation});return;}
    pending=true;sync();
    try{
      const payload=read();
      const result=existing?await updateFinanceArticle(existing.articleId,payload):await createFinanceArticle(payload);
      if(!result)throw new Error('Сервер не подтвердил сохранение статьи.');
      layer.v2Close?.();renderList(root);
    }catch(error){openNotice({message:String(error?.message||'Не удалось сохранить статью')});}
    finally{pending=false;sync();}
  });
  remove?.addEventListener('click',()=>{
    if(pending)return;
    openFinanceDeleteConfirmation(layer,{
      message:'Статья будет удалена из списка доступных статей. Ранее проведённые операции останутся в истории. Вы уверены?',
      onConfirm:()=>archiveFinanceArticle(existing.articleId),
      onSuccess:()=>renderList(root),
    });
  });
  sync();
  return layer;
}

function openForm(root, existing = null) {
  if(financeDesktop(root))return openArticleX(root,existing);
  const items = getFinanceArticles();
  const isSystem = Boolean(existing?.systemKey);
  const direction = existing?.direction || 'OUT';
  const economicType = existing?.economicType === 'GROUP' ? 'OPERATING_EXPENSE' : (existing?.economicType || 'OPERATING_EXPENSE');
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'finance-article-edit-z' }), { stack: true });
  if (!layer) return;

  layer.innerHTML = `${workspaceHeaderContext({
    title: existing ? 'Редактирование статьи' : 'Новая статья',
  })}
    <form class="compact-form" data-finance-article-form novalidate>
      ${field({ label: 'Название', name: 'articleName', value: existing?.name || '', required: true, placeholder: 'Например, Краска' })}
      ${select({ label: 'Родитель', name: 'parentArticleId', value: existing?.parentArticleId || '', options: parentOptions(items, existing?.articleId || '') })}
      ${select({ label: 'Тип', name: 'direction', value: direction, options: DIRECTION_OPTIONS })}
      ${select({ label: 'Экономический характер', name: 'economicType', value: economicType, options: ECONOMIC_OPTIONS })}
      ${existing && !isSystem ? button('Удалить', { type: 'button', variant: 'danger', data: 'data-delete-finance-article' }) : ''}
    </form>
    ${actionBlock(button('Сохранить', {
      data: 'data-finance-article-save',
      aria: 'Сохранить статью',
    }))}`;

  layer.querySelector('[data-finance-article-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const validation = formValidationMessage(form);
    if (validation) {
      openNotice({ message: validation });
      return;
    }
    const data = new FormData(form);
    const payload = {
      name: String(data.get('articleName') || '').trim(),
      parentArticleId: String(data.get('parentArticleId') || ''),
      direction: String(data.get('direction') || ''),
      economicType: String(data.get('economicType') || ''),
    };
    if (!payload.name) {
      openNotice({ message: 'Укажите название статьи.' });
      return;
    }
    if (existing) await updateFinanceArticle(existing.articleId, payload);
    else await createFinanceArticle(payload);
    layer.v2Close?.();
    renderList(root);
  });

  layer.querySelector('[data-finance-article-save]')?.addEventListener('click', () => {
    layer.querySelector('[data-finance-article-form]')?.requestSubmit();
  });
  financeZSave(layer, '[data-finance-article-save]', existing ? 'Редактирование статьи' : 'Новая статья');

  layer.querySelector('[data-delete-finance-article]')?.addEventListener('click', async () => {
    await archiveFinanceArticle(existing.articleId);
    layer.v2Close?.();
    renderList(root);
  });
}

function articleTable(rows, items=rows) {
  const names=new Map(items.map(item=>[item.articleId,item.name]));
  return dataTable({compact:true,caption:'Статьи',rows,columns:[
    {key:'name',label:'Название',sortable:false,render:item=>'<button type="button" data-finance-article="'+escapeHtml(item.articleId)+'" aria-label="Открыть статью '+escapeHtml(item.name)+'">'+escapeHtml(item.name)+'</button>'},
    {key:'parent',label:'Группа',sortable:false,render:item=>escapeHtml(names.get(item.parentArticleId)||'—')},
    {key:'direction',label:'Направление',sortable:false,render:item=>escapeHtml(directionLabel(item.direction))},
    {key:'economicType',label:'Назначение',sortable:false,render:item=>escapeHtml(economicLabel(item.economicType))},
    {key:'system',label:'Тип',sortable:false,render:item=>item.systemKey?'Системная':'Пользовательская'},
  ]});
}

function renderList(root) {
  if(financeDesktop(root))return renderDesktopArticles(root);
  const items = getFinanceArticles();
  const rows = treeRows(items);
  root.innerHTML = `${workspaceHeaderContext({
    title: 'Статьи',
    c: financeDesktop(root) ? null : {
      label: '+',
      data: 'data-add-finance-article',
      aria: 'Добавить статью',
    },
  })}${rows.length ? list({ items: rows.map(row) }) : emptyState('Статей пока нет', 'Добавьте первую статью кнопкой «+».')}`;

  root.querySelector('[data-add-finance-article]')?.addEventListener('click', () => openForm(root));
  root.querySelectorAll('[data-finance-article]').forEach((element) => {
    (financeDesktop(root) ? element.closest('tr') || element : element).addEventListener('click', () => {
      const item = getFinanceArticles().find((candidate) => candidate.articleId === element.dataset.financeArticle);
      if (item) openForm(root, item);
    });
  });
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
function openArticleFilters(anchor,items,state,refresh){
  const names=new Map(items.map(item=>[item.articleId,item.name]));
  const none={value:'',label:'Без фильтра'};
  const parents=[...new Set(items.map(item=>item.parentArticleId||''))].map(id=>({value:id?'id:'+id:'root',label:names.get(id)||'Без группы'}));
  const economics=[...new Set(items.map(item=>item.economicType).filter(Boolean))].map(value=>({value,label:economicLabel(value)}));
  const fields=()=>'<div class="form-grid">'
    +select({label:'Группа',name:'parent',value:state.filters.parent,options:[none,...parents]})
    +select({label:'Направление',name:'direction',value:state.filters.direction,options:[none,...DIRECTION_OPTIONS]})
    +select({label:'Назначение',name:'economicType',value:state.filters.economicType,options:[none,...economics]})
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
function openArticleSort(anchor,state,refresh){
  const content='<div class="people-action-menu">'+ARTICLE_SORTS.map(([value,label])=>button(label,{variant:'secondary',data:'data-article-sort-choice="'+value+'" aria-pressed="'+(value===state.sort)+'"'})).join('')+'</div>';
  const popup=mountModal(anchor,modal(content,{title:'Сортировка',variant:'x',surface:'app',xRole:'action',className:'people-action-popup people-sort-popup'}));
  popup?.querySelectorAll('[data-article-sort-choice]').forEach(control=>control.addEventListener('click',()=>{
    state.sort=control.dataset.articleSortChoice;popup.v2Close?.();refresh();
  }));
}
function renderDesktopArticles(root){
  const items=getFinanceArticles();
  const state=root.financeArticleListState||=( {query:'',filters:articleFilters(),sort:'tree'} );
  root.innerHTML=workspaceHeaderContext({title:'Статьи'})+'<section><div class="v2-desktop-tool-row"><div class="v2-desktop-tool-context"><span><output data-article-count aria-label="Количество статей" aria-live="polite"></output></span></div></div><div data-finance-article-table></div></section>';
  const [toolbar]=setV2ZHeaderRows(root,[
    '<section data-people-desktop-toolbar><div class="people-desktop-tools">'
    +field({name:'articleSearch',type:'search',placeholder:'Поиск',autocomplete:'off',value:state.query,data:'data-article-search'})
    +'<div class="people-desktop-actions people-desktop-query-tools">'
    +compactButton({kind:'filter',data:'data-article-filter title="Фильтр" aria-haspopup="dialog" aria-pressed="false"'})
    +compactButton({kind:'sort',data:'data-article-sort title="Сортировка" aria-haspopup="dialog" aria-pressed="false"'})
    +'</div><div class="people-desktop-actions people-desktop-actions--right">'
    +button('+',{variant:'secondary',className:'people-desktop-icon people-desktop-add',aria:'Добавить статью',data:'data-add-finance-article'})
    +'</div></div></section>'
  ],{desktopTitle:'Статьи'});
  const host=root.querySelector('[data-finance-article-table]');
  if(!toolbar||!host)return;
  const count=root.querySelector('[data-article-count]');
  const search=toolbar.querySelector('[data-article-search]');
  const filter=toolbar.querySelector('[data-article-filter]');
  const sort=toolbar.querySelector('[data-article-sort]');
  const refresh=()=>{
    const rows=visibleArticles(items,state);
    if(count)count.textContent=String(rows.length);
    filter?.setAttribute('aria-pressed',String(Object.values(state.filters).some(Boolean)));
    sort?.setAttribute('aria-pressed',String(state.sort!=='tree'));
    host.innerHTML=rows.length?articleTable(rows,items):emptyState(items.length?'Статьи не найдены':'Статей пока нет',items.length?'Измените условия поиска или фильтрации.':'Добавьте первую статью кнопкой «+».');
    host.querySelectorAll('[data-finance-article]').forEach(control=>(control.closest('tr')||control).addEventListener('click',()=>{
      const item=getFinanceArticles().find(candidate=>candidate.articleId===control.dataset.financeArticle);
      if(item)openForm(root,item);
    }));
  };
  search?.addEventListener('input',()=>{state.query=search.value;refresh();});
  filter?.addEventListener('click',()=>openArticleFilters(filter,items,state,refresh));
  sort?.addEventListener('click',()=>openArticleSort(sort,state,refresh));
  toolbar.querySelector('[data-add-finance-article]')?.addEventListener('click',()=>openForm(root));
  refresh();
}

export function renderFinanceArticles(root) {
  renderList(root);
}
