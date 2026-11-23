import {
  button,datePicker,initDatePickers,initSegmentControls,modal,mountModal,openNotice,
  segmentControl,select,twoColumnLayout,
} from '../../../ui/ui.js';
import { getFinanceOperation } from '../data.js';
import { getRecord } from '../../record/index.js';
import { getWallets } from '../cash/data.js';
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
  const groups=new Map();
  for(const row of movements){
    const id=String(row?.operationId||'');
    if(!id||row?.operationKind==='cancel')continue;
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push(row);
  }
  return [...groups.values()].flatMap(lines=>{
    const first=lines[0];
    const operation=getFinanceOperation(first?.operationId);
    if(!operation||!NAMES[operation.kind])return [];
    // Deposit cash movements are transferred in the separate Deposit tool.
    const data=operation.data&&typeof operation.data==='object'?operation.data:{};
    const out=lines.find(item=>item.direction==='OUT')||first;
    const inbound=lines.find(item=>item.direction==='IN');
    const allocations=Array.isArray(data.allocations)?data.allocations:[];
    const main=allocations[0]||{};
    const record=operation.source?.type==='record'?getRecord(operation.source.id):null;
    return [{
      operationId:String(operation.operationId||''),
      occurredAt:String(operation.occurredAt||''),kind:NAMES[operation.kind],
      wallet:String(main.walletName||out.walletName||first.walletName||data.walletName||''),
      amount:Number(data.total)||Number(first.operationTotal)||lines.reduce((v,l)=>v+Number(l.amount||0),0),
      article:String(first.articleName||data.articleName||''),
      toWallet:operation.kind==='transfer'?String(inbound?.walletName||data.toWalletName||''):'',
      recordId:operation.source?.type==='record'?String(operation.source.id||''):'',
      phone:String(data.person?.phone||record?.person?.phone||''),
      recordDate:String(record?.date||''),recordFrom:String(record?.from||''),
      loan:operation.kind.startsWith('loan-')?String(data.financeEntityName||''):'',
      investment:operation.kind.startsWith('investment-')?String(data.financeEntityName||''):'',
      note:String(data.note||''),
      status:operation.status==='cancelled'?'Отменена':'Активна',
      tips:Number(data.tips||0),
      allocations:allocations.map(entry=>({
        wallet:String(entry.walletName||''),amount:Number(entry.amount||0),
      })),
      originalPayment:operation.kind==='refund'?String(operation.originalOperationId||''):'',
    }];
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
    &&(!wallet||row.wallet===wallet||row.toWallet===wallet));
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
