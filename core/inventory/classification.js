import { actionBlock, button, emptyState, field, modal, mountModal, openNotice,
  v2ListEntry, v2ListEntries } from '../../ui/ui.js';
import { getInventoryCriteria, getInventoryItems, getInventoryClassificationGroups } from './data.js';
import { loadInventoryCriteria, loadInventory, createInventoryCriterion, updateInventoryCriterion,
  createInventoryCriterionValue, updateInventoryCriterionValue,
  removeInventoryCriterionValueAndAssignments } from './service.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { openInventoryClassificationRecovery } from './classification-recovery.js';

// Only these three legacy keys retain the existing InventoryItem columns.
// User-facing names and all additional groups are read from Core.
const LEGACY = [
  {id:'manufacturer',name:'Производитель',legacyField:'manufacturer'},
  {id:'category',name:'Категория',legacyField:'category'},
  {id:'productType',name:'Тип',legacyField:'productType'},
];
const valueText = value => String(value ?? '').trim();
const compare = (a,b) => String(a).localeCompare(String(b),'ru',{numeric:true,sensitivity:'base'});
export const isFixedManufacturerCriterion = group =>
  group?.id === 'manufacturer' || group?.legacyField === 'manufacturer';

export function orderedInventoryCriteria(groups = []) {
  // Manufacturer is the immutable platform-owned root. Only subsequent
  // user-defined groups participate in hierarchy order.
  return [...groups].sort((a,b) =>
    (isFixedManufacturerCriterion(a) ? -1 : isFixedManufacturerCriterion(b) ? 1 : 0)
    || (Number(a.position) || 0) - (Number(b.position) || 0)
    || compare(a.name,b.name));
}


export function inventoryCriterionGroups() {
  const stored = getInventoryCriteria();
  return Array.isArray(stored) ? orderedInventoryCriteria(stored) : LEGACY.map(seed=>({
    ...seed,values:[...new Set(getInventoryItems().map(item=>valueText(item[seed.legacyField])).filter(Boolean))]
      .sort(compare).map(name=>({id:name,name})),
  }));
}

export function criterionOptions(group, current = '') {
  const options = [{value:'',label:'Не указано'}];
  const entries = Array.isArray(group?.values) ? group.values : [];
  entries.forEach(entry=>options.push({
    value: group.legacyField ? entry.name : entry.id,label:entry.name,
  }));
  const existing = valueText(current);
  if (existing && !options.some(option=>option.value===existing))
    options.push({value:existing,label:existing});
  return options;
}

// Legacy tree options are still used by the existing item-specific filter.
// They do not define the new editable criteria; no group tree in product forms.
export function classificationOptions(value = '') {
  const rows = getInventoryClassificationGroups().filter(group=>group && group.groupId);
  const byParent = new Map();
  rows.forEach(group=>{
    const parent=group.parentGroupId||'';
    const children=byParent.get(parent)||[];
    children.push(group);byParent.set(parent,children);
  });
  const options=[{value:'',label:'Все группы'}];
  const seen=new Set();
  const walk=(parent,depth=0)=>{
    if(depth>64)return;
    (byParent.get(parent)||[]).sort((a,b)=>(a.position||0)-(b.position||0)
      ||compare(a.name,b.name)).forEach(group=>{
      if(seen.has(group.groupId))return;
      seen.add(group.groupId);
      options.push({value:group.groupId,label:'— '.repeat(Math.min(depth,8))+group.name});
      walk(group.groupId,depth+1);
    });
  };
  walk('');
  if(value&&!options.some(item=>item.value===value))
    options.push({value,label:'Ранее выбранная группа'});
  return options;
}

export function openInventoryClassificationGroups(onSaved = () => {}) {
  const host = mountModal(document.body, modal(
    '<div data-inventory-criteria-list></div>' +
    '<p class="form-error" role="alert" data-inventory-criteria-error></p>' +
    actionBlock(
      button('Добавить группу',{data:'data-inventory-criteria-add'}) +
      button('Восстановить из таблицы',{variant:'secondary',
        data:'data-inventory-criteria-recovery'})),
    {title:'Группы',variant:'q',surface:'app'},
  ));
  if (!host) return null;
  const main = host.querySelector('[data-inventory-criteria-list]');
  const error = host.querySelector('[data-inventory-criteria-error]');
  let current = getInventoryCriteria() || [];
  const showError = cause => {
    error.textContent = cause instanceof Error ? cause.message : 'Не удалось сохранить группу.';
  };
  const save = async run => {
    try {
      error.textContent = '';
      current = await run();
      onSaved();
      return true;
    } catch(cause) {showError(cause);return false;}
  };
  // The × is a separate list action. Archive, never delete item records.
  const confirmRemove = ({title, description, onConfirm}) => {
    const layer=mountModal(document.body,modal(
      '<p>'+escapeHtml(description)+'</p>' +
      '<p class="form-error" role="alert" data-criteria-remove-error></p>' +
      actionBlock(
        button('Удалить',{variant:'delete-outline',data:'data-criteria-remove-confirm'}) +
        button('Отмена',{variant:'secondary',data:'data-criteria-remove-cancel'})
      ),{title,variant:'q',surface:'app'},
    ));
    if(!layer)return;
    layer.querySelector('[data-criteria-remove-cancel]')?.addEventListener('click',()=>layer.v2Close?.());
    let saving=false;
    const confirmButton=layer.querySelector('[data-criteria-remove-confirm]');
    confirmButton?.addEventListener('click',async()=>{
      if(saving)return;
      saving=true;
      confirmButton.disabled=true;
      const initialLabel=confirmButton.textContent;
      confirmButton.textContent='Удаляем…';
      try {
        await onConfirm();
        layer.v2Close?.();
      }catch(cause){
        const message=cause instanceof Error?cause.message:'Не удалось удалить.';
        const problem=layer.querySelector('[data-criteria-remove-error]');
        if(problem)problem.textContent=message;
        // A Q's inline footer may be outside the iPhone scroll viewport.
        // Always show the reason for a failed value/group removal.
        openNotice({title:'Не удалось удалить',message});
      }finally{
        saving=false;
        confirmButton.disabled=false;
        confirmButton.textContent=initialLabel;
      }
    });
  };
  const wireRemove = (container, selector, handler) => {
    container.querySelectorAll(selector).forEach(node=>{
      node.setAttribute('role','button');
      node.tabIndex=0;
      const activate=event=>{
        event.preventDefault();
        event.stopPropagation();
        handler(node.dataset.deleteAction);
      };
      node.addEventListener('click',activate);
      node.addEventListener('keydown',event=>{
        if(event.key==='Enter'||event.key===' '){activate(event);}
      });
    });
  };
  const removeGroup = id => {
    const group=current.find(row=>row.id===id);
    if(!group || isFixedManufacturerCriterion(group))return;
    confirmRemove({
      title:'Удалить группу',
      description:'Группа «'+group.name+'» исчезнет из списка. Товары и остатки сохранятся.',
      onConfirm:async()=>{
        current=await updateInventoryCriterion(group.id,{archived:true});
        onSaved();
        refresh();
      },
    });
  };
  const editName = (group = null, onFinished = () => {}) => {
    if (isFixedManufacturerCriterion(group)) return;
    const editor = mountModal(document.body, modal(
      '<form data-inventory-criterion-form>' +
      field({label:'Название группы',name:'name',value:group?.name||'',required:true}) +
      '<p class="form-error" data-inventory-criterion-edit-error role="alert"></p>' +
      actionBlock(button('Сохранить',{type:'submit'}) +
        (group ? button('Удалить группу',{type:'button',variant:'delete-outline',
          data:'data-inventory-criterion-remove'}) : '')) +
      '</form>',{title:group?'Изменить группу':'Новая группа',variant:'q',surface:'app'},
    ));
    if(!editor)return;
    const form=editor.querySelector('[data-inventory-criterion-form]');
    const message=editor.querySelector('[data-inventory-criterion-edit-error]');
    let saving=false;
    const run=async patch=>{
      if(saving)return;
      saving=true;
      try {
        const name = valueText(patch?.name);
        if(!patch?.archived && !name)throw new Error('Введите название группы.');
        const ok=await save(()=>group
          ? updateInventoryCriterion(group.id,patch)
          : createInventoryCriterion(name));
        if(ok){editor.v2Close?.();refresh();onFinished();}
        else message.textContent=error.textContent;
      } finally{saving=false;}
    };
    form.addEventListener('submit',event=>{
      event.preventDefault();
      void run({name:form.elements.namedItem('name')?.value});
    });
    form.querySelector('[data-inventory-criterion-remove]')?.addEventListener('click',()=>{
      void run({archived:true});
    });
  };
  const removeValue = (group, entry, afterRemoved = () => {}) => {
    confirmRemove({
      title:'Удалить значение',
      description:'Значение «'+entry.name+'» будет удалено, а его назначения '+
        'в товарах сняты. Сами товары и остатки сохранятся.',
      onConfirm:async()=>{
        const result=await removeInventoryCriterionValueAndAssignments(group,entry);
        current=result.groups;
        onSaved();
        refresh();
        group.refreshValues?.();
        afterRemoved();
      },
    });
  };
  const valueEditor = (group, entry = null) => {
    const editor = mountModal(document.body, modal(
      '<form data-inventory-criterion-value-form>' +
      field({label:'Значение',name:'name',value:entry?.name||'',required:true}) +
      '<p class="form-error" role="alert" data-inventory-criterion-value-error></p>' +
      actionBlock(button('Сохранить',{type:'submit'}) +
        (entry ? button('Удалить значение',{variant:'delete-outline',type:'button',
          data:'data-inventory-criterion-value-delete'}) : '')) +
      '</form>',{title:entry?'Значение':'Новое значение',variant:'q',surface:'app'},
    ));
    if(!editor)return;
    const form=editor.querySelector('[data-inventory-criterion-value-form]');
    const message=editor.querySelector('[data-inventory-criterion-value-error]');
    let saving=false;
    const perform=async patch=>{
      if(saving)return;
      saving=true;
      try {
        if(!patch.archived&&!valueText(patch.name))throw new Error('Введите значение.');
        if(entry) current = await updateInventoryCriterionValue(group.id,entry.id,patch);
        else current = await createInventoryCriterionValue(group.id,patch.name);
        if(entry&&patch.name)await loadInventory();
        editor.v2Close?.();
        onSaved();
        refresh();
        group.refreshValues?.();
      }catch(cause){
        message.textContent=cause instanceof Error?cause.message:'Не удалось сохранить значение.';
      }finally{saving=false;}
    };
    form.addEventListener('submit',event=>{
      event.preventDefault();
      void perform({name:form.elements.namedItem('name')?.value});
    });
    form.querySelector('[data-inventory-criterion-value-delete]')?.addEventListener('click',()=>{
      if(entry)removeValue(group,entry,()=>editor.v2Close?.());
    });
  };
  const openValues = id => {
    const group=current.find(entry=>entry.id===id);
    if(!group)return;
    const layer=mountModal(document.body,modal(
      '<div data-inventory-criterion-values></div>'+
      actionBlock(button('Добавить значение',{data:'data-inventory-add-criterion-value'})+
        (isFixedManufacturerCriterion(group) ? '' :
          button('Изменить группу',{variant:'secondary',data:'data-inventory-edit-criterion'}))),
      {title:group.name,variant:'q',surface:'app'},
    ));
    if(!layer)return;
    const container=layer.querySelector('[data-inventory-criterion-values]');
    const renderValues=()=>{
      const now=current.find(entry=>entry.id===id);
      if(!now){layer.v2Close?.();return;}
      container.innerHTML=now.values.length?v2ListEntries(now.values.map(item=>v2ListEntry({
        title:item.name,interactive:true,initial:'',omitEmptySubtitle:true,
        aria:'Изменить значение '+item.name,
        data:'data-inventory-criterion-value="'+escapeHtml(item.id)+'"',
        deleteData:item.id,deleteAria:'Удалить значение '+item.name,
      }))):emptyState('Значений пока нет');
      container.querySelectorAll('[data-inventory-criterion-value]').forEach(node=>
        node.addEventListener('click',event=>{
          if(event.target.closest('[data-delete-action]'))return;
          const updated=current.find(entry=>entry.id===id);
          const item=updated?.values.find(value=>value.id===node.dataset.inventoryCriterionValue);
          if(item)valueEditor({...updated, refreshValues:renderValues},item);
        }));
      wireRemove(container,'[data-inventory-criterion-value] [data-delete-action]',valueId=>{
        const updated=current.find(entry=>entry.id===id);
        const value=updated?.values.find(entry=>entry.id===valueId);
        if(!value)return;
        removeValue({...updated,refreshValues:renderValues},value);
      });
    };
    layer.querySelector('[data-inventory-add-criterion-value]')?.addEventListener('click',()=>{
      const now=current.find(entry=>entry.id===id);
      if(now)valueEditor({...now,refreshValues:renderValues});
    });
    layer.querySelector('[data-inventory-edit-criterion]')?.addEventListener('click',()=>{
      const now=current.find(entry=>entry.id===id);
      if(now)editName(now,()=>layer.v2Close?.());
    });
    renderValues();
  };
  const refresh=()=>{
    if(!main)return;
    main.innerHTML=current.length?v2ListEntries(orderedInventoryCriteria(current).map(group=>v2ListEntry({
      title:group.name,rightTop:group.values.length+' знач.',
      interactive:true,initial:'',omitEmptySubtitle:true,
      aria:'Открыть значения '+group.name,
      data:'data-inventory-criterion-group="'+escapeHtml(group.id)+'"',
      deleteData:isFixedManufacturerCriterion(group) ? '' : group.id,
      deleteAria:'Удалить группу '+group.name,
    }))):emptyState('Групп пока нет');
    main.querySelectorAll('[data-inventory-criterion-group]').forEach(node=>
      node.addEventListener('click',event=>{
        if(event.target.closest('[data-delete-action]'))return;
        openValues(node.dataset.inventoryCriterionGroup);
      }));
    wireRemove(main,'[data-inventory-criterion-group] [data-delete-action]',removeGroup);
  };
  host.querySelector('[data-inventory-criteria-add]')?.addEventListener('click',()=>editName());
  host.querySelector('[data-inventory-criteria-recovery]')?.addEventListener('click',()=>
    openInventoryClassificationRecovery(()=>{
      current=getInventoryCriteria()||[];
      refresh();
      onSaved();
    }));
  if(current.length)refresh();
  else main.innerHTML=emptyState('Загружаем группы…');
  void loadInventoryCriteria().then(rows=>{current=rows;refresh();}).catch(showError);
  return host;
}
