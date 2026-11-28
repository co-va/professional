// Universal Desktop group and value UI. Domain adapters own persistence,
// permissions, sections and optional ordering. No dependency on finance,
// Service or Inventory.
import { actionBlock, dataTable } from '../page/page.js';
import { button, compactAddButton, compactRemoveButton } from '../buttons/index.js';
import { field } from '../inputs/index.js';
import { list } from '../lists/list.js';
import { initV2ListReorder } from '../lists/list-entry.js';
import { emptyState } from '../states/index.js';
import { modal, mountModal } from '../modals/index.js';
import { escapeHtml } from '../utils/escape-html.js';

export function groupValuesMarkup({addData='',draftData='',listData='',add=true}={}){
  return '<div class="desktop-group-values"><div class="stock-position-group-heading"><span>Значения</span>'+(add?compactAddButton({data:'data-group-value-add '+addData,aria:'Добавить значение'}):'')+'</div><div data-group-value-draft '+draftData+'></div><div data-group-values-list data-service-group-value-list '+listData+'></div></div>';
}
export function groupValueDraft(edit){
  return edit?field({label:'Наименование значения',name:'valueName',value:edit.name,required:true,maxlength:80}):'';
}
export function groupEditorActions({canDelete=false,removeData='',saveData=''}={}){
  return actionBlock((canDelete?button('Удалить',{variant:'danger',data:'data-desktop-group-delete '+removeData}):'')+button('Сохранить',{type:'submit',data:'data-desktop-group-save '+saveData,disabled:true}),{className:'desktop-group-editor-actions'});
}
export function confirmGroupRemoval({title,message,onConfirm,onSuccess}){
  const confirm=mountModal(document.body,modal(
    '<p>'+escapeHtml(message)+'</p><div class="form-error" role="alert" data-service-group-confirm-error></div>'+
    actionBlock(button('Удалить',{type:'button',variant:'danger',data:'data-service-group-confirm-delete'})+button('Отмена',{type:'button',variant:'secondary',data:'data-service-group-confirm-cancel'})),
    {title,variant:'x',xRole:'action',surface:'app'}
  ));
  if(!confirm)return null;
  const cancel=confirm.querySelector('[data-service-group-confirm-cancel]');
  cancel?.addEventListener('click',()=>confirm.v2Close?.());
  confirm.querySelector('[data-service-group-confirm-delete]')?.addEventListener('click',async event=>{
    const control=event.currentTarget;if(control.disabled)return;
    control.disabled=true;if(cancel)cancel.disabled=true;
    try{
      const result=await onConfirm();if(result===false||result===null)throw new Error('Не удалось удалить.');
      confirm.v2Close?.();onSuccess?.();
    }catch(cause){
      const error=confirm.querySelector('[data-service-group-confirm-error]');
      if(error)error.textContent=cause?.message||'Не удалось удалить.';
      control.disabled=false;if(cancel)cancel.disabled=false;
    }
  });
  return confirm;
}
export function renderGroupValues(host,{values=[],getId=value=>value.id,selectedId=null,reorder=false,valueData=()=>'',removeData='',canEdit=()=>true,canRemove=()=>true,onEdit,onRemove,onReorder,onError}={}){
  if(!host)return ()=>{};
  host.innerHTML=values.length?list({className:'ui-list--dense list-entries',items:values.map(value=>{
    const id=String(getId(value));
    return {title:value.name,interactive:false,reorderHandle:reorder,selected:selectedId===id,data:'data-desktop-group-value="'+escapeHtml(id)+'"'+(reorder?' data-reorder-id="'+escapeHtml(id)+'"':'')+' '+valueData(value),aria:canEdit(value)?'Изменить значение '+value.name:value.name};
  })}):emptyState('Значений пока нет');
  for(const node of host.querySelectorAll('[data-desktop-group-value]')){
    const value=values.find(item=>String(getId(item))===node.dataset.desktopGroupValue);
    if(!value)continue;
    const startEdit=()=>onEdit?.(value);
    const target=node.querySelector('.ui-list__main');
    if(target&&canEdit(value)){target.tabIndex=0;target.setAttribute('role','button');target.setAttribute('aria-label','Изменить значение '+value.name);target.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();startEdit();}});}
    if(canEdit(value))node.addEventListener('click',event=>{if(!event.target.closest?.('[data-reorder-handle],[data-desktop-value-row-delete]'))startEdit();});
    if(canRemove(value)){
      node.insertAdjacentHTML('beforeend',compactRemoveButton({data:'data-desktop-value-row-delete title="Удалить значение" '+removeData,aria:'Удалить значение '+value.name}));
      node.querySelector('[data-desktop-value-row-delete]')?.addEventListener('click',event=>{event.stopPropagation();onRemove?.(value);});
    }
  }
  return reorder&&onReorder?initV2ListReorder(host,{onReorder,onError}):()=>{};
}

// Rows are supplied by their domain. Section rows, count, delete action,
// disclosure, keyboard-open and optional drag share one native table renderer.
export function renderGroupDirectory(host,{rows,sections,collapsed,caption='Группы',getId=item=>item.id,getSection=item=>item.section,getCount=item=>item.values?.length||0,getDepth=()=>0,canOpen=()=>true,canDelete=()=>true,nameData=()=>'',deleteData='',deleteLabel='Удалить группу',openLabel='Редактировать группу',showEmpty=false,busy=()=>false,onOpen,onDelete,onReorder,onError}){
  const key=item=>String(getId(item));
  const columns=[
    ...(onReorder?[{key:'drag',label:'',narrow:true,sortable:false,render:item=>'<span class="list-entry__reorder-handle" data-reorder-handle data-desktop-group-key="'+escapeHtml(key(item))+'" role="button" tabindex="0" aria-label="'+escapeHtml('Переместить '+item.name)+'"><span aria-hidden="true">⋮⋮</span></span>'}]:[]),
    {key:'name',label:'Наименование',sortable:false,render:item=>{
      const attrs=' class="desktop-group-table-name" data-group-directory-key="'+escapeHtml(key(item))+'" style="--group-indent:'+Math.max(0,Math.min(Number(getDepth(item))||0,5))*12+'px" '+nameData(item);
      const name=escapeHtml(item.name);
      return canOpen(item)?'<button type="button"'+attrs+' aria-label="'+escapeHtml(openLabel+' '+item.name)+'">'+name+'</button>':'<span'+attrs+'>'+name+'</span>';
    }},
    {key:'values',label:'Значения',sortable:false,render:item=>String(getCount(item))},
    {key:'delete',label:'',narrow:true,sortable:false,render:item=>canDelete(item)?compactRemoveButton({data:'data-desktop-group-row-delete title="'+escapeHtml(deleteLabel)+'" '+deleteData,aria:deleteLabel+' '+item.name}):''},
  ];
  host.innerHTML='<div class="desktop-table-popup" data-desktop-group-directory-table data-group-directory>'+dataTable({columns,rows,caption,compact:true})+'</div>';
  const original=host.querySelector('tbody');if(!original)return ()=>{};
  const table=original.closest('table'),doc=host.ownerDocument;
  const byKey=new Map([...original.querySelectorAll('[data-group-directory-key]')].map(e=>[e.dataset.groupDirectoryKey,e.closest('tr')]));
  const disposers=[];
  for(const [section,label] of sections){
    const members=rows.filter(item=>getSection(item)===section);
    if(!members.length&&!showEmpty)continue;
    const heading=doc.createElement('tbody'),row=heading.insertRow();row.dataset.tableGroupLevel='system';
    const cell=row.insertCell();cell.colSpan=columns.length;
    cell.innerHTML='<button type="button" class="desktop-group-section-toggle" aria-expanded="'+!collapsed.has(section)+'"><span aria-hidden="true">'+(collapsed.has(section)?'▸':'▾')+'</span><span>'+escapeHtml(label)+'</span></button>';
    table.append(heading);
    const body=doc.createElement('tbody');if(onReorder){body.className='list-entries';body.dataset.desktopGroupKind=section;}table.append(body);body.hidden=collapsed.has(section);
    const toggle=cell.querySelector('button');toggle.addEventListener('click',()=>{
      if(busy())return;
      if(collapsed.has(section))collapsed.delete(section);else collapsed.add(section);
      body.hidden=collapsed.has(section);toggle.setAttribute('aria-expanded',String(!body.hidden));toggle.firstElementChild.textContent=body.hidden?'▸':'▾';
    });
    for(const item of members){
      const tr=byKey.get(key(item));if(!tr)continue;
      if(onReorder)tr.dataset.reorderId=key(item);body.append(tr);
      if(canOpen(item))tr.addEventListener('click',event=>{if(!busy()&&!event.target.closest?.('[data-reorder-handle],[data-table-column="delete"]'))onOpen?.(key(item));});
      tr.querySelector('[data-desktop-group-row-delete]')?.addEventListener('click',event=>{event.stopPropagation();if(!busy()&&canDelete(item))onDelete?.(key(item));});
    }
    if(!members.length){const cell=body.insertRow().insertCell();cell.colSpan=columns.length;cell.className='desktop-group-directory-empty';cell.textContent='Групп пока нет';}
    if(onReorder)disposers.push(initV2ListReorder(body,{selector:'tr[data-reorder-id]',onReorder:keys=>onReorder(section,keys),onError}));
  }
  original.remove();
  return ()=>disposers.forEach(dispose=>dispose());
}
