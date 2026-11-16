import { canUseCapability } from '../access.js';

const INVENTORY_NAVIGATION = [
  { id: 'stock', label: 'Остатки', capability: 'inventory.stock.access' },
  { id: 'movements', label: 'Движения', capability: 'inventory.movements.access' },
  { id: 'orders', label: 'Заказы', capability: 'inventory.order.access' },
  { id: 'counterparties', label: 'Контрагенты', capability: 'inventory.counterparties.access' },
];

export function inventoryNavigationItems() {
  return INVENTORY_NAVIGATION.filter((item) => canUseCapability(item.capability)).map(({ id, label }) => ({ id, label }));
}

export async function renderInventorySection(root, section = 'stock') {
  const allowed = inventoryNavigationItems();
  const target = allowed.some((item) => item.id === section) ? section : allowed[0]?.id;
  if (!target) { root.replaceChildren(); return; }
  if (target === 'counterparties') {
    const { renderCounterparties } = await import('./counterparties.js');
    return renderCounterparties(root);
  }
  const { renderInventory } = await import('./inventory.js');
  const cleanup = await renderInventory(root, target);
  // The Excel extension owns only Stock and Movements. The saved purchase
  // order Z1/Q/Z2 belongs exclusively to ./orders.js via renderInventory().
  // Applying the old Order Excel extension erased the Z1 and its + button.
  if (target !== 'orders') {
    const { enhanceInventoryExcel } = await import('./excel-v2.js');
    enhanceInventoryExcel(root, target);
  }
  return cleanup;
}
