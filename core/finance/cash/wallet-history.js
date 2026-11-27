import {
  button, compactButton, datePicker, emptyState, escapeHtml, field,
  initDatePickers, modal, mountModal, select, setV2ZHeaderRows,
} from '../../../ui/ui.js';
import { checkControl, sortGroupingSection } from '../../../ui/selection/check-list.js';
import { DATA_EXPORT_ICON } from '../../../ui/buttons/index.js';
import { financeHistoryTable, financeTableContact } from '../desktop.js';
import { getFinanceOperation, getFinanceArticles, getFinanceArticleCatalog } from '../data.js';
import { desktopDocumentArticles, desktopOperationDirection } from '../dds/classification.js';
import { registeredArticle } from '../dds/article-view.js';
import { articleCellText } from '../dds/article-view.js';
import {readArticleOrder,readDDSGrouping,saveDDSGrouping} from '../dds/article-order.js';
import {DDS_SORTS,WALLET_SORTS,normalizeWalletSort,normalizeDDSView,sortDDSRows,buildDDSGroups,flattenDDSGroups} from '../dds/view-order.js';
import {getWallets} from './data.js';
import {getWorkplaces} from '../../profile/workplaces/data.js';
import {getPeople} from '../../people/data.js';
import {getPeopleSortMode} from '../../people/view-state.js';
import {sortItems} from '../../people/sort.js';
import { exportScopedWorkbook, reportExcelError } from '../../excel/scoped.js';

const emptyFilters = () => ({ title:'', workplace:'', person:'', direction:'', article:'', from:'', to:'' });
const ddsFilters = () => ({ ...emptyFilters(), wallet:'', status:'' });
const money = value => new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(value) + ' ₽';
const clean = value => String(value ?? '').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/\s+/g,' ').trim();
const numeric = value => String(value ?? '').replace(/[^0-9]/g,'');
const sum = rows => rows.reduce((total,row)=>total+Math.round(row.value*100),0)/100;

export function localDate(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '';
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}

// Cash shares DDS classification, but only includes this wallet's actual ledger entries.
export function walletOperationClassification(item, catalog = getFinanceArticles(), canonical = getFinanceArticleCatalog(), operation = getFinanceOperation(item.operationId)) {
  const entries = Array.isArray(item.entries) && item.entries.length ? item.entries : [item];
  const directions = new Set(entries.map(entry=>entry.direction).filter(Boolean));
  const transfer = item.operationKind==='transfer' || entries.some(entry=>entry.economicType==='TRANSFER');
  const direction = transfer ? 'transfer' : directions.size>1 ? 'mixed' : directions.has('OUT') ? 'out' : directions.has('IN') ? 'in' : Number(item.total)<0 ? 'out' : 'in';
  const settlement=operation?.data?.settlement;
  const positions=(Array.isArray(settlement?.items)?settlement.items:item.settlementItems||[]).map(p=>String(p.name||'')).filter(Boolean);
  if(!Array.isArray(canonical)){
   const articles=desktopDocumentArticles(entries,catalog);
   return {direction,title:desktopOperationDirection(direction),articles,article:articles.join(', '),positions,positionList:positions.join(' · ')};
  }
  // Cash is one real payment per wallet, not one row per DDS position.
  // Article labels are only its registered composition, not a new article.
  const entryIds=new Set(entries.map(e=>e.entryId));
  const parts=(operation?.data?.positionMovements||[]).filter(p=>p.sourceKind==='wallet'&&entryIds.has(p.entryId));
  const classes=(parts.length?parts.map(p=>registeredArticle(canonical,p.articleClass)):entries.map(e=>registeredArticle(canonical,e.articleClass))).filter(Boolean);
  const articles=[...new Set(classes.map(a=>a.articleName))];
  const values=[...new Set(classes.map(a=>a.valueName).filter(Boolean))];
  const tips=entries.filter(e=>e.component==='tips'||e.economicType==='TIPS'||e.economicType==='TIPS_REFUND').reduce((n,e)=>n+Math.round(Number(e.amount||0)*100),0)/100;
  return {direction,title:desktopOperationDirection(direction),articles,article:articles.join(' · '),articleValue:articles.length===1&&values.length===1?values[0]:'',positions,positionList:positions.join(' · '),tips,canonicalArticle:true};
}

export function walletHistoryRows(operations, people, { operationName, operationMoment, catalog = getFinanceArticles(), canonical = getFinanceArticleCatalog(), lookup=getFinanceOperation }) {
  return operations.map(item => {
    const value = Number(item.total)||0;
    const occurredAt = String(item.occurredAt||'');
    const contact=financeTableContact(item,people);
    const classification=walletOperationClassification(item,catalog,canonical,lookup(item.operationId));
    return {id:String(item.operationId),documentId:String(item.operationId),date:operationMoment(item),occurredAt,localDate:localDate(occurredAt),operationLabel:operationName(item),...contact,personFilter:[contact.code,contact.person].filter(Boolean).join(' · '),personKey:item.personKey||item.person?.key||item.person?.id||'',workplace:String(item.workplace||''),workplaceKey:item.workplaceKey||'',item,...classification,amount:money(value),value};
  });
}

// Search all displayed columns and saved document facts. Numeric comparisons
// for amount/date sorting, not lexicographic formatted strings.
export function visibleWalletRows(rows, query='', filters=emptyFilters(), sort='dateDesc') {
  const words = clean(query).split(' ').filter(Boolean);
  const items = rows.filter(row => {
    const fullDate = row.localDate ? row.localDate.split('-').reverse().join('.') : '';
    const haystack=clean([row.date,row.localDate,fullDate,row.title,row.code,row.person,row.contact,row.workplace,row.amount,
      row.operationLabel,row.item?.sourceDetails,row.item?.articleName,row.item?.note,row.id,row.documentId,row.wallet,row.position,row.positionList,row.article,row.articleValue,row.status,row.bonus].join(' '));
    if (!words.every(word=>haystack.includes(word) || (/^[+\d().-]+$/.test(word)&&numeric(word)&&
      [row.contact,row.date,fullDate,row.amount].map(numeric).some(value=>value.includes(numeric(word)))))) return false;
    return (!filters.title||row.title===filters.title)&&(!filters.workplace||row.workplace===filters.workplace)
      &&(!filters.person||row.personFilter===filters.person)
      &&(!filters.direction||(row.direction ? (row.direction===filters.direction||(filters.direction==='transfer'&&row.direction==='mixed')) : (filters.direction==='in'?row.value>0:row.value<0)))
      &&(!filters.wallet||row.wallets?.includes(filters.wallet))
      &&(!filters.article||row.articles?.includes(filters.article))
      &&(!filters.status||row.status===filters.status)
      &&(!filters.from||(row.localDate&&row.localDate>=filters.from))
      &&(!filters.to||(row.localDate&&row.localDate<=filters.to));
  });
  const key=sort.replace(/Asc$|Desc$/,'');
  const direction=sort.endsWith('Desc')?-1:1;
  return items.sort((a,b)=>{
    const comparison=key==='amount'?a.value-b.value:key==='bonus'?(a.bonusValue||0)-(b.bonusValue||0):key==='date'?
      (Date.parse(a.occurredAt)||0)-(Date.parse(b.occurredAt)||0):
      String(a[key]||'').localeCompare(String(b[key]||''),'ru',{numeric:true});
    return comparison*direction || String(b.occurredAt).localeCompare(String(a.occurredAt)) || a.id.localeCompare(b.id);
  });
}

export function walletSelection(rows, selected) {
  const chosen=rows.filter(row=>selected.has(row.id));
  return { chosen, exportRows:chosen.length?chosen:rows, count:rows.length, selectedCount:chosen.length,
    total:sum(rows), selectedTotal:sum(chosen) };
}

// Existing Finance Excel contract. Export the selected wallet movement, not
// other allocations of a split payment and not the full invoice as payment.
export function walletExportRows(rows, wallet, lookup=getFinanceOperation) {
  return rows.map(row=>{
    const item=row.item||{};
    const data=lookup(row.documentId||row.id)?.data||{};
    const quote=data.sourceQuote||{};
    const discount=quote.discountPercent!=null?String(quote.discountPercent)+'%':quote.discountMoney!=null?String(quote.discountMoney):'';
    const date=row.localDate||'';
    return {
      operationId:row.documentId||row.id, workplace:row.workplace, invoiceDate:String(quote.invoiceDate||date).slice(0,10),
      invoiceTime:String(quote.invoiceTime||row.date.split(' ')[1]||''),
      participantCode:row.code, participant:row.person, phone:row.contact,
      documentNumber:String(quote.documentNumber||data.documentNumber||row.documentId||row.id),
      purpose:row.canonicalArticle?articleCellText(row.article,row.articleValue):row.operationLabel||row.article||row.title, subject:String(quote.subject||data.subject||row.positionList||item.sourceDetails||item.articleName||data.financeEntityName||''),
      direction:row.value<0?'Расход':'Приход', price:quote.price==null?'':Number(quote.price), discount,
      quotedTotal:quote.quotedTotal==null?(data.settlement?.planTotal==null?'':Number(data.settlement.planTotal)):Number(quote.quotedTotal),
      amount:Math.abs(row.value), paymentDate:date, wallet:String(wallet.name||''),
      note:String(data.note||item.note||''), integrationSource:String(quote.integrationSource||data.integrationSource||'Приложение'),
      status:'Активна',
    };
  });
}

function choices(rows,key) {
  return [{value:'',label:'Без фильтра'},...[...new Set(rows.map(row=>row[key]).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,'ru',{numeric:true})).map(value=>({value,label:value}))];
}
function filterFields(rows, filters, dds = false) {
  const values = key => [{value:'',label:'Без фильтра'},...[...new Set(rows.flatMap(row=>row[key]||[]).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,'ru',{numeric:true})).map(value=>({value,label:value}))];
  return '<div class="form-grid">'
    +select({label:'Клиент / контрагент',name:'person',value:filters.person,options:choices(rows,'personFilter')})
    +select({label:'Рабочее пространство',name:'workplace',value:filters.workplace,options:choices(rows,'workplace')})
    +select({label:'Операция',name:'direction',value:filters.direction,options:[{value:'',label:'Без фильтра'},{value:'in',label:'Приход'},{value:'out',label:'Расход'},{value:'transfer',label:'Транзакция'}]})
    +(dds?select({label:'Кошелёк',name:'wallet',value:filters.wallet,options:values('wallets')}):'')
    +select({label:'Статья',name:'article',value:filters.article,options:values('articles')})
    +(dds?select({label:'Статус',name:'status',value:filters.status,options:choices(rows,'status')}):'')
    +'<div class="form-grid form-grid--two">'
    +datePicker({name:'from',label:'',placeholder:'С даты',value:filters.from,allowClear:true,modalSurface:'app'})
    +datePicker({name:'to',label:'',placeholder:'По дату',value:filters.to,allowClear:true,modalSurface:'app'})
    +'</div></div>';
}
function openFilters(anchor,rows,state,refresh,dds=false) {
  let draft={...state.filters};
  const popup=mountModal(anchor,modal(
    '<div data-people-filter-fields>'+filterFields(rows,draft,dds)+'</div>'
    +'<div class="modal-actions" data-people-filter-actions'+(Object.values(draft).some(Boolean)?'':' hidden')+'>'
    +button('Сбросить',{variant:'secondary',data:'data-people-filter-action'})+'</div>',
    {title:'Фильтр',variant:'x',surface:'app',className:'people-action-popup people-filter-popup'}));
  if(!popup)return;
  initDatePickers(popup);
  const actions=popup.querySelector('[data-people-filter-actions]');
  popup.addEventListener('change',event=>{
    const key=event.target?.name;
    if(!Object.prototype.hasOwnProperty.call(draft,key))return;
    draft[key]=String(event.target.value||'');
    const next={...draft};
    // Keep the last valid period while an invalid range is being edited.
    if(next.from&&next.to&&next.from>next.to){next.from=state.filters.from;next.to=state.filters.to;}
    state.filters=next;
    actions.hidden=!Object.values(draft).some(Boolean)&&!Object.values(next).some(Boolean);
    refresh();
  });
  popup.querySelector('[data-people-filter-action]')?.addEventListener('click',()=>{
    state.filters=dds?ddsFilters():emptyFilters();draft={...state.filters};
    const host=popup.querySelector('[data-people-filter-fields]');
    host.innerHTML=filterFields(rows,draft,dds);initDatePickers(host);
    actions.hidden=true;refresh();
  });
}
function openSort(anchor,state,refresh,dds=false) {
  const grouping=dds?sortGroupingSection([
    {label:'По статьям',checked:state.groupArticles,data:'data-dds-group-articles',aria:'Группировать по статьям'},
    {label:'По значениям',checked:state.groupValues,data:'data-dds-group-values',aria:'Группировать по значениям'}
  ]):'';
  const markup='<div class="people-action-menu">'+grouping+(dds?DDS_SORTS:WALLET_SORTS).map(([value,label])=>
    button(label,{variant:'secondary',data:'data-wallet-sort-choice="'+value+'" aria-pressed="'+(value===state.sort)+'"'})).join('')+'</div>';
  const popup=mountModal(anchor,modal(markup,{title:'Сортировка',variant:'x',surface:'app',xRole:'action',className:'people-action-popup people-sort-popup'}));
  if(dds)for(const [selector,key] of [['[data-dds-group-articles]','groupArticles'],['[data-dds-group-values]','groupValues']]){
    const control=popup?.querySelector(selector);
    control?.addEventListener('change',()=>{
      state[key]=control.checked;
      saveDDSGrouping(state);
      refresh();
    });
  }
  popup?.querySelectorAll('[data-wallet-sort-choice]').forEach(control=>control.addEventListener('click',()=>{
    state.sort=control.dataset.walletSortChoice;popup.v2Close?.();refresh();
  }));
}
const check=(data,aria,checked)=>'<label class="ui-compact-check">'+checkControl({data,aria,checked})+'</label>';
const walletCountMarkup='<output data-wallet-count aria-label="Количество операций" aria-live="polite"></output>';
export function walletHistoryBody(dds=false) {
  // DDS count belongs to H title accessory, exactly like Service.
  return '<section>'+(dds?'':'<div class="v2-desktop-tool-row"><div class="v2-desktop-tool-context"><span>'+walletCountMarkup+'</span></div>'
    +'<div class="v2-desktop-tool-actions"><span><output data-wallet-sum aria-label="Сумма операций" aria-live="polite"></output></span></div></div>')
    +'<div data-wallet-history-host></div></section>';
}
// Optional article hierarchy; preserve one row per document.
function applyDDSHierarchy(host,groups,collapsed){
 const body=host.querySelector('tbody');if(!body)return;
 const byId=new Map([...body.querySelectorAll('[data-finance-history-row]')].map(c=>[c.dataset.financeHistoryRow,c.closest('tr')]));
 const width=host.querySelector('thead tr')?.cells.length||body.rows[0]?.cells.length||1;
 const doc=body.ownerDocument,fragment=doc.createDocumentFragment(),disclosures=[];
 const append=(group,ancestors=[])=>{
  const id=JSON.stringify([group.level,...group.path]),tr=doc.createElement('tr');tr.dataset.tableGroupLevel=group.level;
  const td=doc.createElement('td');td.colSpan=width;
  const details=doc.createElement('details');details.className='dds-table-disclosure';details.open=!collapsed.has(id);
  const summary=doc.createElement('summary');summary.className='inventory-editor-summary';
  const marker=doc.createElement('span');marker.className='dds-group-marker';marker.setAttribute('aria-hidden','true');
  const label=doc.createElement('span');label.textContent=group.label;
  summary.append(marker,label);details.append(summary);td.append(details);tr.append(td);fragment.append(tr);
  const node={tr,details,marker,ancestors,leaves:[]};disclosures.push(node);
  if(group.children?.length)group.children.forEach(child=>append(child,[...ancestors,node]));
  else for(const row of group.rows){const member=byId.get(row.id);if(member){node.leaves.push(member);fragment.append(member);}}
  details.addEventListener('toggle',()=>{if(details.open)collapsed.delete(id);else collapsed.add(id);sync();});
 };
 const sync=()=>{for(const node of disclosures){
  const hidden=node.ancestors.some(parent=>!parent.details.open);
  node.tr.hidden=hidden;node.marker.textContent=node.details.open?'▾':'▸';
  for(const row of node.leaves)row.hidden=hidden||!node.details.open;
 }};
 groups.forEach(group=>append(group));body.append(fragment);sync();
}

export function bindWalletHistory(layer,wallet,rows,{open,settings,dds=false,actions=[]}) {
  const stateKey=dds?'ddsHistoryState':'walletHistoryState';
  const state=layer[stateKey] ||= {query:'',filters:dds?ddsFilters():emptyFilters(),sort:'dateDesc',...(dds?readDDSGrouping():{}),selected:new Set()};
  const tools=actions.filter(Boolean);
  if(!dds){state.filters={...emptyFilters(),...state.filters,title:''};state.sort=normalizeWalletSort(state.sort);}
  if(dds){state.collapsed ||= new Set();normalizeDDSView(state);state.filters.title='';if(state.filters.direction==='mixed')state.filters.direction='transfer';}
  const [toolbar]=setV2ZHeaderRows(layer,[
    '<section data-people-desktop-toolbar><div class="people-desktop-tools">'
    +field({name:'walletSearch',type:'search',placeholder:'Поиск',autocomplete:'off',value:state.query,data:'data-wallet-search'})
    +'<div class="people-desktop-actions people-desktop-query-tools">'
    +compactButton({kind:'filter',data:'data-wallet-filter title="Фильтр" aria-haspopup="dialog" aria-pressed="false"'})
    +compactButton({kind:'sort',data:'data-wallet-sort title="Сортировка" aria-haspopup="dialog" aria-pressed="false"'})
    +'</div><div class="people-desktop-actions people-desktop-actions--right">'
    +(dds?tools.map((action,index)=>button(action.label,{variant:'secondary',className:action.className||'',aria:action.aria||'',data:'data-dds-history-action="'+index+'" title="'+escapeHtml(action.aria||'')+'"'})).join('')
      :button(DATA_EXPORT_ICON,{variant:'secondary',className:'people-desktop-icon',data:'data-wallet-export title="Выгрузить в Excel"',aria:'Выгрузить в Excel'})
        +(settings?button('Удалить',{variant:'secondary',data:'data-wallet-settings',aria:'Удалить кассу'}):''))
    +'</div></div></section>',
  ],{desktopTitle:wallet.name,desktopAccessory:dds?walletCountMarkup:''});
  const host=layer.querySelector('[data-wallet-history-host]');
  if(!toolbar||!host)return;
  const search=toolbar.querySelector('[data-wallet-search]');
  if(search)search.value=state.query;
  const exportControl=toolbar.querySelector('[data-wallet-export]');
  const count=dds?layer.closest('[data-v2-z],[data-v2-z-layer]')?.querySelector(':scope > [data-v2-z-header] > [data-h-title-row] > [data-h-accessory] > [data-wallet-count]'):layer.querySelector('[data-wallet-count]');
  const total=layer.querySelector('[data-wallet-sum]');
  let visible=[],busy=false;
  const sync=()=>{
    const result=walletSelection(visible,state.selected);
    if(count)count.textContent=result.selectedCount?result.selectedCount+' / '+result.count:String(result.count);
    if(total)total.textContent=result.selectedCount?money(result.selectedTotal)+' / '+money(result.total):money(result.total);
    const all=host.querySelector('[data-wallet-select-all]');
    if(all){all.checked=result.count>0&&result.selectedCount===result.count;all.indeterminate=result.selectedCount>0&&!all.checked;}
    if(exportControl)exportControl.disabled=busy||!result.exportRows.length;
  };
  const refresh=()=>{
    const previousViewport=dds?host.querySelector('.ui-data-table--compact'):null;
    if(previousViewport){state.scrollLeft=previousViewport.scrollLeft;state.scrollTop=previousViewport.scrollTop;}
    const groupArticles=dds&&state.groupArticles,groupValues=dds&&state.groupValues;
    const grouped=groupArticles||groupValues;
    const canonical=rows.some(row=>row.canonicalArticle);
    visible=visibleWalletRows(rows,state.query,state.filters,'dateDesc');
    const mode=state.sort;
    visible=sortDDSRows(visible,mode,{wallets:mode==='wallet'?getWallets():[],workplaces:mode==='workplace'?getWorkplaces():[],people:mode==='person'?sortItems(getPeople(),getPeopleSortMode()):[]});
    let groups=[];
    if(grouped){
      groups=buildDDSGroups(visible,{groupArticles,groupValues,catalog:getFinanceArticleCatalog()||[],order:readArticleOrder()});
      visible=flattenDDSGroups(groups);
    }
    // Selection always refers to the current visible table, never hidden rows.
    const ids=new Set(visible.map(row=>row.id));
    for(const id of state.selected)if(!ids.has(id))state.selected.delete(id);
    toolbar.querySelector('[data-wallet-filter]')?.setAttribute('aria-pressed',String(Object.values(state.filters).some(Boolean)));
    toolbar.querySelector('[data-wallet-sort]')?.setAttribute('aria-pressed',String(state.sort!=='dateDesc'));
    host.innerHTML=visible.length?financeHistoryTable(visible,dds?'Все операции':'Операции кошелька',[
      {key:'select',label:'',narrow:true,header:()=>check('data-wallet-select-all','Выбрать все видимые операции',visible.every(row=>state.selected.has(row.id))),render:row=>check('data-wallet-select="'+escapeHtml(row.id)+'"','Выбрать операцию '+row.title,state.selected.has(row.id))},
      {key:'date',label:'Дата',narrow:true},{key:'title',label:'Операция',...(dds?{secondaryKey:'wallet',secondaryLabel:'Источник'}:{})},{key:'code',label:'Код',narrow:true},
      {key:'person',label:'Клиент / контрагент'},{key:'workplace',label:'Рабочее пространство',...(dds?{secondaryKey:'position',secondaryLabel:'Услуга / товар'}:{})},...(dds?(groupArticles&&groupValues?[]:groupArticles?(canonical?[{key:'article',label:'Значение',render:row=>escapeHtml(row.articleValue||'')}]:[]):groupValues?[{key:'article',label:'Статья'}]:[{key:'article',label:'Статья',articleValue:canonical}]):[{key:'article',label:'Статья',articleValue:canonical}]),{key:'amount',label:'Сумма',narrow:true},...(dds?[{key:'bonus',label:'Бонусы',narrow:true}]:[]),
    ]):emptyState(rows.length?'Операции не найдены':'Операций пока нет',rows.length?'Измените условия поиска или фильтрации.':(dds?'Финансовые операции появятся здесь.':'Движения по этой кассе появятся здесь.'));
    if(grouped&&visible.length)applyDDSHierarchy(host,groups,state.collapsed);
    if(dds){const viewport=host.querySelector('.ui-data-table--compact');if(viewport){viewport.scrollLeft=state.scrollLeft||0;viewport.scrollTop=state.scrollTop||0;}}
    host.querySelectorAll('[data-wallet-select]').forEach(control=>control.addEventListener('change',()=>{
      if(control.checked)state.selected.add(control.dataset.walletSelect);else state.selected.delete(control.dataset.walletSelect);sync();
    }));
    const all=host.querySelector('[data-wallet-select-all]');
    all?.addEventListener('change',()=>{
      visible.forEach(row=>all.checked?state.selected.add(row.id):state.selected.delete(row.id));
      host.querySelectorAll('[data-wallet-select]').forEach(control=>{control.checked=all.checked;});sync();
    });
    host.querySelectorAll('[data-finance-history-row]').forEach(control=>{
      (control.closest('tr')||control).addEventListener('click',event=>{
        if(event.target.closest('[data-table-column="select"]'))return;
        const row=visible.find(r=>r.id===control.dataset.financeHistoryRow);
        open(dds?control.dataset.financeHistoryRow:(row?.documentId||control.dataset.financeHistoryRow));
      });
    });
    sync();
  };
  search?.addEventListener('input',()=>{state.query=search.value;refresh();});
  toolbar.querySelector('[data-wallet-filter]')?.addEventListener('click',event=>{
    event.currentTarget.dataset.v2AnchorWidth='360';openFilters(event.currentTarget,rows,state,refresh,dds);
  });
  toolbar.querySelector('[data-wallet-sort]')?.addEventListener('click',event=>openSort(event.currentTarget,state,refresh,dds));
  toolbar.querySelectorAll('[data-dds-history-action]').forEach(control=>control.addEventListener('click',()=>{
    tools[Number(control.dataset.ddsHistoryAction)]?.run(control,walletSelection(visible,state.selected).exportRows);
  }));
  toolbar.querySelector('[data-wallet-settings]')?.addEventListener('click',()=>settings?.());
  exportControl?.addEventListener('click',()=>{
    if(busy)return;const result=walletSelection(visible,state.selected);
    if(!result.exportRows.length)return;
    openWalletExportConfirmation(layer,wallet,result.exportRows,{
      onBusy:value=>{busy=value;sync();},
    });
  });
  refresh();
}

export function openWalletExportConfirmation(root,wallet,rows,{onBusy=()=>{},exportWorkbook=exportScopedWorkbook}={}) {
  if(!rows.length)return null;
  const payload=walletExportRows(rows,wallet);
  const title='Выгрузка';
  const markup='<div class="modal-title"><h2>'+title+'</h2><p>Количество операций: '+rows.length+' · '+escapeHtml(money(sum(rows)))+'</p><p>Выгрузить в Excel?</p></div>'
    +'<div class="modal-actions">'
    +button('Отмена',{variant:'secondary',data:'data-wallet-export-cancel data-modal-autofocus'})
    +button('Выгрузить',{variant:'primary',data:'data-wallet-export-confirm'})
    +'</div>';
  const popup=mountModal(root,modal(markup,{title,variant:'x',surface:'app',className:'desktop-export-confirmation'}));
  if(!popup)return null;
  const confirm=popup.querySelector('[data-wallet-export-confirm]');
  const cancel=popup.querySelector('[data-wallet-export-cancel]');
  let pending=false;
  cancel?.addEventListener('click',()=>{if(!pending)popup.v2Close?.();});
  confirm?.addEventListener('click',async()=>{
    if(pending)return;
    pending=true;confirm.disabled=true;if(cancel)cancel.disabled=true;onBusy(true);
    try{await exportWorkbook('finance',payload);popup.v2Close?.();}
    catch(error){reportExcelError(error);}
    finally{pending=false;confirm.disabled=false;if(cancel)cancel.disabled=false;onBusy(false);}
  });
  return popup;
}
