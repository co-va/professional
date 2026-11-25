import { canUseCapability } from '../core/access.js';
import { button, columnLayout, emptyState, folderList, pageHeader, workspaceHeaderContext } from '../ui/ui.js';
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

export function settingsOverviewMarkup(visible) {
  const available = new Map(visible.map(folder => [folder[0], folder[1]]));
  const top = ['online-booking','integrations','data-transfer'].filter(id => available.has(id));
  const middle = ['notifications','tags'].filter(id => available.has(id));
  const card = id => '<button type="button" class="settings-overview-card" data-settings-tile="'+id+'" aria-expanded="false" aria-controls="settings-panel-'+id+'"><span>'+available.get(id)+'</span><span aria-hidden="true" class="settings-overview-arrow">⌄</span></button>';
  const panel = id => '<section id="settings-panel-'+id+'" class="settings-overview-panel" data-settings-panel="'+id+'" hidden><div data-settings-embedded></div></section>';
  return workspaceHeaderContext({title:'Настройки'})+'<div class="settings-overview">'+
    (top.length ? '<div class="settings-overview-section">'+columnLayout(top.map(card),{columns:top.length,ariaLabel:'Онлайн-запись, интеграции и перенос данных'})+top.map(panel).join('')+'</div>' : '')+
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
  const cards = [...overview.querySelectorAll('[data-settings-tile]')];
  const panels = [...overview.querySelectorAll('[data-settings-panel]')];
  const open = async id => {
    const target = panels.find(panel => panel.dataset.settingsPanel === id);
    if (!target) return;
    const show = target.hidden;
    for (const card of cards) card.setAttribute('aria-expanded', String(show && card.dataset.settingsTile === id));
    for (const panel of panels) panel.hidden = !show || panel !== target;
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
}
