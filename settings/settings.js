import { canUseCapability } from '../core/access.js';
import { button, compactButton, columnLayout, emptyState, folderList, pageHeader, workspaceHeaderContext } from '../ui/ui.js';
import { isV2DesktopWorkspace } from '../ui/v2/geometry.js';
import { loadTenantDocumentArchive } from '../core/runtime/tenant-document-archive.js';

const folders = [
  ['data-transfer', 'Перенос данных', '◫', () => import('./data-transfer/data-transfer.js'), 'data_transfer.access'],
  ['online-booking', 'Онлайн-запись', '◫', () => import('./online-booking/online-booking.js'), 'online_booking.access'],
  ['notifications', 'Уведомления', '◫', () => import('./notifications/notifications.js'), 'notifications.access'],
  ['integrations', 'Интеграции', '◫', () => import('./integrations/integrations.js'), 'integrations.access'],
  ['documents', 'Документы', '◫', () => import('./documents/documents.js'), 'documents.access'],
  ['tags', 'Ярлыки', '◫', () => import('./tags/tags.js'), 'tags.access'],
];

function availableFolders() {
  return folders.filter((folder) => !folder[4] || canUseCapability(folder[4]));
}

function workspaceFolders() {
  return availableFolders();
}

export function settingsNavigationItems() {
  return workspaceFolders().map(([id, label]) => ({ id, label }));
}

export async function renderSettingsSection(root, key = '', { onBack = () => {} } = {}) {
  if (isV2DesktopWorkspace(root.closest('[data-v2-app]'))) return renderDesktopSettings(root);
  const visible = workspaceFolders();
  const folder = visible.find(([id]) => id === key) || visible[0];
  if (!folder) {
    root.innerHTML = pageHeader('Настройки');
    return;
  }
  const module = await folder[3]();
  return module.render(root, onBack);
}

function renderRows(root) {
  const visible = availableFolders();
  root.innerHTML = `${pageHeader('Настройки')}${folderList(visible.map(([key, label]) => ({ title: label, data: `data-settings-open="${key}"` })))}`;
  root.querySelectorAll('[data-settings-open]').forEach((element) => {
    element.addEventListener('click', async () => {
      const folder = visible.find(([key]) => key === element.dataset.settingsOpen);
      if (!folder) return;
      const { render } = await folder[3]();
      render(root, () => renderRows(root));
    });
  });
}

export function renderSettings(root) {
  renderRows(root);
}


// Desktop overview uses the existing section owners, not duplicate settings.
// Embedded controls replace the hidden global V/C sources only on this surface.
export function settingsSectionHeader(root, context, actions = []) {
  if (!root?.hasAttribute('data-settings-embedded')) return workspaceHeaderContext(context);
  return actions.length ? '<div class="settings-overview-actions">'+actions.map(action => button(action.label, {
    variant: action.variant || 'outline', data: action.data, aria: action.aria || action.label,
  })).join('')+'</div>' : '';
}

// Desktop inline details are transient surfaces: one open at a time, no
// remount of the section owner and no implicit save/discard of form drafts.
export function settingsDetailHeading(title, id) {
  return '<div class="settings-inline-heading"><strong>'+title+'</strong>'+compactButton({
    kind:'remove',className:'settings-detail-close',data:'data-settings-detail-close="'+id+'"',aria:'Закрыть '+title,
  })+'</div>';
}

export function setSettingsDetailOpen(panel, open) {
  const overview = panel?.closest('.settings-overview');
  if (!overview || !panel.matches('[data-settings-detail]')) return;
  const set = (detail, visible) => {
    const changed = detail.hidden === visible;
    detail.hidden = !visible;
    if (changed && !visible) detail.dispatchEvent(new Event('settings-detail-closed'));
    for (const control of overview.querySelectorAll('[aria-controls]')) {
      if (control.getAttribute('aria-controls') === detail.id) control.setAttribute('aria-expanded',String(visible));
    }
    const stateKey = detail.dataset.settingsDetailState;
    if (stateKey) {
      const host = detail.closest('[data-settings-embedded]');
      if (host) host.dataset[stateKey] = String(visible);
    }
  };
  if (open) {
    for (const detail of overview.querySelectorAll('[data-settings-detail]')) {
      if (detail !== panel) set(detail,false);
    }
  }
  set(panel,Boolean(open));
}

export function settingsOverviewMarkup(visible) {
  const available = new Map(visible.map(folder => [folder[0], folder[1]]));
  const top = ['online-booking','integrations','data-transfer'].filter(id => available.has(id));
  const middle = ['notifications','tags'].filter(id => available.has(id));
  const summaries = {
    'online-booking': 'Ссылки, приветствие и правила',
    integrations: 'Telegram и Email',
    'data-transfer': 'Импорт из Excel и история переносов',
    notifications: 'События и способы доставки',
    tags: 'Создание и назначение ярлыков',
    documents: 'Документы, шаблоны и история подписаний',
  };
  const card = id => {
    if (['online-booking','integrations','tags','documents'].includes(id)) return '<section class="settings-overview-card settings-overview-card--inline" data-settings-inline="'+id+'" data-settings-section-owner="'+id+'"><div data-settings-embedded></div></section>';
    if (id === 'notifications') return '<section class="settings-overview-card settings-notification-card" data-settings-section-owner="notifications"><div class="settings-inline-heading settings-notification-card-heading"><button type="button" class="settings-notification-title" data-settings-tile="notifications" aria-expanded="false" aria-controls="settings-panel-notifications"><span>Уведомления</span><span class="settings-notification-chevron" aria-hidden="true">⌄</span></button><div class="settings-notification-card-actions">'+button('Сохранить',{type:'submit',className:'settings-h-action',data:'data-notification-card-save form="settings-notification-delivery-form" hidden'})+compactButton({kind:'info',data:'data-notification-card-info',aria:'О доставке уведомлений'})+'</div></div><div data-notification-delivery-card></div></section>';
    const trigger = '<button type="button" class="settings-overview-trigger" data-settings-tile="'+id+'" aria-expanded="false" aria-controls="settings-panel-'+id+'"><strong class="settings-overview-card-title">'+available.get(id)+'</strong><span class="settings-overview-card-summary">'+summaries[id]+'</span><span aria-hidden="true" class="settings-overview-arrow">⌄</span></button>';
    return '<section class="settings-overview-card" data-settings-section-owner="'+id+'">'+trigger+'</section>';
  };
  const panel = id => ['online-booking','integrations','tags','documents'].includes(id) ? '' : '<section id="settings-panel-'+id+'" class="settings-overview-panel" data-settings-panel="'+id+'" data-settings-detail data-settings-section-owner="'+id+'" hidden>'+settingsDetailHeading(available.get(id),'settings-panel-'+id)+'<div data-settings-embedded></div></section>';
  const welcomePanel = available.has('online-booking')
    ? '<section id="settings-online-welcome" class="settings-overview-panel" data-settings-welcome-panel data-settings-detail data-settings-section-owner="online-booking" hidden></section>'
    : '';
  return workspaceHeaderContext({title:'Настройки'})+'<div class="settings-overview">'+
    (top.length ? '<div class="settings-overview-section">'+columnLayout(top.map(card),{columns:top.length,ariaLabel:'Онлайн-запись, интеграции и перенос данных'})+welcomePanel+top.map(panel).join('')+'</div>' : '')+
    (middle.length ? '<div class="settings-overview-section">'+columnLayout(middle.map(card),{columns:middle.length,ariaLabel:'Уведомления и ярлыки'})+middle.map(panel).join('')+'</div>' : '')+
    (available.has('documents') ? '<div class="settings-overview-section">'+card('documents')+panel('documents')+'</div>' : '')+
    '</div>';
}

function renderDesktopSettings(root) {
  const visible = availableFolders();
  root.innerHTML = settingsOverviewMarkup(visible);
  const overview = root.querySelector('.settings-overview');
  const mounted = new Set();
  const pending = new Set();
  // Capture before local button handlers (including modal triggers). A click
  // inside a detail is still a click within its owning section.
  overview.addEventListener('click', event => {
    const close = event.target.closest('[data-settings-detail-close]');
    if (close) {
      const detail = overview.querySelectorAll('[data-settings-detail]');
      const panel = [...detail].find(item => item.id === close.dataset.settingsDetailClose);
      if (panel) {
        setSettingsDetailOpen(panel,false);
        [...overview.querySelectorAll('[aria-controls]')].find(control=>control.getAttribute('aria-controls')===panel.id)?.focus({preventScroll:true});
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const owner = event.target.closest('[data-settings-section-owner]')?.dataset.settingsSectionOwner;
    if (!owner) return;
    for (const panel of overview.querySelectorAll('[data-settings-detail]:not([hidden])')) {
      if (panel.closest('[data-settings-section-owner]')?.dataset.settingsSectionOwner !== owner) setSettingsDetailOpen(panel,false);
    }
  },true);
  const cards = [...overview.querySelectorAll('[data-settings-tile]')];
  const panels = [...overview.querySelectorAll('[data-settings-panel]')];
  const open = async id => {
    const target = panels.find(panel => panel.dataset.settingsPanel === id);
    if (!target) return;
    const show = target.hidden;
    setSettingsDetailOpen(target,show);
    if (!show || mounted.has(id) || pending.has(id)) return;
    const folder = visible.find(item => item[0] === id);
    const host = target.querySelector('[data-settings-embedded]');
    if (!folder || !host) return;
    pending.add(id);
    host.innerHTML = emptyState('Загрузка', 'Загружаем настройки.');
    try {
      const module = await folder[3]();
      if (id === 'documents') await loadTenantDocumentArchive();
      if (!overview.isConnected || !host.isConnected) return;
      await module.render(host, () => {});
      mounted.add(id);
    } catch (error) {
      if (!host.isConnected) return;
      host.innerHTML = emptyState('Не удалось загрузить настройки', error?.message || 'Повторите попытку.')+
        button('Повторить', {data:'data-settings-retry'});
      host.querySelector('[data-settings-retry]')?.addEventListener('click', () => {
        target.hidden = true;
        void open(id);
      });
    } finally {
      pending.delete(id);
    }
  };
  for (const card of cards) card.addEventListener('click', () => void open(card.dataset.settingsTile));
  const notificationCard = overview.querySelector('.settings-notification-card');
  if (notificationCard) {
    // The card opens the list; its independent form controls must never toggle it.
    notificationCard.addEventListener('click', event => {
      if (event.target.closest('button, input, select, textarea, label, [data-notification-delivery-status]')) return;
      void open('notifications');
    });
    const host = notificationCard.querySelector('[data-notification-delivery-card]');
    const folder = visible.find(item => item[0] === 'notifications');
    const loadDelivery = async () => {
      host.innerHTML = emptyState('Загрузка', 'Загружаем настройки доставки.');
      try {
        const module = await folder[3]();
        if (host.isConnected) await module.renderDeliveryCard(host);
      } catch (error) {
        if (!host.isConnected) return;
        host.innerHTML = emptyState('Доставка недоступна',error?.message||'Повторите попытку.')+
          button('Повторить',{data:'data-delivery-retry'});
        host.querySelector('[data-delivery-retry]')?.addEventListener('click',()=>void loadDelivery());
      }
    };
    void loadDelivery();
  }
  for (const inline of overview.querySelectorAll('[data-settings-inline]')) {
    const id = inline.dataset.settingsInline;
    const folder = visible.find(item => item[0] === id);
    const host = inline.querySelector('[data-settings-embedded]');
    const load = async () => {
      host.innerHTML = emptyState('Загрузка', 'Загружаем настройки.');
      try {
        const module = await folder[3]();
        if (id === 'documents') await loadTenantDocumentArchive();
        if (host.isConnected) await module.render(host);
      } catch (error) {
        if (!host.isConnected) return;
        host.innerHTML = emptyState('Не удалось загрузить настройки',error?.message||'Повторите попытку.')+button('Повторить',{data:'data-settings-inline-retry'});
        host.querySelector('[data-settings-inline-retry]')?.addEventListener('click',()=>void load());
      }
    };
    void load();
  }
}
