import {
  button, escapeHtml, modal, mountModal, openNotice, selectFile,
  v2ListEntries, v2ListEntry, v2Section,
} from '../../ui/ui.js';
import { apiRequest } from '../auth.js';

export function excelError(error) {
  const raw=error instanceof Error ? String(error.message||''):'';
  return raw && !/HTTP|fetch|network|404|50\d|JSON|API|Failed to|Prisma|SQL|P20\d|transaction|sourceKey|tenantId|stack|undefined|constraint|database|Internal Server|ID переноса|CO-VA|JSON|payload|endpoint|UUID/i.test(raw)
    ? raw : 'Не удалось обработать файл. Проверьте таблицу и повторите.';
}
export function reportExcelError(error) {
  openNotice({title:'Excel',message:excelError(error)});
}
async function post(path,body) {
  const res=await apiRequest('/data-transfer/'+path,{method:'POST',body:JSON.stringify(body)});
  if (!res.ok){
    const result=await res.json().catch(()=>({}));
    const reason=Array.isArray(result.message)?result.message[0]:result.message;
    throw new Error(typeof reason==='string'&&reason.length<240?reason:'Не удалось обработать файл');
  }
  return res;
}
function download(blob,filename){
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function exportScopedWorkbook(domain,rows,{template=false}={}){
  const response=await post('table',{domain,rows,template});
  const title=domain==='records'?'Записи':'Финансы';
  download(await response.blob(),template?title+'-шаблон.xlsx':title+'.xlsx');
}
// CSV cannot merge group headers. It retains the exact XLSX column order.
const RECORD_LABELS=[
  ['workplace','Рабочее пространство'],
  ['uei','Код клиента'],['name','Имя'],['surname','Фамилия'],
  ['phone','Телефон'],['email','Email'],
  ['date','Дата визита'],['from','Время визита'],['to','Время окончания'],
  ['creatorName','Имя'],['createdDate','Дата'],
  ['createdTime','Время'],
  ['actionStatus','Статус'],['changedBy','Имя'],
  ['changedDate','Дата'],['changedTime','Время'],
];
const RECORD_END_LABELS=[
  ['quotedTotal','Стоимость'],['visitStatus','Статус посещения'],
  ['paymentStatus','Статус оплаты'],
  ['comment','Комментарий'],['integrationSource','Источник интеграции'],
  ['recordId','ID записи'],
];
const FINANCE_LABELS=[
  ['workplace','Рабочее пространство'],['invoiceDate','Дата счёта'],['invoiceTime','Время'],
  ['participantCode','Код'],['participant','Имя / название'],['phone','Телефон'],
  ['documentNumber','Номер документа'],['purpose','Назначение'],
  ['subject','Наименование'],['direction','Движение'],
  ['price','Цена'],['discount','Скидка'],['quotedTotal','К оплате'],
  ['amount','Оплачено'],['paymentDate','Дата оплаты'],['wallet','Кошелёк'],
  ['note','Комментарий'],['integrationSource','Источник интеграции'],
];
function csvCell(value){
  let s=String(value??'').replaceAll('\0','');
  if(/^[\s]*[=+\-@]/.test(s))s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
export function buildScopedCsv(domain,rows){
  let labels=domain==='records'?[...RECORD_LABELS]:[...FINANCE_LABELS];
  if(domain==='records'){
    const count=Math.max(1,...rows.map(r=>r.services?.length||0));
    for(let i=1;i<=count;i++)labels.push(['service'+i,'Услуга '+i]);
    labels.push(...RECORD_END_LABELS);
  }
  const fields=rows.map(row=>{
    const data={...row};
    if(domain==='records')row.services?.forEach((item,i)=>{
      data['service'+(i+1)]=item.name;
    });
    return labels.map(([key])=>data[key]??'');
  });
  return '\uFEFF'+[labels.map(([,label])=>label),...fields]
    .map(line=>line.map(csvCell).join(';')).join('\r\n');
}
export function exportScopedCsv(domain,rows){
  download(new Blob([buildScopedCsv(domain,rows)],{type:'text/csv;charset=utf-8'}),
    (domain==='records'?'Записи':'Финансы')+'.csv');
}
function previewHtml(preview){
  const saved=Number(preview.transferred||0),unchanged=Number(preview.unchanged||0),errors=Number(preview.failed||0);
  const line='К загрузке: '+saved+(unchanged?' · Уже есть: '+unchanged:'')+(errors?' · Ошибок: '+errors:'');
  const issues=(preview.rows||[]).filter(row=>row.reason).slice(0,25).map(row=>{
    let detail=String(row.reason||'');
    if(/SQL|Prisma|P20\d|sourceKey|tenantId|stack|undefined|constraint|database|transaction|ID переноса|CO-VA|JSON|payload|endpoint|UUID/i.test(detail))
      detail='Проверьте сведения в строке';
    return v2ListEntry({title:'Строка '+String(row.row||'—'),subtitle:detail,interactive:false});
  });
  return v2Section('Результат загрузки','<div>'+escapeHtml(line)+'</div>')
    +(issues.length?v2Section('Что исправить',v2ListEntries(issues)):'');
}
export async function chooseScopedImport(root,domain,{onImported=()=>{}}={}){
  // The native picker must open directly from a tap, including on iPhone.
  const file=await selectFile({accept:'.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'});
  if(!file)return;
  const name=String(file.name||'');
  if(!/\.(xlsx|csv)$/i.test(name)||Number(file.size)>25*1024*1024)
    throw new Error('Выберите Excel или CSV размером до 25 МБ');
  const input={
    filename:name,dataUrl:file.dataUrl,source:domain==='records'?'Журнал':'ДДС',
    strict:true,expectedDomain:domain,
  };
  const layer=mountModal(root,modal('<div class="form-grid">'
    +'<div>'+escapeHtml(name)+'</div>'
    +'<div data-scoped-excel-preview aria-live="polite">Читаем файл…</div>'
    +'</div>',{title:'Загрузка',variant:'q',surface:'app'}));
  if(!layer)return;
  const host=layer.querySelector('[data-scoped-excel-preview]');
  let previewReady=false,saving=false;
  async function previewFile(){
    previewReady=false;
    if(host)host.textContent='Читаем файл…';
    try{
      const res=await post('check',input);
      const data=await res.json();
      if(!layer.isConnected)return;
      previewReady=!data.failed&&Number(data.transferred)>0;
      host.innerHTML=previewHtml(data)
        +(previewReady?button('Загрузить',{type:'button',data:'data-scoped-excel-apply'}):'');
      if(!previewReady&&!data.failed&&!data.transferred)
        host.insertAdjacentHTML('beforeend','<div>Новых сведений нет.</div>');
    }catch(error){if(host&&layer.isConnected)host.textContent=excelError(error);}
  }
  host?.addEventListener('click',async event=>{
    const btn=event.target?.closest?.('[data-scoped-excel-apply]');
    if(!btn||!previewReady||saving)return;
    saving=true;previewReady=false;btn.disabled=true;
    try{
      const res=await post('commit',input);
      const result=await res.json();
      await onImported();
      layer.v2Close?.();
      openNotice({title:'Excel',message:'Загружено: '+Number(result.transferred||0)});
    }catch(error){
      reportExcelError(error);saving=false;
      await previewFile();
    }
  });
  await previewFile();
}
