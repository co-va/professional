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

export function inventoryOrderSuggestions() {
  // The price catalog is not a purchase list. Only an explicitly configured
  // stock threshold with a positive replenishment gap creates a suggestion.
  return snapshot.items
    .map((item) => {
      const balance = Number(item?.balance ?? 0);
      const rawMinimum = item?.minStock;
      const minimum = rawMinimum == null || rawMinimum === '' ? null : Number(rawMinimum);
      const rawTarget = item?.targetStock;
      const target = rawTarget == null || rawTarget === '' ? null : Number(rawTarget);
      if (!Number.isFinite(balance) || minimum == null || !Number.isFinite(minimum)
        || minimum < 0 || balance > minimum) return null;
      const replenishmentLevel = target != null && Number.isFinite(target) && target > minimum
        ? target : minimum;
      const desired = Math.max(0, replenishmentLevel - balance);
      // A zero-threshold product at zero stock is NOT a purchase unless
      // a positive target was explicitly configured.
      if (desired <= 0) return null;
      return { ...item, suggestedQuantity: desired };
    })
    .filter(Boolean);
}
