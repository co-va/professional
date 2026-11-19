// E «Движения» owns the only transfer editor. «Остатки» passes its
// selection to this editor; Core is the sole owner of quantities/movements.
import { actionBlock, button, field, modal, mountModal, select, twoColumnLayout } from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { getInventoryItem, getInventoryItems, getInventoryStorageLocations } from './data.js';
import { transferInventoryStock } from './service.js';

const EPS = 0.000001;
const locations = () => getInventoryStorageLocations().filter(item => item && !item.archivedAt);
const options = () => locations().map(place => ({
  value: place.locationId, label: place.isPrimary ? 'Не распределено' : place.name,
}));
const quantityLabel = value => Number(value || 0).toLocaleString('ru-RU', {
  maximumFractionDigits: 3,
});
const stockAt = (item, locationId) => Number((item?.locationBalances || [])
  .find(row => row.locationId === locationId)?.balance || 0);

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

// In the overall view, infer a source only if it is unambiguous. In a
// warehouse-scoped view the passed location is authoritative.
function inferredSource(items, places) {
  const candidates = new Set();
  for (const item of items) {
    const occupied = (item.locationBalances || [])
      .filter(row => Number(row.balance) > EPS).map(row => row.locationId);
    let origins = occupied;
    if (!origins.length) {
      origins = (item.assignedStorageLocations || [])
        .filter(id => places.some(place => place.value === id));
    }
    if (!origins.length && item.location) {
      origins = places.filter(place => place.label === item.location)
        .map(place => place.value);
    }
    if (origins.length > 1) return '';
    if (origins.length === 1) candidates.add(origins[0]);
  }
  return candidates.size === 1 ? [...candidates][0] : '';
}

function compactTransferRow(item, index, from) {
  const balance = stockAt(item, from);
  const unit = String(item.unit || 'шт.');
  // Shared Inventory / Audit geometry: name and balance on the left,
  // editable numerical quantity on the right. Never render V2 cards here.
  return '<div class="data-edit-row inventory-transfer-row" data-inventory-transfer-row="' + index + '">' +
    '<div class="data-edit-row__name inventory-transfer-row__name">' +
      '<strong title="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</strong>' +
      '<small>Остаток: ' + quantityLabel(balance) + ' ' + escapeHtml(unit) + '</small>' +
    '</div>' +
    '<div class="inventory-editor-number">' +
      field({ label: '', name: 'transferQuantity-' + index,
        value: '', placeholder: '—', type: 'number', min: '0',
        step: ['шт.', 'уп.'].includes(unit) ? '1' : '0.001',
        inputmode: 'decimal', autocomplete: 'off' }) +
      '<span class="inventory-editor-number__suffix">' + escapeHtml(unit) + '</span>' +
    '</div>' +
  '</div>';
}

export function openInventoryTransfer(onSaved = () => {}, { selectedItemIds = [], fromLocationId = '' } = {}) {
  const stock = getInventoryItems();
  const selected = [...new Set(selectedItemIds)].map(id => getInventoryItem(id)).filter(Boolean);
  const batch = selected.length > 0;
  const places = options();
  const validLocation = id => places.some(place => place.value === id);
  const fromDefault = validLocation(fromLocationId) ? fromLocationId
    : batch ? inferredSource(selected, places) : '';
  const toDefault = '';
  const transferId = globalThis.crypto?.randomUUID?.() || '';
  let pending = false;
  let submittedPayload = null;

  const host = mountModal(document.body, modal(
    '<form data-inventory-transfer-form>' +
      select({ label: 'Из места', name: 'fromLocationId', value: fromDefault,
        options: [{ value: '', label: 'Выберите исходный склад' }, ...places] }) +
      select({ label: 'В место', name: 'toLocationId', value: toDefault,
        options: [{ value: '', label: 'Выберите склад назначения' }, ...places] }) +
      (batch
        ? '<p class="ui-list__secondary">Выбрано позиций: ' + selected.length + '</p>' +
          '<div data-inventory-transfer-rows></div>' +
          '<p class="ui-list__secondary">Без количества — только карточка в другом складе. С количеством — перемещение остатка.</p>'
        : select({ label: 'Товар', name: 'itemId', value: '',
            options: [{ value: '', label: 'Выбрать товар' },
              ...stock.map(item => ({
                value: item.itemId,
                label: [item.manufacturer, item.name].filter(Boolean).join(' · '),
              }))], searchable: true }) +
          twoColumnLayout(
            field({ label: 'Количество', name: 'quantity', value: '', type: 'number',
              min: '0.001', step: 'any', required: true }),
            '<div data-inventory-transfer-unit-picker></div>',
            { ariaLabel: 'Количество и единица переноса' },
          ) +
          '<p class="ui-list__secondary" data-inventory-transfer-unit></p>') +
      '<p class="form-error" role="alert" data-inventory-transfer-error></p>' +
      '<div data-inventory-transfer-actions hidden>' +
        actionBlock(button('Применить', { type: 'submit' })) +
      '</div>' +
    '</form>',
    { title: 'Перемещение', variant: 'q', surface: 'app' },
  ));
  if (!host) return;
  const form = host.querySelector('[data-inventory-transfer-form]');
  const error = form.querySelector('[data-inventory-transfer-error]');
  const unit = form.querySelector('[data-inventory-transfer-unit]');
  const unitHost = form.querySelector('[data-inventory-transfer-unit-picker]');
  const rowsHost = form.querySelector('[data-inventory-transfer-rows]');
  const actions = form.querySelector('[data-inventory-transfer-actions]');
  const submit = actions.querySelector('[type="submit"]');

  const currentSource = () => String(form.elements.namedItem('fromLocationId')?.value || '');
  const currentDestination = () => String(form.elements.namedItem('toLocationId')?.value || '');
  const readBatch = () => selected.map((item, index) => ({
    item,
    input: String(form.elements.namedItem('transferQuantity-' + index)?.value ?? '').trim(),
  }));
  const renderBatch = () => {
    if (!batch || !rowsHost) return;
    const remembered = readBatch().map(row => row.input);
    rowsHost.innerHTML = selected.map((item, index) =>
      compactTransferRow(item, index, currentSource())).join('');
    remembered.forEach((value, index) => {
      const input = form.elements.namedItem('transferQuantity-' + index);
      if (input) input.value = value;
    });
  };
  const updateSingleUnit = () => {
    if (batch) return;
    const item = getInventoryItem(form.elements.namedItem('itemId')?.value);
    const balance = stockAt(item, currentSource());
    const units = transferUnits(item);
    const previous = unitHost.querySelector('[name="quantityUnit"]')?.value;
    unitHost.innerHTML = select({
      label: 'Единица', name: 'quantityUnit',
      value: units.includes(previous) ? previous : units[0] || '',
      options: units.length
        ? units.map(value => ({ value, label: value }))
        : [{ value: '', label: '—' }],
    });
    unit.textContent = item
      ? 'В выбранном складе: ' + quantityLabel(balance) + ' ' + item.unit : '';
  };

  function validate({ message = false } = {}) {
    const from = currentSource();
    const to = currentDestination();
    let problem = '';
    if (!validLocation(to)) problem = '';
    else if (from && from === to) problem = 'Склады должны отличаться.';
    else if (batch) {
      for (const { item, input } of readBatch()) {
        if (!input || input === '0') continue; // This row only assigns the card.
        const quantity = Number(input.replace(',', '.'));
        const stockUnit = String(item.unit || '');
        if (!Number.isFinite(quantity) || quantity < 0 ||
            Math.round(quantity * 1000) / 1000 !== quantity ||
            (['шт.', 'уп.'].includes(stockUnit) && !Number.isSafeInteger(quantity))) {
          problem = 'Проверьте количество для «' + item.name + '».';
          break;
        }
        if (!validLocation(from)) {
          problem = 'Выберите исходный склад для перемещения количества.';
          break;
        }
        if (quantity > stockAt(item, from) + EPS) {
          problem = 'Недостаточный остаток: ' + item.name + '.';
          break;
        }
      }
    } else if (validLocation(from)) {
      const item = getInventoryItem(form.elements.namedItem('itemId')?.value);
      const quantity = Number(form.elements.namedItem('quantity')?.value);
      const chosenUnit = form.elements.namedItem('quantityUnit')?.value;
      if (!(item && Number.isFinite(quantity) && quantity > 0 &&
            transferUnits(item).includes(chosenUnit) &&
            (!['шт.', 'уп.'].includes(chosenUnit) || Number.isSafeInteger(quantity)))) {
        problem = '';
      }
    }
    const ready = !pending && validLocation(to) && (!from || from !== to) &&
      (batch ? !problem : validLocation(from) &&
        Boolean(getInventoryItem(form.elements.namedItem('itemId')?.value)) &&
        Number(form.elements.namedItem('quantity')?.value) > 0 &&
        transferUnits(getInventoryItem(form.elements.namedItem('itemId')?.value))
          .includes(form.elements.namedItem('quantityUnit')?.value));
    actions.hidden = !ready;
    submit.disabled = !ready;
    if (message || problem) error.textContent = problem;
    else error.textContent = '';
    return ready;
  }

  form.addEventListener('change', event => {
    if (event.target.name === 'fromLocationId') {
      renderBatch();
      updateSingleUnit();
    } else if (event.target.name === 'itemId') updateSingleUnit();
    validate();
  });
  form.addEventListener('input', event => {
    if (event.target.matches('input, select')) validate();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || !validate({ message: true })) return;
    const from = currentSource(), to = currentDestination();
    let lines = [];
    let assignmentItemIds = [];
    if (batch) {
      assignmentItemIds = selected.map(item => item.itemId);
      lines = readBatch().filter(row => Number(row.input) > 0).map(row => ({
        itemId: row.item.itemId, quantity: Number(row.input), unit: row.item.unit,
      }));
    } else {
      const itemId = String(form.elements.namedItem('itemId')?.value || '');
      const quantity = Number(form.elements.namedItem('quantity')?.value);
      const unit = String(form.elements.namedItem('quantityUnit')?.value || '');
      if (!(quantity > 0) || !Number.isFinite(quantity)) return;
      if (['шт.', 'уп.'].includes(unit) && !Number.isSafeInteger(quantity)) return;
      lines = [{ itemId, quantity, unit }];
    }
    if (!transferId) {
      error.textContent = 'Не удалось подготовить идентификатор операции.';
      return;
    }
    const candidate = { transferId, fromLocationId: from || 'primary',
      toLocationId: to, lines, ...(batch ? { assignmentItemIds } : {}) };
    if (submittedPayload && JSON.stringify(submittedPayload) !== JSON.stringify(candidate)) {
      error.textContent = 'Предыдущая попытка не подтверждена. Откройте перенос заново.';
      return;
    }
    submittedPayload = candidate;
    pending = true;
    validate();
    try {
      await transferInventoryStock(submittedPayload);
      host.v2Close?.();
      onSaved();
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : 'Не удалось переместить товар.';
      pending = false;
      validate();
    }
  });
  if (batch) renderBatch();
  else updateSingleUnit();
  validate();
}
