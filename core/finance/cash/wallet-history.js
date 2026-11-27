import {
  button, compactButton, datePicker, emptyState, escapeHtml, field,
  initDatePickers, modal, mountModal, select, setV2ZHeaderRows,
} from '../../../ui/ui.js';
import { checkControl } from '../../../ui/selection/check-list.js';
import { DATA_EXPORT_ICON } from '../../../ui/buttons/index.js';
import { financeHistoryTable, financeTableContact } from '../desktop.js';
import { getFinanceOperation } from '../data.js';
import { exportScopedWorkbook, reportExcelError } from '../../excel/scoped.js';

const SORTS = [
  ['dateDesc','Дата — сначала новые'], ['dateAsc','Дата — сначала ранние'],
  ['titleAsc','Операция — от А до Я'], ['titleDesc','Операция — от Я до А'],
  ['personAsc','Клиент / контрагент — от А до Я'], ['personDesc','Клиент / контрагент — от Я до А'],
  ['workplaceAsc','Рабочее пространство — от А до Я'], ['workplaceDesc','Рабочее пространство — от Я до А'],
  ['amountDesc','Сумма — по убыванию'], ['amountAsc','Сумма — по возрастанию'],
];
const emptyFilters = () => ({ title:'', workplace:'', person:'', direction:'', from:'', to:'' });
const money = value => new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(value) + ' ₽';
const clean = value => String(value ?? '').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/\s+/g,' ').trim();
const numeric = value => String(value ?? '').replace(/[^0-9]/g,'');
const sum = rows => rows.reduce((total,row)=>total+Math.round(row.value*100),0)/100;

function localDate(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '';
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}

export function walletHistoryRows(operations, people, { operationName, operationMoment }) {
  return operations.map(item => {
    const value = Number(item.total)||0;
    const occurredAt = String(item.occurredAt||'');
    const contact=financeTableContact(item,people);
    return { id:String(item.operationId), date:operationMoment(item), occurredAt, localDate:localDate(occurredAt),
      title:operationName(item), ...contact, personFilter:[contact.code,contact.person].filter(Boolean).join(' · '),
      workplace:String(item.workplace||''), amount:money(value), value, item };
  });
}

// Search all displayed columns and saved document facts. Numeric comparisons
// for amount/date sorting, not lexicographic formatted strings.
export function visibleWalletRows(rows, query='', filters=emptyFilters(), sort='dateDesc') {
  const words = clean(query).split(' ').filter(Boolean);
  const items = rows.filter(row => {
    const fullDate = row.localDate ? row.localDate.split('-').reverse().join('.') : '';
    const haystack=clean([row.date,row.localDate,fullDate,row.title,row.code,row.person,row.contact,row.workplace,row.amount,
      row.item?.sourceDetails,row.item?.articleName,row.item?.note,row.id].join(' '));
    if (!words.every(word=>haystack.includes(word) || (/^[+\d().-]+$/.test(word)&&numeric(word)&&
      [row.contact,row.date,fullDate,row.amount].map(numeric).some(value=>value.includes(numeric(word)))))) return false;
    return (!filters.title||row.title===filters.title)&&(!filters.workplace||row.workplace===filters.workplace)
      &&(!filters.person||row.personFilter===filters.person)
      &&(!filters.direction||(filters.direction==='in'?row.value>0:row.value<0))
      &&(!filters.from||(row.localDate&&row.localDate>=filters.from))
      &&(!filters.to||(row.localDate&&row.localDate<=filters.to));
  });
  const key=sort.replace(/Asc$|Desc$/,'');
  const direction=sort.endsWith('Desc')?-1:1;
  return items.sort((a,b)=>{
    const comparison=key==='amount'?a.value-b.value:key==='date'?
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
    const data=lookup(row.id)?.data||{};
    const quote=data.sourceQuote||{};
    const discount=quote.discountPercent!=null?String(quote.discountPercent)+'%':quote.discountMoney!=null?String(quote.discountMoney):'';
    const date=row.localDate||'';
    return {
      operationId:row.id, workplace:row.workplace, invoiceDate:String(quote.invoiceDate||date).slice(0,10),
      invoiceTime:String(quote.invoiceTime||row.date.split(' ')[1]||''),
      participantCode:row.code, participant:row.person, phone:row.contact,
      documentNumber:String(quote.documentNumber||data.documentNumber||row.id),
      purpose:row.title, subject:String(quote.subject||data.subject||item.sourceDetails||item.articleName||data.financeEntityName||''),
      direction:row.value<0?'Расход':'Приход', price:quote.price==null?'':Number(quote.price), discount,
      quotedTotal:quote.quotedTotal==null?'':Number(quote.quotedTotal),
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
function filterFields(rows, filters) {
  return '<div class="form-grid">'
    +select({label:'Операция',name:'title',value:filters.title,options:choices(rows,'title')})
    +select({label:'Клиент / контрагент',name:'person',value:filters.person,options:choices(rows,'personFilter')})
    +select({label:'Рабочее пространство',name:'workplace',value:filters.workplace,options:choices(rows,'workplace')})
    +select({label:'Движение',name:'direction',value:filters.direction,options:[{value:'',label:'Без фильтра'},{value:'in',label:'Приход'},{value:'out',label:'Расход'}]})
    +'<div class="form-grid form-grid--two">'
    +datePicker({name:'from',label:'',placeholder:'С даты',value:filters.from,allowClear:true,modalSurface:'app'})
    +datePicker({name:'to',label:'',placeholder:'По дату',value:filters.to,allowClear:true,modalSurface:'app'})
    +'</div></div>';
}
function openFilters(anchor,rows,state,refresh) {
  let draft={...state.filters};
  const popup=mountModal(anchor,modal(
    '<div data-people-filter-fields>'+filterFields(rows,draft)+'</div>'
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
    state.filters=emptyFilters();draft={...state.filters};
    const host=popup.querySelector('[data-people-filter-fields]');
    host.innerHTML=filterFields(rows,draft);initDatePickers(host);
    actions.hidden=true;refresh();
  });
}
function openSort(anchor,state,refresh) {
  const markup='<div class="people-action-menu">'+SORTS.map(([value,label])=>
    button(label,{variant:'secondary',data:'data-wallet-sort-choice="'+value+'" aria-pressed="'+(value===state.sort)+'"'})).join('')+'</div>';
  const popup=mountModal(anchor,modal(markup,{title:'Сортировка',variant:'x',surface:'app',xRole:'action',className:'people-action-popup people-sort-popup'}));
  popup?.querySelectorAll('[data-wallet-sort-choice]').forEach(control=>control.addEventListener('click',()=>{
    state.sort=control.dataset.walletSortChoice;popup.v2Close?.();refresh();
  }));
}
const check=(data,aria,checked)=>'<label class="ui-compact-check">'+checkControl({data,aria,checked})+'</label>';
export function walletHistoryBody() {
  // Regular text, not the 30px H title/accessory counter.
  return '<section><div class="v2-desktop-tool-row"><div class="v2-desktop-tool-context"><span><output data-wallet-count aria-label="Количество операций" aria-live="polite"></output></span></div>'
    +'<div class="v2-desktop-tool-actions"><span><output data-wallet-sum aria-label="Сумма операций" aria-live="polite"></output></span></div></div>'
    +'<div data-wallet-history-host></div></section>';
}
export function bindWalletHistory(layer,wallet,rows,{open,settings}) {
  const state=layer.walletHistoryState ||= {query:'',filters:emptyFilters(),sort:'dateDesc',selected:new Set()};
  const [toolbar]=setV2ZHeaderRows(layer,[
    '<section data-people-desktop-toolbar><div class="people-desktop-tools">'
    +field({name:'walletSearch',type:'search',placeholder:'Поиск',autocomplete:'off',value:state.query,data:'data-wallet-search'})
    +'<div class="people-desktop-actions people-desktop-query-tools">'
    +compactButton({kind:'filter',data:'data-wallet-filter title="Фильтр" aria-haspopup="dialog" aria-pressed="false"'})
    +compactButton({kind:'sort',data:'data-wallet-sort title="Сортировка" aria-haspopup="dialog" aria-pressed="false"'})
    +'</div><div class="people-desktop-actions people-desktop-actions--right">'
    +button(DATA_EXPORT_ICON,{variant:'secondary',className:'people-desktop-icon',data:'data-wallet-export title="Выгрузить в Excel"',aria:'Выгрузить в Excel'})
    +(settings?button('Удалить',{variant:'secondary',data:'data-wallet-settings',aria:'Удалить кассу'}):'')
    +'</div></div></section>',
  ],{desktopTitle:wallet.name});
  const host=layer.querySelector('[data-wallet-history-host]');
  if(!toolbar||!host)return;
  const search=toolbar.querySelector('[data-wallet-search]');
  if(search)search.value=state.query;
  const exportControl=toolbar.querySelector('[data-wallet-export]');
  const count=layer.querySelector('[data-wallet-count]');
  const total=layer.querySelector('[data-wallet-sum]');
  let visible=[],busy=false;
  const sync=()=>{
    const result=walletSelection(visible,state.selected);
    count.textContent=result.selectedCount?result.selectedCount+' / '+result.count:String(result.count);
    total.textContent=result.selectedCount?money(result.selectedTotal)+' / '+money(result.total):money(result.total);
    const all=host.querySelector('[data-wallet-select-all]');
    if(all){all.checked=result.count>0&&result.selectedCount===result.count;all.indeterminate=result.selectedCount>0&&!all.checked;}
    exportControl.disabled=busy||!result.exportRows.length;
  };
  const refresh=()=>{
    visible=visibleWalletRows(rows,state.query,state.filters,state.sort);
    // Selection always refers to the current visible table, never hidden rows.
    const ids=new Set(visible.map(row=>row.id));
    for(const id of state.selected)if(!ids.has(id))state.selected.delete(id);
    toolbar.querySelector('[data-wallet-filter]')?.setAttribute('aria-pressed',String(Object.values(state.filters).some(Boolean)));
    toolbar.querySelector('[data-wallet-sort]')?.setAttribute('aria-pressed',String(state.sort!=='dateDesc'));
    host.innerHTML=visible.length?financeHistoryTable(visible,'Операции кошелька',[
      {key:'select',label:'',narrow:true,header:()=>check('data-wallet-select-all','Выбрать все видимые операции',visible.every(row=>state.selected.has(row.id))),render:row=>check('data-wallet-select="'+escapeHtml(row.id)+'"','Выбрать операцию '+row.title,state.selected.has(row.id))},
      {key:'date',label:'Дата',narrow:true},{key:'title',label:'Операция'},{key:'code',label:'Код',narrow:true},
      {key:'person',label:'Клиент / контрагент'},{key:'workplace',label:'Рабочее пространство'},{key:'amount',label:'Сумма',narrow:true},
    ]):emptyState(rows.length?'Операции не найдены':'Операций пока нет',rows.length?'Измените условия поиска или фильтрации.':'Движения по этой кассе появятся здесь.');
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
        open(control.dataset.financeHistoryRow);
      });
    });
    sync();
  };
  search?.addEventListener('input',()=>{state.query=search.value;refresh();});
  toolbar.querySelector('[data-wallet-filter]')?.addEventListener('click',event=>{
    event.currentTarget.dataset.v2AnchorWidth='360';openFilters(event.currentTarget,rows,state,refresh);
  });
  toolbar.querySelector('[data-wallet-sort]')?.addEventListener('click',event=>openSort(event.currentTarget,state,refresh));
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
    +button('Выгрузить',{variant:'secondary',data:'data-wallet-export-confirm'})
    +button('Отмена',{variant:'secondary',data:'data-wallet-export-cancel data-modal-autofocus',className:'v2-confirmation-safe'})
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
