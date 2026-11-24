import { actionBlock, button, escapeHtml, modal, mountModal,
  openNotice, v2ListEntry, v2ListEntries } from '../../ui/ui.js';
import { catalogDisclosure } from '../inventory/catalog-ui.js';
import { apiRequest } from '../auth.js';
import { hydratePeopleFromServer } from './data.js';
import { hydrateUEIFromServer } from '../uei.js';

const text=v=>String(v??'').trim();
const request=async(path,data={})=>{
  const response=await apiRequest('/data-transfer/contacts/'+path,{
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
function issueRow(item){
  const id=String(item.rowNumber),field=escapeHtml(item.field);
  const label=escapeHtml(item.contact||'Строка '+id);
  const old=escapeHtml(item.system||'—'),incoming=escapeHtml(item.excel||'—');
  const owners=Array.isArray(item.owners)&&item.owners.length
    ?'<span class="list-entry__column-line is-muted">'+item.owners.map(owner=>
      escapeHtml([owner.code,owner.name].filter(Boolean).join(' · '))).join('; ')+'</span>':'';
  return '<div class="list-entry list-entry--columns contact-review-item" data-review-row="'+id+'" data-review-field="'+field+'">'+
    '<div class="list-entry__background"></div><div class="list-entry__content">'+
    '<input type="checkbox" class="list-entry__selector" data-review-select aria-label="Выбрать '+label+'">'+
    '<div class="list-entry__columns">'+
    '<span class="list-entry__column"><span class="list-entry__column-line is-strong">'+label+'</span>'+
      '<span class="list-entry__column-line is-muted" title="'+old+'">Система: '+old+'</span>'+
      '<span class="list-entry__column-line is-muted" title="'+incoming+'">Excel: '+incoming+'</span>'+owners+'</span>'+
    '<span class="list-entry__column"><label for="review-'+id+'-'+field+'" class="ui-list__secondary">Изменить на</label>'+
      '<input class="contact-review-value" data-review-value id="review-'+id+'-'+field+'" value="'+escapeHtml(item.excel||'')+'" aria-label="Новое значение"></span>'+
    '<span class="list-entry__column"><button type="button" class="ui-button ui-button--outline" data-review-keep>Оставить</button></span>'+
    '</div></div></div>';
}
function content(batch){
  const groups=Array.isArray(batch.groups)?batch.groups:[];
  const done=(Array.isArray(batch.rows)?batch.rows:[]).filter(row=>row.status==='done');
  const sections=groups.map(group=>{
    const entries=(batch.issues||[]).filter(item=>item.field===group.field);
    const items='<div class="list-entries">'+entries.map(issueRow).join('')+'</div>'+
      actionBlock(button('Применить выбранные',{data:'data-review-apply="'+escapeHtml(group.field)+'"'}));
    return catalogDisclosure(group.label,items,false,entries.length)
      .replace('<details>','<details data-review-group="'+escapeHtml(group.field)+'">');
  });
  const completed=catalogDisclosure('Загружено',v2ListEntries(done.map(row=>
    v2ListEntry({title:row.name||'Контакт',
      subtitle:[row.code,'Строка '+row.rowNumber].filter(Boolean).join(' · '),
      interactive:false,omitEmptySubtitle:true}))),false,done.length);
  return '<div class="form-grid contact-review-batch">'+
    '<div>'+escapeHtml(progress(batch))+' · Групп различий: '+groups.length+'</div>'+
    sections.join('')+completed+
    '<p class="form-error" role="alert" data-review-error></p></div>';
}
export function openContactImportReview(root,batchId,{onLoaded=()=>{}}={}){
  const layer=mountModal(root,modal('<div data-review-content>Загрузка…</div>',{
    title:'Сверка контактов',variant:'q',surface:'app',
  }));
  if(!layer)return null;
  const host=layer.querySelector('[data-review-content]');
  let current=null,busy=false;
  const expanded=new Set();
  function show(){
    if(!layer.isConnected||!current)return;
    host.innerHTML=content(current);
    host.querySelectorAll('[data-review-group]').forEach(group=>{
      if(expanded.has(group.dataset.reviewGroup))group.open=true;
      group.addEventListener('toggle',()=>{
        if(group.open)expanded.add(group.dataset.reviewGroup);
        else expanded.delete(group.dataset.reviewGroup);
      });
    });
  }
  const reload=async()=>{current=await request('detail',{batchId});show();};
  const apply=async(item,mode,value)=>{
    current=await request('decide',{batchId,
      rowNumber:Number(item.rowNumber),field:item.field,mode,value,
    });
    show();
  };
  host.addEventListener('click',async event=>{
    if(busy)return;
    const keep=event.target.closest('[data-review-keep]');
    const applyGroup=event.target.closest('[data-review-apply]');
    if(!keep&&!applyGroup)return;
    const selected=applyGroup?[...host.querySelectorAll('[data-review-row]')]
      .filter(row=>row.dataset.reviewField===applyGroup.dataset.reviewApply
        &&row.querySelector('[data-review-select]')?.checked)
      .map(row=>({rowNumber:Number(row.dataset.reviewRow),
        field:row.dataset.reviewField,value:text(row.querySelector('[data-review-value]')?.value)})):[];
    busy=true;
    try{
      if(keep){
        const row=keep.closest('[data-review-row]');
        await apply({rowNumber:Number(row?.dataset.reviewRow),
          field:row?.dataset.reviewField},'keep','');
      }else{
        if(!selected.length)throw Error('Выберите изменения галочками слева.');
        for(const item of selected)await apply(item,'replace',item.value);
      }
      await reloadContacts(onLoaded);
      await reload();
    }catch(e){
      const node=host.querySelector('[data-review-error]');
      if(node)node.textContent=text(e?.message);else errorNotice(e);
    }finally{busy=false;}
  });
  void reload().catch(errorNotice);
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
