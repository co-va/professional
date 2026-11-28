// Inventory Desktop presentation only; existing shared UI owns geometry.
import {button,compactButton,dataTable,escapeHtml,setV2ZHeaderRows} from '../../ui/ui.js';
import {isV2DesktopWorkspace} from '../../ui/v2/geometry.js';
export const inventoryDesktop=root=>isV2DesktopWorkspace(root?.closest('[data-v2-app]'));
export function inventoryDesktopHeader(root,title,left='',actions=[]){
 if(!inventoryDesktop(root))return null;
 const tools=actions.map(a=>a.kind?compactButton({kind:a.kind,data:a.data,aria:a.aria}):button(a.label,{variant:'secondary',className:a.className||'',data:a.data,aria:a.aria||''})).join('');
 const [row]=setV2ZHeaderRows(root,['<div class="v2-desktop-tool-row"><div class="v2-desktop-tool-context">'+left+'</div><div class="v2-desktop-tool-actions">'+tools+'</div></div>'],{desktopTitle:title});
 return row||null;
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
