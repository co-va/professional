import { bindServiceNameSave } from './editor-actions.js';
import {
  actionBlock, button, compactAddButton, compactRemoveButton, compactButton, emptyState, field, initV2ListReorder,
  dataTable, list, modal, mountModal, openNotice, select, v2ListEntries, v2ListEntry,
} from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { moveDesktopQTool } from '../../ui/v2/z-layout.js';
import { catalogDisclosure } from '../inventory/catalog-ui.js';
import { stockGroupTree, sortedStockChildren } from '../inventory/grouping.js';
import {
  getServiceGroupLevels, commitServiceGroupLevels,
  getServiceGroupEntries, commitServiceGroupOrder, commitServiceGroupSection,
} from './products/data.js';

const id = () => crypto.randomUUID();
const kindLabel = kind => kind === 'products' ? 'Группа товаров' : 'Группа услуг';

// A group definition is not an assignment. The owner chooses each group with
// the compact + in the individual Service card, and may leave it unassigned.
// Explicit group-only selection must survive saved and rehydrated data.
export const SERVICE_GROUP_ONLY = '__service_group_only__';

function serviceGroupSlots(levels, selected = {}) {
  const assigned = levels.filter(group => Object.prototype.hasOwnProperty.call(selected || {}, group.id)
    && String(selected[group.id] || '').trim())
    .map(group => ({ id: group.id, value: String(selected[group.id]) }));
  return assigned.length ? assigned : [{ id: '', value: '' }];
}

function serviceGroupRow(slot, index, levels, used) {
  const group = levels.find(entry => entry.id === slot.id);
  const groupOptions = [{ value: '', label: 'Выберите группу' },
    ...levels.filter(entry => entry.id === slot.id || !used.has(entry.id))
      .map(entry => ({ value: entry.id, label: entry.name }))];
  const valueOptions = [{ value: '', label: 'Не указано' },
    ...(Array.isArray(group?.values) ? group.values : [])
      .map(entry => ({ value: entry.id, label: entry.name }))];
  return '<div class="stock-position-group-row stock-position-group-row--removable" data-service-group-row="' + index + '">' +
    select({ name: 'serviceGroupKind' + index, aria: 'Группа ' + (index + 1),
      value: slot.id, options: groupOptions }) +
    select({ name: 'serviceGroupValue' + index, aria: 'Значение группы ' + (index + 1),
      value: slot.value === SERVICE_GROUP_ONLY ? '' : slot.value, options: valueOptions }) +
    compactRemoveButton({ data: 'data-service-group-remove="' + index + '"',
      aria: 'Снять группу', disabled: !slot.id }) + '</div>';
}

export function serviceGroupFields(kind, selected = {}) {
  const levels = getServiceGroupLevels(kind);
  const slots = serviceGroupSlots(levels, selected);
  const used = new Set(slots.map(slot => slot.id).filter(Boolean));
  return '<section class="inventory-editor-group" data-service-position-groups="' + escapeHtml(kind) + '">' +
    '<div class="stock-position-group-heading"><span>Группы</span>' +
      '<div class="inventory-editor-extra-toggles">' +
        compactAddButton({ data: 'data-service-group-add', aria: 'Добавить группу' }) +
        compactButton({ kind: 'info', data: 'data-service-group-info', aria: 'О группировке' }) +
      '</div></div>' +
    '<div data-service-group-rows>' +
      slots.map((slot, index) => serviceGroupRow(slot, index, levels, used)).join('') +
    '</div></section>';
}

// No chosen group means no assignment; an explicitly chosen group with no
// value remains assigned to its top-level folder only.
export function readServiceGroupFields(root) {
  return Object.fromEntries(
    [...(root?.querySelectorAll?.('[data-service-group-row]') || [])].map(row => {
      const id = String(row.querySelector('[name^="serviceGroupKind"]')?.value || '');
      const value = String(row.querySelector('[name^="serviceGroupValue"]')?.value || '');
      return [id, value || SERVICE_GROUP_ONLY];
    }).filter(([id]) => id),
  );
}

export function bindServiceGroupFields(root) {
  const sections = [...(root?.querySelectorAll?.('[data-service-position-groups]') || [])];
  const unsubscribers = sections.map(section => {
    const levels = getServiceGroupLevels(section.dataset.servicePositionGroups);
    const rows = section.querySelector('[data-service-group-rows]');
    const plus = section.querySelector('[data-service-group-add]');
    if (!rows || !plus) return () => {};
    let slots = serviceGroupSlots(levels, readServiceGroupFields(section));
    const draw = () => {
      const used = new Set(slots.map(slot => slot.id).filter(Boolean));
      rows.innerHTML = slots.map((slot, index) => serviceGroupRow(slot, index, levels, used)).join('');
      plus.disabled = slots.length >= levels.length || !slots.every(slot => slot.id);
    };
    const changed = () => section.dispatchEvent(new Event('change', { bubbles: true }));
    const onClick = event => {
      if (event.target.closest?.('[data-service-group-info]')) {
        const title = 'Группы';
        const message = 'Выберите группу и при необходимости её значение. Кнопка «+» добавляет ещё одну группу. Без выбора группировка не применяется.';
        mountModal(document.body, modal(
          '<div class="modal-title"><h2>' + escapeHtml(title) + '</h2><p>' +
            escapeHtml(message) + '</p></div>',
          { title, variant: 'technical', surface: 'app' },
        ));
        return;
      }
      const remove = event.target.closest?.('[data-service-group-remove]');
      if (remove && section.contains(remove)) {
        const index = Number(remove.dataset.serviceGroupRemove);
        if (!Number.isSafeInteger(index) || index < 0 || index >= slots.length) return;
        if (slots.length === 1) slots = [{ id: '', value: '' }];
        else slots.splice(index, 1);
        draw();
        changed();
        return;
      }
      if (!event.target.closest?.('[data-service-group-add]')) return;
      if (slots.length >= levels.length || !slots.every(slot => slot.id)) return;
      slots.push({ id: '', value: '' });
      draw();
    };
    const onChange = event => {
      const name = String(event.target?.name || '');
      const kind = name.match(/^serviceGroupKind(\d+)$/);
      const value = name.match(/^serviceGroupValue(\d+)$/);
      if (kind && slots[Number(kind[1])]) {
        slots[Number(kind[1])] = { id: String(event.target.value || ''), value: '' };
      } else if (value && slots[Number(value[1])]) {
        slots[Number(value[1])].value = String(event.target.value || '');
      } else return;
      draw();
      changed();
    };
    section.addEventListener('click', onClick);
    section.addEventListener('change', onChange);
    draw();
    return () => {
      section.removeEventListener('click', onClick);
      section.removeEventListener('change', onChange);
    };
  });
  return () => unsubscribers.forEach(dispose => dispose());
}

// Existing Stock disclosure and V2 items, but a named group must fold even if
// it has NO values. With values: "Инструменты" → "Брашинг" → V2 positions.
// Multiple chosen groups are nested in the configured order, never implicit.
export function renderServiceGroupTree(items = [], kind = 'procedures', renderRow = () => '', onReorder = () => {}, onError = () => {}, { desktop = false, onCount = () => {} } = {}) {
  const levels = getServiceGroupLevels(kind);
  if (!levels.length && !desktop) return null;
  const criteria = levels.flatMap(group => [
    { id: '__service_group_' + group.id, values: [{ id: 'selected', name: group.name }] },
    { id: group.id, values: group.values || [] },
  ]);
  const decorated = items.map(item => {
    const criteriaValues = {};
    for (const group of levels) {
      const value = String(item.groupValues?.[group.id] || '').trim();
      if (!value) continue;
      criteriaValues['__service_group_' + group.id] = 'selected';
      if (value !== SERVICE_GROUP_ONLY &&
          group.values?.some(option => option.id === value)) criteriaValues[group.id] = value;
    }
    return { ...item, criteriaValues };
  });
  const tree = stockGroupTree(decorated, criteria);
  const directRows = rows => rows.length
    ? v2ListEntries(rows.map(renderRow)) : '';
  const walk = node => sortedStockChildren(node, criteria).map(child => {
    // No auto-expansion: one group is still deliberately collapsible.
    return catalogDisclosure(child.value, walk(child), Boolean(node.key), child.items.length);
  }).join('') + directRows(node.direct);
  // Desktop selects one existing top-level branch instead of folding all
  // branches into separate panels. The shared tree still owns membership,
  // order and nested groups; unassigned items remain reachable.
  const branches = desktop ? sortedStockChildren(tree, criteria).map(node => ({
    key: node.key, label: node.value, count: node.items.length, content: walk(node),
  })) : [];
  if (desktop && tree.direct.length) branches.push({
    key: '', label: levels.length ? 'Без группы' : (kind === 'products' ? 'Товары' : 'Услуги'), count: tree.direct.length, content: directRows(tree.direct),
  });
  const initial = branches[0];
  const html = desktop && initial
    ? '<section data-service-desktop-group-list>' +
      '<div class="service-desktop-group-header">' +
      (levels.length ? select({ name: 'serviceCatalogGroup', value: initial.key,
        options: branches.map(branch => ({ value: branch.key, label: branch.label })),
        aria: 'Группа каталога', className: 'service-desktop-group-select' }) :
        '<span class="service-desktop-group-title">' + escapeHtml(initial.label) + '</span>') +
      '<span class="service-desktop-price-title">Цена</span></div>' +
      '<div class="service-desktop-group-body" data-service-group-catalog>' +
      branches.map((branch, index) => '<div data-service-group-branch="' + index + '"' +
        (index === 0 ? '' : ' hidden') + '>' + branch.content + '</div>').join('') +
      '</div></section>'
    : '<div data-service-group-catalog>' + walk(tree) + '</div>';
  const attach = host => {
    const selector = host.querySelector('input[name="serviceCatalogGroup"]');
    if (desktop && initial) onCount(initial.count);
    const views = [...host.querySelectorAll('[data-service-group-branch]')];
    // Open the selected list's nested groups initially as well. They remain
    // normal native disclosures, with the original subgroup reorder scopes.
    if (desktop) host.querySelectorAll('[data-service-group-branch] details').forEach(details => {
      details.open = true;
    });
    const switchBranch = () => {
      const index = branches.findIndex(branch => branch.key === selector?.value);
      if (index < 0) return;
      views.forEach((view, i) => { view.hidden = i !== index; });
      if (desktop) onCount(branches[index].count);
      const body = host.querySelector('.service-desktop-group-body');
      if (body) body.scrollTop = 0;
    };
    selector?.addEventListener('change', switchBranch);
    const disposers = [...host.querySelectorAll('.list-entries')].map(groupList =>
      initV2ListReorder(groupList, {
        onReorder: async ids => {
          const currentOrder = items.map(item => String(item.id));
          const chosen = new Set(ids);
          let offset = 0;
          const merged = currentOrder.map(key => chosen.has(key) ? ids[offset++] : key);
          await onReorder(merged);
        },
        onError,
      }));
    return () => {
      selector?.removeEventListener('change', switchBranch);
      disposers.forEach(dispose => dispose?.());
    };
  };
  return { html, attach };
}

// Shared V → Группы directory. A V2 row has the group name in the main line
// and EXACTLY "Группа товаров" / "Группа услуг" in the small secondary line.
// Groups and all their values share one existing Service auxiliary dataset.
// Only creation/editing uses compact X. There is never a second Q for values.
export function openServiceGroupingQ({ onSaved = () => {}, desktop = false } = {}) {
  let layer = null;
  let activeKey = null;
  let disposeDrag = () => {};

  const fail = cause => openNotice({
    title: 'Группы',
    message: cause instanceof Error ? cause.message : 'Не удалось сохранить.',
  });
  const persist = async (kind, next) => {
    await commitServiceGroupLevels(kind, next);
    onSaved();
    if (layer) repaint();
  };
  const groupByKey = key => getServiceGroupEntries().find(item => item.key === key);

  const confirmRemove = (title, action, message = 'Позиции останутся на месте, изменится только группировка.') => {
    const confirm = mountModal(document.body, modal(
      '<p>' + escapeHtml(message) + '</p>' +
        '<div class="form-error" role="alert" data-service-group-confirm-error></div>' +
        actionBlock(button('Удалить', {
          type: 'button', variant: 'danger', data: 'data-service-group-confirm-delete',
        }) + button('Отмена', {
          type: 'button', variant: 'secondary', data: 'data-service-group-confirm-cancel',
        })),
      { title, variant: 'x', xRole: 'action', surface: 'app' },
    ));
    if (!confirm) return;
    confirm.querySelector('[data-service-group-confirm-cancel]')
      ?.addEventListener('click', () => confirm.v2Close?.());
    confirm.querySelector('[data-service-group-confirm-delete]')
      ?.addEventListener('click', async event => {
        const control = event.currentTarget;
        if (control.disabled) return;
        control.disabled = true;
        try {
          await action();
          confirm.v2Close?.();
        } catch (cause) {
          const error = confirm.querySelector('[data-service-group-confirm-error]');
          if (error) error.textContent = cause?.message || 'Не удалось удалить.';
          control.disabled = false;
        }
      });
  };

  const groupEditorX = (previous = null, afterCreate = null) => {
    const editor = mountModal(document.body, modal(
      '<form class="compact-form" data-service-group-editor-form>' +
        (previous ? '' : select({
          label: 'Раздел', name: 'groupKind', value: 'procedures',
          options: [
            { value: 'procedures', label: 'Услуги' },
            { value: 'products', label: 'Товары' },
          ],
        })) +
        field({ label: 'Наименование группы', name: 'name',
          value: previous?.name || '', required: true, maxlength: 80 }) +
        '<div class="form-error" role="alert" data-service-group-editor-error></div>' +
        actionBlock(
          button('Сохранить', {
            type: 'submit', data: 'data-service-group-editor-save',
          }) +
          (previous ? button('Удалить группу', {
            type: 'button', variant: 'danger', data: 'data-service-group-editor-delete',
          }) : ''),
        ) +
      '</form>',
      { title: previous ? 'Группа' : 'Добавить группу',
        variant: 'x', xRole: 'editor', surface: 'app' },
    ));
    if (!editor) return null;
    const form = editor.querySelector('[data-service-group-editor-form]');
    const saveButton = editor.querySelector('[data-service-group-editor-save]');
    let busy = false;
    const hasChange = bindServiceNameSave(form, saveButton, previous);
    form?.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || !hasChange()) return;
      const section = previous?.kind || String(new FormData(form).get('groupKind') || '');
      const title = String(new FormData(form).get('name') || '').trim();
      if (!title || !['procedures', 'products'].includes(section)) return;
      busy = true;
      try {
        const existing = getServiceGroupLevels(section);
        const next = previous
          ? existing.map(group => group.id === previous.id
            ? { ...group, name: title } : group)
          : [...existing, { id: id(), name: title, values: [] }];
        await persist(section, next);
        editor.v2Close?.();
        // With no groups, enter through X only. After the first save, show
        // the same single combined Q instead of opening another blank form.
        if (afterCreate) afterCreate();
        else if (!layer) openServiceGroupingQ({ onSaved });
      } catch (cause) {
        const error = editor.querySelector('[data-service-group-editor-error]');
        if (error) error.textContent = cause?.message || 'Не удалось сохранить.';
      } finally { busy = false; }
    });
    editor.querySelector('[data-service-group-editor-delete]')
      ?.addEventListener('click', () => {
        if (!previous) return;
        confirmRemove('Удалить группу?', async () => {
          await persist(previous.kind, getServiceGroupLevels(previous.kind)
            .filter(group => group.id !== previous.id));
          editor.v2Close?.();
          activeKey = null;
          repaint();
        });
      });
    return editor;
  };

  // Desktop Q is a directory only. Creation and editing use X.
  if (desktop) {
    const q=mountModal(document.body,modal(
      '<div data-desktop-group-content></div>'+
      compactButton({kind:'add',className:'v2-desktop-tool-primary',data:'data-desktop-group-add title="Добавить группу"',aria:'Добавить группу'}),
      {title:'Группы',variant:'q',surface:'app',className:'desktop-service-groups-q'}
    ));
    if(!q)return null;
    const content=q.querySelector('[data-desktop-group-content]');
    const add=q.querySelector('[data-desktop-group-add]');
    moveDesktopQTool(add);
    let busy=false,dispose=()=>{};
    const collapsed=new Set();
    const sync=()=>{add.disabled=busy;content.querySelectorAll('[data-desktop-group-row-delete]').forEach(control=>control.disabled=busy);};
    const removeGroup=async key=>{
      const fresh=groupByKey(key);
      if(!fresh)throw new Error('Группа больше не существует.');
      await commitServiceGroupLevels(fresh.kind,getServiceGroupLevels(fresh.kind).filter(item=>item.id!==fresh.id));
      onSaved();render();
    };
    const groupRemovalMessage=group=>'Группировка по группе «'+group.name+'» станет недоступна. Сама группа и её значения будут удалены. Услуги и товары останутся в списках.';


    const openEditor=previous=>{
      if(busy)return;
      const editor=mountModal(q,modal(
        '<form class="compact-form" data-desktop-group-form>'+
        select({label:'Раздел',name:'groupKind',value:previous?.kind||'procedures',options:[{value:'procedures',label:'Услуги'},{value:'products',label:'Товары'}]})+
        field({label:'Наименование группы',name:'name',value:previous?.name||'',required:true,maxlength:80})+
        (previous?'<div class="desktop-group-values"><div class="stock-position-group-heading"><span>Значения</span>'+compactAddButton({data:'data-desktop-group-value-add',aria:'Добавить значение'})+'</div><div data-desktop-group-value-draft></div><div data-service-group-value-list></div></div>':'')+
        '<div class="form-error" role="alert" data-desktop-group-error></div>'+
        actionBlock((previous?button('Удалить группу',{variant:'danger',data:'data-desktop-group-delete'}):'')+
          button('Сохранить',{type:'submit',data:'data-desktop-group-save',disabled:!previous}),{className:'desktop-group-editor-actions'})+
        '</form>',
        {title:previous?'Группа':'Добавить группу',variant:'x',xRole:'editor',surface:'app',className:'desktop-service-group-editor-x'}
      ));
      if(!editor)return;
      const form=editor.querySelector('[data-desktop-group-form]');
      const error=editor.querySelector('[data-desktop-group-error]');
      const save=editor.querySelector('[data-desktop-group-save]');
      const remove=editor.querySelector('[data-desktop-group-delete]');
      const plus=editor.querySelector('[data-desktop-group-value-add]');
      const draftHost=editor.querySelector('[data-desktop-group-value-draft]');
      const listHost=editor.querySelector('[data-service-group-value-list]');
      let group=previous,pending=false,valueEdit=null,disposeValues=()=>{};
      const current=()=>group?groupByKey(group.key):null;
      const name=()=>String(form.elements.namedItem('name')?.value||'').trim();
      const kind=()=>String(form.elements.namedItem('groupKind')?.value||'');
      const valueName=()=>String(draftHost?.querySelector('[name="valueName"]')?.value||'').trim();
      const canSave=()=>Boolean(name()&&['procedures','products'].includes(kind())&&(!valueEdit||valueName())&&(!group||name()!==group.name||kind()!==group.kind||(valueEdit&&(valueEdit.isNew||valueName()!==valueEdit.name))));
      const syncEditor=()=>{
        save.style.display=!previous||valueEdit||canSave()?'':'none';
        save.disabled=pending||!canSave();
        if(remove){remove.disabled=pending;remove.hidden=Boolean(valueEdit);}
        if(plus)plus.disabled=pending||Boolean(valueEdit);
        listHost?.querySelectorAll('[data-desktop-value-row-delete]').forEach(control=>control.disabled=pending);
      };
      const drawValues=()=>{
        if(!listHost)return;
        disposeValues();disposeValues=()=>{};
        const values=current()?.values||[];
        listHost.innerHTML=values.length?list({className:'ui-list--dense list-entries',items:values.map(value=>({
          title:value.name,interactive:false,reorderHandle:!valueEdit,selected:valueEdit?.id===value.id,
          data:'data-desktop-group-value="'+escapeHtml(value.id)+'" data-reorder-id="'+escapeHtml(value.id)+'"',
          aria:'Изменить значение '+value.name,
        }))}):emptyState('Значений пока нет');
        listHost.querySelectorAll('[data-desktop-group-value]').forEach(node=>{
          const valueId=node.dataset.desktopGroupValue;
          const value=values.find(item=>item.id===valueId);
          const editTarget=node.querySelector('.ui-list__main');
          const startEdit=()=>{
            if(pending||valueEdit||!value)return;
            valueEdit={...value,isNew:false};drawDraft();drawValues();
            draftHost.querySelector('input')?.focus();
          };
          if(editTarget){
            editTarget.tabIndex=0;
            editTarget.setAttribute('role','button');
            editTarget.setAttribute('aria-label','Изменить значение '+value.name);
            editTarget.addEventListener('keydown',event=>{
              if(event.key==='Enter'||event.key===' '){event.preventDefault();startEdit();}
            });
          }
          node.addEventListener('click',event=>{
            if(event.target.closest?.('[data-reorder-handle],[data-desktop-value-row-delete]'))return;
            startEdit();
          });
          node.insertAdjacentHTML('beforeend',compactRemoveButton({data:'data-desktop-value-row-delete title="Удалить значение"',aria:'Удалить значение '+value.name}));
          node.querySelector('[data-desktop-value-row-delete]').addEventListener('click',event=>{
            event.stopPropagation();
            if(pending)return;
            confirmRemove('Удалить значение?',async()=>{
              const fresh=current();
              if(pending||!fresh||!fresh.values?.some(item=>item.id===valueId))throw new Error('Значение недоступно.');
              pending=true;syncEditor();
              try{
                await commitServiceGroupLevels(fresh.kind,getServiceGroupLevels(fresh.kind).map(item=>item.id===fresh.id?{...item,values:(item.values||[]).filter(entry=>entry.id!==valueId)}:item));
                group=current();
                if(valueEdit?.id===valueId){valueEdit=null;drawDraft();}
                onSaved();render();drawValues();
              }finally{pending=false;syncEditor();}
            },'Значение «'+value.name+'» будет удалено. Остальные значения, группа, услуги и товары останутся на месте.');
          });
        });
        if(!valueEdit)disposeValues=initV2ListReorder(listHost,{
          onReorder:async ids=>{
            const fresh=current();
            if(pending||!fresh)throw new Error('Группа недоступна.');
            const byId=new Map((fresh.values||[]).map(value=>[value.id,value]));
            if(ids.length!==byId.size||new Set(ids).size!==byId.size||ids.some(id=>!byId.has(id)))throw new Error('Список значений изменился.');
            pending=true;syncEditor();
            try{
              await commitServiceGroupLevels(fresh.kind,getServiceGroupLevels(fresh.kind).map(item=>item.id===fresh.id?{...item,values:ids.map(id=>byId.get(id))}:item));
              group=current();onSaved();render();
            }finally{pending=false;syncEditor();}
          },onError:fail,
        });
        syncEditor();
      };
      const drawDraft=()=>{
        if(!draftHost)return;
        draftHost.innerHTML=valueEdit?field({label:'Наименование значения',name:'valueName',value:valueEdit.name,required:true,maxlength:80}):'';
        syncEditor();
      };
      plus?.addEventListener('click',()=>{if(!pending&&!valueEdit){valueEdit={id:null,name:'',isNew:true};drawDraft();drawValues();draftHost.querySelector('input')?.focus();}});
      form.addEventListener('input',syncEditor);
      form.addEventListener('change',syncEditor);
      form.addEventListener('submit',async event=>{
        event.preventDefault();
        if(pending||!canSave()||!['procedures','products'].includes(kind()))return;
        const section=kind(),title=name(),fresh=current(),editingValue=valueEdit;
        if(group&&!fresh){error.textContent='Группа больше не существует.';return;}
        const nextId=fresh?.id||id();
        const values=fresh?.values||[];
        if(editingValue&&!editingValue.isNew&&!values.some(value=>value.id===editingValue.id)){error.textContent='Значение больше не существует.';return;}
        const nextValues=!editingValue?values:editingValue.isNew?[...values,{id:id(),name:valueName()}]:values.map(value=>value.id===editingValue.id?{...value,name:valueName()}:value);
        const nextGroup={...(fresh||{}),id:nextId,name:title,values:nextValues};
        pending=true;syncEditor();error.textContent='';
        try{
          if(fresh&&fresh.kind!==section)await commitServiceGroupSection(fresh.kind,section,nextGroup);
          else{
            const entries=getServiceGroupLevels(section);
            await commitServiceGroupLevels(section,fresh?entries.map(item=>item.id===nextId?nextGroup:item):[...entries,nextGroup]);
          }
          onSaved();render();
          if(editingValue){
            group=getServiceGroupEntries().find(item=>item.kind===section&&item.id===nextId);
            valueEdit=null;drawDraft();drawValues();
          }else{pending=false;editor.v2Close?.();}
        }catch(cause){error.textContent=cause?.message||'Не удалось сохранить.';}
        finally{pending=false;syncEditor();}
      });
      remove?.addEventListener('click',()=>{
        if(pending||!current())return;
        confirmRemove('Удалить группу?',async()=>{
          const fresh=current();
          if(!fresh)throw new Error('Группа больше не существует.');
          pending=true;syncEditor();
          try{
            await removeGroup(fresh.key);
            pending=false;editor.v2Close?.();
          }finally{pending=false;syncEditor();}
        },groupRemovalMessage(current()));
      });
      const closeEditor=editor.v2Close?.bind(editor);
      if(closeEditor)editor.v2Close=()=>{if(!pending){disposeValues();closeEditor();}};
      drawValues();syncEditor();
    };
    function render(){
      dispose();dispose=()=>{};
        const entries = getServiceGroupEntries();
        const columns = [
          {key:'drag',label:'',narrow:true,sortable:false,render:group=>'<span class="list-entry__reorder-handle" data-reorder-handle data-desktop-group-key="'+escapeHtml(group.key)+'" role="button" tabindex="0" aria-label="'+escapeHtml('Переместить '+group.name)+'"><span aria-hidden="true">⋮⋮</span></span>'},
          {key:'name',label:'Наименование',sortable:false,render:group=>button(escapeHtml(group.name),{variant:'secondary',className:'desktop-group-table-name',data:'data-desktop-group-open',aria:'Редактировать группу '+group.name})},
          {key:'values',label:'Значения',sortable:false,render:group=>String(Array.isArray(group.values)?group.values.length:0)},
          {key:'delete',label:'',narrow:true,sortable:false,render:group=>compactRemoveButton({data:'data-desktop-group-row-delete title="Удалить группу"',aria:'Удалить группу '+group.name})},
        ];
        content.innerHTML='<div class="desktop-table-popup" data-desktop-group-directory-table>'+dataTable({columns,rows:entries,caption:'Группы',compact:true})+'</div>';
        const original=content.querySelector('tbody');
        const table=original.closest('table');
        const rowsByKey=new Map([...original.querySelectorAll('[data-desktop-group-key]')].map(handle=>[handle.dataset.desktopGroupKey,handle.closest('tr')]));
        const disposers=[];
        for(const [kind,label] of [['procedures','УСЛУГИ'],['products','ТОВАРЫ']]){
          const groupEntries=entries.filter(group=>group.kind===kind);
          const heading=document.createElement('tbody');
          const headingRow=heading.insertRow();
          headingRow.dataset.tableGroupLevel='system';
          const headingCell=headingRow.insertCell();
          headingCell.colSpan=columns.length;
          headingCell.innerHTML='<button type="button" class="desktop-group-section-toggle" aria-expanded="'+(!collapsed.has(kind))+'"><span aria-hidden="true">'+(collapsed.has(kind)?'▸':'▾')+'</span><span>'+label+'</span></button>';
          table.appendChild(heading);
          const body=document.createElement('tbody');
          body.className='list-entries';
          body.dataset.desktopGroupKind=kind;
          table.appendChild(body);
          body.hidden=collapsed.has(kind);
          const toggle=headingCell.querySelector('button');
          toggle.addEventListener('click',()=>{
            if(busy)return;
            if(collapsed.has(kind))collapsed.delete(kind);else collapsed.add(kind);
            body.hidden=collapsed.has(kind);
            toggle.setAttribute('aria-expanded',String(!body.hidden));
            toggle.firstElementChild.textContent=body.hidden?'▸':'▾';
          });
          for(const group of groupEntries){
            const row=rowsByKey.get(group.key);
            row.dataset.reorderId=group.key;
            body.appendChild(row);
            row.addEventListener('click',event=>{
              if(busy||event.target.closest?.('[data-reorder-handle],[data-table-column="delete"]'))return;
              const fresh=groupByKey(row.dataset.reorderId);
              if(fresh)openEditor(fresh);
            });
            row.querySelector('[data-desktop-group-row-delete]')?.addEventListener('click',event=>{
              event.stopPropagation();
              const fresh=groupByKey(row.dataset.reorderId);
              if(busy||!fresh)return;
              confirmRemove('Удалить группу?',async()=>{
                if(busy)throw new Error('Дождитесь завершения сохранения.');
                busy=true;sync();
                try{await removeGroup(fresh.key);}
                finally{busy=false;sync();}
              },groupRemovalMessage(fresh));
            });
          }
          if(!groupEntries.length){
            const cell=body.insertRow().insertCell();
            cell.colSpan=columns.length;
            cell.className='desktop-group-directory-empty';
            cell.textContent='Групп пока нет';
          }
          disposers.push(initV2ListReorder(body,{
            selector:'tr[data-reorder-id]',
            onReorder:async keys=>{
              if(busy)throw new Error('Дождитесь завершения сохранения.');
              const fresh=getServiceGroupEntries();
              const expected=fresh.filter(group=>group.kind===kind).map(group=>group.key);
              const allowed=new Set(expected);
              if(keys.length!==expected.length||new Set(keys).size!==expected.length||keys.some(key=>!allowed.has(key)))throw new Error('Список групп изменился. Откройте его повторно.');
              // Replace only this section's slots; preserve the other section and legacy combined order.
              let offset=0;
              const merged=fresh.map(group=>group.kind===kind?keys[offset++]:group.key);
              busy=true;sync();
              try{await commitServiceGroupOrder(merged);onSaved();}
              finally{busy=false;sync();}
            },
            onError:fail,
          }));
        }
        original.remove();
        dispose=()=>disposers.forEach(fn=>fn());

      sync();
    }
    add.addEventListener('click',()=>openEditor(null));
    const close=q.v2Close?.bind(q);
    if(close)q.v2Close=()=>{if(!busy){dispose();close();}};
    render();return q;
  }

  const valueEditorX = (groupKey, previous = null) => {
    const current = groupByKey(groupKey);
    if (!current) return null;
    const editor = mountModal(document.body, modal(
      '<form class="compact-form" data-service-value-editor-form>' +
        field({ label: 'Наименование значения', name: 'name',
          value: previous?.name || '', required: true, maxlength: 80 }) +
        '<div class="form-error" role="alert" data-service-value-editor-error></div>' +
        actionBlock(
          button('Сохранить', {
            type: 'submit', data: 'data-service-value-editor-save',
          }) +
          (previous ? button('Удалить значение', {
            type: 'button', variant: 'danger', data: 'data-service-value-editor-delete',
          }) : ''),
        ) +
      '</form>',
      { title: previous ? 'Значение' : 'Добавить значение',
        variant: 'x', xRole: 'editor', surface: 'app' },
    ));
    if (!editor) return null;
    const form = editor.querySelector('[data-service-value-editor-form]');
    const saveButton = editor.querySelector('[data-service-value-editor-save]');
    let busy = false;
    const hasChange = bindServiceNameSave(form, saveButton, previous);
    const apply = async remove => {
      if (busy) {
        if (remove) throw new Error('Дождитесь завершения сохранения.');
        return;
      }
      const name = String(new FormData(form).get('name') || '').trim();
      if (!remove && !hasChange()) return;
      busy = true;
      try {
        const next = getServiceGroupLevels(current.kind).map(group => {
          if (group.id !== current.id) return group;
          const values = Array.isArray(group.values) ? group.values : [];
          return { ...group, values: remove
            ? values.filter(value => value.id !== previous.id)
            : previous ? values.map(value => value.id === previous.id
              ? { ...value, name } : value)
              : [...values, { id: id(), name }] };
        });
        await persist(current.kind, next);
        editor.v2Close?.();
      } catch (cause) {
        const error = editor.querySelector('[data-service-value-editor-error]');
        if (error) error.textContent = cause?.message || 'Не удалось сохранить.';
        // The confirming X must not close when deletion was rejected.
        if (remove) throw cause;
      } finally { busy = false; }
    };
    form?.addEventListener('submit', event => {
      event.preventDefault();
      void apply(false);
    });
    editor.querySelector('[data-service-value-editor-delete]')
      ?.addEventListener('click', () => {
        if (previous) confirmRemove('Удалить значение?', () => apply(true));
      });
    return editor;
  };

  // The directory remains a Q even before the first group is created.
  layer = mountModal(document.body, modal(
    '<div data-service-group-directory></div>' +
      '<div data-service-group-detail hidden></div>' +
      '<div class="form-error" role="alert" data-service-groups-error></div>' +
      actionBlock(
        button('Изменить группу', {
          type: 'button', variant: 'secondary', data: 'data-service-groups-edit-action',
        }) +
        compactButton({kind:'add',className:'v2-desktop-tool-primary',
          data:'data-service-groups-main-action title="Добавить группу"',aria:'Добавить группу'}),
      ),
    { title: 'Группы', variant: 'q', surface: 'app' },
  ));
  if (!layer) return null;

  const directory = layer.querySelector('[data-service-group-directory]');
  const detail = layer.querySelector('[data-service-group-detail]');
  const action = layer.querySelector('[data-service-groups-main-action]');
  const editAction = layer.querySelector('[data-service-groups-edit-action]');
  const error = layer.querySelector('[data-service-groups-error]');

  function repaint() {
    disposeDrag();
    disposeDrag = () => {};
    const entries = getServiceGroupEntries();
    const active = activeKey ? entries.find(item => item.key === activeKey) : null;
    if (activeKey && !active) activeKey = null;
    const inDetail = Boolean(active && activeKey);
    const headerTitle = layer.querySelector('[data-v2-q-header] .v2-q-title');
    if (headerTitle) {
      headerTitle.textContent = inDetail ? active.name : 'Группы';
      // The heading is purely a heading. Editing is a bottom action.
    }
    directory.hidden = inDetail;
    detail.hidden = !inDetail;
    action.title = inDetail ? 'Добавить значение' : 'Добавить группу';
    action.setAttribute('aria-label',action.title);
    if (editAction) editAction.style.display = inDetail ? '' : 'none';
    if (error) error.textContent = '';
    if (!inDetail) {
      directory.innerHTML = entries.length
        ? v2ListEntries(entries.map(group => v2ListEntry({
          title: group.name,
          subtitle: kindLabel(group.kind),
          initial: '', interactive: true, reorderHandle: true,
          reorderAria: 'Переместить ' + group.name,
          data: 'data-service-group-directory-key="' + escapeHtml(group.key) +
            '" data-reorder-id="' + escapeHtml(group.key) + '"',
          aria: 'Открыть группу ' + group.name,
        })))
        : emptyState('Групп пока нет');
      directory.querySelectorAll('[data-service-group-directory-key]').forEach(node => {
        node.addEventListener('click', event => {
          if (event.target.closest?.('[data-reorder-handle]')) return;
          activeKey = node.dataset.serviceGroupDirectoryKey;
          repaint();
        });
      });
      disposeDrag = initV2ListReorder(directory, {
        onReorder: async keys => {
          await commitServiceGroupOrder(keys);
          onSaved();
        },
        onError: fail,
      });
      return;
    }

    // Use the native Q arrow to return to the group directory. Group edits
    // remain in the Q bottom action area; no buttons above the value rows.
    detail.innerHTML =
      '<div class="inventory-editor-group">' +
        '<div class="inventory-editor-label">' + kindLabel(active.kind) + '</div>' +
        '<div data-service-group-value-list></div>' +
      '</div>';
    const listHost = detail.querySelector('[data-service-group-value-list]');
    const values = Array.isArray(active.values) ? active.values : [];
    listHost.innerHTML = values.length
      ? list({ className: 'ui-list--dense list-entries',
        items: values.map(value => ({
          title: value.name, interactive: true, reorderHandle: true,
          data: 'data-service-value="' + escapeHtml(value.id) +
            '" data-reorder-id="' + escapeHtml(value.id) + '"',
          aria: 'Изменить значение ' + value.name,
        })),
      })
      : emptyState('Значений пока нет');

    listHost.querySelectorAll('[data-service-value]').forEach(node => {
      node.addEventListener('click', event => {
        if (event.target.closest?.('[data-reorder-handle]')) return;
        const fresh = groupByKey(activeKey);
        valueEditorX(activeKey, fresh?.values?.find(value =>
          value.id === node.dataset.serviceValue));
      });
    });
    disposeDrag = initV2ListReorder(listHost, {
      onReorder: async ids => {
        const fresh = groupByKey(activeKey);
        if (!fresh) throw new Error('Группа больше не существует.');
        const byId = new Map((fresh.values || []).map(value => [value.id, value]));
        if (ids.length !== byId.size || ids.some(id => !byId.has(id))) {
          throw new Error('Список значений изменился.');
        }
        const next = getServiceGroupLevels(fresh.kind).map(group =>
          group.id === fresh.id ? {
            ...group, values: ids.map(id => byId.get(id)),
          } : group);
        await commitServiceGroupLevels(fresh.kind, next);
        onSaved();
      },
      onError: fail,
    });
  }

  // The shared Q surface already supports v2Back for its native arrow
  // and swipe. Consume Back only inside a group; otherwise dismiss normally.
  layer.v2Back = () => {
    if (!activeKey) return false;
    activeKey = null;
    repaint();
    return true;
  };
  editAction?.addEventListener('click', () => {
    const active = activeKey ? groupByKey(activeKey) : null;
    if (active) groupEditorX(active);
  });
  action.addEventListener('click', () => {
    if (activeKey) valueEditorX(activeKey);
    else groupEditorX();
  });
  repaint();
  const close = layer.v2Close?.bind(layer);
  if (close) layer.v2Close = () => { disposeDrag(); close(); };
  return layer;
}
