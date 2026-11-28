import { button, escapeHtml, field, list, modal, mountModal,
  openNotice, select, dataTable, v2ListEntry, v2ListEntries } from '../../ui/ui.js';
import { compactCheck } from '../../ui/selection/check-list.js';
import { isV2DesktopWorkspace } from '../../ui/v2/geometry.js';
import { moveDesktopQTool } from '../../ui/v2/z-layout.js';
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
const rowKey=item=>String(item.field)+'::'+String(item.rowNumber);
const discountValue=value=>{
  const raw=text(value).replace('%','').replace(',','.').replace(/\s+/g,'');
  const numeric=Number(raw);
  if(!raw||!Number.isFinite(numeric))return '';
  // Excel stores percentage-formatted 20% as the fractional number 0.2.
  // In the import review the professional explicitly confirms the human
  // percentage (20), never the raw Excel fraction.
  const percent=numeric>0&&numeric<1?numeric*100:numeric;
  return String(Number(percent.toFixed(6)));
};
const discountLabel=value=>{
  const percent=discountValue(value);
  return percent===''?text(value):Number(percent).toLocaleString('ru-RU',{
    maximumFractionDigits:6,
  })+' %';
};
const validDiscount=value=>{
  const raw=text(value).replace(',','.');
  if(!raw)return false;
  const percent=Number(raw);
  return Number.isFinite(percent)&&percent>=0&&percent<=100;
};
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
const matchingGroup=issue=>{
  if(issue.field!=='identity')return issue.field;
  const owners=Array.isArray(issue.owners)?issue.owners:[];
  const fields=owners.flatMap(o=>o.matchedBy||[]);
  for(const candidate of ['email','additionalEmail','uei','phone','additionalPhone','telegram','additionalTelegram'])
    if(fields.includes(candidate))return candidate;
  return 'identity';
};
const fieldTitle={
  email:'Email',additionalEmail:'Дополнительный Email',
  uei:'Код клиента',phone:'Телефон',additionalPhone:'Дополнительный телефон',
  telegram:'Telegram',additionalTelegram:'Дополнительный Telegram',
  identity:'Проверить человека',
};
function reviewGroups(batch){
  const issues=Array.isArray(batch.issues)?batch.issues:[];
  const identityForRow=new Map(issues.filter(i=>i.field==='identity').map(i=>[i.rowNumber,i]));
  const skipped=new Set();
  const groups=new Map();
  // Identity is attached to the matching field (Email/phone/client code),
  // never rendered again in an unrelated "Совпадение" group.
  for(const item of issues.filter(i=>i.field==='identity')){
    const group=matchingGroup(item),key=String(item.rowNumber)+'::'+group;
    skipped.add(key);
    if(!groups.has(group))groups.set(group,[]);
    groups.get(group).push(item);
  }
  for(const item of issues.filter(i=>i.field!=='identity')){
    const key=String(item.rowNumber)+'::'+item.field;
    if(skipped.has(key)&&identityForRow.has(item.rowNumber))continue;
    if(!groups.has(item.field))groups.set(item.field,[]);
    groups.get(item.field).push(item);
  }
  const configured=new Map((batch.groups||[]).map(g=>[g.field,g.label]));
  return [...groups].map(([field,items])=>({
    field,items,label:fieldTitle[field]||configured.get(field)||field,
  }));
}
const matchingOwner=item=>(Array.isArray(item.owners)?item.owners:[])
  .find(o=>o.matchedBy?.includes(matchingGroup(item)))
  ||(Array.isArray(item.owners)?item.owners[0]:null);
function issueDisplay(item,people=[]){
  const fieldName=text(item.field);
  const owner=matchingOwner(item);
  const ownPerson=owner?people.find(p=>text(p.key)===text(owner.key)):null;
  const saved=text(item.system)||'—',incoming=text(item.excel)||'—';
  if(fieldName==='identity'){
    const title=owner?personHeading(owner.code,owner.name):saved;
    const group=matchingGroup(item);
    const matches=group==='email'||group==='additionalEmail'
      ?(ownPerson?.emails||[]).join(', ')
      :group==='phone'||group==='additionalPhone'
        ?(ownPerson?.phones||[]).join(', ')
        :group==='uei'?displayCode(owner?.code)
          :group==='telegram'||group==='additionalTelegram'
            ?(ownPerson?.telegrams||[]).join(', '):'';
    const meta=matches?(fieldTitle[group]||group)+': '+matches:'';
    return {title,secondary:'Excel: '+fromExcel(incoming)+(meta?' · '+meta:'')};
  }
  const person=personForIssue(item,people);
  const name=personName(person)||text(item.contact).replace(/^[0-9A-Za-z]{1,4}\s+/,'').trim();
  const dataValue=fieldName==='discountPercent'?discountLabel(incoming):incoming;
  const oldValue=fieldName==='discountPercent'&&/Уточните: процент или доля/i.test(saved)
    ?'':fieldName==='discountPercent'?discountLabel(saved):saved;
  const title=[personHeading(person?.uei,name),oldValue==='—'?'':oldValue]
    .filter(Boolean).join(' · ');
  return {title,secondary:'Excel: '+dataValue};
}
function issueRow(item,people=[]){
  const id=Number(item.rowNumber),fieldName=text(item.field);
  const display=issueDisplay(item,people);
  return '<div data-review-row="'+id+'" data-review-field="'+escapeHtml(fieldName)+'">'+
    '<div class="inventory-counterparty-product-row">'+
      compactCheck({aria:'Выбрать: '+display.title,
        data:'data-review-select="'+escapeHtml(rowKey(item))+'"'})+
      list({className:'ui-list--dense',items:[{
        ...display,interactive:true,data:'data-review-open',
        aria:display.title+'. '+display.secondary,
      }]})+
    '</div></div>';
}
function decisionOptions(item){
  if(item.field==='identity')return [
    {value:'',label:'Выберите контакт'},
    {value:'same',label:'Существующий контакт'},
    {value:'different',label:'Создать контакт'},
  ];
  return [
    {value:'',label:'Выберите значение'},
    {value:'keep',label:'Сохранить'},
    {value:'replace',label:'Заменить'},
    ...(['email','additionalEmail','phone','additionalPhone','telegram','additionalTelegram','note'].includes(item.field)
      ?[{value:'add',label:'Добавить'}]:[]),
    {value:'manual',label:'Изменить значение'},
  ];
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
  const groups=reviewGroups(batch);
  const rows=Array.isArray(batch.rows)?batch.rows:[];
  const done=rows.filter(row=>row.status==='done');
  const unchanged=rows.filter(row=>row.status==='unchanged');
  const sections=groups.map(group=>{
    const check=compactCheck({
      aria:'Выбрать всю группу '+group.label,
      data:'data-review-group-check="'+escapeHtml(group.field)+'"',
    });
    return catalogDisclosure(group.label,
      '<div class="inventory-audit-data-list">'+group.items.map(item=>issueRow(item,people)).join('')+'</div>',
      false,group.items.length,check)
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
    button('Применить',{data:'data-review-apply'})+
  '</div>';
}
// Keep the server decision payload identical for Desktop and Mobile.
function reviewOperation(item,requested,candidate,manual){
  if(!requested||!decisionOptions(item).some(o=>o.value===requested))throw Error('Выберите правильное значение');
  const mode=requested==='manual'||(requested==='add'&&item.field==='note')?'replace':requested;
  if(mode==='same'&&(!candidate||!item.owners?.some(o=>text(o.key)===candidate)))throw Error('Выберите человека из найденных контактов');
  let value=mode==='same'?candidate:'';
  if(mode==='replace'||mode==='add'){
    value=requested==='manual'?text(manual):item.field==='discountPercent'?discountValue(item.excel):text(item.excel);
    if(requested==='add'&&item.field==='note'){
      value=[text(item.system),text(item.excel)].filter(Boolean).join('\n');
      if(value.length>500)throw Error('Примечание слишком длинное. Не более 500 символов.');
    }
    if(!value)throw Error('Укажите новое значение');
    if(item.field==='discountPercent'&&!validDiscount(value))throw Error('Процент должен быть от 0 до 100');
  }
  return {rowNumber:item.rowNumber,field:item.field,mode,value};
}

function openDesktopContactImportReview(root,batchId,onLoaded){
  const layer=mountModal(root,modal(
    '<div data-review-content>Загрузка…</div><p class="form-error" role="alert" data-review-error></p>'+
    button('Применить',{data:'data-review-apply',disabled:true}),
    {title:'Сверка контактов',variant:'q',surface:'app'}
  ));
  if(!layer)return null;
  const host=layer.querySelector('[data-review-content]'),apply=layer.querySelector('[data-review-apply]'),error=layer.querySelector('[data-review-error]');
  moveDesktopQTool(apply);
  const drafts=new Map(),collapsed=new Set(['__done','__unchanged']);
  let current=null,busy=false,loading=true;
  const draftFor=item=>{
    const key=rowKey(item);
    if(!drafts.has(key))drafts.set(key,{checked:false,mode:'',candidate:item.owners?.length===1?text(item.owners[0].key):'',manual:item.field==='discountPercent'?discountValue(item.excel):text(item.excel)});
    return drafts.get(key);
  };
  const groups=()=>reviewGroups(current||{});
  const issues=()=>groups().flatMap(g=>g.items);
  const chosen=()=>issues().filter(i=>draftFor(i).checked);
  const operation=item=>{const d=draftFor(item);return reviewOperation(item,d.mode,item.owners?.length===1?text(item.owners[0].key):d.candidate,d.manual);};
  function sync(){
    host.querySelectorAll('[data-review-group-check]').forEach(control=>{
      const group=groups().find(g=>g.field===control.dataset.reviewGroupCheck);
      const n=(group?.items||[]).filter(i=>draftFor(i).checked).length;
      control.checked=n>0&&n===group.items.length;
      control.indeterminate=n>0&&n<group.items.length;
    });
    let ready=false;
    try{const items=chosen();ready=items.length>0&&items.map(operation).length===items.length;}catch{}
    apply.disabled=loading||busy||!ready;
    host.inert=loading||busy;
  }
  function show(){
    if(!layer.isConnected||!current)return;
    const people=getAllPeople(),g=groups(),rows=Array.isArray(current.rows)?current.rows:[];
    const done=rows.filter(r=>r.status==='done'),unchanged=rows.filter(r=>r.status==='unchanged');
    const activeKeys=new Set(issues().map(rowKey));
    for(const key of drafts.keys())if(!activeKeys.has(key))drafts.delete(key);
    const tableRows=g.flatMap(group=>group.items.map(item=>{
      const person=personForIssue(item,people),owner=matchingOwner(item);
      const title=item.field==='identity'?(owner?personHeading(owner.code,owner.name):text(item.system)||'Контакт'):personHeading(person?.uei,personName(person)||text(item.contact).replace(/^[0-9A-Za-z]{1,4}\s+/,'').trim());
      const system=item.field==='discountPercent'?(/Уточните: процент или доля/i.test(text(item.system))?'—':discountLabel(item.system)):text(item.system)||'—';
      const excel=item.field==='discountPercent'?discountLabel(item.excel):item.field==='identity'?fromExcel(item.excel):text(item.excel)||'—';
      return {id:rowKey(item),item,title,system,excel};
    }));
    for(const [id,values] of [['__done',done],['__unchanged',unchanged]])
      for(const row of values)tableRows.push({id:id+':'+row.rowNumber,title:personHeading(row.code,row.name),system:'',excel:'Строка '+row.rowNumber});
    const columns=[
      {key:'selected',label:'',narrow:true,sortable:false,render:row=>row.item?compactCheck({checked:draftFor(row.item).checked,data:'data-review-select="'+escapeHtml(row.id)+'"',aria:'Выбрать '+row.title}):compactCheck({disabled:true,aria:'Обработано'})},
      {key:'title',label:'Контакт',sortable:false,render:row=>'<span data-review-table-id="'+escapeHtml(row.id)+'">'+escapeHtml(row.title)+'</span>'},
      {key:'system',label:'В системе',sortable:false},
      {key:'excel',label:'Excel',sortable:false},
      {key:'decision',label:'Решение',sortable:false,render:row=>{
        if(!row.item)return '';
        const item=row.item,d=draftFor(item),id=escapeHtml(row.id);
        return select({name:'reviewMode-'+row.id,value:d.mode,aria:'Решение для '+row.title,options:decisionOptions(item),data:'data-review-mode="'+id+'"'})+
          (item.field==='identity'&&item.owners?.length>1?'<div data-review-candidate-wrap'+(d.mode==='same'?'':' hidden')+'>'+
            select({name:'reviewCandidate-'+row.id,value:d.candidate,aria:'Существующий контакт',options:[{value:'',label:'Выберите контакт'},...item.owners.map(o=>({value:o.key,label:personHeading(o.code,o.name)}))],data:'data-review-candidate="'+id+'"'})+'</div>':'')+
          '<div data-review-manual-wrap'+(d.mode==='manual'?'':' hidden')+'>'+
          field({name:'reviewManual-'+row.id,value:d.manual,type:item.field==='discountPercent'?'number':'text',...(item.field==='discountPercent'?{min:'0',max:'100',step:'any',inputmode:'decimal'}:{}),data:'aria-label="Новое значение" data-review-manual-value="'+id+'"'})+'</div>';
      }},
    ];
    host.innerHTML='<div><strong>'+escapeHtml(progress(current))+'</strong><p class="ui-list__secondary">'+Number(current.pending||0)+' требуют решения · '+g.length+' групп различий</p></div>'+
      (tableRows.length?dataTable({compact:true,caption:'Сверка контактов',columns,rows:tableRows}):'<p class="ui-list__secondary">Нет данных для сверки.</p>');
    const body=host.querySelector('tbody');
    if(!body){sync();return;}
    const doc=body.ownerDocument,members=new Map([...body.querySelectorAll('[data-review-table-id]')].map(n=>[n.dataset.reviewTableId,n.closest('tr')]));
    const all=[...g.map(g=>({id:g.field,label:g.label,items:g.items,ids:g.items.map(rowKey)})),...[['__done','Загружено',done],['__unchanged','Без изменений',unchanged]].filter(([, ,a])=>a.length).map(([id,label,a])=>({id,label,items:[],ids:a.map(r=>id+':'+r.rowNumber)}))];
    for(const group of all){
      const tr=doc.createElement('tr');tr.dataset.tableGroupLevel='group';
      const check=doc.createElement('td');
      if(group.items.length)check.innerHTML=compactCheck({data:'data-review-group-check="'+escapeHtml(group.id)+'"',aria:'Выбрать всю группу '+group.label});
      const td=doc.createElement('td');td.colSpan=columns.length-2;
      const details=doc.createElement('details');details.className='dds-table-disclosure';details.open=!collapsed.has(group.id);
      const summary=doc.createElement('summary');summary.className='inventory-editor-summary';summary.textContent=group.label+' · '+group.ids.length;
      details.append(summary);td.append(details);
      const bulk=doc.createElement('td');
      if(group.items.length>1){
        const common=decisionOptions(group.items[0]).filter(o=>o.value&&group.items.every(i=>decisionOptions(i).some(c=>c.value===o.value)));
        if(common.length)bulk.innerHTML=select({name:'reviewBulk-'+group.id,value:'',aria:'Решение для группы '+group.label,options:[{value:'',label:'Для группы'},...common],data:'data-review-bulk="'+escapeHtml(group.id)+'"'});
      }
      tr.append(check,td,bulk);body.append(tr);
      const groupRows=group.ids.map(id=>members.get(id)).filter(Boolean);
      groupRows.forEach(row=>body.append(row));
      const toggle=()=>{groupRows.forEach(row=>row.hidden=!details.open);if(details.open)collapsed.delete(group.id);else collapsed.add(group.id);};
      details.addEventListener('toggle',toggle);toggle();
    }
    host.querySelectorAll('[data-review-select]').forEach(control=>{control.closest('tr').dataset.reviewTableKey=control.dataset.reviewSelect;});
    sync();
  }
  function update(event){
    if(loading||busy)return;
    const target=event.target,groupId=target.dataset?.reviewGroupCheck,bulkId=target.dataset?.reviewBulk;
    if(groupId!==undefined||bulkId!==undefined){
      const group=groups().find(g=>g.field===(groupId??bulkId));
      if(!group)return;
      for(const item of group.items){
        const d=draftFor(item);
        if(groupId!==undefined)d.checked=target.checked;
        else if(target.value){d.checked=true;d.mode=target.value;}
      }
      if(bulkId!==undefined&&target.value){collapsed.delete(group.field);show();}
      else{
        host.querySelectorAll('[data-review-select]').forEach(c=>{const item=group.items.find(i=>rowKey(i)===c.dataset.reviewSelect);if(item)c.checked=draftFor(item).checked;});
        sync();
      }
      return;
    }
    const row=target.closest('tr[data-review-table-key]');
    if(!row)return;
    const item=issues().find(i=>rowKey(i)===row.dataset.reviewTableKey);
    if(!item)return;
    const d=draftFor(item);
    if(target.matches('[data-review-select]'))d.checked=target.checked;
    else if(target.matches('[data-review-mode]')){
      d.mode=target.value;d.checked=Boolean(d.mode);row.querySelector('[data-review-select]').checked=d.checked;
      const candidate=row.querySelector('[data-review-candidate-wrap]'),manual=row.querySelector('[data-review-manual-wrap]');
      if(candidate)candidate.hidden=d.mode!=='same';
      if(manual)manual.hidden=d.mode!=='manual';
    }else if(target.matches('[data-review-candidate]'))d.candidate=target.value;
    else if(target.matches('[data-review-manual-value]'))d.manual=target.value;
    sync();
  }
  host.addEventListener('change',update);
  host.addEventListener('input',event=>{if(event.target.matches('[data-review-manual-value]'))update(event);});
  apply.addEventListener('click',async()=>{
    if(loading||busy||apply.disabled)return;
    const items=chosen();let operations;
    try{operations=items.map(operation);}catch(err){error.textContent=text(err.message);return;}
    if(!operations.length)return;
    busy=true;error.textContent='';sync();
    try{
      for(const [i,op] of operations.entries()){current=await request('decide',{batchId,...op});drafts.delete(rowKey(items[i]));}
      await reloadContacts(onLoaded);current=await request('detail',{batchId});
    }catch(err){
      error.textContent=text(err.message)||'Не удалось сохранить';
      try{current=await request('detail',{batchId});await reloadContacts(onLoaded);}catch{}
    }finally{busy=false;show();}
  });
  void (async()=>{
    try{
      current=await request('detail',{batchId});
      while(layer.isConnected&&current?.rows?.some(row=>row.status==='new')){
        current=await request('advance',{batchId,limit:40});if(!current.more)break;
      }
      await reloadContacts(onLoaded);
      if(layer.isConnected)show();
    }catch(err){error.textContent=text(err.message);}
    finally{loading=false;sync();}
  })();
  return layer;
}

export function openContactImportReview(root,batchId,{onLoaded=()=>{}}={}){
  if(isV2DesktopWorkspace(root.closest('[data-v2-app]')))return openDesktopContactImportReview(root,batchId,onLoaded);
  const layer=mountModal(root,modal('<div data-review-content>Загрузка…</div>',{
    title:'Сверка контактов',variant:'q',surface:'app',
  }));
  if(!layer)return null;
  const host=layer.querySelector('[data-review-content]');
  let current=null,busy=false;
  const expanded=new Set();
  const selectedRows=()=>[...host.querySelectorAll('[data-review-row]')]
    .filter(row=>row.querySelector('[data-review-select]')?.checked);
  const selectedIssues=()=>selectedRows()
    .map(row=>(current?.issues||[]).find(item=>
      item.rowNumber===Number(row.dataset.reviewRow)&&item.field===row.dataset.reviewField))
    .filter(Boolean);
  function sync(){
    host.querySelectorAll('[data-review-group]').forEach(group=>{
      const parent=group.closest('.inventory-editor-panel');
      const selectAll=parent?.querySelector(':scope > .inventory-editor-heading__selection [data-review-group-check]');
      if(!selectAll)return;
      const items=[...group.querySelectorAll('[data-review-select]')];
      const chosen=items.filter(input=>input.checked).length;
      selectAll.checked=items.length>0&&chosen===items.length;
      selectAll.indeterminate=chosen>0&&chosen<items.length;
    });
    const apply=host.querySelector('[data-review-apply]');
    if(apply){apply.hidden=!selectedRows().length;apply.disabled=busy;}
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
  function openEditor(items){
    if(busy||!items.length)return;
    const oneKind=items.every(i=>i.field===items[0].field);
    const group=matchingGroup(items[0]);
    const common=items.length>1&&oneKind;
    const people=getAllPeople();
    const first=items[0];
    const heading=fieldTitle[group]||text(first.label)||'Данные';
    const preview=list({className:'ui-list--dense',items:items.map(item=>({
      ...issueDisplay(item,people),interactive:false,
    }))});
    const manualControl=(item,key)=>'<div data-review-manual="'+key+'" hidden>'+
      field({
        label:item.field==='discountPercent'?'Процент':'Новое значение',
        name:'reviewManual-'+key,value:item.field==='discountPercent'
          ?discountValue(item.excel):text(item.excel),
        type:item.field==='discountPercent'?'number':'text',
        ...(item.field==='discountPercent'?{min:'0',max:'100',step:'any',inputmode:'decimal'}:{}),
      })+'</div>';
    const selectedField=(item,key,shared=false)=>{
      const options=decisionOptions(item);
      const candidate=item.field==='identity'&&item.owners?.length>1
        ?select({
          label:'Какой контакт?',name:'reviewCandidate-'+key,
          options:[
            {value:'',label:'Выберите контакт'},
            ...item.owners.map(owner=>({
              value:owner.key,label:personHeading(owner.code,owner.name),
            })),
          ],
        }):'';
      return '<div data-review-choice="'+key+'">'+
        select({
          label:shared?'Одно решение для всех':issueDisplay(item,people).title,
          name:'reviewMode-'+key,
          options,
        })+
        (candidate?'<div data-review-candidate-control="'+key+'" hidden>'+candidate+'</div>':'')+
        manualControl(item,key)+
        '<p class="ui-list__secondary" data-review-append hidden>Добавить к существующим данным: '+
        escapeHtml(text(item.excel))+'</p></div>';
    };
    const options=common
      ?compactCheck({label:'Одно значение для всех',checked:true,data:'data-review-common'})+
        '<div data-review-common-control>'+selectedField(first,'common',true)+'</div>'+
        '<div data-review-individual-control hidden>'+
          items.map((item,index)=>selectedField(item,String(index))).join('')+
        '</div>'
      :items.map((item,index)=>selectedField(item,String(index))).join('');
    const message=items.some(item=>item.field==='identity'&&matchingGroup(item).includes('email'))
      ?'<p class="ui-list__secondary">«Создать контакт»: Email, уже принадлежащий другому контакту, не переносится.</p>':'';
    const html='<form class="form-grid" data-review-choice-form>'+
      '<p class="ui-list__secondary">Выбрано: '+items.length+'</p>'+
      preview+message+options+
      '<p class="form-error" role="alert" data-review-choice-error></p>'+
      button('Применить',{type:'submit',data:'data-review-confirm'})+
    '</form>';
    const dialog=mountModal(root,modal(html,{
      title:heading,variant:'x',surface:'app',xRole:'editor',
    }));
    if(!dialog)return;
    const form=dialog.querySelector('[data-review-choice-form]');
    const commonToggle=dialog.querySelector('[data-review-common]');
    function shared(){return common&&Boolean(commonToggle?.checked);}
    function syncChoice(){
      const sharedBlock=dialog.querySelector('[data-review-common-control]');
      const separateBlock=dialog.querySelector('[data-review-individual-control]');
      if(sharedBlock){sharedBlock.hidden=!shared();sharedBlock.style.display=shared()?'':'none';}
      if(separateBlock){separateBlock.hidden=shared();separateBlock.style.display=shared()?'none':'';}
      dialog.querySelectorAll('[data-review-choice]').forEach(node=>{
        const mode=text(form.elements.namedItem('reviewMode-'+node.dataset.reviewChoice)?.value);
        const manual=node.querySelector('[data-review-manual]');
        const candidate=node.querySelector('[data-review-candidate-control]');
        const addition=node.querySelector('[data-review-append]');
        if(manual){manual.hidden=mode!=='manual';manual.style.display=mode==='manual'?'':'none';}
        if(candidate){candidate.hidden=mode!=='same';candidate.style.display=mode==='same'?'':'none';}
        if(addition){addition.hidden=mode!=='add';addition.style.display=mode==='add'?'':'none';}
      });
    }
    form.addEventListener('change',syncChoice);
    syncChoice();
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(busy)return;
      const error=form.querySelector('[data-review-choice-error]');
      if(error)error.textContent='';
      let operations;
      try{
        operations=items.map((item,index)=>{
          const key=shared()?'common':String(index);
          const requested=text(form.elements.namedItem('reviewMode-'+key)?.value);
          const candidate=item.field==='identity'
            ?item.owners?.length===1?text(item.owners[0].key)
              :text(form.elements.namedItem('reviewCandidate-'+key)?.value):'';
          return reviewOperation(item,requested,candidate,form.elements.namedItem('reviewManual-'+key)?.value);
        });
      }catch(err){if(error)error.textContent=text(err.message);return;}
      busy=true;
      const submit=form.querySelector('[data-review-confirm]');
      if(submit)submit.disabled=true;
      try{
        for(const operation of operations)
          current=await request('decide',{batchId,...operation});
        await reloadContacts(onLoaded);
        dialog.v2Close?.();
        await reload();
      }catch(err){
        if(error)error.textContent=text(err.message)||'Не удалось сохранить';
      }finally{busy=false;if(submit?.isConnected)submit.disabled=false;sync();}
    });
  }
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
    sync();
    if((groupInput||target.closest?.('[data-review-select]'))&&target.checked)
      openEditor(selectedIssues());
  });
  host.addEventListener('click',event=>{
    const open=event.target.closest?.('[data-review-open]');
    if(open){
      const check=open.closest('[data-review-row]')?.querySelector('[data-review-select]');
      if(check){check.checked=!check.checked;sync();if(check.checked)openEditor(selectedIssues());}
      return;
    }
    if(event.target.closest?.('[data-review-apply]'))openEditor(selectedIssues());
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
  const desktop=isV2DesktopWorkspace(layer.closest('[data-v2-app]'));
  const refresh=async()=>{
    const batches=await request('batches');
    if(layer.isConnected)host.innerHTML=batches.length
      ?(desktop?dataTable({compact:true,caption:'История загрузок',rows:batches,columns:[
        {key:'filename',label:'Файл',sortable:false,render:batch=>'<button type="button" data-contact-review-open="'+escapeHtml(batch.id)+'">'+escapeHtml(text(batch.filename)||'Контакты.xlsx')+'</button>'},
        {key:'done',label:'Обработано',sortable:false,render:batch=>escapeHtml(String(Number(batch.done||0))+' / '+String(Number(batch.total||0)))},
        {key:'pending',label:'Ожидают',sortable:false,render:batch=>String(Number(batch.pending||0))},
        {key:'groupCount',label:'Группы',sortable:false,render:batch=>String(Number(batch.groupCount||0))},
      ]}):v2ListEntries(batches.map(batchRow)))
      :'<p class="ui-list__secondary">Загруженных файлов пока нет.</p>';
  };
  host.addEventListener('click',event=>{
    const item=event.target.closest('[data-contact-review-open]');
    if(item)openContactImportReview(desktop?layer:root,item.dataset.contactReviewOpen,{
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
