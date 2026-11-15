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

export function inventoryOrderSuggestions(mode = 'target') {
  // A threshold is a configured business requirement, not every product with
  // a zero balance. The target list may include goods above their minimum.
  const field = mode === 'minimum' ? 'minStock' : 'targetStock';
  return snapshot.items
    .map(item => {
      const balance = Number(item?.balance ?? 0);
      const raw = item?.[field];
      const threshold = raw == null || raw === '' ? null : Number(raw);
      if (!Number.isFinite(balance) || threshold == null || !Number.isFinite(threshold)
        || threshold <= 0 || balance >= threshold) return null;
      const suggestedQuantity = Math.max(0, threshold - balance);
      if (suggestedQuantity <= 0) return null;
      return { ...item, suggestedQuantity };
    })
    .filter(Boolean);
}
