import { emptyState, page } from '../../ui/ui.js';
import { loyaltyHeader } from './shared.js';
import { canUseCapability } from '../access.js';

const LOYALTY_NAVIGATION = [
  { id: 'deposit', label: 'Депозит', capability: 'loyalty.deposit.access' },
  // Created automatically on first access for each Person; not a manually issued program.
  { id: 'personal-account', label: 'Личный счёт', capability: 'loyalty.personal_account.access', assignableToPerson: false },
  { id: 'certificate', label: 'Сертификат', capability: 'loyalty.certificate.access' },
  { id: 'subscription', label: 'Абонемент', capability: 'loyalty.subscription.access' },
  { id: 'referral', label: 'Реферальная программа', capability: 'loyalty.referral.access' },
  { id: 'bonus', label: 'Бонусная программа', capability: 'loyalty.bonus.access' },
];

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
    const owner = await import(`./${id}/index.js`);
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
export async function renderLoyaltySection(root, section = 'deposit') {
  if (!loyaltyNavigationItems().some((item) => item.id === section)) {
    root.innerHTML = page([loyaltyHeader('Лояльность'), emptyState('Инструмент недоступен', 'У вас нет доступа к этому инструменту.')]);
    return;
  }
  const owner = await import(`./${section}/index.js`);
  if (typeof owner.render !== 'function') {
    throw new Error(`Loyalty E "${section}" has no render entrypoint`);
  }
  return owner.render(root);
}

export { renderLoyaltySection as render };
