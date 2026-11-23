import {
  button, datePicker, initDatePickers, modal, mountModal, openNotice,
  segmentControl, initSegmentControls, select, twoColumnLayout,
} from '../ui/ui.js';
import { getRecordsInRange, getRecordEvents, recordActionState, recordVisitState, refreshRecordsFromServer } from '../core/record/index.js';
import { getRecordPaymentState } from '../core/finance/index.js';
import { getWorkplaces } from '../core/workplace-time.js';
import { getPeople } from '../core/people/data.js';
import { chooseScopedImport, exportScopedCsv, exportScopedWorkbook, reportExcelError } from '../core/excel/scoped.js';

const actionLabels={booked:'Записался',rescheduled:'Перенёс',cancelled:'Отменил'};
const visitLabels={expected:'Ожидает',arrived:'Пришёл','no-show':'Не пришёл'};
const sourceLabels=new Set(['online-booking','account-journal','public-booking','user']);
function stateFor(record){
  const events=getRecordEvents(record.id);
  const action=recordActionState(record,events);
  const visit=recordVisitState(record,events);
  const payment=getRecordPaymentState(record);
  const paymentStatus=payment.fullyPaid?'Оплачено':payment.partiallyPaid?'Частично'
    :(!payment.hasPayments && record.historicalPaymentStatus)||'Не оплачено';
  return {action,visit,payment:paymentStatus};
}
function getRows(from,to,{action='',visit='',payment='',workplaceId=''}={}){
  const catalog=getWorkplaces();
  const persons=new Map(getPeople().map(person=>[String(person.key),person]));
  return getRecordsInRange({from,to,workplaceId}).flatMap(record=>{
    const status=stateFor(record);
    if(action&&status.action!==action)return [];
    if(visit&&status.visit!==visit)return [];
    if(payment&&status.payment!==payment)return [];
    const owner=persons.get(String(record.person?.key||''))||{};
    const place=catalog.find(w=>String(w.key)===String(record.workplaceId));
    return [{
      recordId:String(record.id||''),name:String(record.person?.name||''),
      surname:String(record.person?.surname||''),phone:String(record.person?.phone||owner.phones?.[0]||''),
      uei:String(owner.uei||''),date:String(record.date||''),
      from:String(record.from||''),to:String(record.to||''),
      workplace:String(place?.name||''),bookedBy:sourceLabels.has(String(record.source||''))?'Самостоятельно':'Профессионал',
      actionStatus:actionLabels[status.action]||'Записался',
      visitStatus:visitLabels[status.visit]||'',
      paymentStatus:status.payment,createdAt:String(record.createdAt||''),
      services:(Array.isArray(record.procedures)?record.procedures:[]).map(service=>({
        name:String(service.name||''),cost:service.cost??service.price??'',
        duration:service.duration??'',
      })),
    }];
  });
}
function openJournalExport(root){
  const places=getWorkplaces();
  const markup='<form class="form-grid" data-journal-excel-export>'
    +twoColumnLayout(
      datePicker({label:'С',name:'from',required:true,allowClear:false,showYear:true}),
      datePicker({label:'По',name:'to',required:true,allowClear:false,showYear:true}),
      {ariaLabel:'Период выгрузки'})
    +select({label:'Запись',name:'action',value:'',options:[
      {value:'',label:'Все'},...Object.entries(actionLabels).map(([value,label])=>({value,label})),
    ]})
    +select({label:'Посещение',name:'visit',value:'',options:[
      {value:'',label:'Все'},...Object.entries(visitLabels).map(([value,label])=>({value,label})),
    ]})
    +select({label:'Оплата',name:'payment',value:'',options:[
      {value:'',label:'Все'},
      {value:'Не оплачено',label:'Не оплачено'},
      {value:'Частично',label:'Частично'},
      {value:'Оплачено',label:'Оплачено'},
    ]})
    +select({label:'Рабочее пространство',name:'workplaceId',value:'',options:[
      {value:'',label:'Все'},...places.map(p=>({value:p.key,label:p.name})),
    ]})
    +segmentControl([{value:'xlsx',label:'Excel'},{value:'csv',label:'CSV'}],
      {name:'format',value:'xlsx',aria:'Формат выгрузки'})
    +button('Выгрузить',{type:'submit'})
    +'</form>';
  const layer=mountModal(root,modal(markup,{
    title:'Выгрузка',variant:'q',surface:'app',
  }));
  if(!layer)return;
  initDatePickers(layer);initSegmentControls(layer);
  const form=layer.querySelector('[data-journal-excel-export]');
  let running=false;
  form?.addEventListener('submit',async event=>{
    event.preventDefault();
    if(running)return;
    const data=new FormData(form);
    const from=String(data.get('from')||''),to=String(data.get('to')||'');
    if(!from||!to){openNotice({title:'Выгрузка',message:'Выберите период «С — По»'});return;}
    if(from>to){openNotice({title:'Выгрузка',message:'Дата «С» не может быть позже «По»'});return;}
    running=true;
    const submit=form.querySelector('button[type="submit"]');
    if(submit)submit.disabled=true;
    try{
      const rows=getRows(from,to,{
        action:String(data.get('action')||''),
        visit:String(data.get('visit')||''),
        payment:String(data.get('payment')||''),
        workplaceId:String(data.get('workplaceId')||''),
      });
      if(String(data.get('format'))==='csv')exportScopedCsv('records',rows);
      else await exportScopedWorkbook('records',rows);
      layer.v2Close?.();
    }catch(error){reportExcelError(error);}
    finally{running=false;if(submit)submit.disabled=false;}
  });
}
export function openJournalExcel(root,{onImported=()=>{}}={}){
  const actions=[
    {key:'export',name:'Выгрузка',run:()=>openJournalExport(root)},
    {key:'import',name:'Загрузка',run:()=>chooseScopedImport(root,'records',{
      onImported:async()=>{await refreshRecordsFromServer();await onImported();},
    })},
    {key:'template',name:'Шаблон',run:()=>exportScopedWorkbook('records',[],{template:true})},
  ];
  const layer=mountModal(root,modal('<div class="modal-actions">'
    +actions.map(item=>button(item.name,{variant:'secondary',data:'data-journal-excel-'+item.key})).join('')
    +'</div>',{title:'Excel',variant:'x',surface:'app',xRole:'action'}));
  if(!layer)return;
  actions.forEach(item=>layer.querySelector('[data-journal-excel-'+item.key+']')?.addEventListener('click',()=>{
    layer.v2Close?.();
    try{Promise.resolve(item.run()).catch(reportExcelError);}
    catch(error){reportExcelError(error);}
  }));
}
