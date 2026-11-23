import {
  button, datePicker, initDatePickers, modal, mountModal, openNotice,
  segmentControl, initSegmentControls, select, twoColumnLayout,
} from '../ui/ui.js';
import { getRecordsInRange, getRecordEvents, recordActionState, recordVisitState, refreshRecordsFromServer } from '../core/record/index.js';
import { getRecordPaymentState } from '../core/finance/index.js';
import { getWorkplaces } from '../core/workplace-time.js';
import { getPeople } from '../core/people/data.js';
import { getProfile } from '../core/profile/data.js';
import { resolveRecordSettlement } from '../core/finance/settlement.js';
import { chooseScopedImport, exportScopedCsv, exportScopedWorkbook, reportExcelError } from '../core/excel/scoped.js';

const actionLabels={booked:'Записался',rescheduled:'Перенёс',cancelled:'Отменил',deleted:'Удалена'};
const visitLabels={expected:'Ожидает',arrived:'Пришёл','no-show':'Не пришёл'};
const onlineSources=new Set(['online-booking','account-journal','public-booking','user']);
const integrationLabels={
  'online-booking':'Онлайн-запись','public-booking':'Онлайн-запись',
  'account-journal':'Приложение','user':'Приложение',
  'journal':'Журнал','manual':'Журнал',
};
function stateFor(record,events){
  const action=recordActionState(record,events);
  const visit=recordVisitState(record,events);
  const payment=getRecordPaymentState(record);
  const paymentStatus=payment.fullyPaid?'Оплачено':payment.partiallyPaid?'Частично'
    :(!payment.hasPayments && record.historicalPaymentStatus)||'Не оплачено';
  return {action,visit,payment:paymentStatus};
}
function splitMoment(value,timeZone=''){
  const date=new Date(String(value||''));
  if(!Number.isFinite(date.getTime()))return {date:'',time:''};
  const parts=new Intl.DateTimeFormat('ru-RU',{
    timeZone:timeZone||'UTC',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  }).formatToParts(date);
  const key=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return {date:[key.year,key.month,key.day].join('-'),time:key.hour+':'+key.minute};
}
function actorName(actor,record,person,profile){
  const name=String(actor?.name||actor?.displayName||'').trim();
  if(name)return name;
  const profileId=String(actor?.profileId||'');
  const accountId=String(actor?.accountId||'');
  if(profile && (profileId && [profile.id,profile.key].includes(profileId)
    || accountId && accountId===profile.platformAccountId))
    return [profile.name,profile.surname].filter(Boolean).join(' ');
  if(accountId && Array.isArray(person.accounts) && person.accounts.includes(accountId))
    return [person.name,person.surname].filter(Boolean).join(' ');
  return String(record?.historicalCreatorName||'');
}
function quotedServicesTotal(record){
  if(record?.historicalQuotedTotal!==undefined && record?.historicalQuotedTotal!==null
    && record?.historicalQuotedTotal!=='')return Number(record.historicalQuotedTotal);
  const settlement=resolveRecordSettlement(record);
  return (Array.isArray(settlement?.items)?settlement.items:[])
    .filter(item=>item.sourceType==='procedure')
    .reduce((sum,item)=>sum+Math.max(0,Number(item.planAmount)||0),0);
}
function getRows(from,to,{action='',visit='',payment='',workplaceId=''}={}){
  const catalog=getWorkplaces();
  const persons=new Map(getPeople().map(person=>[String(person.key),person]));
  const profile=getProfile();
  return getRecordsInRange({from,to,workplaceId}).flatMap(record=>{
    const events=getRecordEvents(record.id);
    const status=stateFor(record,events);
    const actionForExport=record.historicalAction==='Удалена'?'deleted':status.action;
    if(action&&actionForExport!==action)return [];
    if(visit&&status.visit!==visit)return [];
    if(payment&&status.payment!==payment)return [];
    const owner=persons.get(String(record.person?.key||''))||{};
    const place=catalog.find(w=>String(w.key)===String(record.workplaceId));
    const timezone=String(place?.timeZone||'');
    const createdEvent=events.find(event=>event.type==='created');
    const created=splitMoment(record.createdAt||createdEvent?.at,timezone);
    const changedEvent=[...events].reverse().find(event=>
      event.type==='cancelled'||event.type==='rescheduled');
    const changed=splitMoment(changedEvent?.at,timezone);
    const actionStatus=actionLabels[actionForExport]||'Записался';
    const creator=String(record.historicalCreatorName||'')
      ||actorName(record.createdBy||createdEvent?.actor,record,owner,profile);
    const changer=String(record.historicalChangedBy||'')
      ||(changedEvent?actorName(changedEvent.actor,{},owner,profile):'');
    return [{
      recordId:String(record.id||''),
      workplace:String(place?.name||''),
      uei:String(record.person?.uei||owner.uei||''),
      name:String(record.person?.name||owner.name||''),
      surname:String(record.person?.surname||owner.surname||''),
      phone:String(record.person?.phone||owner.phones?.[0]||''),
      email:String(record.person?.email||owner.emails?.[0]||''),
      date:String(record.date||''),from:String(record.from||''),to:String(record.to||''),
      creatorName:creator,
      createdDate:String(record.historicalCreatedDate||created.date||''),
      createdTime:String(record.historicalCreatedTime||created.time||''),
      actionStatus,changedBy:changer,
      changedDate:String(record.historicalChangedDate||changed.date||''),
      changedTime:String(record.historicalChangedTime||changed.time||''),
      services:(Array.isArray(record.procedures)?record.procedures:[]).map(item=>({
        name:String(item.name||''),
      })),
      quotedTotal:quotedServicesTotal(record),
      visitStatus:visitLabels[status.visit]||'',
      paymentStatus:status.payment,
      paidFull:status.payment==='Оплачено'?'Да':'Нет',
      comment:String(record.historicalComment||record.comment||''),
      integrationSource:String(record.historicalIntegrationSource
        ||integrationLabels[String(record.source||'')]||record.source||''),
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
