import { actionBlock, button, emptyState, field, list, modal, mountModal } from '../../ui/ui.js';
import { getInventoryCriteria, getInventoryItems, getInventoryClassificationGroups } from './data.js';
import { loadInventoryCriteria, loadInventory, createInventoryCriterion, updateInventoryCriterion,
  createInventoryCriterionValue, updateInventoryCriterionValue } from './service.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';

// Only these three legacy keys retain the existing InventoryItem columns.
// User-facing names and all additional groups are read from Core.
const LEGACY = [
  {id:'manufacturer',name:'Производитель',legacyField:'manufacturer'},
  {id:'category',name:'Категория',legacyField:'category'},
  {id:'productType',name:'Тип',legacyField:'productType'},
];
const valueText = value => String(value ?? '').trim();
const compare = (a,b) => String(a).localeCompare(String(b),'ru',{numeric:true,sensitivity:'base'});

export function inventoryCriterionGroups() {
  const stored = getInventoryCriteria();
  return Array.isArray(stored) && stored.length ? stored : LEGACY.map(seed=>({
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
    actionBlock(button('Добавить группу',{data:'data-inventory-criteria-add'})),
    {title:'Группы',variant:'q',surface:'app'},
  ));
  if (!host) return null;
  const main = host.querySelector('[data-inventory-criteria-list]');
  const error = host.querySelector('[data-inventory-criteria-error]');
  let current = getInventoryCriteria();
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
  const editName = (group = null, onFinished = () => {}) => {
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
      void perform({archived:true});
    });
  };
  const openValues = id => {
    const group=current.find(entry=>entry.id===id);
    if(!group)return;
    const layer=mountModal(document.body,modal(
      '<div data-inventory-criterion-values></div>'+
      actionBlock(button('Добавить значение',{data:'data-inventory-add-criterion-value'})+
        button('Изменить группу',{variant:'secondary',data:'data-inventory-edit-criterion'})),
      {title:group.name,variant:'q',surface:'app'},
    ));
    if(!layer)return;
    const container=layer.querySelector('[data-inventory-criterion-values]');
    const renderValues=()=>{
      const now=current.find(entry=>entry.id===id);
      if(!now){layer.v2Close?.();return;}
      container.innerHTML=now.values.length?list({
        className:'ui-list--dense',
        items:now.values.map(item=>({
          title:item.name,interactive:true,
          aria:'Изменить значение '+item.name,
          data:'data-inventory-criterion-value="'+escapeHtml(item.id)+'"',
        })),
      }):emptyState('Значений пока нет');
      container.querySelectorAll('[data-inventory-criterion-value]').forEach(node=>
        node.addEventListener('click',()=>{
          const updated=current.find(entry=>entry.id===id);
          const item=updated?.values.find(value=>value.id===node.dataset.inventoryCriterionValue);
          if(item)valueEditor({...updated, refreshValues:renderValues},item);
        }));
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
    main.innerHTML=current.length?list({
      className:'ui-list--dense',
      items:current.map(group=>({
        title:group.name,secondary:group.values.length+' знач.',
        interactive:true,aria:'Открыть значения '+group.name,
        data:'data-inventory-criterion-group="'+escapeHtml(group.id)+'"',
      })),
    }):emptyState('Групп пока нет');
    main.querySelectorAll('[data-inventory-criterion-group]').forEach(node=>
      node.addEventListener('click',()=>openValues(node.dataset.inventoryCriterionGroup)));
  };
  host.querySelector('[data-inventory-criteria-add]')?.addEventListener('click',()=>editName());
  if(current.length)refresh();
  else main.innerHTML=emptyState('Загружаем группы…');
  void loadInventoryCriteria().then(rows=>{current=rows;refresh();}).catch(showError);
  return host;
}
