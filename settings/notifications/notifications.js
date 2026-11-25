import { settingsSectionHeader } from '../settings.js';
import { compactCheck } from '../../ui/selection/check-list.js';
import {
  getNotificationCatalog,
  getNotificationDeliveryRouting,
  getNotificationRouting,
  saveNotificationDeliveryRouting,
  saveNotificationRouting,
  setAllNotificationsEnabled,
  setNotificationEnabled,
} from '../../core/notifications/routing.js';
import {
  button,
  compactButton,
  emptyState,
  escapeHtml,
  field,
  modal,
  mountModal,
  mountV2ZLayer,
  page,
  select,
  smallActionButton,
  textareaField,
  v2Section,
  v2ListEntry,
  v2ListEntries,
  v2ZLayer,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import { messageBubble } from '../../ui/chat/index.js';

const EXTERNAL_CHANNEL_OPTIONS = Object.freeze([
  { value: 'TELEGRAM', label: 'Telegram' },
  { value: 'EMAIL', label: 'Email' },
  { value: '', label: 'Не использовать' },
]);

const ROUTING_MODE_OPTIONS = Object.freeze([
  { value: 'always', label: 'Во все выбранные каналы' },
  { value: 'fallback', label: 'По очереди, если предыдущий не доставлен' },
]);

const PREVIEW_VALUES = Object.freeze({
  date: '18 октября',
  time: '14:30',
  workplace: 'Рабочее пространство',
  amount: '5 000 ₽',
  document: 'Согласие на обработку данных',
  program: 'Программа лояльности',
  investment: 'Инвестиционная программа',
  status: 'Подтверждено',
  person: { name: 'Александр', surname: 'Иванов' },
});

function text(value = '') {
  return String(value ?? '').trim();
}

function policyFor(routing, event) {
  const source = Array.isArray(routing) ? routing.find((item) => item?.eventType === event.type) : null;
  return {
    enabled: source?.enabled === true,
    titleTemplate: text(source?.titleTemplate) || text(event.defaultTitle) || event.title,
    bodyTemplate: text(source?.bodyTemplate) || text(event.defaultBody),
  };
}

function externalChannelValues(policy = {}) {
  const values = [];
  for (const value of Array.isArray(policy.channels) ? policy.channels : []) {
    const channel = String(value || '').trim().toUpperCase();
    if (!['TELEGRAM', 'EMAIL'].includes(channel) || values.includes(channel)) continue;
    values.push(channel);
  }
  while (values.length < 2) values.push('');
  return values.slice(0, 2);
}

function selectedExternalChannels(form) {
  const data = new FormData(form);
  const values = ['channel1', 'channel2']
    .map((name) => String(data.get(name) || '').trim().toUpperCase())
    .filter((value) => ['TELEGRAM', 'EMAIL'].includes(value));
  return [...new Set(values)];
}

function openPushInfo() {
  const content = '<div class="modal-title"><h2>Push</h2><p>Push отправляется всегда отдельно. Последовательность применяется только к Telegram и Email.</p></div>';
  return mountModal(document.body, modal(content, {
    title: 'О Push',
    variant: 's',
    surface: 'app',
  }));
}

function deliveryFields(policy = {}) {
  const channels = externalChannelValues(policy);
  return `<div class="field-inline-label"><span>Push — всегда</span>${smallActionButton({
    icon: 'info', data: 'data-notification-push-info', aria: 'О Push',
  })}</div>
    ${select({label:'Порядок отправки',name:'mode',value:policy?.mode === 'fallback'?'fallback':'always',options:ROUTING_MODE_OPTIONS})}
    ${select({label:'Канал 1',name:'channel1',value:channels[0],options:EXTERNAL_CHANNEL_OPTIONS})}
    ${select({label:'Канал 2',name:'channel2',value:channels[1],options:EXTERNAL_CHANNEL_OPTIONS})}`;
}

function deliveryDraft(form) {
  const data = new FormData(form);
  return {mode:data.get('mode') === 'fallback'?'fallback':'always',channels:['PUSH',...selectedExternalChannels(form)]};
}

export async function renderDeliveryCard(host) {
  const save = host.closest('.settings-notification-card')?.querySelector('[data-notification-card-save]');
  if (!save) return;
  save.hidden = true;
  const policy = await getNotificationDeliveryRouting();
  if (!host.isConnected) return;
  const draw = current => {
    host.innerHTML = `<form id="settings-notification-delivery-form" class="form-grid settings-notification-delivery-form" data-notification-delivery-form>
      ${deliveryFields(current)}
      <div class="muted" data-notification-delivery-status aria-live="polite"></div>
    </form>`;
    const form = host.querySelector('form');
    const status = form.querySelector('[data-notification-delivery-status]');
    const baseline = JSON.stringify(deliveryDraft(form));
    let busy = false;
    const sync = () => {
      save.hidden = JSON.stringify(deliveryDraft(form)) === baseline;
      save.disabled = busy;
      form.querySelectorAll('button').forEach(control=>{control.disabled=busy;});
    };
    form.querySelector('[data-notification-push-info]')?.addEventListener('click',openPushInfo);
    form.addEventListener('input',sync);
    form.addEventListener('change',sync);
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const draft=deliveryDraft(form);
      if(busy || JSON.stringify(draft)===baseline)return;
      busy=true;sync();status.textContent='Сохраняем…';
      try {
        const saved=await saveNotificationDeliveryRouting(draft);
        if(host.isConnected)draw(saved);
      } catch(error) {
        status.textContent=error?.message||'Не удалось сохранить настройки доставки';
      } finally {
        busy=false;
        if(form.isConnected)sync();
      }
    });
    sync();
  };
  draw(policy);
}

export async function openDeliverySettings() {
  const policy = await getNotificationDeliveryRouting();
  const body = `<div data-notification-delivery-settings>
    <form class="form-grid" data-notification-delivery-form>
      ${deliveryFields(policy)}
      <div class="muted" data-notification-delivery-status aria-live="polite"></div>
      ${button('Сохранить', { type: 'submit' })}
    </form>
  </div>`;
  const layer = mountModal(document.body, modal(body, {
    title: 'Настройки уведомлений',
    variant: 'x',
    className: 'modal--form-sheet',
  }));
  if (!layer) return null;

  layer.querySelector('[data-notification-push-info]')?.addEventListener('click', openPushInfo);
  const form = layer.querySelector('[data-notification-delivery-form]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = layer.querySelector('[data-notification-delivery-status]');
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    if (status) status.textContent = 'Сохраняем…';
    try {
      await saveNotificationDeliveryRouting(deliveryDraft(form));
      layer.v2Close?.();
    } catch (error) {
      if (submit) submit.disabled = false;
      if (status) status.textContent = error instanceof Error ? error.message : 'Не удалось сохранить';
    }
  });
  return layer;
}

function renderTemplate(template, values = PREVIEW_VALUES) {
  return String(template || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
    const value = String(path || '').split('.').reduce((current, key) => current && typeof current === 'object' ? current[key] : '', values);
    return String(value ?? '');
  });
}

function previewMarkup(titleTemplate, bodyTemplate) {
  const title = renderTemplate(titleTemplate);
  const body = renderTemplate(bodyTemplate);
  return `<div data-notification-preview>${messageBubble({
    direction: 'outbound',
    body: [title, body].filter(Boolean).join('\n\n'),
  }, { viewer: 'profile' })}</div>`;
}

function editorSignature(form) {
  if (!form) return '';
  const data = new FormData(form);
  return JSON.stringify([
    String(data.get('titleTemplate') || ''),
    String(data.get('bodyTemplate') || ''),
  ]);
}

function editorMarkup(event, current) {
  const variableText = (Array.isArray(event.variables) ? event.variables : [])
    .map((value) => `{{${escapeHtml(value)}}}`)
    .join(', ');
  return `${workspaceHeaderContext({ title: event.title })}
    ${v2Section('Предпросмотр', previewMarkup(current.titleTemplate, current.bodyTemplate))}
    ${v2Section('Сообщение', `
      <form class="form-grid" data-notification-policy-form>
        ${field({ label: 'Заголовок сообщения', name: 'titleTemplate', value: current.titleTemplate, required: true })}
        ${textareaField({ label: 'Текст сообщения', name: 'bodyTemplate', value: current.bodyTemplate, rows: 7, required: true })}
        ${variableText ? `<div class="muted">Доступно: ${variableText}</div>` : ''}
        <div class="muted" data-notification-editor-status aria-live="polite"></div>
        <button type="button" class="v2-workspace-source-hidden" data-v2-primary-action data-v2-primary-label="Сохранить" data-v2-primary-visible="false" aria-label="Сохранить сообщение">Сохранить</button>
      </form>
    `)}`;
}

function openEditor(root, routing, event) {
  const current = policyFor(routing, event);
  const layer = mountV2ZLayer(root, v2ZLayer(editorMarkup(event, current), { className: 'notification-editor-z' }), { stack: true });
  if (!layer) return null;

  const form = layer.querySelector('[data-notification-policy-form]');
  const preview = layer.querySelector('[data-notification-preview]');
  const primary = layer.querySelector('[data-v2-primary-action]');
  const status = layer.querySelector('[data-notification-editor-status]');
  const initial = editorSignature(form);

  const redraw = () => {
    if (!form) return;
    const data = new FormData(form);
    if (preview) {
      preview.innerHTML = messageBubble({
        direction: 'outbound',
        body: [
          renderTemplate(data.get('titleTemplate')),
          renderTemplate(data.get('bodyTemplate')),
        ].filter(Boolean).join('\n\n'),
      }, { viewer: 'profile' });
    }
    if (primary) primary.dataset.v2PrimaryVisible = editorSignature(form) !== initial ? 'true' : 'false';
    window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
  };

  form?.addEventListener('input', redraw);
  primary?.addEventListener('click', () => form?.requestSubmit());
  form?.addEventListener('submit', async (submitEvent) => {
    submitEvent.preventDefault();
    if (!form) return;
    if (primary) primary.disabled = true;
    if (status) status.textContent = 'Сохраняем…';
    const data = new FormData(form);
    try {
      await saveNotificationRouting(event.type, {
        titleTemplate: data.get('titleTemplate'),
        bodyTemplate: data.get('bodyTemplate'),
      });
      layer.v2Close?.();
      await render(root);
    } catch (error) {
      if (primary) primary.disabled = false;
      if (status) status.textContent = error instanceof Error ? error.message : 'Не удалось сохранить сообщение';
      window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
    }
  });
  redraw();
  return layer;
}


const VARIABLE_LABELS = Object.freeze({
  date:'Дата', time:'Время', workplace:'Рабочее пространство', amount:'Сумма',
  document:'Название документа', program:'Название программы лояльности',
  investment:'Название инвестиции', status:'Статус участия',
  'person.name':'Имя клиента', 'person.surname':'Фамилия клиента',
});

function desktopGroups(catalog) {
  const groups = new Map(['Запись','Финансы','Лояльность','Документы и согласия'].map(name=>[name,[]]));
  for (const event of catalog) {
    const type = String(event.type || '');
    const name = /^(loyalty|personal-account|investment|deposit)\./.test(type)
      ? 'Лояльность' : text(event.group) || 'Другие';
    if (!groups.has(name)) groups.set(name,[]);
    groups.get(name).push(event);
  }
  return [...groups].filter(([,events])=>events.length);
}

function desktopRow(event, routing) {
  const type = escapeHtml(event.type);
  const policy = policyFor(routing,event);
  return `<div class="notification-desktop-item" data-notification-item="${type}">
    <div class="notification-desktop-row">
      ${compactCheck({checked:policy.enabled,data:'data-notification-enabled="'+type+'"',aria:'Отправлять: '+event.title})}
      ${v2ListEntry({title:event.title,subtitle:event.description||'',omitEmptySubtitle:true,initial:'',className:'notification-desktop-entry',data:'data-notification-open="'+type+'" aria-expanded="false"',aria:'Редактировать: '+event.title})}
    </div>
    <div class="notification-desktop-editor" data-notification-editor="${type}" hidden></div>
  </div>`;
}

function desktopCatalogMarkup(catalog,routing) {
  return `<div class="notification-desktop-master">${compactCheck({label:'Сервисные уведомления',checked:allEventsEnabled(catalog,routing),data:'data-notification-service-enabled',aria:'Все сервисные уведомления'})}</div>
    <div class="muted" data-notification-catalog-status aria-live="polite"></div>
    ${desktopGroups(catalog).map(([group,events])=>`<section class="notification-desktop-group"><h3>${escapeHtml(group)}</h3>${v2ListEntries(events.map(event=>desktopRow(event,routing)))}</section>`).join('')}`;
}

function desktopEditor(panel,event,routing,close) {
  const current=policyFor(routing,event);
  const variables=Array.isArray(event.variables)?event.variables:[];
  panel.innerHTML=`<form class="form-grid" data-notification-policy-form>
    <div class="notification-editor-heading"><strong>${escapeHtml(event.title)}</strong><div class="notification-editor-actions">
      ${button('Сохранить',{type:'submit',className:'settings-h-action',data:'data-notification-editor-save hidden'})}
      ${compactButton({kind:'remove',className:'settings-detail-close',data:'data-notification-editor-close',aria:'Закрыть редактор'})}
    </div></div>
    <div class="notification-editor-columns"><div class="form-grid">
      ${field({label:'Заголовок',name:'titleTemplate',value:current.titleTemplate,required:true})}
      ${textareaField({label:'Текст',name:'bodyTemplate',value:current.bodyTemplate,rows:5,required:true})}
      ${variables.length?`<div class="notification-variables"><small>Подставить данные в заголовок или текст</small><div class="notification-variable-chips">${variables.map(key=>`<button type="button" class="settings-outline-action ui-button" data-notification-variable="${escapeHtml(key)}" title="${escapeHtml('{{'+key+'}}')}">${escapeHtml(VARIABLE_LABELS[key]||key)}</button>`).join('')}</div><small>Выберите поле и нажмите нужную переменную. При отправке она заменится фактическими данными.</small></div>`:''}
      <div class="muted" data-notification-editor-status aria-live="polite"></div>
    </div><div class="notification-editor-preview"><strong>Предпросмотр</strong><small>Пример сообщения</small>${previewMarkup(current.titleTemplate,current.bodyTemplate)}</div></div>
  </form>`;
  const form=panel.querySelector('form');
  const title=form.elements.titleTemplate;
  const body=form.elements.bodyTemplate;
  const save=form.querySelector('[data-notification-editor-save]');
  const preview=form.querySelector('[data-notification-preview]');
  const status=form.querySelector('[data-notification-editor-status]');
  let baseline=editorSignature(form),active=body,busy=false;
  const redraw=()=>{
    preview.innerHTML=messageBubble({direction:'outbound',body:[renderTemplate(title.value),renderTemplate(body.value)].filter(Boolean).join('\n\n')},{viewer:'profile'});
    save.hidden=editorSignature(form)===baseline;
    save.disabled=busy;
  };
  [title,body].forEach(input=>input.addEventListener('focus',()=>{active=input;}));
  form.addEventListener('input',redraw);
  form.querySelectorAll('[data-notification-variable]').forEach(control=>{
    control.addEventListener('pointerdown',event=>event.preventDefault());
    control.addEventListener('click',()=>{
      const key=control.dataset.notificationVariable;
      if(!variables.includes(key))return;
      const token='{{'+key+'}}';
      const start=active.selectionStart??active.value.length,end=active.selectionEnd??start;
      active.setRangeText(token,start,end,'end');
      active.focus({preventScroll:true});
      redraw();
    });
  });
  form.querySelector('[data-notification-editor-close]').addEventListener('click',close);
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    if(busy||editorSignature(form)===baseline)return;
    busy=true;redraw();status.textContent='Сохраняем…';
    try {
      const saved=await saveNotificationRouting(event.type,{titleTemplate:title.value,bodyTemplate:body.value});
      const index=routing.findIndex(item=>item?.eventType===event.type);
      if(index>=0)routing[index]=saved;else routing.push(saved);
      title.value=saved?.titleTemplate??title.value;
      body.value=saved?.bodyTemplate??body.value;
      baseline=editorSignature(form);status.textContent='';
    } catch(error) {status.textContent=error?.message||'Не удалось сохранить сообщение';}
    finally {busy=false;redraw();}
  });
  redraw();
}

function bindDesktopEditors(root,host,catalog,routing) {
  const buttons=[...host.querySelectorAll('[data-notification-open]')];
  const closeAll=except=>{
    for(const control of buttons){
      if(control===except)continue;
      const panel=control.closest('[data-notification-item]')?.querySelector('[data-notification-editor]');
      if(panel)panel.hidden=true;
      control.setAttribute('aria-expanded','false');
    }
  };
  root.closest('[data-settings-panel="notifications"]')?.addEventListener('settings-detail-closed',()=>closeAll());
  for(const control of buttons) control.addEventListener('click',()=>{
    const panel=control.closest('[data-notification-item]')?.querySelector('[data-notification-editor]');
    const event=catalog.find(item=>item.type===control.dataset.notificationOpen);
    if(!panel||!event)return;
    const show=panel.hidden;
    closeAll();
    if(!show)return;
    if(!panel.firstElementChild) desktopEditor(panel,event,routing,()=>{panel.hidden=true;control.setAttribute('aria-expanded','false');control.focus({preventScroll:true});});
    panel.hidden=false;control.setAttribute('aria-expanded','true');
  });
}

function groupedEvents(catalog = []) {
  const groups = new Map();
  for (const event of Array.isArray(catalog) ? catalog : []) {
    const group = text(event?.group) || 'Другие';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(event);
  }
  return groups;
}

function eventRow(event, policy) {
  return `<div class="app-notification-row" data-notification-row="${escapeHtml(event.type)}">
    ${compactCheck({checked: policy.enabled, data: `data-notification-enabled="${escapeHtml(event.type)}"`, aria: 'Отправлять: ' + event.title})}
    <span data-notification-open="${escapeHtml(event.type)}" role="button" tabindex="0" aria-label="Редактировать: ${escapeHtml(event.title)}">
      <strong>${escapeHtml(event.title)}</strong>
      ${event.description ? `<small>${escapeHtml(event.description)}</small>` : ''}
    </span>
  </div>`;
}

function allEventsEnabled(catalog, routing) {
  return catalog.length > 0 && catalog.every((event) => policyFor(routing, event).enabled);
}

function serviceControlMarkup(catalog, routing) {
  return v2Section('Сервисные уведомления', `<div class="app-notification-list">
    <div class="app-notification-row">
      ${compactCheck({checked: allEventsEnabled(catalog, routing), data: 'data-notification-service-enabled', aria: 'Все сервисные уведомления'})}
      <span>
        <strong>Все сервисные уведомления</strong>
        <small>Включить или выключить весь список</small>
      </span>
    </div>
  </div>`);
}

function catalogMarkup(catalog, routing) {
  return [...groupedEvents(catalog).entries()].map(([group, events]) => v2Section(
    group,
    `<div class="app-notification-list">${events.map((event) => eventRow(event, policyFor(routing, event))).join('')}</div>`,
  )).join('');
}

function replaceRouting(routing, saved) {
  routing.splice(0, routing.length, ...(Array.isArray(saved) ? saved : []));
}

function bindCatalog(root, host, catalog, routing, {desktop=false}={}) {
  const byType = new Map(catalog.map((event) => [event.type, event]));
  const serviceToggle = host.querySelector('[data-notification-service-enabled]');
  const eventToggles = [...host.querySelectorAll('[data-notification-enabled]')];

  const catalogStatus=host.querySelector('[data-notification-catalog-status]');
  let saving=false;
  const lock=value=>{saving=value;if(serviceToggle)serviceToggle.disabled=value;eventToggles.forEach(checkbox=>{checkbox.disabled=value;});};
  const syncServiceState = () => {
    if (serviceToggle) {
      serviceToggle.checked = allEventsEnabled(catalog, routing);
      serviceToggle.indeterminate = !serviceToggle.checked && catalog.some(event=>policyFor(routing,event).enabled);
    }
  };
  syncServiceState();

  serviceToggle?.addEventListener('change', async () => {
    if(saving)return;
    const requested = serviceToggle.checked;
    lock(true);if(catalogStatus)catalogStatus.textContent='';
    try {
      const saved = await setAllNotificationsEnabled(requested);
      replaceRouting(routing, saved);
      eventToggles.forEach((checkbox) => {
        const type = checkbox.dataset.notificationEnabled || '';
        checkbox.checked = routing.find((item) => item?.eventType === type)?.enabled === true;
      });
      syncServiceState();
    } catch (error) {
      syncServiceState();
      if(catalogStatus)catalogStatus.textContent=error?.message||'Не удалось изменить уведомления';
    } finally {lock(false);}
  });

  eventToggles.forEach((checkbox) => {
    checkbox.addEventListener('click', (event) => event.stopPropagation());
    checkbox.addEventListener('change', async () => {
      if(saving)return;
      const type = checkbox.dataset.notificationEnabled || '';
      const previous = !checkbox.checked;
      lock(true);if(catalogStatus)catalogStatus.textContent='';
      try {
        const saved = await setNotificationEnabled(type, checkbox.checked);
        const index = routing.findIndex((item) => item?.eventType === type);
        if (index >= 0) routing[index] = saved;
        else routing.push(saved);
        checkbox.checked = saved?.enabled === true;
        syncServiceState();
      } catch (error) {
        checkbox.checked = previous;
        if(catalogStatus)catalogStatus.textContent=error?.message||'Не удалось изменить уведомление';
      } finally {lock(false);}
    });
  });

  if(desktop){bindDesktopEditors(root,host,catalog,routing);return;}
  const open = (node) => {
    const event = byType.get(node.dataset.notificationOpen || '');
    if (event) openEditor(root, routing, event);
  };
  host.querySelectorAll('[data-notification-open]').forEach((node) => {
    node.addEventListener('click', () => open(node));
    node.addEventListener('keydown', (event) => {
      if (!['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      open(node);
    });
  });
}

export async function render(root) {
  const desktop=root.hasAttribute('data-settings-embedded');
  root.innerHTML = page([
    desktop?'':settingsSectionHeader(root,{
      title: 'Уведомления',
      v: {
        data: 'data-notification-delivery-settings-open',
        aria: 'Настройки доставки уведомлений',
      },
    },[{label:'Доставка',data:'data-notification-delivery-settings-open',aria:'Настройки доставки уведомлений'}]),
    '<div data-notification-routing></div>',
  ]);
  root.querySelector('[data-notification-delivery-settings-open]')?.addEventListener('click', () => void openDeliverySettings());

  const host = root.querySelector('[data-notification-routing]');
  if (host) host.innerHTML = emptyState('Загрузка', 'Загружаем уведомления.');

  try {
    const [catalog, routing] = await Promise.all([
      getNotificationCatalog(),
      getNotificationRouting(),
    ]);
    if (!host) return;
    host.innerHTML = desktop?desktopCatalogMarkup(catalog,routing):`${serviceControlMarkup(catalog, routing)}${catalogMarkup(catalog, routing)}`;
    bindCatalog(root, host, catalog, routing,{desktop});
  } catch (error) {
    if (host) host.innerHTML = emptyState('Настройки недоступны', error instanceof Error ? error.message : 'Не удалось загрузить уведомления.');
  }
}
