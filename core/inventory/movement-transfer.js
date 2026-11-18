// E «Движения» owns the stock-transfer editor. Stock invokes the same
// mechanism, never another inventory mutation implementation.
import { actionBlock, button, field, modal, mountModal, select, twoColumnLayout } from '../../ui/ui.js';
import { getInventoryItem, getInventoryItems, getInventoryStorageLocations } from './data.js';
import { transferInventoryStock } from './service.js';
const locations = () => getInventoryStorageLocations().filter(item => item && !item.archivedAt);
const options = () => locations().map(location => ({
  value: location.locationId, label: location.isPrimary ? 'Не распределено' : location.name,
}));

function transferUnits(item) {
  if (!item) return [];
  const stock = String(item.unit || '').trim();
  const receipt = String(item.receiptUnit || '').trim();
  const explicit = Array.isArray(item.conversionRules)
    && item.conversionRules.some(row => row.unit === receipt && Number(row.stockPerUnit) > 0);
  const net = item.grossWeight != null && item.tareWeight != null
    ? Number(item.grossWeight) - Number(item.tareWeight)
    : Number(item.netPackageWeight || 0);
  const knownPack = Number(item.packageQuantity) > 0 || net > 0 || explicit;
  return [...new Set([...(receipt && (receipt === stock || knownPack) ? [receipt] : []), stock])].filter(Boolean);
}

export function openInventoryTransfer(onSaved = () => {}) {
  const stock = getInventoryItems();
  const places = options();
  const fromDefault = places.find(place => place.value === 'primary')?.value || places[0]?.value || '';
  const toDefault = places.find(place => place.value !== fromDefault)?.value || '';
  // Do not preselect an arbitrary product for a stock-changing operation.
  const host = mountModal(document.body, modal(
    '<form data-inventory-transfer-form>' +
    select({ label: 'Из места', name: 'fromLocationId', value: fromDefault, options: places }) +
    select({ label: 'В место', name: 'toLocationId', value: toDefault, options: places }) +
    select({ label: 'Товар', name: 'itemId', value: '',
      options: [{ value: '', label: 'Выбрать товар' },
        ...stock.map(item => ({
          value: item.itemId, label: [item.manufacturer, item.name].filter(Boolean).join(' · '),
        }))], searchable: true }) +
    twoColumnLayout(
      field({ label: 'Количество', name: 'quantity', value: '', type: 'number',
        min: '0.001', step: 'any', required: true }),
      '<div data-inventory-transfer-unit-picker></div>',
      { ariaLabel: 'Количество и единица переноса' },
    ) +
    '<p class="ui-list__secondary" data-inventory-transfer-unit></p>' +
    '<p class="form-error" role="alert" data-inventory-transfer-error></p>' +
    actionBlock(button('Переместить', { type: 'submit' })) +
    '</form>',
    { title: 'Перемещение', variant: 'q', surface: 'app' },
  ));
  if (!host) return;
  const form = host.querySelector('[data-inventory-transfer-form]');
  const unit = host.querySelector('[data-inventory-transfer-unit]');
  const unitHost = host.querySelector('[data-inventory-transfer-unit-picker]');
  const updateUnit = () => {
    const item = getInventoryItem(form.querySelector('[name="itemId"]')?.value);
    const from = form.querySelector('[name="fromLocationId"]')?.value;
    const balance = item?.locationBalances?.find(loc => loc.locationId === from)?.balance ?? 0;
    const units = transferUnits(item);
    const previous = unitHost.querySelector('[name="quantityUnit"]')?.value;
    unitHost.innerHTML = select({
      label: 'Единица', name: 'quantityUnit',
      value: units.includes(previous) ? previous : units[0] || '',
      options: units.length
        ? units.map(value => ({ value, label: value }))
        : [{ value: '', label: '—' }],
    });
    unit.textContent = item ? 'В выбранном складе: '
      + Number(balance).toLocaleString('ru-RU', { maximumFractionDigits: 3 }) + ' ' + item.unit : '';
  };
  form.addEventListener('change', event => {
    if (event.target.name === 'itemId' || event.target.name === 'fromLocationId') updateUnit();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    const from = String(data.get('fromLocationId') || '');
    const to = String(data.get('toLocationId') || '');
    const itemId = String(data.get('itemId') || '');
    const quantity = Number(data.get('quantity'));
    const quantityUnit = String(data.get('quantityUnit') || '');
    const error = host.querySelector('[data-inventory-transfer-error]');
    if (!from || !to || from === to) { error.textContent = 'Выберите два разных места.'; return; }
    if (!getInventoryItem(itemId) || !(quantity > 0) || !Number.isFinite(quantity)) {
      error.textContent = 'Выберите товар и положительное количество.'; return;
    }
    if (!transferUnits(getInventoryItem(itemId)).includes(quantityUnit)) {
      error.textContent = 'Выберите единицу количества для товара.';
      return;
    }
    if (['шт.', 'уп.'].includes(quantityUnit) && !Number.isSafeInteger(quantity)) {
      error.textContent = 'Укажите целое число штук или упаковок.';
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await transferInventoryStock({ fromLocationId: from, toLocationId: to,
        lines: [{ itemId, quantity, unit: quantityUnit }] });
      host.v2Close?.();
      onSaved();
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : 'Не удалось переместить товар.';
      submit.disabled = false;
    }
  });
  updateUnit();
}
