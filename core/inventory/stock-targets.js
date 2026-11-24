import {
  actionBlock, button, field, initSegmentControls, modal, mountModal, segmentControl,
} from '../../ui/ui.js';
import { getInventoryItem, getInventoryStorageLocations } from './data.js';
import { updateInventoryStockTargets } from './service.js';

export const INVENTORY_TOTAL_SCOPE = 'total';
export const storageName = place => place?.isPrimary ? 'Не распределено' : place?.name || '';
export const inventoryLocations = () => getInventoryStorageLocations().filter(place => !place.archivedAt);
export const itemLocationBalance = (item, locationId) =>
  Number((item?.locationBalances || []).find(row => row.locationId === locationId)?.balance || 0);

/**
 * "Общий" is an aggregate, not a physical place. A named warehouse shows
 * actual positive balances at that site, plus its assigned zero-stock items.
 * The original item.location label supplies those zero-stock assignments for
 * legacy A/B items after recovery; it must not fabricate stock quantities.
 */
export function inventoryItemBelongsToStorage(item, scope = INVENTORY_TOTAL_SCOPE) {
  if (scope === INVENTORY_TOTAL_SCOPE) return true;
  if (itemLocationBalance(item,scope) > 0.000001) return true;
  // Catalog availability is not a movement: a zero-balance card can belong
  // to several warehouses without fabricating grams or physical containers.
  if (Array.isArray(item?.assignedStorageLocations)
    && item.assignedStorageLocations.includes(scope)) return true;
  if (scope === 'primary') return false; // technical undistributed stock
  const place=inventoryLocations().find(row=>row.locationId===scope && !row.isPrimary);
  if(!place || String(item.location||'').trim().toLocaleLowerCase('ru-RU')
       !== String(place.name||'').trim().toLocaleLowerCase('ru-RU')) return false;
  // A stale legacy label cannot override a real allocation elsewhere.
  return !(item.locationBalances||[]).some(row=>
    row.locationId!==scope && Number(row.balance)>0.000001);
}

export function inventoryDisplayBalance(item, scope = INVENTORY_TOTAL_SCOPE) {
  return scope === INVENTORY_TOTAL_SCOPE ? Number(item?.balance || 0)
    : itemLocationBalance(item, scope);
}
export function inventoryDisplayTarget(item, scope = INVENTORY_TOTAL_SCOPE) {
  if (scope === INVENTORY_TOTAL_SCOPE) return item?.targetStock ?? null;
  return (item?.locationTargets || []).find(row => row.locationId === scope)?.targetStock ?? null;
}

export function openInventoryStockTargets(itemId, onSaved = () => {}) {
  const item = getInventoryItem(itemId);
  if (!item) return;
  const places = inventoryLocations();
  const stored = new Map((item.locationTargets || [])
    .map(row => [row.locationId, row.targetStock]));
  const unit = item.thresholdUnit || item.receiptUnit || item.unit || 'шт.';
  const markup = '<form class="form-grid" data-inventory-targets-form>' +
    segmentControl([
      {value: 'overall',label: 'От общего'},
      {value: 'locations',label: 'По складам'},
    ], {name: 'mode', value: item.targetStockMode === 'locations' ? 'locations' : 'overall',
      aria: 'Расчёт желаемого остатка'}) +
    field({label: 'Общий желаемый остаток · ' + unit, name: 'targetStock',
      value: item.targetStock ?? '', type: 'number', min: '0', step: '0.001',
      inputmode: 'decimal'}) +
    '<div data-inventory-target-location-fields>' + places.map((place, index) =>
      field({label: storageName(place) + ' · ' + unit, name: 'locationTarget' + index,
        value: stored.get(place.locationId) ?? '', type: 'number',
        min: '0', step: '0.001', inputmode: 'decimal'})
    ).join('') + '</div>' +
    '<p class="ui-list__secondary" data-inventory-target-result></p>' +
    '<p class="form-error" role="alert" data-inventory-target-error></p>' +
    actionBlock(button('Применить', {type:'submit'})) + '</form>';
  const layer = mountModal(document.body, modal(markup, {
    title: 'Желаемый остаток', variant: 'q', surface: 'app',
  }));
  if (!layer) return;
  const form = layer.querySelector('[data-inventory-targets-form]');
  initSegmentControls(form);
  const status = form.querySelector('[data-inventory-target-result]');
  const total = form.elements.namedItem('targetStock');
  const modeInput = form.elements.namedItem('mode');
  const read = name => {
    const value = String(form.elements.namedItem(name)?.value ?? '').trim().replace(',', '.');
    return value === '' ? null : Number(value);
  };
  const calc = () => {
    const allocations = places.map((place, i) => ({
      locationId: place.locationId, targetStock: read('locationTarget' + i),
    }));
    const configured = allocations.filter(entry => entry.targetStock !== null);
    const sum = configured.reduce((value, entry) => value + entry.targetStock, 0);
    const rounded = Math.round((sum + Number.EPSILON) * 1000) / 1000;
    const mode = modeInput.value;
    const global = read('targetStock');
    total.readOnly = mode === 'locations';
    if (mode === 'locations') {
      total.value = configured.length ? String(rounded) : '';
      status.textContent = configured.length
        ? 'Общая цель: ' + rounded.toLocaleString('ru-RU') + ' ' + unit
        : 'Задайте желаемое количество хотя бы на одном складе.';
    } else {
      status.textContent = configured.length && global != null && rounded > global
        ? 'Общий желаемый остаток будет увеличен до ' +
          rounded.toLocaleString('ru-RU') + ' ' + unit
        : configured.length
          ? 'Распределено по складам: ' + rounded.toLocaleString('ru-RU') + ' ' + unit
          : 'Распределение по складам необязательно.';
    }
    return {mode, global, allocations};
  };
  let lastManual = item.targetStock == null ? '' : String(item.targetStock);
  form.addEventListener('input', event => {
    if (event.target === total && modeInput.value === 'overall') lastManual = total.value;
    calc();
  });
  modeInput.addEventListener('change', () => {
    if (modeInput.value === 'overall') total.value = lastManual;
    calc();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = calc();
    const error = form.querySelector('[data-inventory-target-error]');
    const numbers = [data.global, ...data.allocations.map(x => x.targetStock)]
      .filter(x => x != null);
    if (numbers.some(x => !Number.isFinite(x) || x < 0 || x > 999999999)) {
      error.textContent = 'Проверьте количество: только неотрицательные числа.';return;
    }
    const save = form.querySelector('[type="submit"]');
    save.disabled = true;
    try {
      await updateInventoryStockTargets(itemId,{
        mode: data.mode,
        targetStock: data.mode === 'overall' ? data.global : null,
        locations: data.allocations,
      });
      layer.v2Close?.();
      onSaved();
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : 'Не удалось сохранить остаток.';
      save.disabled = false;
    }
  });
  calc();
  return layer;
}
