import { canUseCapability } from '../access.js';
import { inventoryDesktop } from './desktop.js';

const INVENTORY_NAVIGATION = [
  { id: 'stock', label: 'Остатки', capability: 'inventory.stock.access' },
  { id: 'movements', label: 'Движения', capability: 'inventory.movements.access' },
  { id: 'orders', label: 'Заказы', capability: 'inventory.order.access' },
  { id: 'counterparties', label: 'Контрагенты', capability: 'inventory.counterparties.access' },
  { id: 'consumption-groups', label: 'Группы расхода', capability: 'inventory.consumption_groups.access' },
];

export function inventoryNavigationItems(desktop = false) {
  const available=INVENTORY_NAVIGATION.filter(item=>canUseCapability(item.capability));
  const combined=desktop&&available.some(item=>item.id==='orders')&&available.some(item=>item.id==='counterparties');
  return available.filter(item=>!combined||item.id!=='counterparties').map(({id,label})=>({id,label:combined&&id==='orders'?'Контрагенты':label}));
}

export async function renderInventorySection(root, section = 'stock') {
  const allowed = inventoryNavigationItems(inventoryDesktop(root));
  const requested=section==='counterparties'&&inventoryDesktop(root)&&allowed.some(item=>item.id==='orders')&&!allowed.some(item=>item.id==='counterparties')?'orders':section;
  const target = allowed.some((item) => item.id === requested) ? requested : allowed[0]?.id;
  if (!target) { root.replaceChildren(); return; }
  if (target === 'consumption-groups') {
    const { renderConsumptionGroups } = await import('./consumption-groups.js');
    return renderConsumptionGroups(root);
  }
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
