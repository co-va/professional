// E «Движения» owns all physical supplier-return actions. A purchase order
// only opens this canonical Q; it does not carry its own mutation editor.
import { actionBlock, button, field, modal, mountModal, openNotice, select, twoColumnLayout } from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { getInventoryStorageLocations, getInventorySupplierClaims } from './data.js';
import { returnInventoryPurchaseOrderToSupplier, refundInventorySupplierClaim } from './service.js';
import { loadWalletCatalog } from '../runtime/auxiliary-state.js';

export const availableWarehouses = () => getInventoryStorageLocations().filter(place => !place.archivedAt);

export function openReturnToSupplierQ({ current, orderId, layer, onSaved }) {
    const saved = current();
    if (!saved || saved.status !== 'received') return;
    const places = availableWarehouses();
    const claims = getInventorySupplierClaims(orderId);
    const fields = saved.lines.map((line, index) => {
      const claimed = claims.filter(claim => claim.itemId === line.itemId)
        .reduce((sum, claim) => sum + Number(claim.packages || 0), 0);
      const max = Math.max(0, line.packages - claimed);
      return '<section data-supplier-return-row="' + index + '">' +
        '<p>' + escapeHtml(line.name) + ' · доступно к оформлению: ' +
          escapeHtml(String(max)) + ' шт.</p>' +
        twoColumnLayout(
          field({label:'Вернуть, шт.',name:'returnPackages',type:'number',
            value:'0',min:'0',max:String(max),step:'1',inputmode:'numeric'}),
          field({label:'Причина',name:'returnReason',placeholder:'Несоответствие'}),
          {ariaLabel:'Возврат поставщику'},
        ) + '</section>';
    }).join('');
    const popup = mountModal(layer, modal('<form data-supplier-return-form class="form-grid">' +
      select({label:'С какого склада', name:'returnLocation', value:'',
        options:[{value:'',label:'Выберите склад'},...places.map(place=>({
          value:place.locationId,label:place.isPrimary?'Не распределено':place.name,
        }))]}) +
      fields +
      '<p class="form-error" role="status" data-supplier-return-error></p>' +
      actionBlock(button('Вернуть поставщику',{type:'submit',data:'data-supplier-return-save'})) +
      '</form>',{title:'Возврат поставщику',variant:'q'}));
    if (!popup) return;
    const form=popup.querySelector('[data-supplier-return-form]');
    const error=popup.querySelector('[data-supplier-return-error]');
    const save=popup.querySelector('[data-supplier-return-save]');
    const returnId=globalThis.crypto?.randomUUID?.();
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(save.disabled)return;
      const location=form.querySelector('[name="returnLocation"]')?.value||'';
      if(!places.some(place=>place.locationId===location)) {
        error.textContent='Выберите склад возврата.';return;
      }
      const lines=[];
      for(const row of form.querySelectorAll('[data-supplier-return-row]')){
        const line=saved.lines[Number(row.dataset.supplierReturnRow)];
        const count=Number(row.querySelector('[name="returnPackages"]')?.value||0);
        const reason=row.querySelector('[name="returnReason"]')?.value.trim()||'';
        const claimed=claims.filter(claim=>claim.itemId===line.itemId)
          .reduce((sum,claim)=>sum+Number(claim.packages||0),0);
        if(!Number.isSafeInteger(count)||count<0||count+claimed>line.packages||
          count>0&&!reason){error.textContent='Проверьте количество и причину: '+line.name;return;}
        if(count>0)lines.push({itemId:line.itemId,packages:count,reason});
      }
      if(!lines.length||!returnId){error.textContent='Выберите позиции возврата.';return;}
      save.disabled=true;
      try{
        await returnInventoryPurchaseOrderToSupplier(orderId,{
          returnId,storageLocationId:location,lines,
        });
        popup.v2Close?.();onSaved();
      }catch(cause){
        error.textContent=String(cause?.message||'Не удалось сохранить возврат.');
        if(save.isConnected)save.disabled=false;
      }
    });
  };

export async function openSupplierRefundQ({ current, orderId, layer, onSaved, rubles }) {
    const claims=getInventorySupplierClaims(orderId)
      .filter(claim=>Number(claim.outstanding)>0.009);
    if(!claims.length)return openNotice({title:'Расчёты',message:'Непогашенной задолженности нет.'});
    let wallets=[];
    try{wallets=await loadWalletCatalog();}
    catch(e){return openNotice({title:'Расчёты',message:String(e?.message||'Кошельки недоступны')});}
    if(!wallets.length)return openNotice({title:'Расчёты',message:'Нет кошельков.'});
    const popup=mountModal(layer,modal('<form data-supplier-refund-form class="form-grid">'+
      select({label:'Задолженность',name:'claimId',value:'',
        options:[{value:'',label:'Выберите позицию'},...claims.map(claim=>({
          value:claim.claimId,
          label:(current()?.lines.find(line=>line.itemId===claim.itemId)?.name||'Товар')+
            ' · '+rubles(claim.outstanding),
        }))]})+
      select({label:'Кошелёк',name:'walletId',value:'',
        options:[{value:'',label:'Выберите кошелёк'},...wallets.map(w=>({value:w.id,label:w.name}))]})+
      field({label:'Получено, ₽',name:'refundAmount',type:'number',min:'0.01',step:'0.01'})+
      '<p class="form-error" data-supplier-refund-error></p>'+
      actionBlock(button('Поступление денег',{type:'submit',data:'data-supplier-refund-save'}))+
      '</form>',{title:'Возврат денег поставщиком',variant:'q'}));
    if(!popup)return;
    const form=popup.querySelector('[data-supplier-refund-form]');
    const error=popup.querySelector('[data-supplier-refund-error]');
    const submit=popup.querySelector('[data-supplier-refund-save]');
    const settlementId=globalThis.crypto?.randomUUID?.();
    form.querySelector('[name="claimId"]')?.addEventListener('change',event=>{
      const claim=claims.find(row=>row.claimId===event.target.value);
      form.querySelector('[name="refundAmount"]').value=claim?String(claim.outstanding):'';
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(submit.disabled)return;
      const claim=claims.find(row=>row.claimId===form.querySelector('[name="claimId"]')?.value);
      const wallet=wallets.find(w=>w.id===form.querySelector('[name="walletId"]')?.value);
      const value=Number(form.querySelector('[name="refundAmount"]')?.value);
      if(!claim||!wallet||!(value>0)||value>Number(claim.outstanding)+0.001||!settlementId){
        error.textContent='Выберите задолженность, кошелёк и сумму не выше остатка долга.';return;
      }
      submit.disabled=true;
      try{
        await refundInventorySupplierClaim(claim.claimId,{
          settlementId,walletId:wallet.id,walletName:wallet.name,
          amount:value,occurredAt:new Date().toISOString(),
        });
        popup.v2Close?.();onSaved();
      }catch(cause){
        error.textContent=String(cause?.message||'Не удалось провести возврат денег.');
        if(submit.isConnected)submit.disabled=false;
      }
    });
  };

