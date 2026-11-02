let snapshot = {
  items: [],
  lots: [],
  movements: [],
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function applyInventorySnapshot(value = {}) {
  snapshot = {
    items: asArray(value?.items),
    lots: asArray(value?.lots),
    movements: asArray(value?.movements),
  };
  window.dispatchEvent(new CustomEvent('book:inventory-changed'));
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

export function inventoryOrderSuggestions() {
  return snapshot.items
    .map((item) => {
      const balance = Number(item?.balance) || 0;
      const minimum = item?.minStock == null ? null : Number(item.minStock);
      const target = item?.targetStock == null ? null : Number(item.targetStock);
      if (minimum == null || balance > minimum) return null;
      const desired = target != null && target > balance ? target - balance : Math.max(0, minimum - balance);
      return { ...item, suggestedQuantity: desired };
    })
    .filter(Boolean);
}
