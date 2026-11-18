// E «Движения» owns the stock-transfer editor. Stock invokes the same
// mechanism, never another inventory mutation implementation.
import { actionBlock, button, field, modal, mountModal, select, twoColumnLayout, v2ListEntries, v2ListEntry } from '../../ui/ui.js';
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

export function openInventoryTransfer(onSaved = () => {}, { selectedItemIds = [], fromLocationId = '' } = {}) {
  const stock = getInventoryItems();
  // Both one-item and selected-item moves submit through the same canonical
  // Core /inventory/transfers operation. A selected move uses the server-side
  // exact remaining balance, including physical containers, at submit time.
  const selected = [...new Set(selectedItemIds)].map(id => getInventoryItem(id)).filter(Boolean);
  const batch = selected.length > 0;
  const places = options();
  // One stable operation identifier per form; retries cannot duplicate stock.
  const transferId = globalThis.crypto?.randomUUID?.() || '';
  let pending = false;
  let submittedPayload = null;
  const fromDefault = places.some(place => place.value === fromLocationId)
    ? fromLocationId : batch ? '' : places.find(place => place.value === 'primary')?.value || places[0]?.value || '';
  const toDefault = batch ? '' : places.find(place => place.value !== fromDefault)?.value || '';
  // Do not preselect an arbitrary product for a stock-changing operation.
  const host = mountModal(document.body, modal(
    '<form data-inventory-transfer-form>' +
    select({ label: 'Из места', name: 'fromLocationId', value: fromDefault,
      options: [{ value: '', label: 'Выберите исходный склад' }, ...places] }) +
    select({ label: 'В место', name: 'toLocationId', value: toDefault,
      options: [{ value: '', label: 'Выберите склад назначения' }, ...places] }) +
    (batch
      ? '<p>Выбранные товары: ' + selected.length +
        '. Перемещается весь фактический остаток каждого товара из исходного склада.</p>' +
        '<div data-inventory-transfer-batch-preview></div>'
      : select({ label: 'Товар', name: 'itemId', value: '',
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
        '<p class="ui-list__secondary" data-inventory-transfer-unit></p>') +
    '<p class="form-error" role="alert" data-inventory-transfer-error></p>' +
    actionBlock(button('Переместить', { type: 'submit' })) +
    '</form>',
    { title: 'Перемещение', variant: 'q', surface: 'app' },
  ));
  if (!host) return;
  const form = host.querySelector('[data-inventory-transfer-form]');
  const unit = host.querySelector('[data-inventory-transfer-unit]');
  const unitHost = host.querySelector('[data-inventory-transfer-unit-picker]');
  const batchPreview = host.querySelector('[data-inventory-transfer-batch-preview]');
  const available = () => {
    const from = form.querySelector('[name="fromLocationId"]')?.value || '';
    return selected.map(item => ({
      item, balance: Number((getInventoryItem(item.itemId)?.locationBalances || [])
        .find(row => row.locationId === from)?.balance || 0),
    }));
  };
  const previewBatch = () => {
    if (!batch || !batchPreview) return;
    const rows = available();
    const movable = rows.filter(row => row.balance > 0.000001);
    const skipped = rows.length - movable.length;
    batchPreview.innerHTML =
      '<p>Можно переместить: <strong>' + movable.length +
        '</strong>' + (skipped ? ' · Без остатка: ' + skipped : '') + '</p>' +
      v2ListEntries(rows.map(({ item, balance }) => v2ListEntry({
        title: item.name, rightTop: balance.toLocaleString('ru-RU',
          { maximumFractionDigits: 3 }) + ' ' + (item.unit || ''),
        subtitle: balance > 0.000001 ? 'Весь остаток' : 'Нет остатка в выбранном складе',
      })));
  };
  const updateUnit = () => {
    if (batch) { previewBatch(); return; }
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
    if (pending) return;
    const data = new FormData(form);
    const from = String(data.get('fromLocationId') || '');
    const to = String(data.get('toLocationId') || '');
    const itemId = String(data.get('itemId') || '');
    const quantity = Number(data.get('quantity'));
    const quantityUnit = String(data.get('quantityUnit') || '');
    const error = host.querySelector('[data-inventory-transfer-error]');
    if (!from || !to || from === to) { error.textContent = 'Выберите два разных места.'; return; }
    let lines = [];
    if (batch) {
      lines = available().filter(row => row.balance > 0.000001).map(row => ({
        itemId: row.item.itemId, fullBalance: true,
      }));
      if (!lines.length) {
        error.textContent = 'У выбранных товаров нет остатка в исходном складе.';
        return;
      }
    } else {
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
      lines = [{ itemId, quantity, unit: quantityUnit }];
    }
    if (!transferId) { error.textContent = 'Не удалось подготовить идентификатор операции.'; return; }
    const candidate = { transferId, fromLocationId: from, toLocationId: to, lines };
    // A retry uses the same immutable request even if the first reply was lost.
    if (submittedPayload && JSON.stringify(submittedPayload) !== JSON.stringify(candidate)) {
      error.textContent = 'Предыдущая попытка переноса не подтверждена. Обновите остатки перед новой операцией.';
      return;
    }
    submittedPayload = candidate;
    const submit = form.querySelector('[type="submit"]');
    pending = true;
    submit.disabled = true;
    try {
      await transferInventoryStock(submittedPayload);
      host.v2Close?.();
      onSaved();
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : 'Не удалось переместить товар.';
      pending = false;
      submit.disabled = false;
    }
  });
  updateUnit();
}
