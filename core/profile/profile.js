import { button, compactButton, setV2ZHeaderRows, collectRepeatedField, entityVisualCard, escapeHtml, field, modal, mountModal, openEntityCardAppearanceQ, openSharedProfileDataEditor, openSharedProfileSettingsMenu, openSharedPasswordAction, page, repeatedField, searchableSelect, select, textareaField, v2HorizontalRail, v2Section, workspaceHeaderContext, workplaceAddButton } from '../../ui/ui.js';
import { canUseCapability, getAccess, getLimit, loadAccess, requestLiveMode } from '../../core/access.js';
import { changePassword, logout } from '../../core/auth.js';
import { getProfessionCatalog, getProfile, saveProfile as saveProfileData } from './data.js';
import { getWorkplaces, saveWorkplaces, upsertWorkplace } from './workplaces/data.js';
import { bindWorkplaceForm, workplaceForm } from './workplaces/workplaces.js';
import { profileCardAppearance, profileCardFields, workplaceCardAppearance, workplaceCardFields, workplaceCardPhoto } from './card-presentation.js';
import { getCardAppearanceTemplate, saveCardAppearanceTemplate } from '../../core/card-appearance-templates.js';
import { loadProfileState } from './runtime.js';
import { loadOperationalState } from '../runtime/operational-state.js';
import { isV2DesktopWorkspace } from '../../ui/v2/geometry.js';
import { moveDesktopQTool } from '../../ui/v2/z-layout.js';

const EXPERIENCES=['Без опыта','До 1 года','1–3 года','3–5 лет','5–10 лет','10–15 лет','15–20 лет','Более 20 лет'];
const fullName=p=>[p.name,p.surname].filter(Boolean).join(' ')||'Ваш профиль';
const initial=p=>fullName(p).slice(0,1).toUpperCase()||'?';
const crop=v=>Number.isFinite(Number(v))?Math.max(0,Math.min(100,Math.round(Number(v)))):50;
const avatarPosition=p=>`${crop(p.photoCropX)}% ${crop(p.photoCropY)}%`;
const professionOptions=(current='')=>[...new Set([current,...getProfessionCatalog()].map(value=>String(value||'').trim()).filter(Boolean))];

function demoRemainingText(access){
  const expiresAt=new Date(access?.demoExpiresAt||0).getTime();
  if(!Number.isFinite(expiresAt)||!expiresAt)return 'DEMO';
  const diff=Math.max(0,expiresAt-Date.now());
  if(diff<=0)return 'DEMO завершено';
  const hours=Math.ceil(diff/3_600_000);
  if(hours<24)return `DEMO · осталось ${hours} ч.`;
  return `DEMO · осталось ${Math.ceil(hours/24)} дн.`;
}

export function render(root,navigateBack=()=>{},options={}){
  return loadProfileState().then(()=>renderProfile(root,navigateBack,options));
}

function profileContext(p,title=fullName(p),{includeSettings=true}={}){
  return workspaceHeaderContext({
    title,
    a:{kind:'avatar',image:p.photo||'',imagePosition:avatarPosition(p),initials:initial(p)},
    v:includeSettings?{data:'data-profile-settings',aria:'Настройки профиля'}:null,
  });
}

function profileCard(p){
  const workplaces=canUseCapability('workplaces.access')?getWorkplaces():[];
  return entityVisualCard({
    appearance:profileCardAppearance(p),
    fields:profileCardFields(p,workplaces),
    image:p.photo||'',
    imagePosition:avatarPosition(p),
    interactive:true,
    data:'data-profile-card',
    aria:'Открыть данные профиля',
  });
}

function workplaceRail(){
  const items=getWorkplaces();
  if(!items.length){
    return '<div class="v2-profile-empty">Рабочих пространств пока нет.</div>';
  }
  const p=getProfile();
  return v2HorizontalRail(items.map(w=>entityVisualCard({
    appearance:workplaceCardAppearance(w),
    fields:workplaceCardFields(w,p),
    image:workplaceCardPhoto(w),
    imagePosition:`${crop(w.photoCropX)}% ${crop(w.photoCropY)}%`,
    interactive:true,
    data:`data-workplace="${escapeHtml(w.key)}"`,
    aria:`Открыть рабочее пространство ${w.name||''}`,
  })).join(''),{className:'v2-profile-workplaces'});
}

function bindDesktopWorkplaceRail(root){
  const rail=root.querySelector('.v2-profile-workplaces');
  const section=rail?.closest('.v2-section');
  const title=section?.querySelector('.v2-section__title');
  if(!rail||!title)return;
  title.insertAdjacentHTML('beforeend','<span class="profile-workplace-rail-controls" data-v2-layer-gesture-ignore>'+
    compactButton({kind:'previous',data:'data-profile-rail-prev',aria:'Предыдущее рабочее пространство'})+
    compactButton({kind:'next',data:'data-profile-rail-next',aria:'Следующее рабочее пространство'})+'</span>');
  section.classList.add('profile-workplace-rail-interactive');
  const nav=title.querySelector('.profile-workplace-rail-controls');
  const prev=nav.querySelector('[data-profile-rail-prev]');
  const next=nav.querySelector('[data-profile-rail-next]');
  const sync=()=>{
    const max=Math.max(0,rail.scrollWidth-rail.clientWidth);
    nav.hidden=max<=1;
    prev.disabled=rail.scrollLeft<=1;
    next.disabled=rail.scrollLeft>=max-1;
  };
  const step=direction=>{
    const max=Math.max(0,rail.scrollWidth-rail.clientWidth);
    const first=rail.firstElementChild?.getBoundingClientRect().left||0;
    const positions=[...new Set([0,...[...rail.children].map(card=>Math.max(0,Math.min(max,card.getBoundingClientRect().left-first))),max])].sort((a,b)=>a-b);
    const target=direction>0?positions.find(x=>x>rail.scrollLeft+1):positions.slice().reverse().find(x=>x<rail.scrollLeft-1);
    if(target!=null)rail.scrollTo({left:target,behavior:'smooth'});
  };
  prev.addEventListener('click',()=>step(-1));
  next.addEventListener('click',()=>step(1));
  rail.addEventListener('scroll',sync,{passive:true});
  requestAnimationFrame(sync);
}

function profileDataFields(p,emails){
  return `<div class="v2-profile-data-grid">
    ${v2Section('Личные данные',`<div class="form-grid">${field({label:'Имя',name:'profileName',value:p.name,placeholder:'Ваше имя',required:true})}${field({label:'Фамилия',name:'profileSurname',value:p.surname,placeholder:'Ваша фамилия'})}${textareaField({label:'О себе',name:'profileAbout',value:p.about||'',placeholder:'Коротко о себе'})}</div>`)}
    ${v2Section('Контактные данные',repeatedField({label:'Телефон',name:'profilePhones',values:p.phones?.length?p.phones:[p.phone||''],type:'tel',addInHeader:true})+repeatedField({label:'Telegram',name:'profileTelegrams',values:p.telegrams||[],addInHeader:true})+repeatedField({label:'Email',name:'profileEmails',values:emails,type:'email',addInHeader:true}))}
    ${v2Section('Профессиональные данные',`<div class="form-grid">${searchableSelect({label:'Профессия',name:'profession',value:p.profession||'',options:professionOptions(p.profession),placeholder:'Введите профессию',required:true})}${select({label:'Опыт работы',name:'experience',value:p.experience||'',options:[{value:'',label:'Не указан'},...EXPERIENCES.map(v=>({value:v,label:v}))]})}${textareaField({label:'О профессии',name:'professionAbout',value:p.professionAbout||'',placeholder:'Расскажите о своей профессии'})}</div>`)}
  </div>`;
}

function showProfileError(message){
  mountModal(document.body,modal(`<div class="modal-title"><h2>Не удалось сохранить</h2><p>${escapeHtml(message||'Ошибка сервера')}</p></div>`,{variant:'s',title:'Не удалось сохранить'}));
}

function openWorkplaceLimitModal(root,limit){
  const current=Number.isFinite(limit)?String(limit):'текущий лимит';
  mountModal(root,modal(`<div class="modal-title"><h2>Работаете в нескольких местах?</h2><p>Сейчас доступно рабочих пространств: ${escapeHtml(current)}.</p></div>`,{variant:'s',title:'Рабочие пространства'}));
}

function collectProfileData(root){
  const current=getProfile();
  const phones=collectRepeatedField(root,'profilePhones');
  return {
    ...current,
    key:'profile',
    name:root.querySelector('[name="profileName"]')?.value.trim()||'',
    surname:root.querySelector('[name="profileSurname"]')?.value.trim()||'',
    phone:phones[0]||'',
    phones,
    telegrams:collectRepeatedField(root,'profileTelegrams'),
    emails:collectRepeatedField(root,'profileEmails'),
    about:root.querySelector('[name="profileAbout"]')?.value.trim()||'',
    profession:root.querySelector('[name="profession"]')?.value||'',
    experience:root.querySelector('[name="experience"]')?.value||'',
    professionAbout:root.querySelector('[name="professionAbout"]')?.value.trim()||''
  };
}

function openProfileData(root,navigateBack,options={}){
  const current=getProfile();
  const accountEmail=String(options.accountEmail||'').trim();
  // The account email is an auth identity. Other profile emails are contacts.
  // Keep existing contacts intact, but never render the account address twice.
  const emails=[...new Map([accountEmail,...(current.emails||[])]
    .map(value=>String(value||'').trim())
    .filter(Boolean)
    .map(value=>[value.toLowerCase(),value])).values()];
  return openSharedProfileDataEditor({
    root,
    title:'Данные профиля',
    fields:profileDataFields(current,emails),
    read:collectProfileData,
    validate:(values)=>!values.name||!values.phones.length||!values.profession
      ?'Имя, телефон и профессия обязательны.':'',
    persist:saveProfileData,
    onSaved:()=>renderProfile(root,navigateBack,options),
    onOpen:(layer)=>{
      if(isV2DesktopWorkspace(layer.closest('[data-v2-app]'))){
        const form=layer.querySelector('[data-profile-data-form]');
        const save=layer.querySelector('[data-save-profile]');
        if(form&&save){
          form.insertAdjacentHTML('beforeend',button('Изменить пароль',{variant:'outline',data:'data-profile-change-password'}));
          const password=form.querySelector('[data-profile-change-password]');
          password.addEventListener('click',()=>openSharedPasswordAction({onSubmit:({currentPassword,newPassword})=>changePassword(currentPassword,newPassword)}));
          moveDesktopQTool(password);
          form.id ||= 'profile-data-'+crypto.randomUUID();
          save.setAttribute('form',form.id);
          moveDesktopQTool(save);
        }
      }
      if(!accountEmail)return;
      const primary=layer.querySelector('[data-repeated-name="profileEmails"] [data-repeated-row] input[name="profileEmails"]');
      if(!primary)return;
      primary.readOnly=true;
      primary.dataset.accountPrimaryEmail='true';
      primary.title='Нажмите, чтобы изменить основной Email';
      primary.setAttribute('aria-label','Основной Email. Нажмите, чтобы изменить и подтвердить новый адрес');
      const editAccountEmail=()=>{
        void import('./account-controls.js')
          .then(({openAccountEmailSettingsModal})=>openAccountEmailSettingsModal())
          .catch(()=>showProfileError('Не удалось открыть изменение Email'));
      };
      primary.addEventListener('click',editAccountEmail);
      primary.addEventListener('keydown',(event)=>{
        if(event.key!=='Enter'&&event.key!==' ')return;
        event.preventDefault();
        editAccountEmail();
      });
    },
  });
}

export function openProfileAppearanceQ(root,{onSaved=null,navigateBack=()=>{},options={}}={}){
  const typeOptions=[
    {value:'profile',label:'Профиль'},
    {value:'workplace',label:'Рабочее пространство'},
  ];
  const workplaces=()=>getWorkplaces();
  return openEntityCardAppearanceQ(root,{
    title:'Вид',
    typeLabel:'Тип карты',
    typeOptions,
    initialType:'profile',
    targetLabel:'Рабочее пространство',
    initialTarget:'all',
    defaultTarget:(type)=>type==='workplace'?workplaces()[0]?.key||'all':'all',
    allowPhoto:(type,target)=>type==='profile'||(type==='workplace'&&target!=='all'),
    targetOptions:(type)=>type==='workplace'
      ? [{value:'all',label:'Общий вид'},...workplaces().map((item)=>({value:item.key,label:item.name||'Рабочее пространство'}))]
      : [],
    resolve:(type,target)=>{
      const p=getProfile();
      const values=workplaces();
      if(type==='profile'){
        return {
          appearance:profileCardAppearance(p),
          fields:profileCardFields(p,values),
          photo:p.photo||'',
          photoPosition:avatarPosition(p),
        };
      }
      const template=getCardAppearanceTemplate('workplace');
      const sample=target==='all'
        ? (values[0]||{name:'Рабочее пространство',photo:'',photoCropX:50,photoCropY:50,cardAppearance:{}})
        : (values.find((item)=>item.key===target)||values[0]||{name:'Рабочее пространство',photo:'',photoCropX:50,photoCropY:50,cardAppearance:{}});
      return {
        appearance:target==='all' && template?.appearance ? template.appearance : workplaceCardAppearance(sample),
        fields:workplaceCardFields(sample,p),
        photo:String(sample.photo||''),
        photoPosition:`${crop(sample.photoCropX)}% ${crop(sample.photoCropY)}%`,
      };
    },
    save:async({type,target,appearance,photo,editor})=>{
      if(type==='profile'){
        const current=getProfile();
        await saveProfileData({...current,photo,cardAppearance:appearance});
        return;
      }
      if(target==='all'){
        saveCardAppearanceTemplate('workplace',{
          appearance,
          // The common View configures presentation only. It must never copy
          // the example workplace's photo into every other workplace.
          photo:getCardAppearanceTemplate('workplace')?.photo||'',
          photoPosition:getCardAppearanceTemplate('workplace')?.photoPosition||'50% 50%',
        });
        const values=workplaces().map((item)=>({...item,cardAppearance:{}}));
        if(values.length)await saveWorkplaces(values);
        return;
      }
      const current=workplaces().find((item)=>item.key===target);
      if(!current)return;
      await upsertWorkplace({...current,photo,cardAppearance:appearance});
    },
    onSaved:()=>{if(typeof onSaved==='function')onSaved();else renderProfile(root,navigateBack,options)},
  });
}

function profileSettingsActions(root,navigateBack,options={}){
  const access=getAccess();
  const commercialActions=access?.commercialMode==='DEMO'?[
    {id:'demo-status',label:demoRemainingText(access),disabled:true},
    {
      id:'live-request',
      label:access.liveRequestedAt?'Запрос LIVE отправлен':'Запросить LIVE',
      disabled:Boolean(access.liveRequestedAt),
      onSelect:async()=>{
        try{
          await requestLiveMode();
          await loadAccess();
        }catch(error){
          showProfileError(error instanceof Error?error.message:'Не удалось отправить запрос LIVE');
        }
      },
    },
  ]:access?.commercialMode==='LIVE'?[
    {
      id:'live-tools',
      label:'LIVE · инструменты',
      onSelect:async()=>{
        try{
          await requestLiveMode({manage:true});
          await loadAccess();
        }catch(error){
          showProfileError(error instanceof Error?error.message:'Не удалось открыть инструменты LIVE');
        }
      },
    },
  ]:[];
  return [
      ...commercialActions,
      {id:'appearance',label:'Вид',onSelect:()=>openProfileAppearanceQ(root,{navigateBack,options})},
      {id:'password',label:'Изменить пароль',onSelect:()=>openSharedPasswordAction({onSubmit:({currentPassword,newPassword})=>changePassword(currentPassword,newPassword)})},
      {id:'controls',label:'Документы / Уведомления',onSelect:()=>import('./account-controls.js').then(({openAccountControlsModal})=>openAccountControlsModal())},
      {id:'logout',label:'Выход',variant:'danger',onSelect:()=>logout()},
  ];
}

function openProfileSettings(root,navigateBack,options={}){
  return openSharedProfileSettingsMenu({actions:profileSettingsActions(root,navigateBack,options)});
}

function renderDesktopProfileTools(root,navigateBack,options,workplacesAllowed,title){
  const actions=profileSettingsActions(root,navigateBack,options)
    .filter(action=>!['controls','logout','demo-status','password'].includes(action.id))
    .map(action=>{
      if(action.id==='live-request')return {...action,label:'DEMO',aria:action.label};
      if(action.id==='live-tools')return {...action,label:'LIVE',aria:action.label};
      return action;
    });
  const add=workplacesAllowed?button('<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',{
    variant:'secondary',className:'v2-desktop-tool-primary',data:'data-profile-desktop-add',aria:'Добавить рабочее пространство',
  }):'';
  const markup='<div class="v2-desktop-tool-row" data-profile-desktop-toolbar><div class="v2-desktop-tool-actions">'+
    actions.map(action=>button(action.label,{variant:'secondary',className:'v2-desktop-tool-accent',data:'data-profile-desktop-action="'+action.id+'"',aria:action.aria||action.label,disabled:Boolean(action.disabled)})).join('')+add+'</div></div>';
  const [row]=setV2ZHeaderRows(root,[markup],{desktopTitle:title});
  row?.querySelectorAll('[data-profile-desktop-action]').forEach(control=>{
    const action=actions.find(item=>item.id===control.dataset.profileDesktopAction);
    if(action&&!action.disabled)control.addEventListener('click',action.onSelect);
  });
  row?.querySelector('[data-profile-desktop-add]')?.addEventListener('click',()=>openWorkplace(root,null,navigateBack,options));
}

async function openWorkplaceQ(root,existing,navigateBack,options={}){
  // Do not open a draft with default rules before the server snapshot is loaded.
  if(canUseCapability('online_booking.access')){
    try{await loadOperationalState({full:true});}
    catch(error){showProfileError(root,error?.message||'Не удалось загрузить правила онлайн-записи.');return;}
    if(!root.isConnected)return;
  }
  // The F profile owns Header B. Q owns only its canonical in-sheet title.
  const layer=mountModal(root,modal(workplaceForm(existing),{
    title:'Рабочее пространство',
    variant:'q',
    surface:'app',
    className:'v2-workplace-data-layer',
  }));
  if(!layer)return;
  const closeAndRender=()=>{
    layer.v2Close?.();
    renderProfile(root,navigateBack,options);
  };
  bindWorkplaceForm(layer,existing,{
    onSaved:closeAndRender,
    onDeleted:closeAndRender,
  });
}

function openWorkplace(root,existing,navigateBack,options={}){
  const workplaceLimit=getLimit('workplaces.max');
  if(!existing&&workplaceLimit!==null&&getWorkplaces().length>=workplaceLimit){
    openWorkplaceLimitModal(root,workplaceLimit);
    return;
  }
  openWorkplaceQ(root,existing,navigateBack,options);
}

function rootAddSource(){
  return workplaceAddButton({
    label:'+',
    className:'v2-primary-source-only',
    variant:'',
    data:'data-add-workplace data-v2-primary-action data-v2-primary-label="+"',
  });
}

function renderProfile(root,navigateBack,options={}){
  if(!root?.isConnected)return;
  const p=getProfile();
  const workplacesAllowed=canUseCapability('workplaces.access');
  const workplaceOnly=options.desktopPart==='workplaces';
  const profileOnly=options.desktopPart==='profile';
  const desktopRoot=isV2DesktopWorkspace(root.closest('[data-v2-app]'))&&!profileOnly;
  const desktopOverview=desktopRoot&&!workplaceOnly;
  root.innerHTML=page([
    workplaceOnly?workspaceHeaderContext({title:'Рабочие пространства',v:desktopRoot?null:{data:'data-profile-settings',aria:'Настройки'}}):profileContext(p,desktopOverview||profileOnly?'Профиль':fullName(p),{includeSettings:!desktopRoot}),
    workplaceOnly?'':desktopOverview?v2Section('Профиль',profileCard(p)):profileCard(p),
    workplacesAllowed&&!profileOnly?(workplaceOnly?workplaceRail():v2Section('Рабочие пространства',workplaceRail())):'',
    workplacesAllowed&&!profileOnly&&!desktopRoot?rootAddSource():''
  ]);
  if(desktopRoot){
    renderDesktopProfileTools(root,navigateBack,options,workplacesAllowed,workplaceOnly?'Рабочие пространства':'Профиль');
    bindDesktopWorkplaceRail(root);
  }
  root.querySelector('[data-profile-settings]')?.addEventListener('click',()=>openProfileSettings(root,navigateBack,options));
  root.querySelector('[data-profile-card]')?.addEventListener('click',()=>openProfileData(root,navigateBack,options));
  root.querySelector('[data-add-workplace]')?.addEventListener('click',()=>openWorkplace(root,null,navigateBack,options));
  root.querySelectorAll('[data-workplace]').forEach(el=>el.addEventListener('click',()=>openWorkplace(root,getWorkplaces().find(w=>w.key===el.dataset.workplace)||null,navigateBack,options)));
}

// Desktop account entry uses the existing profile data/card/settings in Q.
export function openDesktopProfileQ(root,options={}){
  if(!canUseCapability('profile.access'))return null;
  const layer=mountModal(root,modal('<div data-desktop-profile-content></div>',{title:'Профиль',variant:'q',surface:'app'}));
  const host=layer?.querySelector('[data-desktop-profile-content]');
  if(!host)return layer;
  const refresh=()=>{if(host.isConnected)renderProfile(host,refresh,{...options,desktopPart:'profile'});options.onSaved?.();};
  refresh();
  return layer;
}
