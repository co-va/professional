import { emptyState, page, setV2ZHeaderRows } from '../../ui/ui.js';
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
    loyaltyHeader('Лояльность'),
    ...visible.map(item => '<div data-loyalty-program-section="' + item.id + '"></div>'),
  ]);
  setV2ZHeaderRows(root, [], { desktopTitle: 'Лояльность' });
  const sections = visible.map(async item => {
    const host = root.querySelector('[data-loyalty-program-section="' + item.id + '"]');
    if (!host) return;
    host.dataset.loyaltyOverviewTitle = LOYALTY_NAVIGATION.find(entry => entry.id === item.id)?.overviewLabel || item.label;
    try {
      const owner = await loadLoyaltyModule(item.id);
      if (host.isConnected) await owner.render(host);
    } catch (error) {
      if (host.isConnected) host.innerHTML = emptyState(host.dataset.loyaltyOverviewTitle, String(error?.message || 'Не удалось загрузить программы'));
    }
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
