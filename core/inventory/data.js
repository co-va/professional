import { inventoryStockBalanceInThresholdUnits, isWeighedInventoryItem } from './completeness.js';

let criteriaCatalog = null;
if (typeof window !== 'undefined') window.addEventListener('professional:auth-logout', () => {
  criteriaCatalog = null;
});

export const getInventoryCriteria = () => criteriaCatalog;
export function setInventoryCriteriaCatalog(rows = []) {
  criteriaCatalog = Array.isArray(rows) ? rows : [];
  return criteriaCatalog;
}

let snapshot = {
  items: [],
  lots: [],
  movements: [],
  orders: [],
  supplierClaims: [],
  supplierClaimSettlements: [],
  classificationGroups: [],
  storageLocations: [],
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
    supplierClaims: asArray(value?.supplierClaims),
    supplierClaimSettlements: asArray(value?.supplierClaimSettlements),
    classificationGroups: asArray(value?.classificationGroups),
    storageLocations: asArray(value?.storageLocations),
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

export function getInventoryClassificationGroups() {
  return snapshot.classificationGroups;
}

export function getInventoryStorageLocations() {
  return snapshot.storageLocations;
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

export function getInventorySupplierClaims(orderId = '') {
  return snapshot.supplierClaims.filter(claim => !orderId || claim.orderId === orderId);
}

export function getInventoryOrder(orderId) {
  return snapshot.orders.find(order => String(order?.orderId || '') === String(orderId || '')) || null;
}

// Thresholds in InventoryItem are already tube quantities for weighed items.
// Compare them with the actual balance converted from grams to tube equivalents.
// Purchase amounts still use the original stock unit so order packaging works.
export function inventoryOrderSuggestions(mode = 'target') {
  return snapshot.items
    .map(item => {
      const balance = inventoryStockBalanceInThresholdUnits(item);
      const rawMinimum = item?.minStock;
      const rawTarget = item?.targetStock;
      const minimum = rawMinimum == null || rawMinimum === '' ? null : Number(rawMinimum);
      const target = rawTarget == null || rawTarget === '' ? null : Number(rawTarget);
      if (balance == null || !Number.isFinite(balance) || balance < 0) return null;
      const hasMinimum = minimum != null && Number.isFinite(minimum) && minimum >= 0;
      const hasTarget = target != null && Number.isFinite(target) && target > 0;
      // Missing BOTH thresholds means this paint has never been configured.
      // If it is entirely absent, recommend one tube instead of hiding it.
      // Explicitly entered 0 / 0 means no replenishment and stays excluded.
      const missingThresholds = (rawMinimum == null || rawMinimum === '')
        && (rawTarget == null || rawTarget === '');
      const absentColour = balance === 0 && isWeighedInventoryItem(item)
        && missingThresholds;
      // Respect the deliberate 0/0 setting: it means this item has no
      // configured replenishment quantity. A lone minimum 0 still triggers at
      // zero stock, because the threshold is inclusive.
      if (hasMinimum && minimum === 0 && rawTarget != null && target === 0) return null;
      if (!(hasTarget || hasMinimum || absentColour)) return null;
      const urgent = (hasMinimum && balance <= minimum + 1e-9) || absentColour;
      const recommended = (hasTarget && balance < target - 1e-9) || absentColour;
      if (mode === 'minimum' ? !urgent : !(urgent || recommended)) return null;
      // Planning is in full-tube equivalents. The order editor already rounds
      // the final purchase to whole packs via ceil(quantity / packageSize).
      const desired = hasTarget && target > (minimum ?? -1)
        ? target
        : absentColour ? 1
        : urgent ? (hasMinimum ? minimum : 0) + 1 : target;
      const needed = Math.max(0, desired - balance);
      if (needed <= 1e-9) return null;
      // Desired stock quantity comes from Core's exact threshold->stock
      // factor. Unknown conversions must never be treated as 1 stock unit.
      const suppliedFactor = item.thresholdStockFactor;
      if (Object.prototype.hasOwnProperty.call(item, 'thresholdStockFactor')
        && (suppliedFactor == null || !(Number(suppliedFactor) > 0))) return null;
      const weighed = isWeighedInventoryItem(item);
      const legacySize = Number(item.packageQuantity);
      const legacyFactor = weighed && Number.isFinite(legacySize) && legacySize > 0 ? legacySize : 1;
      const factor = Object.prototype.hasOwnProperty.call(item, 'thresholdStockFactor')
        ? Number(suppliedFactor) : legacyFactor;
      const suggestedQuantity = Number((needed * factor).toFixed(6));
      return { ...item, urgency: urgent ? 'urgent' : 'normal', suggestedQuantity };
    })
    .filter(Boolean);
}
