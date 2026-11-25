import { settingsSectionHeader, settingsDetailHeading, setSettingsDetailOpen } from '../settings.js';
import { buildBookingLink } from '../../core/booking-link/index.js';
import { apiRequest, getCurrentAccount } from '../../core/auth.js';
import { loadOperationalState } from '../../core/runtime/operational-state.js';
import {
  getBookingSettings,
  normalizeBookingSettings,
  saveBookingSettings,
} from '../../core/booking-settings/index.js';
import {
  actionBlock,
  button,
  copyIconButton,
  copyTextToClipboard,
  emptyState,
  escapeHtml,
  field,
  select,
  setCopyButtonCopied,
  textareaField,
} from '../../ui/ui.js';

let publicRouteState = { profileSlug: '', workplaces: [] };

async function loadOwnerPublicRoute() {
  const response = await apiRequest('/online-booking/owner/route');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || 'Не удалось сформировать короткую ссылку онлайн-записи');
  return {
    profileSlug: String(payload?.profileSlug || '').trim(),
    workplaces: (Array.isArray(payload?.workplaces) ? payload.workplaces : []).map((item) => ({
      key: String(item?.key || ''),
      name: String(item?.name || ''),
      slug: String(item?.slug || '').trim(),
    })),
  };
}

function bookingLink(profileSlug, workplaceSlug = '') {
  return buildBookingLink({
    origin: globalThis.location?.origin || '',
    profileSlug,
    workplaceSlug,
  });
}

function copyLinkField(label, value, kind) {
  return `<div class="field"><span>${escapeHtml(label)}</span><div class="input-action-row"><input type="text" value="${escapeHtml(value)}" readonly aria-label="${escapeHtml(label)}">${copyIconButton({ data: `data-copy-booking-link="${escapeHtml(kind)}"`, aria: `Скопировать: ${label}` })}</div></div>`;
}

function bindCopyButtons(root) {
  root.querySelectorAll('[data-copy-booking-link]').forEach((copyButton) => {
    copyButton.addEventListener('click', async () => {
      const value = copyButton.closest('.input-action-row')?.querySelector('input')?.value || '';
      if (!value) return;
      try {
        if (await copyTextToClipboard(value)) setCopyButtonCopied(copyButton);
      } catch {
        // Ссылка остаётся видимой для ручного копирования.
      }
    });
  });
}

function settingsSignature(value) {
  return JSON.stringify(normalizeBookingSettings(value));
}

function welcomeDraft(form, baseSettings = getBookingSettings()) {
  const data = new FormData(form);
  return normalizeBookingSettings({
    ...baseSettings,
    welcomeTitle: data.get('welcomeTitle'),
    welcomeText: data.get('welcomeText'),
  });
}

function setWelcomeSaveVisible(host, visible) {
  const save = host?.querySelector('[data-online-booking-welcome-save]');
  const actions = save?.closest('.modal-actions');
  if (actions) actions.hidden = !visible;
}

function mountScreen(root, body) {
  root.innerHTML = `${settingsSectionHeader(root,{title:'Онлайн-запись'})}<div class="form-grid form-grid--relaxed">${body}</div>`;
}

function renderInlineBooking(root) {
  // The editor belongs to the overview row, not to either summary card.
  const panel = root.closest('.settings-overview-section')?.querySelector('[data-settings-welcome-panel]');
  if (!panel) return;
  const workplaces = publicRouteState.workplaces.filter(item=>item.key && item.slug);
  const options = [{value:'',label:'Выбрать рабочее пространство'},...workplaces.map(item=>({value:item.key,label:item.name||'Без названия'}))];
  const saved = getBookingSettings();
  root.innerHTML = `<div class="settings-inline-heading"><strong>Онлайн-запись</strong>${button('Приветствие',{className:'settings-h-action',data:'data-inline-welcome aria-expanded="false" aria-controls="settings-online-welcome"'})}</div>
    <div class="form-grid settings-booking-fields">
      ${copyLinkField('Общая ссылка',bookingLink(publicRouteState.profileSlug),'general')}
      ${select({label:'Рабочее пространство',name:'bookingWorkplace',value:'',options,aria:'Выбрать рабочее пространство для онлайн-записи'})}
      ${copyLinkField('Ссылка рабочего пространства','','workplace')}
    </div>`;
  panel.hidden = true;
  panel.innerHTML = `${settingsDetailHeading('Приветствие','settings-online-welcome')}
    <form class="form-grid settings-inline-welcome" data-inline-welcome-form>
      ${field({label:'Заголовок',name:'welcomeTitle',value:saved.welcomeTitle,maxlength:90})}
      ${textareaField({label:'Текст',name:'welcomeText',value:saved.welcomeText,rows:4,maxlength:500})}
      ${button('Сохранить',{type:'submit',className:'settings-h-action',data:'data-inline-welcome-save hidden'})}
    </form>`;
  bindCopyButtons(root);
  const copy = root.querySelector('[data-copy-booking-link="workplace"]');
  const link = copy?.closest('.input-action-row')?.querySelector('input');
  if(copy) copy.disabled=true;
  root.querySelector('input[name="bookingWorkplace"]')?.addEventListener('change',event=>{
    const workplace=workplaces.find(item=>item.key===event.target.value);
    if(link) link.value=workplace?bookingLink(publicRouteState.profileSlug,workplace.slug):'';
    if(copy) copy.disabled=!link?.value;
  });
  const toggle=root.querySelector('[data-inline-welcome]');
  const form=panel.querySelector('[data-inline-welcome-form]');
  const save=form?.querySelector('[data-inline-welcome-save]');
  let baseline=saved;
  const sync=()=>{if(save)save.hidden=settingsSignature(welcomeDraft(form,baseline))===settingsSignature(baseline);};
  toggle?.addEventListener('click',()=>{
    setSettingsDetailOpen(panel,panel.hidden);
  });
  form?.addEventListener('input',sync);
  form?.addEventListener('change',sync);
  form?.addEventListener('submit',event=>{
    event.preventDefault();
    baseline=saveBookingSettings(welcomeDraft(form,getBookingSettings()));
    sync();
    setSettingsDetailOpen(panel,false);
  });
  sync();
}

function renderReady(root) {
  if(root.hasAttribute('data-settings-embedded')) return renderInlineBooking(root);
  const workplaces = publicRouteState.workplaces.filter(item=>item.key && item.slug);
  const options = [{value:'',label:'Выбрать рабочее пространство'},...workplaces.map(item=>({value:item.key,label:item.name||'Без названия'}))];
  const saved = getBookingSettings();
  mountScreen(root,`<div class="form-grid settings-mobile-booking-links">
    ${copyLinkField('Общая ссылка',bookingLink(publicRouteState.profileSlug),'general')}
    ${select({label:'Рабочее пространство',name:'bookingWorkplace',value:'',options,aria:'Выбрать рабочее пространство для онлайн-записи'})}
    ${copyLinkField('Ссылка рабочего пространства','','workplace')}
  </div>
  <section class="settings-mobile-booking-welcome">
    <strong>Приветствие</strong>
    <form class="form-grid" data-online-booking-welcome>
      ${field({label:'Заголовок',name:'welcomeTitle',value:saved.welcomeTitle,maxlength:90})}
      ${textareaField({label:'Текст',name:'welcomeText',value:saved.welcomeText,rows:6,maxlength:500})}
      ${actionBlock(button('Сохранить',{type:'submit',data:'data-online-booking-welcome-save',aria:'Сохранить приветствие'}))}
    </form>
  </section>`);
  bindCopyButtons(root);
  const copy=root.querySelector('[data-copy-booking-link="workplace"]');
  const link=copy?.closest('.input-action-row')?.querySelector('input');
  if(copy)copy.disabled=true;
  root.querySelector('input[name="bookingWorkplace"]')?.addEventListener('change',event=>{
    const workplace=workplaces.find(item=>item.key===event.target.value);
    if(link)link.value=workplace?bookingLink(publicRouteState.profileSlug,workplace.slug):'';
    if(copy)copy.disabled=!link?.value;
  });
  const form=root.querySelector('[data-online-booking-welcome]');
  let baseline=saved;
  const sync=()=>setWelcomeSaveVisible(root,settingsSignature(welcomeDraft(form,baseline))!==settingsSignature(baseline));
  form?.addEventListener('input',sync);
  form?.addEventListener('change',sync);
  form?.addEventListener('submit',event=>{
    event.preventDefault();
    if(settingsSignature(welcomeDraft(form,baseline))===settingsSignature(baseline))return;
    baseline=saveBookingSettings(welcomeDraft(form,getBookingSettings()));
    sync();
  });
  sync();
}

function renderUnavailable(root, title, message) {
  if(root.hasAttribute('data-settings-embedded')) {
    root.innerHTML='<strong class="settings-overview-card-title">Онлайн-запись</strong>'+emptyState(title,message);
    return;
  }
  mountScreen(root, emptyState(title, message));
}

export function render(root) {
  root.innerHTML = `${settingsSectionHeader(root,{ title: 'Онлайн-запись' })}${emptyState('Загрузка', 'Формируем ссылки онлайн-записи.')}`;

  void Promise.all([loadOperationalState({ full: true }), getCurrentAccount(), loadOwnerPublicRoute()])
    .then(([, account, publicRoute]) => {
      const tenantId = String(account?.tenant?.id || '');
      if (!tenantId || !publicRoute.profileSlug) {
        renderUnavailable(root, 'Ссылка недоступна', 'Не удалось определить адрес онлайн-записи.');
        return;
      }
      publicRouteState = publicRoute;
      renderReady(root);
    })
    .catch(() => renderUnavailable(root, 'Ссылка недоступна', 'Не удалось сформировать ссылку онлайн-записи.'));
}
