import { actionBlock, button, escapeHtml, field, list, modal, mountModal,
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
  const saved=text(item.system)||'Не указано',excel=text(item.excel)||'Не указано';
  if(item.field==='identity')return [
    {value:'',label:'Выберите контакт'},
    {value:'same',label:'Существующий контакт'},
    {value:'different',label:'Создать контакт'},
  ];
  return [
    {value:'',label:'Выберите изменение'},
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
          if(!requested)throw Error('Выберите правильное значение');
          // Notes are one text field, while contact channels are arrays.
          // Append a note using the existing guarded replace operation; other
          // multi-value fields use the server's add operation.
          const mode=requested==='manual'||(requested==='add'&&item.field==='note')
            ?'replace':requested;
          const candidate=item.field==='identity'
            ?item.owners?.length===1?text(item.owners[0].key)
              :text(form.elements.namedItem('reviewCandidate-'+key)?.value):'';
          if(mode==='same'&&!candidate)
            throw Error('Выберите человека из найденных контактов');
          let value=mode==='same'?candidate:'';
          if(mode==='replace'||mode==='add'){
            value=requested==='manual'
              ?text(form.elements.namedItem('reviewManual-'+key)?.value)
              :item.field==='discountPercent'?discountValue(item.excel):text(item.excel);
            if(requested==='add'&&item.field==='note'){
              const previous=text(item.system),incoming=text(item.excel);
              value=[previous,incoming].filter(Boolean).join('\n');
              if(value.length>500)throw Error('Примечание слишком длинное. Не более 500 символов.');
            }
            if(!value)throw Error('Укажите новое значение');
            if(item.field==='discountPercent'&&!validDiscount(value))
              throw Error('Процент должен быть от 0 до 100');
          }
          return {rowNumber:item.rowNumber,field:item.field,mode,value};
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
