import { actionBlock, button, compactButton, openNotice, collectLinks, colorPicker, escapeHtml, field, initColorPickers, initLinks, initTimePickers, links, mountModal, modal, phoneField, select, textareaField, timePicker } from '../../../ui/ui.js';
import { compactCheck } from '../../../ui/selection/check-list.js';
import { moveDesktopQTool, pinDesktopQDanger } from '../../../ui/v2/z-layout.js';
import { isV2DesktopWorkspace } from '../../../ui/v2/geometry.js';
import { getProfile } from '../data.js';
import { canUseCapability } from '../../access.js';
import { BOOKING_SLOT_STEPS, getWorkplaceBookingRules, normalizeWorkplaceBookingRules, saveWorkplaceBookingRules } from '../../booking-settings/index.js';
import { deleteWorkplace as deleteWorkplaceData, getWorkplaceReferenceData, getWorkplaces, upsertWorkplace } from './data.js';

function workplaceDefaults(){
  return getWorkplaceReferenceData().defaults||{};
}

function emptyWorkplace(){
  const defaults=workplaceDefaults();
  return {
    photo:'',photoCropX:50,photoCropY:50,name:'',color:'',city:'',address:'',phone:'',
    currency:defaults.currency||'',
    timeZone:defaults.timeZone||'',
    from:defaults.from||'',
    to:defaults.to||'',
    links:[],about:'',cardAppearance:{},visibleInPublicBooking:true,
  };
}

export function workplaceForm(existing=null){
  const reference=getWorkplaceReferenceData();
  const defaults=reference.defaults||{};
  const w=existing||emptyWorkplace();
  const cities=[...new Set([w.city,...(reference.cities||[])].filter(Boolean))];
  const bookingRules = canUseCapability('online_booking.access') ? getWorkplaceBookingRules(w.key) : null;
  const currencies=(reference.currencies||[]).length
    ? reference.currencies
    : (w.currency?[{value:w.currency,label:w.currency}]:[]);
  const primary=actionBlock(button('Сохранить',{
    type:'submit',
    data:'data-workplace-primary',
    aria:'Сохранить',
  }));
  // Destructive action must stay at the end of the scrollable Q form, never in the floating .modal-actions footer.
  const deletion=existing
    ? button('Удалить',{
        variant:'critical',
        data:'data-delete-workplace-form',
      })
    : '';
  // Photo is edited by the single shared View editor; Q carries the stored values.
  const photoFields=`<input type="hidden" name="workplacePhoto" value="${escapeHtml(w.photo||'')}">
    <input type="hidden" name="workplacePhotoCropX" value="${Number(w.photoCropX||50)}">
    <input type="hidden" name="workplacePhotoCropY" value="${Number(w.photoCropY||50)}">`;
  // Q data order: identity, address, phone, schedule, currency, color, links, about.
  const scheduleField=`<div class="work-time-row"><span class="work-time-row__label">График работы</span>
      <div class="work-time-row__fields">
        ${timePicker({label:'С',name:'workplaceFrom',value:w.from||defaults.from||''})}
        ${timePicker({label:'До',name:'workplaceTo',value:w.to||defaults.to||''})}
      </div>
    </div>`;
  const colorField=`<div class="workplace-form__color"><span class="work-time-row__label">Цвет рабочего пространства *</span>
      ${colorPicker({name:'workplaceColor',value:w.color||'',required:true})}
    </div>`;
  return `<form class="compact-form workplace-form" data-workplace-form>
    <input type="hidden" name="workplaceCardAppearance" value="${escapeHtml(JSON.stringify(w.cardAppearance||{}))}">
    <input type="hidden" name="visibleInPublicBooking" value="${w.visibleInPublicBooking===false?'false':'true'}">
    ${photoFields}
    ${bookingRules ? `<input type="hidden" name="workplaceAllowCancellation" value="${bookingRules.allowClientCancellation?'true':'false'}">
      <input type="hidden" name="workplaceAllowRescheduling" value="${bookingRules.allowClientRescheduling?'true':'false'}">` : ''}
    <div class="workplace-booking-top">
      <div class="workplace-booking-tools">
        ${bookingRules ? `${compactButton({kind:'info',data:'data-workplace-booking-info',aria:'О шаге записи'})}
        <div class="workplace-booking-step">
          <span>Шаг</span>${select({name:'workplaceBookingSlotStep',value:String(bookingRules.preferredSlotStep),options:BOOKING_SLOT_STEPS.map(step=>({value:String(step),label:step+' мин'}))})}
        </div>` : ''}
      </div>
      <div class="workplace-booking-checks${bookingRules?'':' workplace-booking-checks--single'}">
        ${compactCheck({label:'Онлайн-запись',checked:w.visibleInPublicBooking!==false,data:'data-workplace-public-booking-visibility'})}
        ${bookingRules ? `${compactCheck({label:'Отмена записи',checked:bookingRules.allowClientCancellation,data:'data-workplace-booking-cancel'})}
        ${compactCheck({label:'Перенос записи',checked:bookingRules.allowClientRescheduling,data:'data-workplace-booking-reschedule'})}` : ''}
      </div>
    </div>
    ${field({label:'Название',name:'workplaceName',value:w.name,placeholder:'Название рабочего пространства',required:true})}
    ${select({label:'Город *',name:'workplaceCity',value:w.city||'',options:cities,placeholder:'Город',searchable:true,allowCustom:false})}
    ${field({label:'Адрес',name:'workplaceAddress',value:w.address,placeholder:'Адрес'})}
    ${phoneField({label:'Телефон',name:'workplacePhone',value:w.phone||''})}
    ${scheduleField}
    ${select({label:'Валюта',name:'workplaceCurrency',value:w.currency||defaults.currency||'',options:currencies})}
    ${colorField}
    ${links({links:w.links||[],name:'workplace-links',label:'Ссылки',compact:true,addInHeader:true})}
    ${textareaField({label:'О рабочем пространстве',name:'workplaceAbout',value:w.about||'',placeholder:'Коротко о рабочем пространстве'})}
    <div class="form-error" data-workplace-error></div>
    ${primary}
    ${deletion}
  </form>`;
}
function formSnapshot(form){
  if(!form)return '';
  return JSON.stringify([...new FormData(form).entries()].map(([key,value])=>[key,typeof value==='string'?value:'']));
}

function parseCardAppearance(value){
  try{
    const parsed=JSON.parse(String(value||'{}'));
    return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};
  }catch{return {}}
}

function collectWorkplaceForm(root,existing){
  const form=root.querySelector('[data-workplace-form]');
  const data=new FormData(form);
  const name=String(data.get('workplaceName')||'').trim();
  const city=String(data.get('workplaceCity')||'').trim();
  const color=String(data.get('workplaceColor')||'').trim();
  const profile=getProfile();
  return {
    valid:Boolean(name&&city&&color),
    bookingRules:data.has('workplaceBookingSlotStep')?normalizeWorkplaceBookingRules({
      preferredSlotStep:Number(data.get('workplaceBookingSlotStep')),
      allowClientCancellation:data.get('workplaceAllowCancellation')==='true',
      allowClientRescheduling:data.get('workplaceAllowRescheduling')==='true',
    }):null,
    item:{
      key:existing?.key||form.dataset.workplaceDraftKey||(form.dataset.workplaceDraftKey=crypto.randomUUID()),
      profileId:profile.key,
      photo:String(data.get('workplacePhoto')||''),
      photoCropX:Number(data.get('workplacePhotoCropX')||50),
      photoCropY:Number(data.get('workplacePhotoCropY')||50),
      name,
      color,
      city,
      address:String(data.get('workplaceAddress')||'').trim(),
      phone:String(data.get('workplacePhone')||'').trim(),
      currency:String(data.get('workplaceCurrency')||workplaceDefaults().currency||''),
      from:String(data.get('workplaceFrom')||''),
      to:String(data.get('workplaceTo')||''),
      links:collectLinks(root,'workplace-links'),
      about:String(data.get('workplaceAbout')||'').trim(),
      cardAppearance:parseCardAppearance(data.get('workplaceCardAppearance')),
      visibleInPublicBooking:String(data.get('visibleInPublicBooking')||'true')!=='false',
      createdAt:existing?.createdAt||new Date().toISOString(),
      updatedAt:new Date().toISOString(),
    },
  };
}

async function saveWorkplace(root,existing,onDone){
  const {valid,item,bookingRules}=collectWorkplaceForm(root,existing);
  const error=root.querySelector('[data-workplace-error]');
  if(!valid){if(error)error.textContent='Название, город и цвет обязательны.';return false}
  try{
    const saved=await upsertWorkplace(item);
    if(!saved)throw Error('Сервер не подтвердил рабочее пространство.');
    if(bookingRules && (!existing || JSON.stringify(bookingRules)!==JSON.stringify(getWorkplaceBookingRules(item.key)))) await saveWorkplaceBookingRules(item.key,bookingRules);
    if(error)error.textContent='';
    onDone?.(saved);
    return true;
  }catch(saveError){
    if(error)error.textContent=saveError instanceof Error?saveError.message:'Не удалось сохранить рабочее пространство';
    return false;
  }
}

export function bindWorkplaceForm(root,existing=null,{onSaved=()=>{},onDeleted=()=>{}}={}){
  const form=root.querySelector('[data-workplace-form]');
  if(!form)return ()=>{};
  if(root.querySelector('[data-color-picker]'))initColorPickers(root);
  if(root.querySelector('[data-time-picker]'))initTimePickers(root);
  initLinks(root);

  // The visible checkbox is part of the Q draft: one Save commits all workplace fields.
  // Keep the existing hidden API field as the single form-data source.
  form.querySelector('[data-workplace-public-booking-visibility]')?.addEventListener('change',(event)=>{
    setWorkplaceDraft(root,'visibleInPublicBooking',event.currentTarget.checked?'true':'false');
  });

  for(const [selector,name] of [['[data-workplace-booking-cancel]','workplaceAllowCancellation'],['[data-workplace-booking-reschedule]','workplaceAllowRescheduling']]){
    form.querySelector(selector)?.addEventListener('change',event=>setWorkplaceDraft(root,name,event.currentTarget.checked?'true':'false'));
  }

  form.querySelector('[data-workplace-booking-info]')?.addEventListener('click',()=>{
    openNotice({title:'Шаг записи',message:'0 мин — предложения по целым часам; 15 мин — через 15 минут; 30 мин — через 30 минут. После занятого времени допускается запись сразу после окончания предыдущей либо через выбранный шаг (для 0 — через час). Обязательного перерыва нет. Применение в клиентской записи ещё не подключено.',action:'Закрыть'});
  });

  const primary=root.querySelector('[data-workplace-primary]');
  const primaryActions=primary?.closest('.modal-actions');
  if(isV2DesktopWorkspace(root.closest('[data-v2-app]'))){
    if(primary){
      form.id ||= 'workplace-data-'+crypto.randomUUID();
      primary.setAttribute('form',form.id);
      moveDesktopQTool(primary);
    }
    // Reuse the two existing Q tool rows without moving the content baseline.
    const toolbar=root.querySelector('[data-v2-q-header-content] > .desktop-q-toolbar');
    const top=form.querySelector('.workplace-booking-top');
    const tools=top?.querySelector('.workplace-booking-tools');
    const checks=top?.querySelector('.workplace-booking-checks');
    if(toolbar && top && checks){
      toolbar.classList.add('workplace-booking-toolbar');
      const slot=tools?.querySelector('[name="workplaceBookingSlotStep"]');
      if(slot){
        // A relocated selector still belongs to the original form.
        slot.setAttribute('form',form.id);
        tools.addEventListener('input',()=>form.dispatchEvent(new Event('input',{bubbles:true})));
        tools.addEventListener('change',()=>form.dispatchEvent(new Event('change',{bubbles:true})));
      }
      if(tools?.children.length) toolbar.prepend(tools);
      checks.setAttribute('data-desktop-q-secondary-tools','');
      checks.setAttribute('data-v2-layer-gesture-ignore','');
      toolbar.after(checks);
      top.remove();
    }
    const remove=root.querySelector('[data-delete-workplace-form]');
    const body=form.closest('[data-v2-q-body]');
    if(remove&&body){
      remove.classList.remove('ui-button--critical','ui-button--delete-outline');
      remove.classList.add('ui-button--danger');
      const footer=body.ownerDocument.createElement('div');
      footer.className='app-settings-panel';
      footer.append(remove);
      body.append(footer);
      if(pinDesktopQDanger(remove)){
        // Keep the destructive action outside the scrolling form, in the Q footer.
        body.after(footer);
      }
    }
  }
  const initial=formSnapshot(form);
  let dirty=!existing;

  const syncPrimary=()=>{
    if(!primary)return;
    primary.disabled=false;
    if(primaryActions)primaryActions.hidden=!dirty;
  };
  const syncDirty=()=>{
    dirty=!existing||formSnapshot(form)!==initial;
    syncPrimary();
  };

  form.addEventListener('input',syncDirty);
  form.addEventListener('change',syncDirty);
  form.addEventListener('submit',async(event)=>{
    event.preventDefault();
    if(primary)primary.disabled=true;
    const saved=await saveWorkplace(root,existing,onSaved);
    if(!saved&&primary)primary.disabled=false;
  });

  root.querySelector('[data-delete-workplace-form]')?.addEventListener('click',(event)=>{
    event.preventDefault();
    if(existing)confirmDeleteWorkplace(root,existing.key,onDeleted);
  });
  syncPrimary();

  return ()=>{
    form.removeEventListener('input',syncDirty);
    form.removeEventListener('change',syncDirty);
  };
}

function setWorkplaceDraft(root,name,value,{notify=true}={}){
  const input=root.querySelector(`[name="${CSS.escape(name)}"]`);
  if(!input)return;
  input.value=String(value??'');
  if(notify)input.dispatchEvent(new Event('change',{bubbles:true}));
}

export function confirmDeleteWorkplace(root,key,onDeleted=()=>{}){
  const w=getWorkplaces().find(x=>x.key===key);if(!w)return;
  const m=mountModal(root,modal(`<div class="modal-title"><h2>Удалить пространство?</h2><p>${escapeHtml(w.name||'Рабочее пространство')} будет убрано из активных пространств. Исторические данные сохранятся.</p></div><div class="form-error" data-workplace-delete-error></div><div class="modal-actions">${button('Удалить',{variant:'critical',data:'data-confirm-delete-workplace'})}${button('Отмена',{variant:'secondary',data:'data-cancel-delete-workplace'})}</div>`,{variant:'x',title:'Удаление рабочего пространства'}));
  if(!m)return;
  m.querySelector('[data-cancel-delete-workplace]').onclick=()=>m.v2Close?.();
  m.querySelector('[data-confirm-delete-workplace]').onclick=async()=>{
    try{
      if(await deleteWorkplaceData(key)){m.v2Close?.();onDeleted();}else m.v2Close?.();
    }catch(deleteError){
      const error=m.querySelector('[data-workplace-delete-error]');
      if(error)error.textContent=deleteError instanceof Error?deleteError.message:'Не удалось удалить рабочее пространство';
    }
  };
}
