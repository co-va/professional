let snapshot = {
  items: [],
  lots: [],
  movements: [],
  orders: [],
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function applyInventorySnapshot(value = {}) {
  snapshot = {
    items: asArray(value?.items),
    lots: asArray(value?.lots),
    movements: asArray(value?.movements),
    orders: asArray(value?.orders),
  };
  window.dispatchEvent(new CustomEvent('professional:inventory-changed'));
  return snapshot;
}

export function getInventorySnapshot() {
  return snapshot;
}

export function getInventoryItems() {
  return snapshot.items;
}

export function getInventoryItem(itemId) {
  return snapshot.items.find((item) => String(item?.itemId || '') === String(itemId || '')) || null;
}

export function getInventoryMovements() {
  return snapshot.movements;
}

export function getInventoryMovement(movementId) {
  return snapshot.movements.find((item) => String(item?.movementId || '') === String(movementId || '')) || null;
}

export function getInventoryOrders() {
  return snapshot.orders;
}

export function getInventoryOrder(orderId) {
  return snapshot.orders.find(order => String(order?.orderId || '') === String(orderId || '')) || null;
}

// Minimum is the urgent threshold (inclusive). Target is the stock level we
// replenish TO. Both values remain in canonical InventoryItem units: grams for
// weighed colour; tube fractions are converted at the Professional input edge.
export function inventoryOrderSuggestions(mode = 'target') {
  return snapshot.items
    .map(item => {
      const balance = Number(item?.balance);
      const rawMinimum = item?.minStock;
      const rawTarget = item?.targetStock;
      const minimum = rawMinimum == null || rawMinimum === '' ? null : Number(rawMinimum);
      const target = rawTarget == null || rawTarget === '' ? null : Number(rawTarget);
      if (!Number.isFinite(balance) || balance < 0) return null;
      const hasMinimum = minimum != null && Number.isFinite(minimum) && minimum >= 0;
      const hasTarget = target != null && Number.isFinite(target) && target > 0;
      // A blank/zero configuration must never fill the Order UI with every item.
      if (!(hasTarget || (hasMinimum && minimum > 0))) return null;
      const urgent = hasMinimum && balance <= minimum + 1e-9;
      const recommended = hasTarget && balance < target - 1e-9;
      if (mode === 'minimum' ? !urgent : !(urgent || recommended)) return null;
      // When urgent, always replenish to the target, not merely to the minimum.
      // Without a configured target, lift the minimum by one physical package.
      const pack = Number(item.packageQuantity);
      const packageUnits = Number.isFinite(pack) && pack > 0 ? pack : 1;
      const desired = hasTarget && target > minimum
        ? target
        : urgent ? (hasMinimum ? minimum : 0) + packageUnits : target;
      const suggestedQuantity = Math.max(0, desired - balance);
      if (suggestedQuantity <= 1e-9) return null;
      return { ...item, urgency: urgent ? 'urgent' : 'normal', suggestedQuantity };
    })
    .filter(Boolean);
}
