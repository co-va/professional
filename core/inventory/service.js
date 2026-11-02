import { apiRequest } from '../auth.js';
import { applyInventorySnapshot } from './data.js';

async function inventoryRequest(path = '', options = {}) {
  const response = await apiRequest(`/inventory${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || 'Не удалось сохранить склад');
  return applyInventorySnapshot(payload);
}

export async function loadInventory() {
  return inventoryRequest();
}

export async function createInventoryItem(value = {}) {
  return inventoryRequest('/items', {
    method: 'POST',
    body: JSON.stringify(value),
  });
}

export async function updateInventoryItem(itemId, value = {}) {
  return inventoryRequest(`/items/${encodeURIComponent(String(itemId || ''))}`, {
    method: 'PUT',
    body: JSON.stringify(value),
  });
}

export async function createInventoryMovement(value = {}) {
  return inventoryRequest('/movements', {
    method: 'POST',
    body: JSON.stringify(value),
  });
}

export async function correctInventoryMovement(movementId, value = {}) {
  return inventoryRequest(`/movements/${encodeURIComponent(String(movementId || ''))}/correct`, {
    method: 'POST',
    body: JSON.stringify(value),
  });
}
