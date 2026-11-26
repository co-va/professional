import { button, emptyState, escapeHtml, modal, mountModal, openEntityCardAppearanceQ, page, setV2ZHeaderRows } from '../../ui/ui.js';
import { DATA_EXCHANGE_ICON } from '../../ui/buttons/index.js';
import { isV2DesktopWorkspace } from '../../ui/v2/geometry.js';
import { loyaltyHeader } from './shared.js';
import { canUseCapability } from '../access.js';

const LOYALTY_NAVIGATION = [
  { id: 'deposit', overviewLabel: 'Депозиты', load: () => import('./deposit/index.js'), label: 'Депозит', capability: 'loyalty.deposit.access' },
  // Created automatically on first access for each Person; not a manually issued program.
  { id: 'personal-account', load: () => import('./personal-account/index.js'), label: 'Личный счёт', capability: 'loyalty.personal_account.access', assignableToPerson: false },
  { id: 'certificate', overviewLabel: 'Сертификаты', load: () => import('./certificate/index.js'), label: 'Сертификат', capability: 'loyalty.certificate.access' },
  { id: 'subscription', overviewLabel: 'Абонементы', load: () => import('./subscription/index.js'), label: 'Абонемент', capability: 'loyalty.subscription.access' },
  { id: 'referral', overviewLabel: 'Реферальные программы', load: () => import('./referral/index.js'), label: 'Реферальная программа', capability: 'loyalty.referral.access' },
  { id: 'bonus', overviewLabel: 'Бонусные программы', load: () => import('./bonus/index.js'), label: 'Бонусная программа', capability: 'loyalty.bonus.access' },
];

export function loadLoyaltyModule(id) {
  const item = LOYALTY_NAVIGATION.find(entry => entry.id === id);
  if (!item) throw new Error(`Unknown Loyalty E "${id}"`);
  return item.load();
}

export function loyaltyNavigationItems() {
  return LOYALTY_NAVIGATION
    .filter((item) => canUseCapability(item.capability))
    .map(({ id, label, assignableToPerson }) => ({ id, label, assignableToPerson: assignableToPerson !== false }));
}

/**
 * Single E-type registry. Each registered E module supplies its own Person
 * cards, detail body and opening action. Contacts never enumerate E types.
 */
export async function collectPersonLoyaltyCards(person = {}, { refresh = true } = {}) {
  const groups = await Promise.all(loyaltyNavigationItems().map(async ({ id }) => {
    const owner = await loadLoyaltyModule(id);
    if (typeof owner.getPersonLoyaltyCards !== 'function') {
      throw new Error(`Loyalty E "${id}" has no Person card contract`);
    }
    const result = await owner.getPersonLoyaltyCards(person, { refresh });
    if (!result || !Array.isArray(result.cards)) {
      throw new Error(`Loyalty E "${id}" returned an invalid Person card contract`);
    }
    return result;
  }));
  const tasks = refresh ? groups.map(group => group.refreshPromise).filter(Boolean) : [];
  return {
    cards: groups.flatMap(group => group.cards),
    refreshPromise: tasks.length ? Promise.allSettled(tasks) : null,
  };
}
export function loyaltyWorkspaceNavigationItems(desktop = false) {
  const items = loyaltyNavigationItems();
  if (!desktop) return items;
  return [
    ...(items.some(item => item.assignableToPerson) ? [{ id: 'programs', label: 'Программы', icon: 'loyalty' }] : []),
    ...items.filter(item => !item.assignableToPerson),
  ];
}

async function renderDesktopPrograms(root) {
  const visible = loyaltyNavigationItems().filter(item => item.assignableToPerson);
  root.innerHTML = page([
    loyaltyHeader('Программы'),
    ...visible.map(item => '<div data-loyalty-program-section="' + item.id + '">' + emptyState(LOYALTY_NAVIGATION.find(entry => entry.id === item.id)?.overviewLabel || item.label, 'Загрузка…') + '</div>'),
  ]);
  const owners = new Map();
  const toolbar = '<div class="v2-desktop-tool-row"><div class="v2-desktop-tool-actions">' +
    button(DATA_EXCHANGE_ICON, { variant: 'secondary', className: 'v2-desktop-tool-icon', data: 'data-program-excel title="Обмен данными"', aria: 'Обмен данными', disabled: true }) +
    button('Вид', { variant: 'secondary', data: 'data-program-view', disabled: true }) +
    button('+', { variant: 'secondary', className: 'v2-desktop-tool-primary', data: 'data-program-add aria-haspopup="dialog"', aria: 'Добавить программу', disabled: true }) +
    '</div></div>';
  const [tools] = setV2ZHeaderRows(root, [toolbar], { desktopTitle: 'Программы' });
  const add = tools?.querySelector('[data-program-add]');
  const view = tools?.querySelector('[data-program-view]');
  const excel = tools?.querySelector('[data-program-excel]');
  const availableOwners = () => visible.map(item => owners.get(item.id)).filter(item => item?.host.isConnected);
  const syncTools = () => {
    if (!tools?.isConnected) return;
    const available = availableOwners();
    if (add) add.disabled = !available.some(item => typeof item.owner.openCreateProgramQ === 'function');
    if (view) view.disabled = !available.some(item => typeof item.owner.programAppearanceOptions === 'function');
    if (excel) {
      const supported = visible.some(item => item.id === 'deposit') || available.some(item => typeof item.owner.openProgramExcel === 'function');
      excel.hidden = !supported;
      excel.disabled = !available.some(item => typeof item.owner.openProgramExcel === 'function');
    }
  };
  const choose = (anchor, entries, action) => {
    if (!entries.length) return;
    const markup = '<div class="desktop-q-action-menu">' + entries.map(item => button(escapeHtml(item.label), {
      variant: 'secondary', data: 'data-program-choice="' + escapeHtml(item.id) + '"',
    })).join('') + '</div>';
    const layer = mountModal(anchor, modal(markup, { variant: 'x', xRole: 'picker', className: 'desktop-q-action-popup' }));
    layer?.querySelectorAll('[data-program-choice]').forEach(control => control.addEventListener('click', () => {
      const item = entries.find(entry => entry.id === control.dataset.programChoice);
      layer.v2Close?.();
      if (item?.host.isConnected) void action(item);
    }));
  };
  add?.addEventListener('click', () => choose(add, availableOwners().filter(item => typeof item.owner.openCreateProgramQ === 'function'), item => item.owner.openCreateProgramQ(item.host, item.render)));
  view?.addEventListener('click', () => {
    const entries = availableOwners().filter(item => typeof item.owner.programAppearanceOptions === 'function');
    if (!entries.length) return;
    const configs = new Map(entries.map(item => [item.id, item.owner.programAppearanceOptions(item.render)]));
    const config = id => configs.get(id);
    openEntityCardAppearanceQ(root, {
      title: 'Вид', typeLabel: 'Тип карты', showTypeSelector: true,
      typeOptions: entries.map(item => ({ value: item.id, label: item.label })),
      initialType: entries[0].id,
      resolve: id => config(id).resolve(),
      save: ({ type, ...values }) => config(type).save(values),
      onSaved: ({ type }) => config(type).onSaved?.(),
    });
  });
  excel?.addEventListener('click', () => {
    const entries = availableOwners().filter(item => typeof item.owner.openProgramExcel === 'function');
    if (entries.length === 1) return entries[0].owner.openProgramExcel(entries[0].host, entries[0].render, { anchor: excel });
    choose(excel, entries, item => item.owner.openProgramExcel(item.host, item.render, { anchor: excel }));
  });
  syncTools();
  const sections = visible.map(async item => {
    const host = root.querySelector('[data-loyalty-program-section="' + item.id + '"]');
    if (!host) return;
    host.dataset.loyaltyOverviewTitle = LOYALTY_NAVIGATION.find(entry => entry.id === item.id)?.overviewLabel || item.label;
    const render = async () => {
      try {
        const owner = await loadLoyaltyModule(item.id);
        if (!host.isConnected) return;
        await owner.render(host);
        if (host.isConnected) {
          owners.set(item.id, { ...item, owner, host, render });
          syncTools();
        }
      } catch (error) {
        if (!host.isConnected) return;
        host.innerHTML = emptyState(host.dataset.loyaltyOverviewTitle, String(error?.message || 'Не удалось загрузить программы')) + '<button type="button" class="ui-button ui-button--secondary" data-loyalty-program-retry>Повторить</button>';
        host.querySelector('[data-loyalty-program-retry]')?.addEventListener('click', () => {
          host.innerHTML = emptyState(host.dataset.loyaltyOverviewTitle, 'Загрузка…');
          void render();
        });
      }
    };
    await render();
  });
  await Promise.all(sections);
}

export async function renderLoyaltySection(root, section = 'deposit') {
  if (isV2DesktopWorkspace(root.closest('[data-v2-app]')) && section === 'programs') return renderDesktopPrograms(root);
  if (!loyaltyNavigationItems().some((item) => item.id === section)) {
    root.innerHTML = page([loyaltyHeader('Лояльность'), emptyState('Инструмент недоступен', 'У вас нет доступа к этому инструменту.')]);
    return;
  }
  const owner = await loadLoyaltyModule(section);
  if (typeof owner.render !== 'function') {
    throw new Error(`Loyalty E "${section}" has no render entrypoint`);
  }
  return owner.render(root);
}

export { renderLoyaltySection as render };
