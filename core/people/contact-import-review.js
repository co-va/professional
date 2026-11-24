import { actionBlock, button, escapeHtml, list, modal, mountModal,
  openNotice, select, v2ListEntry, v2ListEntries } from '../../ui/ui.js';
import { compactCheck } from '../../ui/selection/check-list.js';
import { catalogDisclosure } from '../inventory/catalog-ui.js';
import { apiRequest } from '../auth.js';
import { getAllPeople, hydratePeopleFromServer } from './data.js';
import { hydrateUEIFromServer } from '../uei.js';

const text=v=>String(v??'').trim();
const request=async(path,data={})=>{
  const reading=path==='batches'||path==='detail';
  const url='/data-transfer/contacts/'+path+(reading&&data.batchId
    ?'?batchId='+encodeURIComponent(text(data.batchId)):'');
  const response=await apiRequest(url,reading?{}:{
    method:'POST',body:JSON.stringify(data),
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(Array.isArray(payload.message)
    ?payload.message.join('; '):payload.message||'Не удалось проверить Контакты');
  return payload;
};
const errorNotice=e=>openNotice({title:'Загрузки',message:text(e?.message)||'Ошибка сверки'});
const progress=x=>'Обработано '+Number(x.done||0)+' из '+Number(x.total||0);
async function reloadContacts(onLoaded){
  const response=await apiRequest('/business-state/journal');
  if(!response.ok)throw Error('Контакты сохранены, но список пока не обновился.');
  const state=await response.json();
  hydratePeopleFromServer(state.people||[]);
  hydrateUEIFromServer(state.uei||{});
  onLoaded?.();
}
const batchRow=batch=>v2ListEntry({
  title:text(batch.filename)||'Контакты.xlsx',
  subtitle:progress(batch),
  rightTop:String(batch.pending||0)+' ожидают',
  rightBottom:String(batch.groupCount||0)+' групп',
  data:'data-contact-review-open="'+escapeHtml(batch.id)+'"',
});
const hiddenIdentifier=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text(value));
const displayCode=value=>{
  const valueText=text(value);
  if(!valueText||hiddenIdentifier(valueText))return '';
  return /^\d{1,4}$/.test(valueText)?valueText.padStart(4,'0'):valueText;
};
const codeLabel=value=>displayCode(value)?'Код: '+displayCode(value):'';
const identityFields={
  uei:'код клиента',phone:'телефон',additionalPhone:'доп. телефон',
  email:'Email',additionalEmail:'доп. Email',
  telegram:'Telegram',additionalTelegram:'доп. Telegram',
};

const rowKey=item=>String(item.field)+'::'+String(item.rowNumber);
const personName=person=>[text(person?.name),text(person?.surname)]
  .filter(Boolean).join(' ');
const personHeading=(code,name)=>[displayCode(code),text(name)]
  .filter(Boolean).join(' ')||'Контакт';
const fromExcel=value=>{
  const source=text(value);
  const parts=/^([0-9A-Za-z]{1,4})\s+(.+)$/.exec(source);
  return parts?[displayCode(parts[1]),parts[2]].join(' '):source;
};
const personForIssue=(item,people)=>people.find(person=>
  text(person.key)===text(item.personKey))||null;
function choiceOptions(item){
  const saved=text(item.system)||'Не указано';
  const incoming=text(item.excel)||'Не указано';
  if(item.field==='identity')return [
    {value:'',label:'Выберите решение'},
    {value:'same',label:'Тот же человек'},
    {value:'different',label:'Другой человек'},
  ];
  return [
    {value:'',label:'Какое значение правильное?'},
    {value:'keep',label:'Система: '+saved},
    {value:'replace',label:'Excel: '+incoming},
    ...(['email','additionalEmail','phone','additionalPhone',
      'telegram','additionalTelegram'].includes(item.field)
      ?[{value:'add',label:'Добавить как дополнительный: '+incoming}]:[]),
  ];
}
function issueRow(item,people=[]){
  const id=Number(item.rowNumber);
  const fieldName=text(item.field);
  const key=escapeHtml(rowKey(item));
  const saved=text(item.system)||'—';
  const incoming=text(item.excel)||'—';
  const owners=Array.isArray(item.owners)?item.owners:[];
  const found=personForIssue(item,people);
  const knownName=personName(found);
  const knownCode=text(found?.uei);
  // The identity candidate belongs to the existing system record.
  // The imported name and code are separate, never displayed as the
  // system person's name.
  const onlyCandidate=owners.length===1?owners[0]:null;
  const title=fieldName==='identity'
    ?onlyCandidate?personHeading(onlyCandidate.code,onlyCandidate.name)
      :text(item.system)||'Несколько совпадений'
    :[personHeading(knownCode,knownName||text(item.contact)
        .replace(/^[0-9A-Za-z]{1,4}\s+/,'').trim()),
       saved==='—'?'':saved].filter(Boolean).join(' · ');
  const imported=fieldName==='identity'?fromExcel(incoming):incoming;
  const comparison='Excel: '+imported;
  const matchedBy=fieldName==='identity'&&onlyCandidate
    ?(onlyCandidate.matchedBy||[]).map(field=>identityFields[field]||field).join(', ')
    :'';
  const candidateOptions=[
    {value:'',label:'Выберите контакт'},
    ...owners.map(person=>({
      value:text(person.key),
      label:[personHeading(person.code,person.name),
        text(person.key).startsWith('excel:')?'Excel: строка '+text(person.key).slice(6):'',
      ].filter(Boolean).join(' · '),
    })),
  ];
  const display=list({className:'ui-list--dense',items:[{
    title,
    secondary:comparison+(matchedBy?' · Совпадает: '+matchedBy:''),
    interactive:true,data:'data-review-open',
    aria:'Система: '+title+'. '+comparison,
  }]});
  const editRow=(label,content)=>'<div class="data-edit-row">'+
    '<span class="data-edit-row__name"><strong>'+escapeHtml(label)+'</strong></span>'+
    content+'</div>';
  // One candidate needs no extra selection; the existing identifier is
  // retained in a hidden field and is never exposed to the user.
  const candidateControl=onlyCandidate
    ?'<input type="hidden" data-review-candidate value="'+escapeHtml(onlyCandidate.key)+'">'
    :editRow('Контакт',select({
      name:'reviewCandidate-'+id+'-'+fieldName,
      aria:'Выберите совпадающий контакт',
      data:'data-review-candidate',options:candidateOptions,value:'',
    }));
  return '<div data-review-row="'+id+'" data-review-field="'+escapeHtml(fieldName)+'">'+
    '<div class="inventory-counterparty-product-row">'+
      compactCheck({aria:'Выбрать: '+title,data:'data-review-select="'+key+'"'})+
      display+'</div>'+
    '<div class="inventory-audit-data-list" data-review-editor hidden>'+
      editRow('Выбор',select({
        name:'reviewMode-'+id+'-'+fieldName,
        aria:'Выберите правильное значение для '+title,
        data:'data-review-mode',options:choiceOptions(item),value:'',
      }))+
      '<div data-review-candidates hidden>'+candidateControl+'</div>'+
      '<input type="hidden" data-review-value value="'+escapeHtml(incoming==='—'?'':incoming)+'">'+
      (item.error?'<p class="form-error" role="alert">'+escapeHtml(item.error)+'</p>':'')+
    '</div></div>';
}
function processedRow(row){
  const title=text(row.name)||'Контакт';
  const subtitle=[codeLabel(row.code),'Excel: строка '+row.rowNumber]
    .filter(Boolean).join(' · ');
  return '<div class="inventory-counterparty-product-row">'+
    compactCheck({disabled:true,aria:'Уже обработан: '+title})+
    list({className:'ui-list--dense',items:[{
      title,secondary:subtitle,interactive:false,
    }]})+'</div>';
}
function content(batch,people=[]){
  const groups=(Array.isArray(batch.groups)?[...batch.groups]:[])
    .sort((a,b)=>Number(b.field==='identity')-Number(a.field==='identity'));
  const rows=Array.isArray(batch.rows)?batch.rows:[];
  const done=rows.filter(row=>row.status==='done');
  const unchanged=rows.filter(row=>row.status==='unchanged');
  const sections=groups.map(group=>{
    const issues=(batch.issues||[]).filter(item=>item.field===group.field);
    if(!issues.length)return '';
    const check=compactCheck({
      aria:'Выбрать всю группу '+group.label,
      data:'data-review-group-check="'+escapeHtml(group.field)+'"',
    });
    return catalogDisclosure(group.label,
      '<div class="inventory-audit-data-list">'+issues.map(item=>issueRow(item,people)).join('')+'</div>',
      false,issues.length,check)
      .replace('<details>','<details data-review-group="'+escapeHtml(group.field)+'">');
  });
  const ready=done.length?catalogDisclosure('Загружено',
    '<div class="inventory-audit-data-list">'+done.map(processedRow).join('')+'</div>',
    false,done.length):'';
  const identical=unchanged.length?catalogDisclosure('Без изменений',
    '<div class="inventory-audit-data-list">'+unchanged.map(processedRow).join('')+'</div>',
    false,unchanged.length):'';
  return '<div class="form-grid">'+
    '<div><strong>'+escapeHtml(progress(batch))+'</strong>'+
      '<div class="ui-list__secondary">'+Number(batch.pending||0)+
      ' требуют решения · '+groups.length+' групп различий</div></div>'+
    '<div class="inventory-stock-category-sequence" data-review-groups>'+
      sections.join('')+ready+identical+'</div>'+
    '<p class="form-error" role="alert" data-review-error></p>'+
    actionBlock(button('Применить',{data:'data-review-apply'}))+
  '</div>';
}
export function openContactImportReview(root,batchId,{onLoaded=()=>{}}={}){
  const layer=mountModal(root,modal('<div data-review-content>Загрузка…</div>',{
    title:'Сверка контактов',variant:'q',surface:'app',
  }));
  if(!layer)return null;
  const host=layer.querySelector('[data-review-content]');
  let current=null,busy=false;
  const expanded=new Set();
  const selectedRows=()=>[...host.querySelectorAll('[data-review-row]')]
    .filter(row=>row.querySelector('[data-review-select]')?.checked);
  function sync(){
    host.querySelectorAll('[data-review-row]').forEach(row=>{
      const checked=Boolean(row.querySelector('[data-review-select]')?.checked);
      const editor=row.querySelector('[data-review-editor]');
      if(editor){
        editor.hidden=!checked;
        // The canonical .inventory-audit-data-list uses display:grid;
        // enforce hidden until selected without altering the shared CSS.
        editor.style.display=checked?'':'none';
      }
      const mode=text(row.querySelector('[data-review-mode]')?.value);
      const candidates=row.querySelector('[data-review-candidates]');
      if(candidates)candidates.hidden=!checked||mode!=='same'
        ||Boolean(row.querySelector('[data-review-candidate][type="hidden"]'));
    });
    host.querySelectorAll('[data-review-group]').forEach(group=>{
      const parent=group.closest('.inventory-editor-panel');
      const selectAll=parent?.querySelector(':scope > .inventory-editor-heading__selection [data-review-group-check]');
      if(!selectAll)return;
      const items=[...group.querySelectorAll('[data-review-select]')];
      const chosen=items.filter(input=>input.checked).length;
      selectAll.checked=items.length>0&&chosen===items.length;
      selectAll.indeterminate=chosen>0&&chosen<items.length;
    });
    const rows=selectedRows();
    const apply=host.querySelector('[data-review-apply]');
    const footer=apply?.closest('.modal-actions');
    if(footer)footer.hidden=!rows.length;
    if(apply)apply.disabled=busy||!rows.length||rows.some(row=>{
      const mode=text(row.querySelector('[data-review-mode]')?.value);
      return !mode||(mode==='same'&&!text(row.querySelector('[data-review-candidate]')?.value));
    });
  }
  function show(){
    if(!layer.isConnected||!current)return;
    host.innerHTML=content(current,getAllPeople());
    host.querySelectorAll('[data-review-group]').forEach(group=>{
      if(expanded.has(group.dataset.reviewGroup))group.open=true;
      group.addEventListener('toggle',()=>{
        if(group.open)expanded.add(group.dataset.reviewGroup);
        else expanded.delete(group.dataset.reviewGroup);
      });
    });
    sync();
  }
  const reload=async()=>{current=await request('detail',{batchId});show();};
  host.addEventListener('change',event=>{
    const target=event.target;
    const groupInput=target.closest?.('[data-review-group-check]');
    if(groupInput){
      const group=groupInput.closest('.inventory-editor-panel')?.querySelector('[data-review-group]');
      if(groupInput.checked&&group){
        group.open=true;
        expanded.add(group.dataset.reviewGroup);
      }
      group?.querySelectorAll('[data-review-select]').forEach(input=>{
        input.checked=groupInput.checked;
      });
    }
    if(target.closest?.('[data-review-select]')||groupInput
      ||target.closest?.('[data-review-mode]')
      ||target.closest?.('[data-review-candidate]'))sync();
  });
  host.addEventListener('click',async event=>{
    const open=event.target.closest?.('[data-review-open]');
    if(open){
      const check=open.closest('[data-review-row]')?.querySelector('[data-review-select]');
      if(check){check.checked=!check.checked;sync();}
      return;
    }
    const apply=event.target.closest?.('[data-review-apply]');
    if(!apply||busy||apply.disabled)return;
    const entries=selectedRows().map(row=>({
      rowNumber:Number(row.dataset.reviewRow),
      field:row.dataset.reviewField,
      mode:text(row.querySelector('[data-review-mode]')?.value),
      value:'',
      currentValue:text(row.querySelector('[data-review-value]')?.value),
      personKey:text(row.querySelector('[data-review-candidate]')?.value),
    }));
    if(!entries.length)return;
    busy=true;sync();
    try{
      for(const item of entries){
        const value=item.mode==='same'?item.personKey
          :['replace','add'].includes(item.mode)?item.currentValue:'';
        current=await request('decide',{batchId,rowNumber:item.rowNumber,
          field:item.field,mode:item.mode,value});
      }
      await reloadContacts(onLoaded);
      await reload();
    }catch(error){
      const node=host.querySelector('[data-review-error]');
      if(node)node.textContent=text(error?.message);
      else errorNotice(error);
    }finally{busy=false;sync();}
  });
  void (async()=>{
    await reload();
    while(layer.isConnected&&current?.rows?.some(row=>row.status==='new')){
      current=await request('advance',{batchId,limit:40});
      show();
      if(!current.more)break;
    }
    await reloadContacts(onLoaded);
  })().catch(errorNotice);
  return layer;
}

export function openContactImportBatches(root,{onLoaded=()=>{}}={}){
  const layer=mountModal(root,modal('<div data-contact-review-list>Загрузка…</div>',{
    title:'Загрузки',variant:'q',surface:'app',
  }));
  if(!layer)return null;
  const host=layer.querySelector('[data-contact-review-list]');
  const refresh=async()=>{
    const batches=await request('batches');
    if(layer.isConnected)host.innerHTML=batches.length
      ?v2ListEntries(batches.map(batchRow))
      :'<p class="ui-list__secondary">Загруженных файлов пока нет.</p>';
  };
  host.addEventListener('click',event=>{
    const item=event.target.closest('[data-contact-review-open]');
    if(item)openContactImportReview(root,item.dataset.contactReviewOpen,{
      onLoaded:()=>{onLoaded?.();void refresh().catch(errorNotice);},
    });
  });
  void refresh().catch(errorNotice);
  return layer;
}
export function openContactImportUpload(root,file,{onLoaded=()=>{}}={}){
  const layer=mountModal(root,modal('<div data-contact-upload-state>Читаем файл…</div>',{
    title:'Загрузка контактов',variant:'q',surface:'app',
  }));
  if(!layer)return null;
  const host=layer.querySelector('[data-contact-upload-state]');
  const body={dataUrl:text(file.dataUrl),filename:text(file.name),
    source:'Контакты',expectedDomain:'people',strict:true};
  async function start(){
    let batch=await request('start',body);
    if(!layer.isConnected)return;
    host.textContent=progress(batch);
    while(layer.isConnected){
      batch=await request('advance',{batchId:batch.id,limit:40});
      host.textContent=progress(batch);
      if(!batch.more)break;
    }
    await reloadContacts(onLoaded);
    if(layer.isConnected){
      layer.v2Close?.();
      openContactImportReview(root,batch.id,{onLoaded});
    }
  }
  void start().catch(e=>{if(layer.isConnected)host.textContent=text(e?.message);});
  return layer;
}
