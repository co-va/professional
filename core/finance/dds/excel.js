import {
  button,datePicker,initDatePickers,initSegmentControls,modal,mountModal,
  segmentControl,select,twoColumnLayout,
} from '../../../ui/ui.js';
import { getFinanceOperation } from '../data.js';
import { getRecord } from '../../record/index.js';
import { getWallets } from '../cash/data.js';
import { getWorkplaces } from '../../workplace-time.js';
import { refreshFinanceState } from '../service.js';
import { chooseScopedImport,exportScopedCsv,exportScopedWorkbook,reportExcelError } from '../../excel/scoped.js';

const NAMES={
  'manual-income':'Доход','manual-expense':'Расход',transfer:'Перевод',
  payment:'Оплата услуги',refund:'Возврат оплаты',
  'loan-received':'Получение займа','loan-repayment':'Возврат займа',
  'investment-received':'Получение инвестиций',
  'investment-return':'Возврат инвестиций',
  'investment-contribution':'Вклад в инвестицию',
  'investment-capital-return':'Возврат капитала',
  'investment-income':'Доход инвестиции',
  'investment-expense':'Расход инвестиции',
  'investment-income-payment':'Выплата дохода инвестору',
};
function kindGroup(entry){
  if(entry.kind==='Перевод')return 'transfer';
  if(entry.kind.includes('займ'))return 'loan';
  if(entry.kind.includes('инвестиц'))return 'investment';
  if(entry.kind==='Расход'||entry.kind==='Возврат оплаты')return 'expense';
  return 'income';
}
export function ddsExportRows(movements){
  const grouped=new Map();
  for(const movement of movements){
    const id=String(movement?.operationId||'');
    if(!id||movement?.operationKind==='cancel')continue;
    if(!grouped.has(id))grouped.set(id,[]);
    grouped.get(id).push(movement);
  }
  return [...grouped.values()].flatMap(lines=>{
    const operation=getFinanceOperation(lines[0]?.operationId);
    if(!operation||!NAMES[operation.kind]||operation.status==='cancelled')return [];
    const data=operation.data&&typeof operation.data==='object'?operation.data:{};
    const quote=data.sourceQuote&&typeof data.sourceQuote==='object'?data.sourceQuote:data;
    const record=operation.source?.type==='record'?getRecord(operation.source.id):null;
    const allocations=Array.isArray(data.allocations)?data.allocations:[];
    // Two wallets are two visible Finance rows. Do not multiply the invoice.
    const walletRows=allocations.length
      ?allocations.map(item=>({wallet:String(item.walletName||''),amount:Number(item.amount||0),direction:'Приход'}))
      :[...lines.reduce((map,movement)=>{
        const wallet=String(movement.walletName||data.walletName||'');
        const direction=movement.direction==='OUT'?'Расход':'Приход';
        const key=direction+'|'+wallet;
        const row=map.get(key)||{wallet,amount:0,direction};
        row.amount+=Number(movement.amount||0);
        map.set(key,row);
        return map;
      },new Map()).values()];
    const person=data.person&&typeof data.person==='object'?data.person:record?.person||{};
    const participant=[person.name,person.surname].filter(Boolean).join(' ')
      ||String(data.participant||data.counterpartyName||'');
    const type=String(quote.purpose||NAMES[operation.kind]||'');
    const subject=String(quote.subject||data.subject||data.financeEntityName
      ||lines[0]?.articleName||data.articleName||'');
    const invoiceDate=String(quote.invoiceDate||record?.date||operation.occurredAt||'').slice(0,10);
    const placeId=String(record?.workplaceId||data.workplace||'');
    const place=getWorkplaces().find(w=>String(w.key)===placeId);
    const quotedTotal=quote.quotedTotal==null?'':Number(quote.quotedTotal);
    const discount=quote.discountPercent!=null?String(quote.discountPercent)+'%'
      :quote.discountMoney!=null?String(quote.discountMoney):'';
    return walletRows.filter(row=>row.amount>0).map(item=>({
      operationId:String(operation.operationId||''),
      kind:NAMES[operation.kind],
      occurredAt:String(operation.occurredAt||''),
      workplace:String(data.workplaceName||place?.name||data.workplace||''),
      invoiceDate,invoiceTime:String(quote.invoiceTime||record?.from||''),
      participantCode:String(person.uei||data.uei||''),
      participant,phone:String(person.phone||record?.person?.phone||data.phone||''),
      documentNumber:String(quote.documentNumber||data.documentNumber||operation.operationId||''),
      purpose:type,subject,
      direction:item.direction,
      price:quote.price==null?'':Number(quote.price),discount,
      quotedTotal,amount:item.amount,
      paymentDate:String(operation.occurredAt||'').slice(0,10),
      wallet:item.wallet,
      note:String(data.note||''),
      integrationSource:String(quote.integrationSource||data.integrationSource||'Приложение'),
      status:'Активна',
    }));
  });
}
function filteredRows(movements,form){
  const data=new FormData(form);
  const from=String(data.get('from')||''),to=String(data.get('to')||'');
  if(from&&to&&from>to)throw new Error('Дата «С» не может быть позже «По»');
  const status=String(data.get('status')||'');
  const kind=String(data.get('kind')||'');
  const wallet=String(data.get('wallet')||'');
  return ddsExportRows(movements).filter(row=>
    (!from||row.occurredAt.slice(0,10)>=from)
    &&(!to||row.occurredAt.slice(0,10)<=to)
    &&(!status||row.status===status)
    &&(!kind||kindGroup(row)===kind)
    &&(!wallet||row.wallet===wallet));
}
function exportQ(root,movements){
  const wallets=getWallets().map(wallet=>({value:String(wallet.name||''),label:String(wallet.name||'')}));
  const form='<form class="form-grid" data-dds-excel-export>'
    +twoColumnLayout(datePicker({label:'С',name:'from',showYear:true}),
      datePicker({label:'По',name:'to',showYear:true}),{ariaLabel:'Период'})
    +select({label:'Операции',name:'kind',value:'',options:[
      {value:'',label:'Все'},...[
        ['income','Доходы'],['expense','Расходы'],['loan','Займы'],
        ['investment','Инвестиции'],['transfer','Переводы'],
      ].map(([value,label])=>({value,label})),
    ]})
    +select({label:'Кошелёк',name:'wallet',value:'',options:[{value:'',label:'Все'},...wallets]})
    +select({label:'Статус',name:'status',value:'',options:[
      {value:'',label:'Все'},{value:'Активна',label:'Активные'},
      {value:'Отменена',label:'Отменённые'},
    ]})
    +segmentControl([{value:'xlsx',label:'Excel'},{value:'csv',label:'CSV'}],
      {name:'format',value:'xlsx',aria:'Формат выгрузки'})
    +button('Выгрузить',{type:'submit'})+'</form>';
  const layer=mountModal(root,modal(form,{title:'Выгрузка',variant:'q',surface:'app'}));
  if(!layer)return;
  initDatePickers(layer);initSegmentControls(layer);
  const node=layer.querySelector('[data-dds-excel-export]');
  let busy=false;
  node?.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy)return;
    busy=true;
    const submit=node.querySelector('button[type="submit"]');
    if(submit)submit.disabled=true;
    try{
      const rows=filteredRows(movements,node);
      const fmt=String(new FormData(node).get('format')||'xlsx');
      if(fmt==='csv')exportScopedCsv('finance',rows);
      else await exportScopedWorkbook('finance',rows);
      layer.v2Close?.();
    }catch(error){reportExcelError(error);}
    finally{busy=false;if(submit)submit.disabled=false;}
  });
}
export function openDDSExcel(root,movements,{onImported=()=>{}}={}){
  const actions=[
    {key:'export',label:'Выгрузка',run:()=>exportQ(root,movements)},
    {key:'import',label:'Загрузка',run:()=>chooseScopedImport(root,'finance',{
      onImported:async()=>{await refreshFinanceState();await onImported();},
    })},
    {key:'template',label:'Шаблон',run:()=>exportScopedWorkbook('finance',[],{template:true})},
  ];
  const layer=mountModal(root,modal('<div class="modal-actions">'
    +actions.map(item=>button(item.label,{variant:'secondary',data:'data-dds-excel-'+item.key})).join('')
    +'</div>',{title:'Excel',variant:'x',surface:'app',xRole:'action'}));
  if(!layer)return;
  actions.forEach(item=>layer.querySelector('[data-dds-excel-'+item.key+']')?.addEventListener('click',()=>{
    layer.v2Close?.();
    try{Promise.resolve(item.run()).catch(reportExcelError);}
    catch(error){reportExcelError(error);}
  }));
}
