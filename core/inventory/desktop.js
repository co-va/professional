// Inventory Desktop presentation only; existing shared UI owns geometry.
import {button,compactButton,dataTable,escapeHtml,modal,mountModal,setV2ZHeaderRows} from '../../ui/ui.js';
import {isV2DesktopWorkspace} from '../../ui/v2/geometry.js';
export const inventoryDesktop=root=>isV2DesktopWorkspace(root?.closest('[data-v2-app]'));
export function inventoryDesktopHeader(root,title,left='',actions=[],{context=''}={}){
 if(!inventoryDesktop(root))return null;
 const query=actions.filter(a=>['filter','sort'].includes(a.kind));
 const actionMarkup=a=>a.kind?compactButton({kind:a.kind,data:a.data+' title="'+escapeHtml(a.aria||'')+'" aria-haspopup="dialog" aria-pressed="false"',aria:a.aria}):button(a.label,{variant:'secondary',className:a.className||'',data:a.data+' title="'+escapeHtml(a.aria||'')+'"',aria:a.aria||''});
 const right=actions.filter(a=>!query.includes(a)).map(a=>query.length&&!a.kind?actionMarkup({...a,className:a.className?.includes('v2-desktop-tool-primary')?'people-desktop-icon people-desktop-add':a.className?.includes('v2-desktop-tool-icon')?'people-desktop-icon':a.className}):actionMarkup(a)).join('');
 const search=left.startsWith('<div class="ui-search-field">')?left.slice('<div class="ui-search-field">'.length,-6):left;
 const html=query.length
  ?'<section data-people-desktop-toolbar><div class="people-desktop-tools">'+search+
    '<div class="people-desktop-actions people-desktop-query-tools">'+query.map(actionMarkup).join('')+'</div>'+
    '<div class="people-desktop-actions people-desktop-actions--right">'+(context?'<div class="v2-desktop-tool-context">'+context+'</div>':'')+right+'</div></div></section>'
  :'<div class="v2-desktop-tool-row"><div class="v2-desktop-tool-context">'+left+'</div><div class="v2-desktop-tool-actions">'+right+'</div></div>';
 const [row]=setV2ZHeaderRows(root,[html],{desktopTitle:title});
 return row||null;
}
export function inventoryDesktopSort(anchor,options,value,onChange){
 const popup=mountModal(anchor,modal('<div class="people-action-menu">'+options.map(o=>button(escapeHtml(o.label),{variant:'secondary',data:'data-inventory-sort-choice="'+escapeHtml(o.value)+'" aria-pressed="'+(value===o.value)+'"'})).join('')+'</div>',{variant:'x',title:'Сортировка',surface:'app',xRole:'action',className:'people-action-popup people-sort-popup'}));
 popup?.querySelectorAll('[data-inventory-sort-choice]').forEach(control=>control.addEventListener('click',()=>{onChange(control.dataset.inventorySortChoice);popup.v2Close?.();}));
}
export function inventoryDesktopFilter(anchor,values,fields,onChange){
 const initial=Object.fromEntries(Object.keys(values).map(k=>[k,'']));
 let state={...values};
 const markup='<div data-inventory-filter-fields>'+fields(state)+'</div><div class="modal-actions" data-inventory-filter-reset'+(Object.values(state).some(Boolean)?'':' hidden')+'>'+button('Сбросить',{variant:'secondary',data:'data-inventory-filter-clear'})+'</div>';
 const popup=mountModal(anchor,modal(markup,{variant:'x',title:'Фильтр',surface:'app',className:'people-action-popup people-filter-popup'}));
 if(!popup)return;
 const reset=popup.querySelector('[data-inventory-filter-reset]');
 const sync=()=>{reset.hidden=!Object.values(state).some(Boolean);anchor.setAttribute('aria-pressed',String(!reset.hidden));onChange({...state});};
 popup.addEventListener('change',event=>{
  const key=event.target?.name;
  if(!Object.prototype.hasOwnProperty.call(state,key))return;
  state[key]=String(event.target.value||'');sync();
 });
 popup.querySelector('[data-inventory-filter-clear]')?.addEventListener('click',()=>{
  state={...initial};popup.querySelector('[data-inventory-filter-fields]').innerHTML=fields(state);sync();
 });
}
export function inventoryTable(rows,columns,caption){
 return dataTable({compact:true,caption,rows,columns:columns.map(c=>({...c,sortable:false}))});
}
export function inventoryRowButton(label,attribute,id){
 return '<button type="button" '+attribute+'="'+escapeHtml(id)+'" aria-label="'+escapeHtml(label)+'">'+escapeHtml(label)+'</button>';
}
export function bindInventoryTableRows(host,selector,open){
 host?.querySelectorAll(selector).forEach(button=>{
  const tr=button.closest('tr');
  (tr||button).addEventListener('click',event=>{
   if(event.target.closest('[data-stock-item-check],[data-reorder-handle],[data-table-column="select"]'))return;
   open(button);
  });
 });
}
