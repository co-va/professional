import {
  actionBlock,
  button,
  emptyState,
  escapeHtml,
  field,
  initMultiSelect,
  modal,
  mountModal,
  openNotice,
  page,
  v2ListEntries,
  v2ListEntry,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import { flushBusinessPersistence } from '../business-persistence.js';
import { getRecord, refreshRecordsFromServer, updateRecord } from '../record/index.js';
import { getProducts } from '../service/products/data.js';
import { loadInventory } from '../inventory/service.js';

function workplaceAssignment(item, workplaceId) {
  const id = String(workplaceId || '');
  return (Array.isArray(item?.workplaces) ? item.workplaces : [])
    .find((workplace) => String(workplace?.workplaceId ?? workplace?.id ?? workplace?.key ?? '') === id) || null;
}

function costValue(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value?.free) return 0;
  return value?.amount ?? value?.from ?? value?.to ?? '';
}

function productCost(product, workplaceId) {
  const assigned = workplaceAssignment(product, workplaceId);
  const assignedCost = costValue(assigned?.cost);
  if (assignedCost !== '') return assignedCost;
  return costValue(product?.cost);
}

function productAvailable(product, workplaceId) {
  const assigned = Array.isArray(product?.workplaces) ? product.workplaces : [];
  return !assigned.length || Boolean(workplaceAssignment(product, workplaceId));
}

function money(value) {
  if (value === '' || value == null) return '';
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value) || 0)} ₽`;
}

function productRows(products, selected, currentById, workplaceId) {
  return products.map((product) => {
    const id = String(product?.id || '');
    const current = currentById.get(id);
    const cost = current?.cost ?? productCost(product, workplaceId);
    return v2ListEntry({
      title: product?.name || 'Товар',
      rightTop: money(cost),
      interactive: true,
      selectable: true,
      selected: selected.has(id),
      data: `data-sale-product="${escapeHtml(id)}"`,
      aria: `Выбрать товар ${product?.name || ''}`,
    });
  });
}

export function openSale({
  workplaceId = '',
  selectedProducts = [],
  onSave = async () => true,
} = {}) {
  const current = Array.isArray(selectedProducts) ? selectedProducts : [];
  const selected = new Set(current.map(item => String(item?.id || '')).filter(Boolean));
  const currentById = new Map(current.map(item => [String(item?.id || ''), item]));
  const amountDraft = new Map();
  for (const item of current) if (item?.quantity != null) amountDraft.set(String(item.id), String(item.quantity));
  let available = [], controller = null, ready = false;

  const layer = mountModal(document.body, modal(
    `${workspaceHeaderContext({ title: 'Продажа' })}${page([
      '<div data-sale-products></div>',
      '<div data-sale-amounts></div>',
      '<div class="form-error" role="alert" data-sale-error></div>',
      actionBlock(button('Добавить', { data: 'data-sale-save', disabled: true })),
    ])}`,
    { variant: 'q', surface: 'app', title: 'Продажа', className: 'sale-q' },
  ));
  if (!layer) return null;
  const listRoot = layer.querySelector('[data-sale-products]');
  const amountsRoot = layer.querySelector('[data-sale-amounts]');
  const saveButton = layer.querySelector('[data-sale-save]');
  const errorHost = layer.querySelector('[data-sale-error]');
  listRoot.innerHTML = emptyState('Загрузка', 'Загружаем товары со склада.');

  const syncAmounts = () => {
    amountsRoot.innerHTML = available.filter(item => selected.has(String(item.id))).map(item => {
      const id = String(item.id);
      const existing = currentById.get(id);
      const defaultQuantity = item.inventoryItemId
        ? (item.quantity == null ? '' : String(item.quantity))
        : '1';
      const value = amountDraft.get(id) ?? (existing?.quantity == null ? defaultQuantity : String(existing.quantity));
      return field({
        label: 'Количество · ' + item.name + ' (' + (item.unit || 'шт.') + ')',
        name: 'quantity-' + id, value,
        type: 'number', min: '0.001', step: 'any', inputmode: 'decimal',
        data: `data-sale-quantity="${escapeHtml(id)}"`,
      });
    }).join('');
  };
  amountsRoot?.addEventListener('input', event => {
    if (!event.target.matches('[data-sale-quantity]')) return;
    amountDraft.set(event.target.dataset.saleQuantity, event.target.value);
  });
  void loadInventory().then(() => {
    if (!layer.isConnected) return;
    const fresh = getProducts().filter(item => productAvailable(item, workplaceId));
    const shown = new Set(fresh.map(item => String(item.id)));
    // Historical sale rows stay visible even if the stock product was later
    // archived or its sale flag was disabled. They must remain removable.
    const saved = current.filter(item => !shown.has(String(item.id)))
      .map(item => ({ ...item, inventoryOwned: Boolean(item.inventoryItemId),
        pricePerUnit: Number(item.unitPrice ?? (Number(costValue(item.cost)) / (Number(item.quantity) || 1))) || 0 }));
    available = [...fresh, ...saved];
    listRoot.innerHTML = available.length
      ? v2ListEntries(productRows(available, selected, currentById, workplaceId))
      : emptyState('Товаров пока нет', 'Создайте товар на складе и включите «Продажа».');
    if (available.length) controller = initMultiSelect(listRoot, {
      selectedValues: [...selected],
      selector: '[data-sale-product]',
      valueAttribute: 'saleProduct',
      onChange: values => {
        selected.clear();
        values.forEach(value => selected.add(String(value)));
        syncAmounts();
      },
    });
    syncAmounts();
    ready = true;
    saveButton.disabled = false;
  }).catch(error => {
    if (!layer.isConnected) return;
    listRoot.innerHTML = '';
    errorHost.textContent = error instanceof Error ? error.message : 'Не удалось загрузить склад.';
  });

  saveButton?.addEventListener('click', async () => {
    if (!ready || saveButton.disabled) return;
    const nextProducts = [];
    for (const product of available.filter(item => selected.has(String(item.id)))) {
      const id = String(product.id);
      const existing = currentById.get(id);
      const raw = String(amountDraft.get(id) ?? amountsRoot.querySelector('[data-sale-quantity="' + id + '"]')?.value ?? '').trim();
      const quantity = Number(raw.replace(',', '.'));
      if (!raw || !Number.isFinite(quantity) || quantity <= 0 || (product.unit === 'шт.' && !Number.isSafeInteger(quantity))) {
        errorHost.textContent = 'Проверьте количество: ' + product.name;
        return;
      }
      const savedUnitPrice = Number(existing?.unitPrice);
      const previousTotal = Number(costValue(existing?.cost));
      const previousQuantity = Number(existing?.quantity);
      const unitPrice = existing
        ? Number.isFinite(savedUnitPrice) && savedUnitPrice >= 0
          ? savedUnitPrice : Number.isFinite(previousTotal) && previousQuantity > 0
            ? previousTotal / previousQuantity : 0
        : Number(product.inventoryItemId ? product.pricePerUnit
          : productCost(product, workplaceId)) || 0;
      nextProducts.push({
        ...(existing || {}),
        id: product.id,
        name: product.name,
        ...(product.inventoryItemId ? { inventoryItemId: product.inventoryItemId } : {}),
        unit: product.unit || 'шт.',
        quantity,
        unitPrice,
        // Record/Finance requires a numeric immutable price snapshot.
        cost: Math.round(unitPrice * quantity * 100) / 100,
      });
    }
    saveButton.disabled = true;
    errorHost.textContent = '';
    try {
      const result = await onSave(nextProducts);
      if (result === false) { saveButton.disabled = false; return; }
      controller?.destroy();
      layer.v2Close?.();
    } catch (error) {
      errorHost.textContent = error instanceof Error ? error.message : 'Не удалось добавить товары.';
      saveButton.disabled = false;
    }
  });
  return layer;
}

export function openRecordSale(record, { onSaved = () => {} } = {}) {
  if (!record?.id) return null;
  const current = getRecord(record.id) || record;
  return openSale({
    workplaceId: current.workplaceId,
    selectedProducts: current.products || [],
    onSave: async (products) => {
      const updated = updateRecord(current.id, { products });
      if (!updated) throw new Error('Не удалось обновить состав продажи.');
      await flushBusinessPersistence();
      await refreshRecordsFromServer();
      const saved = getRecord(current.id) || updated;
      onSaved(saved);
      return saved;
    },
  });
}
