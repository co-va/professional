import {inventoryDesktop,inventoryDesktopHeader,inventoryTable,inventoryRowButton,bindInventoryTableRows} from './desktop.js';
import {DATA_EXCHANGE_ICON,GROUP_ICON} from '../../ui/buttons/index.js';
import {
  actionBlock,
  button,
  details,
  emptyState,
  field,
  textareaField,
  modal,
  mountModal,
  mountV2ZLayer,
  openNotice,
  openSharedProfileSettingsMenu,
  page,
  list,
  select,
  setV2ZHeaderRows,
  shortDateTimeParts,
  twoColumnLayout,
  v2ListEntries,
  v2ListEntry,
  initV2ListReorder,
  v2ZLayer,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { compactCheck } from '../../ui/selection/check-list.js';
import { canUseCapability } from '../access.js';
import '../../ui/page/page.js';
import {
  inventoryItemCompletion, isWeighedInventoryItem, netStocktakeGrams,
  inventoryStockThresholdInput, inventoryStockThresholdStored,
} from './completeness.js';
import { openInventoryProductAppearanceQ, openInventoryProductOverview } from './product-overview.js';
import { openQuickStockItemX, openStockItemQEditor, supplierPurchase } from './stock-item-editor.js';
import {
  openInventoryBulkSupplierLink, prepareInventorySupplierLinks, applyInventorySupplierLinks,
} from './supplier-bulk-link.js';
import { getAuthToken as getInventorySupplierAuthToken } from '../auth.js';
import { renderInventoryOrders, openInventoryOrderFromSelection } from './orders.js';
import { classificationOptions, openInventoryClassificationGroups,
  inventoryCriterionGroups, criterionOptions } from './classification.js';
import { openInventoryStorageLocations, reconcileLegacyInventoryStorage } from './storage.js';
import { openInventoryTransfer } from './movement-transfer.js';
import { renderStockBrandList, buildStockCatalogGroups, stockRootCriterion, stockNestedCriteria } from './stock-catalog.js';
import { stockGroupTree, sortedStockChildren, stockGroupValue } from './grouping.js';
import { planInventoryPositionReorder, planInventoryMoveToEnd } from './position-reorder-plan.js';
import { catalogDisclosure } from './catalog-ui.js';
import { INVENTORY_TOTAL_SCOPE, inventoryDisplayBalance,
  inventoryItemBelongsToStorage, itemLocationBalance, inventoryLocations, storageName } from './stock-targets.js';
import {
  emptyStockFilters, hasStockFilters, matchesStockFilters,
  stockFilterOptions, stockSupplierNames, STOCK_FILLED, STOCK_EMPTY,
} from './stock-filters.js';
import {
  getInventoryItem,
  getInventoryItems,
  getInventoryClassificationGroups,
  getInventoryStorageLocations,
  getInventoryMovement,
  getInventoryMovements,
} from './data.js';
import {
  archiveSelectedInventoryItems,
  updateInventoryItemsBatch,
  correctInventoryMovement,
  createInventoryMovement,
  loadInventory,
  loadInventoryCriteria,
  reorderInventoryCriterionValues,
  reorderInventoryItemsBatch,
  repairInventoryPositions,
} from './service.js';

const UNIT_OPTIONS = [
  { value: 'г', label: 'г' },
  { value: 'мл', label: 'мл' },
  { value: 'шт.', label: 'шт.' },
  { value: 'уп.', label: 'уп.' },
];
const EMPTY_MANUFACTURER = 'Без производителя';
const INVENTORY_SORT_KEY = 'professional.inventory.sort';
const INVENTORY_SORT_MODES = {
  manufacturersSort: ['name-asc', 'name-desc', 'count-desc', 'count-asc'],
  itemsSort: ['position-asc', 'name-asc', 'name-desc', 'type-asc', 'balance-desc', 'balance-asc'],
};

// Reuse the Contacts convention for persistent local sort preferences.
function readInventorySortModes() {
  try {
    const stored = JSON.parse(localStorage.getItem(INVENTORY_SORT_KEY) || '{}');
    const firstPositionSort = stored?.positionSortVersion !== 2;
    const itemsSort = firstPositionSort ? 'position-asc'
      : INVENTORY_SORT_MODES.itemsSort.includes(stored?.itemsSort) ? stored.itemsSort : 'position-asc';
    if (firstPositionSort) localStorage.setItem(INVENTORY_SORT_KEY, JSON.stringify({
      ...stored, itemsSort, positionSortVersion: 2,
    }));
    return {
      manufacturersSort: INVENTORY_SORT_MODES.manufacturersSort.includes(stored?.manufacturersSort)
        ? stored.manufacturersSort : 'name-asc',
      itemsSort,
    };
  } catch {
    return { manufacturersSort: 'name-asc', itemsSort: 'position-asc' };
  }
}

const STOCK_VIEW = {
  ...readInventorySortModes(),
  manufacturersType: '',
  itemsType: '',
  itemsFilters: emptyStockFilters(),
  storageScope: INVENTORY_TOTAL_SCOPE,
};

function saveInventorySortMode(key, value) {
  if (!INVENTORY_SORT_MODES[key]?.includes(value)) return;
  STOCK_VIEW[key] = value;
  try {
    localStorage.setItem(INVENTORY_SORT_KEY, JSON.stringify({
      manufacturersSort: STOCK_VIEW.manufacturersSort,
      itemsSort: STOCK_VIEW.itemsSort,
      positionSortVersion: 2,
    }));
  } catch {
    // Storage disabled: keep the selected order active for this session.
  }
}
function numberText(value, maximum = 3) {
  const number = Number(value) || 0;
  return number.toLocaleString('ru-RU', { maximumFractionDigits: maximum }).replaceAll('\u00a0', ' ');
}

function moneyText(value) {
  const number = Number(value) || 0;
  return `${number.toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replaceAll('\u00a0', ' ')} ₽`;
}

function normalizedSearch(value = '') {
  return String(value || '').trim().toLocaleLowerCase('ru-RU');
}

function itemSearchText(item = {}) {
  return [
    item.manufacturer,
    item.name,
    item.productType,
    item.category,
    item.sku,
    item.barcode,
    ...stockNestedCriteria(inventoryCriterionGroups()).map(group=>stockGroupValue(item,group)),
  ].filter(Boolean).join(' ').toLocaleLowerCase('ru-RU');
}

function manufacturerName(item = {}) {
  return String(item.manufacturer || '').trim() || EMPTY_MANUFACTURER;
}

function productTypeText(item = {}) {
  return String(item.productType || item.category || '').trim();
}

function inventoryPositionComparator(left, right) {
  // The manual position is independent for each manufacturer. Together, companies
  // remain grouped by name, with numbered items before unnumbered items inside.
  const company = manufacturerName(left).localeCompare(manufacturerName(right), 'ru', { numeric: true, sensitivity: 'base' });
  if (company) return company;
  const rank = item => Number.isSafeInteger(Number(item.position)) && Number(item.position) > 0
    ? Number(item.position) : Number.MAX_SAFE_INTEGER;
  return rank(left) - rank(right)
    || String(left.name || '').localeCompare(String(right.name || ''), 'ru', { numeric: true, sensitivity: 'base' })
    || String(left.itemId || '').localeCompare(String(right.itemId || ''));
}

function sortItems(items = [], mode = STOCK_VIEW.itemsSort) {
  const rows = [...items];
  const byName = (left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'ru', { numeric: true, sensitivity: 'base' });
  if (mode === 'position-asc') return rows.sort(inventoryPositionComparator);
  if (mode === 'name-desc') return rows.sort((left, right) => byName(right, left));
  if (mode === 'balance-asc') return rows.sort((left, right) => (Number(left.balance) || 0) - (Number(right.balance) || 0) || byName(left, right));
  if (mode === 'balance-desc') return rows.sort((left, right) => (Number(right.balance) || 0) - (Number(left.balance) || 0) || byName(left, right));
  if (mode === 'type-asc') return rows.sort((left, right) => productTypeText(left).localeCompare(productTypeText(right), 'ru', { sensitivity: 'base' }) || byName(left, right));
  return rows.sort(byName);
}

function matchesType(item, type = '') {
  return !type || productTypeText(item) === type;
}

function stockTypeOptions(manufacturer = '') {
  const values = [...new Set(getInventoryItems()
    .filter((item) => !manufacturer || manufacturerName(item) === manufacturer)
    .map(productTypeText)
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'ru', { numeric: true, sensitivity: 'base' }));
  return [{ value: '', label: 'Все подкатегории' }, ...values.map((value) => ({ value, label: value }))];
}

function movementTitle(movement = {}) {
  if (movement.personUei) return String(movement.personUei);
  if (movement.kind === 'RECEIPT') return 'Приход';
  if (movement.kind === 'CONSUMPTION') return 'Расход';
  if (movement.kind === 'WRITE_OFF') return 'Списание';
  if (movement.kind === 'TRANSFER') return 'Перемещение';
  if (movement.kind === 'SALE') return 'Продажа';
  if (movement.kind === 'RETURN') return 'Возврат на склад';
  if (movement.kind === 'SUPPLIER_RETURN') return 'Возврат поставщику';
  if (movement.kind === 'ADJUSTMENT') return 'Инвентаризация';
  if (movement.kind === 'CORRECTION') return 'Корректировка';
  return 'Движение';
}

function movementSubtitle(movement = {}) {
  return [movement.procedureKey, movement.note].filter(Boolean).join(' · ');
}

function movementMoment(value) {
  const parts = shortDateTimeParts(value || '');
  return [parts.date, parts.time].filter(Boolean).join(' · ');
}

function movementSign(line = {}) {
  return line.direction === 'OUT' ? '−' : '+';
}

function notifyContext() {
  window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
}

function context(title, { a = null, v = null, c = null } = {}) {
  return workspaceHeaderContext({ title, a, v, c });
}

function itemUsageMode(item = {}) {
  if (item.canConsume !== false && item.canSell === true) return 'both';
  if (item.canConsume !== false) return 'consume';
  if (item.canSell === true) return 'sale';
  return 'track';
}


// The stock view still needs a lossless count of pieces per purchased pack.
function inventoryPackPieceCount(item = {}) {
  if (item.receiptUnit !== 'уп.') return '';
  const total = Number(item.packageQuantity);
  if (!(total > 0)) return '';
  let perPiece = item.unit === 'шт.' ? 1
    : Number(item.conversionRules?.find(row => row.unit === 'шт.')?.stockPerUnit);
  if (!(perPiece > 0)) return '';
  const pieces = total / perPiece;
  return Number.isSafeInteger(pieces) && pieces >= 2 ? String(pieces) : '';
}

function inventoryToday() {
  const now = new Date();
  return [String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')].join('-');
}
function inventoryOccurredAt(value) {
  const raw = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(raw + 'T12:00:00');
  return !Number.isNaN(date.getTime()) && inventoryTodayForDate(date) === raw ? date.toISOString() : null;
}
function inventoryTodayForDate(date) {
  return [String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
}


export function openItemEditor(root, itemId = '', defaults = {}, onSaved = () => {}, stockScope = INVENTORY_TOTAL_SCOPE) {
  return openStockItemQEditor(itemId, defaults, onSaved, stockScope);
}

function openInventoryItemFilters(root, availableFilters, values, onApplied) {
  if (!availableFilters.length) {
    openNotice({ title: 'Фильтр', message: 'Для этих позиций пока нет доступных фильтров.' });
    return;
  }
  let applied = { ...values };
  let draft = { ...applied };
  const hasFilters = state => Object.values(state).some(Boolean);
  const changed = () => availableFilters.some(({ key }) => draft[key] !== applied[key]);
  const fieldsMarkup = state => `<div class="form-grid" data-inventory-filter-fields>
    ${availableFilters.map(({ key, label, options }) => select({
      label, name: `inventoryFilter-${key}`, value: state[key], options,
    })).join('')}
  </div>`;
  const filterLayer = mountModal(root, modal(`
    <div data-inventory-filter-form>${fieldsMarkup(draft)}</div>
    <div class="modal-actions" data-inventory-filter-actions hidden>
      ${button('Применить', { data: 'data-inventory-filter-action' })}
    </div>`, { title: 'Фильтр', variant: 'x', surface: 'app' }));
  if (!filterLayer) return;
  const action = filterLayer.querySelector('[data-inventory-filter-action]');
  const actions = filterLayer.querySelector('[data-inventory-filter-actions]');
  const syncAction = () => {
    const isChanged = changed();
    const reset = !isChanged && hasFilters(applied);
    actions.hidden = !isChanged && !reset;
    action.textContent = isChanged ? 'Применить' : 'Сбросить';
    action.classList.toggle('ui-button--secondary', reset);
  };
  filterLayer.addEventListener('change', event => {
    const option = availableFilters.find(({ key }) => event.target?.name === `inventoryFilter-${key}`);
    if (!option) return;
    draft[option.key] = String(event.target.value || '');
    syncAction();
  });
  action.addEventListener('click', () => {
    if (changed()) {
      applied = { ...draft };
      Object.assign(values, applied);
      onApplied();
      filterLayer.v2Close?.();
      return;
    }
    if (!hasFilters(applied)) return;
    availableFilters.forEach(({ key }) => { values[key] = ''; });
    applied = { ...values };
    draft = { ...applied };
    filterLayer.querySelector('[data-inventory-filter-form]').innerHTML = fieldsMarkup(draft);
    onApplied();
    syncAction();
  });
  syncAction();
}

function movementNoteLabel(kind) {
  if (kind === 'RECEIPT') return 'Основание прихода';
  if (kind === 'WRITE_OFF') return 'Причина списания';
  if (kind === 'RETURN') return 'Основание возврата';
  return 'Примечание';
}

function openMovementEditor(root, movementId = '', kind = 'CONSUMPTION', { record = null, onSaved = null } = {}) {
  const movement = movementId ? getInventoryMovement(movementId) : null;
  const correcting = Boolean(movement);
  // Canonical movement retries must never create a second stock fact.
  const movementRequestId = correcting ? '' : (globalThis.crypto?.randomUUID?.() || '');
  if (correcting && movement.kind === 'ADJUSTMENT'
      && movement.lines?.some(line => line.actualContainerCount != null)) {
    openNotice({ title: 'Инвентаризация', message: 'Для исправления физического пересчёта проведите новую инвентаризацию.' });
    return;
  }
  let actualKind = movement?.kind || kind;
  if (correcting && movement.lines?.some(line =>
    (line.storageLocationId || 'primary') !== 'primary')) {
    openNotice({ title: 'Движения', message: 'Операция по конкретному складу исправляется новым компенсирующим движением.' });
    return;
  }
  const originalLines = new Map((movement?.lines || []).map(line => [line.itemId, line]));
  const selected = new Set(originalLines.keys());
  const recordLabel = [record?.personUei, record?.personName].map(value => String(value || '').trim()).filter(Boolean).join(' · ');

  // Q1: the operation selector lives in the Q header, not in the scrollable body.
  const availableFilters = inventoryAuditFilters(getInventoryItems());
  const filterValues = Object.fromEntries(availableFilters.map(({ key }) => [key, '']));
  const selectionMarkup = `${workspaceHeaderContext({
    title: 'Движение',
    v: { data: 'data-inventory-movement-v', aria: 'Фильтр материалов' },
  })}<div class="form-grid" data-inventory-movement-selection>
    ${recordLabel ? `<p>${escapeHtml(recordLabel)}</p>` : ''}
    ${stockSearchField('', 'data-inventory-movement-search')}
    <p data-inventory-movement-count></p>
    <div data-inventory-movement-choices></div>
    ${actionBlock(button('Продолжить', { data: 'data-inventory-movement-next', disabled: !selected.size }))}
  </div>`;
  const selectionLayer = mountModal(root, modal(selectionMarkup, { variant: 'q' }));
  if (!selectionLayer) return;
  const header = selectionLayer.querySelector('[data-v2-q-header-content]');
  if (header) {
    const operationControl = !correcting && !kind ? select({
      name: 'movementKind',
      value: '',
      options: [
        { value: '', label: 'Операция' },
        { value: 'RECEIPT', label: 'Приход' },
        { value: 'CONSUMPTION', label: 'Расход' },
        { value: 'TRANSFER', label: 'Перемещение' },
        { value: 'WRITE_OFF', label: 'Списание' },
        { value: 'RETURN', label: 'Возврат на склад' },
        ...(canUseCapability('inventory.stocktake.access')
          ? [{ value: 'ADJUSTMENT', label: 'Инвентаризация' }] : []),
      ],
    }) : `<h2 class="v2-q-title">${escapeHtml(movementTitle({ kind: actualKind }))}</h2>`;
    header.innerHTML = operationControl;
  }
  const choiceHost = selectionLayer.querySelector('[data-inventory-movement-choices]');
  const search = selectionLayer.querySelector('[data-inventory-movement-search]');
  const countHost = selectionLayer.querySelector('[data-inventory-movement-count]');
  const nextButton = selectionLayer.querySelector('[data-inventory-movement-next]');

  const renderChoices = () => {
    if (!actualKind) {
      choiceHost.innerHTML = '';
      countHost.textContent = 'Выберите операцию';
      nextButton.disabled = true;
      return;
    }
    const query = normalizedSearch(search?.value);
    const items = getInventoryItems()
      .filter(item => availableFilters.every(({ key }) => !filterValues[key] || String(item[key] ?? '').trim() === filterValues[key]))
      .filter(item => actualKind !== 'CONSUMPTION' || item.canConsume !== false)
      .filter(item => actualKind !== 'SALE' || item.canSell === true)
      .filter(item => !query || `${manufacturerName(item)} ${itemSearchText(item)}`.toLocaleLowerCase('ru-RU').includes(query))
      .sort(inventoryPositionComparator);
    choiceHost.innerHTML = items.length
      ? items.map(item => compactCheck({
          label: `${manufacturerName(item)} · ${item.name} (${numberText(item.balance)} ${item.unit})`,
          checked: selected.has(item.itemId),
          data: `data-inventory-movement-item="${escapeHtml(item.itemId)}"`,
        })).join('')
      : emptyState('Материалы не найдены', 'Измените поиск или добавьте материал в остатках.');
    countHost.textContent = `Выбрано ${selected.size}`;
    nextButton.disabled = selected.size === 0;
  };
  selectionLayer.addEventListener('change', event => {
    if (event.target.matches?.('[name="movementKind"]')) {
      if (event.target.value === 'TRANSFER') {
        selectionLayer.v2Close?.();
        openInventoryTransfer(() => renderMovements(root));
        return;
      }
      if (event.target.value === 'ADJUSTMENT' && canUseCapability('inventory.stocktake.access')) {
        selectionLayer.v2Close?.();
        openInventoryAuditSelection(root, { onSaved: () => renderMovements(root) });
        return;
      }
      actualKind = ['RECEIPT', 'CONSUMPTION', 'WRITE_OFF', 'RETURN'].includes(event.target.value)
        ? event.target.value : '';
      if (actualKind === 'CONSUMPTION') {
        [...selected].forEach(itemId => {
          if (getInventoryItem(itemId)?.canConsume === false) selected.delete(itemId);
        });
      }
      renderChoices();
      return;
    }
    const input = event.target.closest?.('[data-inventory-movement-item]');
    if (!input) return;
    if (input.checked) selected.add(input.dataset.inventoryMovementItem);
    else selected.delete(input.dataset.inventoryMovementItem);
    countHost.textContent = `Выбрано ${selected.size}`;
    nextButton.disabled = selected.size === 0;
  });
  search?.addEventListener('input', renderChoices);
  selectionLayer.querySelector('[data-inventory-movement-v]')?.addEventListener('click', () => {
    openSharedProfileSettingsMenu({
      title: 'Движение',
      actions: [{
        id: 'filter',
        label: 'Фильтр',
        onSelect: () => openInventoryItemFilters(selectionLayer, availableFilters, filterValues, renderChoices),
      }],
    });
  });

  // Second enter amounts for the selected items only. Q2 can close back to Q1.
  nextButton.addEventListener('click', () => {
    if (!actualKind || !selected.size) return;
    const rows = [...selected].map(itemId => ({
      item: getInventoryItem(itemId),
      previous: originalLines.get(itemId) || null,
    })).filter(row => row.item).sort((a, b) => inventoryPositionComparator(a.item, b.item));
    if (!rows.length) {
      openNotice({ title: 'Материалы', message: 'Выбранные позиции не найдены на складе.' });
      return;
    }
    // Match inventoryAuditInput: one item heading with balance, then compact inputs.
    const rowMarkup = rows.map(({ item, previous }) => {
      const outgoing = previous?.direction ? previous.direction === 'OUT'
        : ['CONSUMPTION', 'SALE', 'WRITE_OFF'].includes(actualKind);
      const containers = previous?.containerDelta == null ? '' : Math.abs(Number(previous.containerDelta));
      const physicalPieceCount = item.receiptUnit === 'шт.' || Boolean(inventoryPackPieceCount(item));
      const showContainers = isWeighedInventoryItem(item) && physicalPieceCount
        && (['RETURN', 'WRITE_OFF'].includes(actualKind) || previous?.containerDelta != null);
      const quantityPlaceholder = {
        RECEIPT: 'Поступило', CONSUMPTION: 'Израсходовано',
        WRITE_OFF: 'Списано', RETURN: 'Возвращено',
      }[actualKind] || 'Количество';
      const consume = !correcting && actualKind === 'CONSUMPTION';
      const receipt = !correcting && actualKind === 'RECEIPT';
      // People receive a physical piece or pack, not the internal gram/ml
      // accounting unit. Let Core perform the one authorized conversion.
      const inputUnit = receipt ? (item.receiptUnit || item.unit)
        : consume ? (item.consumeUnit || item.unit) : item.unit;
      // An empty preference stays empty. A stored preference is merely an
      // editable default, not a fixed deduction.
      const initialQuantity = previous?.quantity
        ?? (consume ? item.consumeQuantity ?? '' : '');
      const quantityInput = field({
        label: '', placeholder: `${quantityPlaceholder}, ${inputUnit}`,
        name: `quantity-${item.itemId}`,
        value: initialQuantity,
        type: 'number', min: '0', step: '0.001', inputmode: 'decimal',
      });
      const containerInput = showContainers ? field({
        label: '', placeholder: outgoing ? 'Тюбиков выбыло, шт.' : 'Тюбиков поступило, шт.',
        name: `containers-${item.itemId}`,
        value: containers, type: 'number', min: '0', step: '1', inputmode: 'numeric',
      }) : '';
      const balance = `${numberText(item.balance)} ${item.unit}`;
      return `<section data-inventory-movement-row data-item-id="${escapeHtml(item.itemId)}"
          data-row-direction="${escapeHtml(previous?.direction || '')}"
          data-quantity-unit="${escapeHtml(inputUnit)}">
        <div class="field-inline-label"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(balance)}</span></div>
        ${showContainers
          ? twoColumnLayout(quantityInput, containerInput, { ariaLabel: `Количество и тара: ${item.name}` })
          : quantityInput}
      </section>`;
    }).join('');
    // This selector belongs to Movements, not the Stock card or Orders.
    // A record's workplace may preselect a location only on an exact match.
    const places = inventoryLocations();
    const recordedPlace = places.find(place =>
      String(place.locationId) === String(record?.workplaceKey || '') ||
      (!place.isPrimary && String(storageName(place)).trim().toLocaleLowerCase('ru-RU') ===
        String(record?.workplaceKey || '').trim().toLocaleLowerCase('ru-RU')));
    const scopedPlace = places.find(place => place.locationId === STOCK_VIEW.storageScope);
    const initialPlace = recordedPlace?.locationId || (record ? '' : scopedPlace?.locationId || '');
    const placeSelector = !correcting ? select({
      label: 'Склад', name: 'storageLocationId', value: initialPlace,
      options: [{ value: '', label: 'Выберите склад' },
        ...places.map(place => ({ value: place.locationId, label: storageName(place) }))],
    }) : '';
    const editorMarkup = `<form class="form-grid" data-inventory-movement-form>
      ${placeSelector}
      ${actualKind === 'RECEIPT' && !correcting ? field({
        label: 'Поставщик', name: 'supplier', placeholder: 'Необязательно',
      }) : ''}
      ${!correcting ? field({
        label: actualKind === 'RECEIPT' ? 'Дата прихода'
          : actualKind === 'WRITE_OFF' ? 'Дата окончания' : 'Дата операции',
        name: 'occurredDate', type: 'date', value: inventoryToday(),
      }) : ''}
      ${field({ label: movementNoteLabel(actualKind), name: 'note', value: movement?.note || '' })}
      ${rowMarkup}
      <div class="form-error" data-inventory-movement-error role="alert"></div>
      ${actionBlock(button(correcting ? 'Исправить' : 'Сохранить', { type: 'submit', data: 'data-inventory-movement-save' }))}
    </form>`;
    const editorLayer = mountModal(selectionLayer, modal(editorMarkup, { title: movementTitle({ kind: actualKind }), variant: 'q' }));
    if (!editorLayer) return;
    const form = editorLayer.querySelector('[data-inventory-movement-form]');
    const errorHost = editorLayer.querySelector('[data-inventory-movement-error]');
    const saveButton = editorLayer.querySelector('[data-inventory-movement-save]');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (saveButton.disabled) return;
      errorHost.textContent = '';
      const lines = [];
      for (const element of form.querySelectorAll('[data-inventory-movement-row]')) {
        const itemId = element.dataset.itemId;
        const item = getInventoryItem(itemId);
        if (!item) { errorHost.textContent = 'Один из материалов больше не доступен.'; return; }
        const quantityRaw = element.querySelector('[name^="quantity-"]')?.value.trim() || '';
        const quantity = Number(quantityRaw.replace(',', '.'));
        const tubeRaw = element.querySelector('[name^="containers-"]')?.value.trim() || '';
        const tubeCount = tubeRaw ? Number(tubeRaw.replace(',', '.')) : null;
        if (!quantityRaw || !Number.isFinite(quantity) || quantity < 0
            || (quantity === 0 && (!tubeCount || tubeCount <= 0))) {
          errorHost.textContent = `Проверьте количество: ${item.name}`;
          return;
        }
        if (tubeCount != null && (!Number.isSafeInteger(tubeCount) || tubeCount < 0)) {
          errorHost.textContent = `Проверьте количество тюбиков: ${item.name}`;
          return;
        }
        const direction = element.dataset.rowDirection;
        const outgoing = direction ? direction === 'OUT'
          : ['CONSUMPTION', 'SALE', 'WRITE_OFF'].includes(actualKind);
        const inputUnit = element.dataset.quantityUnit || item.unit;
        const consume = actualKind === 'CONSUMPTION' && !correcting;
        const receipt = actualKind === 'RECEIPT' && !correcting;
        const wholeContainer = consume && ['шт.', 'уп.'].includes(inputUnit) && ['г', 'мл'].includes(item.unit);
        if ((receipt || consume && (inputUnit === 'уп.' || wholeContainer))
            && ['шт.', 'уп.'].includes(inputUnit) && !Number.isSafeInteger(quantity)) {
          errorHost.textContent = 'Укажите целое количество упаковок или штук: ' + item.name;
          return;
        }
        // Auto-count physical tubes/ampoules for a full receipt when known.
        // Bulk powder/sugar has no tube count, and must not invent one.
        const knownPieces = receipt && inputUnit === 'уп.'
          ? Number(inventoryPackPieceCount(item)) : receipt && inputUnit === 'шт.' ? 1 : 0;
        const receivedContainers = receipt && isWeighedInventoryItem(item) && knownPieces > 0
          ? quantity * knownPieces : null;
        lines.push({
          itemId, quantity,
          // Core translates an explicitly different unit only once.
          ...((consume || receipt) && inputUnit !== item.unit ? { quantityUnit: inputUnit } : {}),
          ...(tubeCount != null ? { containerDelta: outgoing ? -tubeCount : tubeCount }
            : receivedContainers != null ? { containerDelta: receivedContainers }
            : wholeContainer ? { containerDelta: -quantity } : {}),
          ...(direction ? { direction } : {}),
        });
      }
      if (!lines.length) { errorHost.textContent = 'Выберите материалы.'; return; }
      const values = new FormData(form);
      const note = String(values.get('note') || '').trim();
      const selectedPlace = String(values.get('storageLocationId') || '').trim();
      if (!correcting && !inventoryLocations().some(place => place.locationId === selectedPlace)) {
        errorHost.textContent = 'Выберите склад, на котором выполняется операция.';
        return;
      }
      const occurredAt = !correcting ? inventoryOccurredAt(values.get('occurredDate')) : null;
      if (!correcting && !occurredAt) {
        errorHost.textContent = 'Укажите корректную дату операции.';
        return;
      }
      if (!correcting && !movementRequestId) {
        errorHost.textContent = 'Не удалось подготовить идентификатор движения.';
        return;
      }
      saveButton.disabled = true;
      try {
        if (!correcting) lines.forEach(line => { line.storageLocationId = selectedPlace; });
        if (correcting) {
          await correctInventoryMovement(movement.movementId, { lines, note });
        } else {
          await createInventoryMovement({
            movementId: movementRequestId,
            kind: actualKind,
            occurredAt,
            sourceType: record?.recordId ? 'record' : 'manual',
            ...(record?.recordId ? { recordId: String(record.recordId) } : {}),
            ...(record?.personKey ? { personKey: String(record.personKey) } : {}),
            ...(record?.personUei ? { personUei: String(record.personUei) } : {}),
            ...(record?.procedureKey ? { procedureKey: String(record.procedureKey) } : {}),
            ...(record?.workplaceKey ? { workplaceKey: String(record.workplaceKey) } : {}),
            ...(actualKind === 'RECEIPT' ? { supplier: String(values.get('supplier') || '').trim() } : {}),
            note, lines,
          });
        }
        editorLayer.v2Close?.();
        selectionLayer.v2Close?.();
        if (typeof onSaved === 'function') onSaved();
        else renderMovements(root);
      } catch (error) {
        errorHost.textContent = error instanceof Error ? error.message : 'Не удалось сохранить движение.';
        saveButton.disabled = false;
      }
    });
    notifyContext();
  });
  renderChoices();
  notifyContext();
}

/**
 * Shared material-consumption entry point.
 * A future Record action passes its existing record context; it must not
 * introduce a second editor or create a new Record.
 */
export async function openInventoryConsumption(root, { record = null, onSaved = null } = {}) {
  if (!canUseCapability('inventory.movements.access')) {
    openNotice({ title: 'Расход', message: 'Нет доступа к складским движениям.' });
    return;
  }
  try {
    await loadInventory();
  } catch (error) {
    openNotice({ title: 'Расход', message: error instanceof Error ? error.message : 'Не удалось загрузить склад.' });
    return;
  }
  openMovementEditor(root, '', 'CONSUMPTION', { record, onSaved });
}

function stockSearchField(value = '', data = 'data-inventory-stock-search') {
  return `<div class="ui-search-field">${field({
    name: 'inventorySearch',
    value,
    type: 'search',
    autocomplete: 'off',
    placeholder: 'Название, подкатегория, артикул…',
    data,
  })}</div>`;
}

// Stock item rows stay fixed. Only category headers can be reordered.
// The existing shared list engine saves category order. Only a temporary
// compact header preview follows the pointer; expanded contents stay in flow.
function initStockCategoryDragPreview(sequence) {
  if (!sequence) return () => {};
  let gesture = null;
  let preview = null;
  let destination = null;
  const clear = () => {
    preview?.remove();
    preview = null;
    destination = null;
    gesture = null;
  };
  const onDown = event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const handle = event.target.closest?.('[data-reorder-handle]');
    const group = handle?.closest?.('[data-stock-category]');
    if (!group || !sequence.contains(group)) return;
    const heading = group.querySelector(':scope > details > summary');
    if (!heading) return;
    const rect = heading.getBoundingClientRect();
    gesture = {
      pointerId: event.pointerId, startY: event.clientY,
      offsetY: Math.max(0,Math.min(rect.height,event.clientY-rect.top)),
      left: rect.left, width: rect.width, title: heading.textContent.trim(),
    };
  };
  const onMove = event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!preview && Math.abs(event.clientY-gesture.startY) < 4) return;
    if (!preview) {
      preview = document.createElement('div');
      preview.className = 'inventory-stock-category-drag-preview';
      const title = document.createElement('strong');
      title.textContent = gesture.title;
      destination = document.createElement('small');
      destination.textContent = 'Перемещение группы';
      preview.append(title,destination);
      preview.style.left = gesture.left + 'px';
      preview.style.width = gesture.width + 'px';
      document.body.appendChild(preview);
    }
    preview.style.top = event.clientY-gesture.offsetY + 'px';
    const target = sequence.querySelector(
      '[data-stock-category].is-reorder-target-before, [data-stock-category].is-reorder-target-after');
    const label = target?.querySelector(':scope > details > summary')?.textContent?.trim();
    destination.textContent = label
      ? (target.classList.contains('is-reorder-target-before') ? 'Перед: ' : 'После: ') + label
      : 'Перемещение группы';
  };
  const onEnd = event => {
    if (gesture?.pointerId === event.pointerId) clear();
  };
  sequence.addEventListener('pointerdown',onDown);
  sequence.addEventListener('pointermove',onMove);
  sequence.addEventListener('pointerup',onEnd);
  sequence.addEventListener('pointercancel',onEnd);
  sequence.addEventListener('lostpointercapture',onEnd);
  return () => {
    clear();
    sequence.removeEventListener('pointerdown',onDown);
    sequence.removeEventListener('pointermove',onMove);
    sequence.removeEventListener('pointerup',onEnd);
    sequence.removeEventListener('pointercancel',onEnd);
    sequence.removeEventListener('lostpointercapture',onEnd);
  };
}

function stockListMarkup(manufacturer, query = '', rowsProvider = null, expanded = new Map(), selected = new Set(), allowCategoryReorder = false, desktop = false) {
  const needle = normalizedSearch(query);
  // Z2 always belongs to its manufacturer. Filtering/searching removes only
  // the nested disclosure presentation, never the manufacturer boundary.
  const flat = Boolean(needle) || hasStockFilters(STOCK_VIEW.itemsFilters);
  const group = typeof rowsProvider === 'function'
    ? rowsProvider() : getInventoryItems().filter(item => manufacturerName(item) === manufacturer);
  const classificationGroups = getInventoryClassificationGroups();
  const storageLocations = getInventoryStorageLocations();
  const items = sortItems(group.filter(item => {
    if (!matchesType(item, STOCK_VIEW.itemsType)
      || !matchesStockFilters(item, STOCK_VIEW.itemsFilters, classificationGroups, storageLocations)) return false;
    return !needle || itemSearchText(item).includes(needle);
  }), STOCK_VIEW.itemsSort);
  if (!items.length) return emptyState('Ничего не найдено', 'Измените поиск или фильтр.');

  const itemRow = item => {
    const hasSupplier = Boolean(item.primaryOfferId ||
      (Array.isArray(item.supplierOffers) && item.supplierOffers.some(offer =>
        offer.counterpartyId && offer.catalogItemId)));
    const completion = inventoryItemCompletion(item);
    return {
      // One existing Shared List indicator by the name: linked supplier.
      indicatorColor: hasSupplier ? '#39805F' : '#989898',
      indicatorLabel: hasSupplier ? 'Поставщик привязан' : 'Поставщик не привязан',
      // Second existing Shared List indicator next to the product metadata:
      // inventory-card completeness, per the canonical Inventory audit.
      secondaryIndicatorColor: completion.complete ? '#39805F' : '#C48637',
      secondaryIndicatorLabel: completion.complete
        ? 'Карточка заполнена'
        : 'Карточка заполнена на ' + completion.percentage + '%. ' +
          'Не заполнено: ' + completion.missing.join(', '),
      title: `${Number(item.position) > 0 ? `${item.position} · ` : ''}${item.name}`,
      secondary: [item.sku, productTypeText(item)].filter(Boolean).join(' · '),
      right: [
        `${numberText(inventoryDisplayBalance(item,STOCK_VIEW.storageScope))} ${item.unit || ''}`,
        item.lastPurchasePrice == null ? '' : moneyText(item.lastPurchasePrice),
      ].filter(Boolean),
      interactive: true,
      data: `data-inventory-item="${escapeHtml(item.itemId)}"`,
      aria: `Открыть ${item.name}. ${hasSupplier ? 'Поставщик привязан' : 'Поставщик не привязан'}. ${completion.complete ? 'Карточка заполнена' : 'Карточка заполнена на ' + completion.percentage + ' процентов'}`,
    };
  };
  // The compact selector is a sibling of the clickable stock row, never a
  // child of its button. Checking an item does not open its Q overview.
  const itemList = rows => desktop && rows.length ? inventoryTable(rows,[
    {key:'select',label:'',narrow:true,render:item=>compactCheck({checked:selected.has(String(item.itemId)),aria:'Выбрать '+item.name,data:'data-stock-item-check="'+escapeHtml(item.itemId)+'"'})},
    {key:'position',label:'№',narrow:true,render:item=>escapeHtml(Number(item.position)>0?String(item.position):'')},
    {key:'name',label:'Наименование',render:item=>inventoryRowButton(item.name,'data-inventory-item',item.itemId)},
    {key:'sku',label:'Артикул'},
    {key:'type',label:'Тип',render:item=>escapeHtml(productTypeText(item))},
    {key:'balance',label:'Остаток',narrow:true,render:item=>escapeHtml(numberText(inventoryDisplayBalance(item,STOCK_VIEW.storageScope))+' '+(item.unit||''))},
    {key:'price',label:'Цена закупки',narrow:true,render:item=>escapeHtml(item.lastPurchasePrice==null?'':moneyText(item.lastPurchasePrice))},
    {key:'supplier',label:'Поставщик',render:item=>escapeHtml(item.primaryOfferId||item.supplierOffers?.some(offer=>offer.counterpartyId&&offer.catalogItemId)?'Привязан':'Не привязан')},
    {key:'completion',label:'Карточка',narrow:true,render:item=>escapeHtml(inventoryItemCompletion(item).percentage+'%')},
  ],'Складские позиции') : rows.map(item =>
    '<div class="inventory-counterparty-product-row">' +
      compactCheck({
        checked:selected.has(String(item.itemId)),
        aria:'Выбрать складскую единицу ' + item.name,
        data:'data-stock-item-check="' + escapeHtml(item.itemId) + '"',
      }) +
      list({className:'ui-list--dense',items:[itemRow(item)]}) +
    '</div>'
  ).join('');
  if (flat) return '<div class="list-entries inventory-stock-category-sequence">' +
    itemList(items) + '</div>';
  const nestedCriteria = stockNestedCriteria(inventoryCriterionGroups());
  const tree = stockGroupTree(items, nestedCriteria);
  // The shared disclosure owns the appearance; only a named value becomes
  // a folder. An empty assignment skips that level altogether.
  const disclosure = (label, content, key, nested = false, reorderId = '', rows = [], autoOpen = false) =>
    catalogDisclosure(label, content, nested, rows.length,
      compactCheck({
        checked: rows.length > 0 && rows.every(item => selected.has(String(item.itemId))),
        aria: 'Выбрать все позиции группы ' + label,
        data: 'data-stock-group-check="' + escapeHtml(key) + '"',
      }), reorderId).replace('<details>',
      '<details data-stock-disclosure="' + escapeHtml(key) + '"' +
      (needle || (expanded.has(key) ? expanded.get(key) : autoOpen) ? ' open' : '') + '>');
  const render = (node, depth = 0) => {
    const children = sortedStockChildren(node, nestedCriteria);
    // Direct products count as a visible sibling. A group with an ungrouped
    // product beside it starts collapsed, while the direct product stays open.
    const sole = children.length === 1 && node.direct.length === 0;
    const folders = children.map(child => {
      const id = child.group.values?.find(value =>
        value.id === child.valueId || value.name === child.value)?.id || '';
      const reorderId = allowCategoryReorder && depth === 0 ? id : '';
      return disclosure(child.value, render(child, depth + 1),child.key,
        depth > 0, reorderId, child.items, sole);
    }).join('');
    return folders + itemList(node.direct);
  };
  return '<div class="list-entries inventory-stock-category-sequence">' +
    render(tree) + '</div>';
}

function stockSortOptions(level) {
  if (level === 'manufacturers') {
    return [
      { value: 'name-asc', label: 'Название А—Я' },
      { value: 'name-desc', label: 'Название Я—А' },
      { value: 'count-desc', label: 'Больше позиций сначала' },
      { value: 'count-asc', label: 'Меньше позиций сначала' },
    ];
  }
  return [
    { value: 'position-asc', label: 'По порядку' },
    { value: 'name-asc', label: 'Название А—Я' },
    { value: 'name-desc', label: 'Название Я—А' },
    { value: 'type-asc', label: 'По подкатегории' },
    { value: 'balance-desc', label: 'Остаток: больше сначала' },
    { value: 'balance-asc', label: 'Остаток: меньше сначала' },
  ];
}

function openStockControls(trigger, level, manufacturer, onChange, mode = 'sort', rowsProvider = null) {
  const sortKey = level === 'manufacturers' ? 'manufacturersSort' : 'itemsSort';
  const isFilter = level === 'items' && mode === 'filter';
  const currentItems = typeof rowsProvider === 'function' ? rowsProvider()
    : getInventoryItems().filter(item =>
      !manufacturer || manufacturerName(item) === manufacturer);
  const presence = [
    { value: STOCK_FILLED, label: 'Заполнено' },
    { value: STOCK_EMPTY, label: 'Не заполнено' },
  ];
  const presenceOptions = [{ value: '', label: 'Все' }, ...presence];
  const options = (label, extract) => [
    { value: '', label },
    ...presence,
    ...stockFilterOptions(currentItems, extract).map(value => ({ value, label: value })),
  ];
  const supplierValues = item => stockSupplierNames(item);
  let applied = { ...STOCK_VIEW.itemsFilters };
  let draft = { ...applied };
  const fields = isFilter ? [
    select({label:'Подкатегория', name:'inventoryType', value:draft.type,
      options:[...stockTypeOptions(manufacturer).slice(0, 1), ...presence,
        ...stockTypeOptions(manufacturer).slice(1)]}),
    select({label:'Категория', name:'inventoryFilterCategory', value:draft.category,
      options:options('Все категории', item=>item.category)}),
    select({label:'Группа', name:'inventoryFilterGroup', value:draft.group,
      options: [{ value: '', label: 'Все группы' }, ...classificationOptions().slice(1)] }),
    select({label:'Место хранения', name:'inventoryFilterLocation', value:draft.location,
      options:[{value:'',label:'Без ограничения'}, ...presence,
        ...getInventoryStorageLocations().filter(place => !place.archivedAt)
          .map(place => ({ value: place.locationId, label: place.name })),
        ...stockFilterOptions(currentItems, item => item.location)
          .filter(value => !getInventoryStorageLocations().some(place =>
            place.name === value || place.locationId === value))
          .map(value => ({ value, label: value }))]}),
    select({label:'Единица', name:'inventoryFilterUnit', value:draft.unit,
      options:options('Все единицы', item=>item.unit)}),
    select({label:'Использование', name:'inventoryFilterUsage', value:draft.usage, options:[
      {value:'',label:'Любое'}, {value:'consume',label:'Расход'},
      {value:'sale',label:'Продажа'}, {value:'both',label:'Расход и продажа'},
      {value:'track',label:'Только учёт'},
    ]}),
    select({label:'Поставщик', name:'inventoryFilterSupplier', value:draft.supplier,
      options:options('Все поставщики', supplierValues)}),
    select({label:'Наличие', name:'inventoryFilterAvailability', value:draft.availability, options:[
      {value:'',label:'Любое'}, {value:'zero',label:'Нет на складе'},
      {value:'positive',label:'Есть на складе'},
      {value:'minimum',label:'На минимуме / ниже'},
      {value:'target',label:'На цели / ниже'},
    ]}),
    select({label:'Цена', name:'inventoryFilterPrice', value:draft.price, options:[
      {value:'',label:'Все'}, {value:'known',label:'Заполнено'},
      {value:'missing',label:'Не заполнено'},
    ]}),
    select({label:'Тара', name:'inventoryFilterTare', value:draft.tare, options:[
      {value:'',label:'Все'}, {value:'known',label:'Заполнено'},
      {value:'missing',label:'Не заполнено'},
    ]}),
    select({label:'Наименование', name:'inventoryFilterName', value:draft.name, options:presenceOptions}),
    select({label:'Артикул', name:'inventoryFilterSku', value:draft.sku, options:presenceOptions}),
    select({label:'Штрихкод', name:'inventoryFilterBarcode', value:draft.barcode, options:presenceOptions}),
    select({label:'Порядковый №', name:'inventoryFilterPosition', value:draft.position, options:presenceOptions}),
    select({label:'Минимум', name:'inventoryFilterMinStock', value:draft.minStock, options:presenceOptions}),
    select({label:'Цель', name:'inventoryFilterTargetStock', value:draft.targetStock, options:presenceOptions}),
    select({label:'Упаковка', name:'inventoryFilterPackageQuantity', value:draft.packageQuantity, options:presenceOptions}),
    select({label:'Брутто, г', name:'inventoryFilterGrossWeight', value:draft.grossWeight, options:presenceOptions}),
  ].join('') : '';
  const content = '<div data-inventory-stock-controls>'
    + (mode !== 'filter' ? select({
      label:'Сортировка', name:'inventorySort',
      value:STOCK_VIEW[sortKey], options:stockSortOptions(level),
    }) : '')
    + (isFilter ? '<div class="form-grid">' + fields
      + '<div class="modal-actions" data-inventory-stock-filter-actions hidden>'
      + button('Применить', {data:'data-inventory-stock-filter-action'})
      + '</div></div>' : '')
    + '</div>';
  const modalRoot = mountModal(trigger, modal(content, {
    title:mode === 'filter' ? 'Фильтр' : 'Сортировка',
    variant:'x',
  }));
  modalRoot?.querySelector('input[name="inventorySort"]')?.addEventListener('change', event => {
    saveInventorySortMode(sortKey,event.target.value);
    onChange?.();
  });
  if (!isFilter || !modalRoot) return;
  const action = modalRoot.querySelector('[data-inventory-stock-filter-action]');
  const actions = modalRoot.querySelector('[data-inventory-stock-filter-actions]');
  const formKeys = Object.keys(emptyStockFilters());
  const inputName = key => key === 'type' ? 'inventoryType'
    : 'inventoryFilter' + key.charAt(0).toUpperCase() + key.slice(1);
  const readDraft = () => Object.fromEntries(formKeys.map(key => [
    key, String(modalRoot.querySelector('[name="' + inputName(key) + '"]')?.value ?? ''),
  ]));
  const syncAction = () => {
    const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
    const reset = !dirty && hasStockFilters(applied);
    actions.hidden = !dirty && !reset;
    action.textContent = dirty ? 'Применить' : 'Сбросить';
    action.classList.toggle('ui-button--secondary', reset);
  };
  const onInput = event => {
    if (!formKeys.some(key => event.target?.name === inputName(key))) return;
    draft = readDraft();
    syncAction();
  };
  modalRoot.addEventListener('change',onInput);
  modalRoot.addEventListener('input',onInput);
  action.addEventListener('click',() => {
    const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
    applied = dirty ? { ...draft } : emptyStockFilters();
    STOCK_VIEW.itemsFilters = { ...applied };
    STOCK_VIEW.itemsType = applied.type;
    onChange?.();
    modalRoot.v2Close?.();
  });
  syncAction();
}
function openManufacturerStock(root, manufacturer, groupContext = null) {
  // Each visit to a physical shelf opens in the explicit numerical order.
  // A remembered name/price filter must not silently replace shelf sequence.
  saveInventorySortMode('itemsSort', 'position-asc');
  STOCK_VIEW.itemsType = '';
  STOCK_VIEW.itemsFilters = emptyStockFilters();
  const rowsProvider = groupContext
    ? () => buildStockCatalogGroups(
      groupContext.itemsForView?.() || getInventoryItems(),groupContext.criteria)
      .find(entry => entry.name === manufacturer)?.items || []
    : null;
  const expandedStockGroups = new Map();
  // One selection drives both actions; no separate stock mutation owner.
  const selectedStockItems = new Set();
  const desktop=inventoryDesktop(root);
  const markup = `
    ${context(manufacturer, {
      v: desktop?null:{ data: 'data-inventory-company-v', aria: 'Фильтр и сортировка позиций' },
      c: desktop?null:{ label: '+', data: 'data-inventory-add-item', aria: 'Добавить позицию' },
    })}
    <div data-stock-selected-actions hidden>
      <p class="ui-list__secondary">Выбрано: <strong data-stock-selected-count>0</strong></p>
      ${actionBlock(
        button('Действия', { data: 'data-stock-selected-action' }) +
        button('Удалить', { variant: 'delete-outline', data: 'data-stock-selected-delete' })
      )}
    </div>
    <div data-inventory-company-list>${stockListMarkup(manufacturer, '', rowsProvider, expandedStockGroups, selectedStockItems, false, desktop)}</div>`;
  const layer = mountV2ZLayer(root, v2ZLayer(markup, { className: 'inventory-manufacturer-z' }), { stack: true });
  if (!layer) return;
  const searchRow = desktop?inventoryDesktopHeader(layer,manufacturer,stockSearchField('', 'data-inventory-company-search'),[
    {kind:'filter',data:'data-inventory-company-filter',aria:'Фильтр'},
    {kind:'sort',data:'data-inventory-company-sort',aria:'Сортировка'},
    {label:'+',className:'v2-desktop-tool-primary',data:'data-inventory-add-item',aria:'Добавить позицию'},
  ]):setV2ZHeaderRows(layer, [stockSearchField('', 'data-inventory-company-search')])[0];
  const searchInput = searchRow?.querySelector('[data-inventory-company-search]') || null;

  const listHost = layer.querySelector('[data-inventory-company-list]');
  const selectionActions = layer.querySelector('[data-stock-selected-actions]');
  const selectedCount = layer.querySelector('[data-stock-selected-count]');
  const syncGroupChecks = () => {
    // Parent categories include all nested types. Partial selections
    // remain distinct from fully selected groups.
    listHost?.querySelectorAll('[data-stock-group-check]').forEach(check => {
      const rows = [...(check.closest('.inventory-editor-panel')
        ?.querySelectorAll('[data-stock-item-check]') || [])];
      const chosen = rows.filter(row => selectedStockItems.has(String(row.dataset.stockItemCheck))).length;
      check.checked = rows.length > 0 && chosen === rows.length;
      check.indeterminate = chosen > 0 && chosen < rows.length;
    });
  };
  const syncSelected = () => {
    for (const id of selectedStockItems) if (!getInventoryItem(id)) selectedStockItems.delete(id);
    if (selectionActions) selectionActions.hidden = !selectedStockItems.size;
    if (selectedCount) selectedCount.textContent = String(selectedStockItems.size);
  };
  const deleteSelected = () => {
    const chosen = [...selectedStockItems].map(id => getInventoryItem(id)).filter(Boolean);
    const safe = chosen.filter(item =>
      Math.abs(Number(item.balance) || 0) < 0.000001 &&
      !(item.locationBalances || []).some(row => Math.abs(Number(row.balance) || 0) > 0.000001) &&
      !((Number(item.containerCount) || 0) > 0) &&
      !(item.locationContainerCounts || []).some(row => Number(row.containers) !== 0));
    const skipped = chosen.length - safe.length;
    if (!safe.length)
      return openNotice({ title: 'Удаление', message:
        'У выбранных товаров есть остатки. Сначала оформите перемещение или списание в «Движениях».' });
    const dialog = mountModal(document.body, modal(
      '<p>Удалить ' + safe.length + ' позиций из «Остатков»?' +
      (skipped ? ' · С остатками останутся: ' + skipped + '.' : '') +
      ' Прайсы контрагентов и история сохраняются.</p>' +
      '<p class="form-error" role="alert" data-stock-bulk-delete-error></p>' +
      actionBlock(button('Удалить · ' + safe.length, {
        variant: 'delete-outline', data: 'data-stock-bulk-delete-confirm',
      }) + button('Отмена', {
        variant: 'secondary', data: 'data-stock-bulk-delete-cancel',
      })), { title: 'Удаление выбранных', variant: 'x', xRole: 'action', surface: 'app' },
    ));
    if (!dialog) return;
    dialog.querySelector('[data-stock-bulk-delete-cancel]')?.addEventListener('click', () => dialog.v2Close?.());
    let saving = false;
    dialog.querySelector('[data-stock-bulk-delete-confirm]')?.addEventListener('click', async event => {
      if (saving) return;
      saving = true;
      const submit = event.currentTarget;
      submit.disabled = true;
      try {
        await archiveSelectedInventoryItems(safe.map(item => item.itemId));
        safe.forEach(item => selectedStockItems.delete(item.itemId));
        dialog.v2Close?.();
        renderList();
        openNotice({ title: 'Остатки', message: 'Удалено позиций: ' + safe.length +
          (skipped ? '. Не удалены позиции с остатками: ' + skipped + '.' : '.') });
      } catch (cause) {
        const error = dialog.querySelector('[data-stock-bulk-delete-error]');
        if (error) error.textContent = cause instanceof Error ? cause.message
          : 'Не удалось удалить выбранные позиции.';
        submit.disabled = false;
        saving = false;
      }
    });
  };
  layer.querySelector('[data-stock-selected-action]')?.addEventListener('click', () => {
    const ids = [...selectedStockItems].filter(id => Boolean(getInventoryItem(id)));
    if (!ids.length) return;
    const options = [
      { value: '', label: 'Выберите действие' },
      { value: 'edit', label: 'Изменить данные' },
      { value: 'audit', label: 'Инвентаризация остатков' },
      { value: 'transfer', label: 'Переместить' },
      { value: 'order', label: 'Создать заказ' },
    ];
    // One short X choice, then a persistent Q for exactly these item IDs.
    const chooser = mountModal(document.body, modal(
      '<div class="modal-title"><h2>Действия</h2></div>' +
      select({ label: '', name: 'stockSelectedActionPicker', value: '', options }) +
      '<p class="ui-list__secondary">Выбрано позиций: ' + ids.length + '</p>',
      { title: 'Действия', variant: 'x', xRole: 'picker', surface: 'app' },
    ));
    if (!chooser) return;
    const openWorkspace = initialAction => {
      const choice = mountModal(document.body, modal(
        '<div data-stock-bulk-workspace></div>',
        { title: 'Действия', variant: 'q', surface: 'app' },
      ));
      if (!choice) return;
      const body = choice.querySelector('[data-v2-q-body]');
      const header = choice.querySelector('[data-v2-q-header-content]');
      if (!body || !header) { choice.v2Close?.(); return; }
      const showSelection = (message = '') => {
        const selectedItems = ids.map(id => getInventoryItem(id)).filter(Boolean);
        body.innerHTML =
          '<p class="ui-list__secondary">Выбрано позиций: ' + selectedItems.length + '</p>' +
          (message ? '<p role="status" class="ui-list__secondary">' + escapeHtml(message) + '</p>' : '') +
          list({
            className: 'ui-list--dense',
            items: selectedItems.map(item => ({ title: inventoryAuditItemLabel(item) })),
          });
      };
      header.innerHTML = select({
        label: '', name: 'stockSelectedAction', value: initialAction, options,
      });
      const changeAction = action => {
        if (!choice.isConnected) return;
        if (action === 'edit' || action === 'audit') {
          openInventoryAuditCriteria(choice, {
            mode: action === 'edit' ? 'data' : 'stock',
            ids, onSaved: renderList, keepOpen: true, existingLayer: choice,
          });
        } else if (action === 'transfer') {
          openInventoryTransfer(() => {
            renderList();
            showSelection('Перемещение выполнено.');
          }, {
            selectedItemIds: ids,
            fromLocationId: STOCK_VIEW.storageScope === INVENTORY_TOTAL_SCOPE
              ? '' : STOCK_VIEW.storageScope,
            existingLayer: choice,
          });
        } else if (action === 'order') {
          // Order creation is a separate, persisted multi-step transaction.
          // The selected positions remain available in the parent Q.
          showSelection();
          openInventoryOrderFromSelection(choice, ids, () => {
            renderList();
            showSelection('Заказ сформирован.');
          });
        } else showSelection();
      };
      header.addEventListener('change', event => {
        if (event.target?.name === 'stockSelectedAction')
          changeAction(String(event.target.value || ''));
      });
      changeAction(initialAction);
    };
    chooser.querySelector('[name="stockSelectedActionPicker"]')?.addEventListener('change', event => {
      const action = String(event.target.value || '');
      if (!action) return;
      chooser.v2Close?.();
      openWorkspace(action);
    });
  });
  layer.querySelector('[data-stock-selected-delete]')?.addEventListener('click', deleteSelected);
  let disposeCategoryReorder = () => {};
  let disposeCategoryPreview = () => {};
  const renderList = () => {
    syncSelected();
    disposeCategoryPreview();
    disposeCategoryReorder();
    const query = searchInput?.value || '';
    const criteria = inventoryCriterionGroups();
    const nestedCriteria = stockNestedCriteria(criteria);
    const allRows = rowsProvider?.() || getInventoryItems().filter(item=>manufacturerName(item)===manufacturer);
    const topNodes = sortedStockChildren(stockGroupTree(allRows,nestedCriteria),nestedCriteria);
    const reorderGroup = topNodes.length > 1 &&
      topNodes.every(node=>node.group.id===topNodes[0].group.id)
      ? topNodes[0].group : null;
    const allowCategoryReorder = !query.trim() && !hasStockFilters(STOCK_VIEW.itemsFilters)
      && STOCK_VIEW.itemsSort==='position-asc' && Boolean(reorderGroup);
    if (listHost) listHost.innerHTML = stockListMarkup(
      manufacturer, query, rowsProvider, expandedStockGroups, selectedStockItems,
      allowCategoryReorder, desktop);
    listHost?.querySelectorAll('[data-stock-item-check]').forEach(check=>
      check.addEventListener('change',()=>{
        const id=String(check.dataset.stockItemCheck);
        if(check.checked)selectedStockItems.add(id);
        else selectedStockItems.delete(id);
        syncSelected();
        syncGroupChecks();
      }));
    listHost?.querySelectorAll('[data-stock-group-check]').forEach(check =>
      check.addEventListener('change', () => {
        const rows = check.closest('.inventory-editor-panel')
          ?.querySelectorAll('[data-stock-item-check]') || [];
        rows.forEach(row => {
          const id = String(row.dataset.stockItemCheck);
          if (check.checked) selectedStockItems.add(id);
          else selectedStockItems.delete(id);
          row.checked = check.checked;
        });
        syncSelected();
        syncGroupChecks();
      }));
    syncGroupChecks();
    if (allowCategoryReorder && listHost) {
      disposeCategoryReorder=initV2ListReorder(listHost,{
        selector:'[data-stock-category][data-reorder-id]',
        onReorder:async draggedIds=>{
          // The view may hide categories belonging to other manufacturers.
          // Persist the COMPLETE catalog sequence with hidden IDs unchanged.
          const group=inventoryCriterionGroups().find(entry=>entry.id===reorderGroup.id);
          if (!group) throw new Error('Группа категорий изменилась. Откройте список заново.');
          const all=group.values.map(entry=>entry.id);
          const visible=new Set(draggedIds);
          if (visible.size!==draggedIds.length
            || draggedIds.some(id=>!all.includes(id)))
            throw new Error('Порядок категорий изменился. Откройте список заново.');
          let index=0;
          const merged=all.map(id=>visible.has(id)?draggedIds[index++]:id);
          await reorderInventoryCriterionValues(group.id,merged);
          renderList();
        },
        onError:error=>{
          const problem=document.createElement('div');
          problem.className='form-error';
          problem.textContent=error instanceof Error
            ? error.message : 'Порядок групп не сохранился.';
          listHost.prepend(problem);
        },
      });
      disposeCategoryPreview=initStockCategoryDragPreview(
        listHost.querySelector('.inventory-stock-category-sequence'));
    }
    bindInventoryTableRows(listHost,'[data-inventory-item]',control=>{
      const itemId=control.dataset.inventoryItem;
      openInventoryProductOverview(itemId,{
        stockScope:STOCK_VIEW.storageScope,
        edit:(onSaved,scope)=>openItemEditor(root,itemId,{},onSaved,scope),
        onChanged:renderList,
      });
    });
    // Only an intentional summary click changes the remembered state.
    // Native initial <details open> toggle events must not override the
    // default rule when a formerly single group later gains siblings.
    listHost?.querySelectorAll('[data-stock-disclosure]').forEach(details =>
      details.querySelector(':scope > summary')?.addEventListener('click', () => {
        if (!details.isConnected || (searchInput?.value || '').trim()) return;
        expandedStockGroups.set(details.dataset.stockDisclosure, !details.open);
      }));
  };

  searchInput?.addEventListener('input', renderList);
  layer.querySelector('[data-inventory-company-v]')?.addEventListener('click', () => {
    openSharedProfileSettingsMenu({
      title: 'Складские позиции',
      actions: [
        { id: 'filter', label: 'Фильтр', onSelect: () =>
          openStockControls(document.body, 'items', manufacturer, renderList, 'filter', rowsProvider) },
        { id: 'sort', label: 'Сортировка', onSelect: () =>
          openStockControls(document.body, 'items', manufacturer, renderList, 'sort', rowsProvider) },
      ],
    });
  });
  searchRow?.querySelector('[data-inventory-company-filter]')?.addEventListener('click',event=>openStockControls(event.currentTarget,'items',manufacturer,renderList,'filter',rowsProvider));
  searchRow?.querySelector('[data-inventory-company-sort]')?.addEventListener('click',event=>openStockControls(event.currentTarget,'items',manufacturer,renderList,'sort',rowsProvider));
  (searchRow?.querySelector('[data-inventory-add-item]')||layer.querySelector('[data-inventory-add-item]'))?.addEventListener('click', () => {
    const first=groupContext?.criteria?.[0];
    const value=first?.values?.find(entry=>entry.name===manufacturer);
    const defaults=first?.legacyField
      ? { [first.legacyField]:value?.name || '' }
      : first && value ? { criteriaValues:{[first.id]:value.id} }
      : { manufacturer:manufacturer===EMPTY_MANUFACTURER?'':manufacturer };
    openStockCreateOptions(root,renderList,defaults);
  });
  renderList();
  notifyContext();
}

function movementJournalMarkup() {
  const movements = getInventoryMovements();
  if (!movements.length) return emptyState('Движений пока нет', 'Добавьте операцию через +.');
  return v2ListEntries(movements.map(movement => v2ListEntry({
    title: movementTitle(movement),
    subtitle: movementSubtitle(movement) || `${(movement.lines || []).length} поз.`,
    rightTop: movementMoment(movement.occurredAt),
    initial: '',
    data: `data-inventory-movement="${escapeHtml(movement.movementId)}"`,
    aria: `Открыть движение ${movementTitle(movement)}`,
  })));
}

function openMovementDetails(root, movementId) {
  const movement = getInventoryMovement(movementId);
  if (!movement) return;
  // The journal is the V2 list. An opened movement is a detail card, never a second list.
  const lines = details((movement.lines || []).map(line => ({
    left: [line.name || getInventoryItem(line.itemId)?.name || 'Позиция',
      ['TRANSFER', 'SUPPLIER_RETURN'].includes(movement.kind) ? storageName(inventoryLocations().find(
        place => place.locationId === (line.storageLocationId || 'primary'))) : ''].filter(Boolean).join(' · '),
    right: `${movementSign(line)}${numberText(line.quantity)} ${line.unit || getInventoryItem(line.itemId)?.unit || ''}`,
  })), { variant: 'split' });
  const physicalAudit = movement.kind === 'ADJUSTMENT' &&
    movement.lines?.some(line => line.actualContainerCount != null);
  const markup = `<div class="form-grid">
    ${movementMoment(movement.occurredAt) ? `<p>${escapeHtml(movementMoment(movement.occurredAt))}</p>` : ''}
    ${movement.personUei ? `<p>${escapeHtml(movement.personUei)}</p>` : ''}
    ${movementSubtitle(movement) ? `<p>${escapeHtml(movementSubtitle(movement))}</p>` : ''}
    ${lines}
    ${physicalAudit || ['TRANSFER', 'SUPPLIER_RETURN'].includes(movement.kind)
      || movement.sourceType === 'inventory-purchase-order'
      ? '' : actionBlock(button('Исправить', { data: 'data-inventory-movement-correct' }))}
  </div>`;
  const layer = mountModal(root, modal(markup, { title: movementTitle(movement), variant: 'q' }));
  layer?.querySelector('[data-inventory-movement-correct]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openMovementEditor(root, movementId);
  });
}

function inventoryAuditScope({ manufacturer = '' } = {}) {
  // Z2 search and filters never restrict the independent Q1 stocktake list.
  return getInventoryItems().filter(item =>
    !manufacturer || manufacturerName(item) === manufacturer
  ).sort(inventoryPositionComparator).map(item => item.itemId);
}

function inventoryAuditItems(ids) {
  const byId = new Map(getInventoryItems().map(item => [item.itemId, item]));
  return ids.map(id => byId.get(id)).filter(Boolean).sort(inventoryPositionComparator);
}

function inventoryAuditItemLabel(item, includeManufacturer = false) {
  // Numbering is editable data, never part of a product's displayed name.
  return includeManufacturer
    ? `${manufacturerName(item)} · ${item.name}`
    : String(item.name || 'Позиция');
}

function inventoryAuditFilters(items, manufacturer = '') {
  const definitions = [
    ['manufacturer', 'Производитель'],
    ['productType', 'Подкатегория'],
    ['category', 'Категория'],
    ['supplier', 'Поставщик'],
    ['unit', 'Единица'],
  ];
  return definitions.filter(([key]) => key !== 'manufacturer' || !manufacturer).map(([key, label]) => {
    const options = [...new Set(items.map(item => String(item[key] ?? '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' }));
    return { key, label, options: [{ value: '', label: 'Все' }, ...options.map(value => ({ value, label: value }))] };
  }).filter(filter => filter.options.length > 2);
}

function openInventoryAuditSelection(root, { manufacturer = '', onSaved = () => {} } = {}) {
  const ids = [...new Set(inventoryAuditScope({ manufacturer }))];
  if (!ids.length) {
    openNotice({ title: 'Инвентаризация', message: 'В текущей выборке нет позиций.' });
    return null;
  }
  const availableFilters = inventoryAuditFilters(inventoryAuditItems(ids), manufacturer);
  const filterValues = Object.fromEntries(availableFilters.map(({ key }) => [key, '']));
  const markup = `${workspaceHeaderContext({
    title: 'Инвентаризация',
    v: { data: 'data-inventory-audit-v', aria: 'Фильтры инвентаризации' },
  })}<div class="form-grid" data-inventory-audit-selection>
    ${select({ label: '', name: 'auditKind', value: 'stock', options: [
      { value: 'stock', label: 'Остатки' },
      { value: 'data', label: 'Данные' },
    ] })}
    <div data-inventory-audit-data-settings hidden>
      ${twoColumnLayout(
        select({ label: 'Что изменить', name: 'auditField', value: 'category',
          options: INVENTORY_AUDIT_EDIT_FIELDS.map(({ value, label }) => ({ value, label })) }),
        `<div class="inventory-audit-value-cell">
          <div class="inventory-audit-value-heading"><span>На что изменить</span><span>Всем</span></div>
          <div class="inventory-audit-value-line">
            <div data-inventory-audit-common-value></div>
            <div class="inventory-audit-common-check">
              ${compactCheck({ label: '', data: 'data-inventory-audit-apply-all',
                aria: 'Применить одно значение ко всем выбранным' })}
            </div>
          </div>
        </div>`,
        { ariaLabel: 'Какие данные и на что изменить' },
      )}
    </div>
    ${compactCheck({ label: 'Выбрать все показанные', data: 'data-inventory-audit-all' })}
    <p data-inventory-audit-count>Выбрано 0 из ${ids.length}</p>
    <div data-inventory-audit-list></div>
    <p class="form-error" role="status" data-inventory-audit-status></p>
    ${actionBlock(button('Продолжить', { data: 'data-inventory-audit-next' }))}
  </div>`;
  // Q header owns search; V remains in the existing shared workspace context.
  const layer = mountModal(root, modal(markup, { variant: 'q' }));
  if (!layer) return null;
  const header = layer.querySelector('[data-v2-q-header-content]');
  if (header) header.innerHTML = stockSearchField('', 'data-inventory-audit-search');
  const search = layer.querySelector('[data-inventory-audit-search]');
  const list = layer.querySelector('[data-inventory-audit-list]');
  const all = layer.querySelector('[data-inventory-audit-all]');
  const count = layer.querySelector('[data-inventory-audit-count]');
  const next = layer.querySelector('[data-inventory-audit-next]');
  const kindSelector = layer.querySelector('[name="auditKind"]');
  const fieldSelector = layer.querySelector('[name="auditField"]');
  const settings = layer.querySelector('[data-inventory-audit-data-settings]');
  const checkbox = layer.querySelector('[data-inventory-audit-apply-all]');
  const valueHost = layer.querySelector('[data-inventory-audit-common-value]');
  const status = layer.querySelector('[data-inventory-audit-status]');
  const selected = new Set();
  let visible = [];
  let busy = false;

  const isData = () => kindSelector?.value === 'data';
  const isCommon = () => isData() && Boolean(checkbox?.checked);
  const sync = () => {
    if (count) count.textContent = `Выбрано ${selected.size} из ${ids.length}`;
    if (next) {
      next.disabled = busy || !selected.size;
      next.textContent = `Продолжить · ${selected.size}`;
    }
    if (all) {
      all.checked = visible.length > 0 && visible.every(id => selected.has(id));
      all.disabled = busy || !visible.length;
    }
  };
  const render = () => {
    const needle = normalizedSearch(search?.value);
    const items = inventoryAuditItems(ids).filter(item =>
      (!needle || `${manufacturerName(item)} ${itemSearchText(item)}`.toLocaleLowerCase('ru-RU').includes(needle))
      && availableFilters.every(({ key }) => !filterValues[key] || String(item[key] ?? '').trim() === filterValues[key]))
      .sort(inventoryPositionComparator);
    visible = items.map(item => item.itemId);
    if (list) list.innerHTML = items.length
      ? items.map(item => compactCheck({
        label: inventoryAuditItemLabel(item, !manufacturer),
        checked: selected.has(item.itemId),
        data: `data-inventory-audit-item="${escapeHtml(item.itemId)}"`,
      })).join('')
      : emptyState('Ничего не найдено', 'Измените поиск.');
    sync();
  };
  const syncValue = () => {
    if (!valueHost) return;
    const enabled = isCommon();
    valueHost.querySelectorAll('input, button').forEach(control => {
      control.disabled = !enabled;
    });
    sync();
  };
  const renderValue = () => {
    const definition = inventoryAuditFieldDefinition(fieldSelector?.value);
    if (!definition || !valueHost) return;
    valueHost.innerHTML = inventoryAuditDataControl(definition, 'auditValue');
    syncValue();
    if (status) status.textContent = '';
  };
  const syncKind = () => {
    if (settings) settings.hidden = !isData();
    syncValue();
    if (status) status.textContent = '';
  };
  kindSelector?.addEventListener('change', syncKind);
  fieldSelector?.addEventListener('change', renderValue);
  checkbox?.addEventListener('change', syncValue);
  list?.addEventListener('change', event => {
    const input = event.target.closest?.('[data-inventory-audit-item]');
    if (!input || busy) return;
    if (input.checked) selected.add(input.dataset.inventoryAuditItem);
    else selected.delete(input.dataset.inventoryAuditItem);
    sync();
  });
  all?.addEventListener('change', () => {
    if (busy) return;
    visible.forEach(id => all.checked ? selected.add(id) : selected.delete(id));
    render();
  });
  search?.addEventListener('input', render);
  function openAuditFilter() {
    openInventoryItemFilters(layer, availableFilters, filterValues, render);
  }
  layer.querySelector('[data-inventory-audit-v]')?.addEventListener('click', () => {
    openSharedProfileSettingsMenu({
      title: 'Инвентаризация',
      actions: [{ id: 'filter', label: 'Фильтр', onSelect: openAuditFilter }],
    });
  });
  next?.addEventListener('click', async () => {
    if (busy || !selected.size) return;
    const dataMode = isData();
    const common = isCommon();
    const initialCommonValue = common
      ? String(valueHost?.querySelector('[name="auditValue"]')?.value ?? '').trim()
      : '';
    openInventoryAuditCriteria(layer, {
      mode: dataMode ? 'data' : 'stock',
      ids: [...selected],
      fieldName: fieldSelector?.value || 'category',
      ...(dataMode ? { keepOpen: true, initialCommon: common, initialCommonValue } : {}),
      onSaved: () => {
        if (!dataMode) {
          layer.v2Close?.();
          onSaved();
          return;
        }
        // A completed data operation refreshes Q1, but never closes its Q2 editor.
        selected.clear();
        render();
        onSaved();
      },
    });
  });
  renderValue();
  syncKind();
  render();
  notifyContext();
  return layer;
}


function inventoryAuditInput(item, index) {
  const previous = isWeighedInventoryItem(item)
    ? `${item.containerCount == null ? '— тюб.' : `${numberText(item.containerCount)} тюб.`} · ${numberText(item.balance)} ${item.unit}`
    : `${numberText(item.balance)} ${item.unit}`;
  // One existing Shared compactCheck in the title line; no new button variant.
  const heading = `<div class="field-inline-label" data-inventory-audit-heading="${index}">
    ${compactCheck({ label: '', checked: true, data: `data-inventory-audit-include="${index}"`,
      aria: `Учитывать при инвентаризации: ${inventoryAuditItemLabel(item)}` })}
    <strong title="${escapeHtml(inventoryAuditItemLabel(item))}">${escapeHtml(inventoryAuditItemLabel(item))}</strong>
    <span data-inventory-audit-result="${index}" data-inventory-audit-previous="${escapeHtml(previous)}">${escapeHtml(previous)}</span>
  </div>`;
  if (isWeighedInventoryItem(item)) {
    return `<section data-inventory-audit-row="${index}">
      ${heading}
      <div data-inventory-audit-fields>
      ${twoColumnLayout(
        field({ label: '', placeholder: 'Тюбиков, шт.', name: `auditTubes-${index}`, type: 'number', min: '0',
          step: '1', inputmode: 'numeric' }),
        field({ label: '', placeholder: 'Общий вес, г', name: `auditGross-${index}`, type: 'number', min: '0',
          step: '0.001', inputmode: 'decimal' }),
        { ariaLabel: `Количество и вес: ${item.name}` },
      )}
      </div>
    </section>`;
  }
  return `<section data-inventory-audit-row="${index}">
    ${heading}
    <div data-inventory-audit-fields>
    ${field({ label: '', placeholder: `Фактически, ${item.unit}`, name: `auditActual-${index}`,
      type: 'number', min: '0', step: '0.001', inputmode: 'decimal' })}
    </div>
  </section>`;
}
function inventoryAuditMeasure(item, index, data) {
  if (isWeighedInventoryItem(item)) {
    const tubeText = String(data.get(`auditTubes-${index}`) ?? '').trim();
    const grossText = String(data.get(`auditGross-${index}`) ?? '').trim();
    if (!tubeText && !grossText) return null;
    const tubes = tubeText ? Number(tubeText.replace(',', '.')) : NaN;
    const gross = grossText ? Number(grossText.replace(',', '.')) : NaN;
    // Either zero field means an empty shelf: zero tubes and zero gross grams.
    // A nonzero companion is a conflict, never a silent stock adjustment.
    if ((tubeText && tubes === 0) || (grossText && gross === 0)) {
      if ((tubeText && tubes !== 0) || (grossText && gross !== 0))
        throw new Error('Ноль тюбиков и ненулевой вес несовместимы.');
      return { actual: 0, containers: 0, note: 'Тюбиков: 0; общий вес: 0 г' };
    }
    if (!tubeText || !grossText) throw new Error('Укажите тюбики и общий вес.');
    const actual = netStocktakeGrams({ gross, containers: tubes, tareWeight: item.tareWeight });
    const capacity = Number(item.packageQuantity);
    if (Number.isFinite(capacity) && capacity > 0 && actual > tubes * capacity + 0.001)
      throw new Error('Масса красителя превышает вместимость выбранных тюбиков.');
    return {
      actual,
      containers: tubes,
      note: `Тюбиков: ${tubes}; общий вес: ${numberText(gross)} г; тара/шт.: ${numberText(item.tareWeight)} г`,
    };
  }
  const raw = String(data.get(`auditActual-${index}`) ?? '').trim();
  if (!raw) return null;
  const actual = Number(raw.replace(',', '.'));
  if (!Number.isFinite(actual) || actual < 0) throw new Error('Проверьте фактическое количество.');
  return { actual, note: '' };
}


const INVENTORY_AUDIT_EDIT_FIELDS = [
  { value: 'category', label: 'Категория', kind: 'criterion' },
  { value: 'productType', label: 'Подкатегория', kind: 'criterion' },
  { value: 'name', label: 'Наименование', kind: 'text' },
  { value: 'manufacturer', label: 'Производитель', kind: 'criterion' },
  { value: 'position', label: 'Порядковый номер', kind: 'integer' },
  { value: 'sku', label: 'Артикул', kind: 'text' },
  { value: 'barcode', label: 'Штрихкод', kind: 'text' },
  { value: 'supplier', label: 'Поставщик', kind: 'association' },
  { value: 'referencePrice', label: 'Цена', kind: 'decimal' },
  { value: 'unit', label: 'Единица', kind: 'unit' },
  { value: 'packageQuantity', label: 'Упаковка', kind: 'decimal' },
  { value: 'grossWeight', label: 'Брутто, г', kind: 'decimal' },
  { value: 'tareWeight', label: 'Тара, г', kind: 'decimal' },
  { value: 'minStock', label: 'Срочно при (тюб./шт.)', kind: 'decimal' },
  { value: 'targetStock', label: 'Цель (тюб./шт.)', kind: 'decimal' },
  { value: 'usage', label: 'Использование', kind: 'usage' },
];
const INVENTORY_AUDIT_USAGE = [
  { value: 'consume', label: 'Расход' },
  { value: 'sale', label: 'Продажа' },
  { value: 'both', label: 'Расход и продажа' },
  { value: 'track', label: 'Только учёт' },
];

function inventoryAuditFieldDefinition(key) {
  return INVENTORY_AUDIT_EDIT_FIELDS.find(option => option.value === key) || null;
}

function inventoryAuditCurrentValue(item, definition) {
  if (definition.value === 'usage') return itemUsageMode(item);
  if (definition.value === 'referencePrice') return supplierPurchase(item).value;
  if (definition.value === 'minStock' || definition.value === 'targetStock')
    return inventoryStockThresholdInput(item, item[definition.value]);
  return item[definition.value];
}

function inventoryAuditCanClear(definition) { return !['name', 'unit', 'usage'].includes(definition.value); }

function inventoryAuditDataControl(definition, name, { shared = false, locked = false, value = '', placeholder = '' } = {}) {
  const label = shared
    ? definition.value === 'position' ? 'Начальный номер (дальше по порядку)' : 'Новое значение'
    : '';
  if (locked) return field({ label, name, value: String(value ?? ''), placeholder: 'Цена от поставщика', disabled: true });
  if (definition.kind === 'criterion') {
    // Same existing dropdown as the product card: choose a catalogued value,
    // never create a new category/manufacturer by typing in bulk editor.
    const group = inventoryCriterionGroups().find(row => row.legacyField === definition.value);
    const current = String(value ?? '');
    return select({
      label, name, value: current, aria: definition.label,
      options: group ? criterionOptions(group, current) : [{ value: '', label: 'Не указано' }],
    });
  }
  if (!shared && definition.kind === 'text') return textareaField({
    label, name, value: String(value ?? ''), rows: 1, placeholder: 'Не указано',
  });
  if (definition.kind === 'unit' || definition.kind === 'usage') return select({
    label, name, value: String(value ?? ''),
    options: [{ value: '', label: shared ? 'Выберите значение' : 'Не указано' },
      ...(definition.kind === 'unit' ? UNIT_OPTIONS : INVENTORY_AUDIT_USAGE)],
  });
  const integer = definition.kind === 'integer';
  const decimal = definition.kind === 'decimal';
  return field({
    label, name, value: String(value ?? ''),
    placeholder: placeholder || (shared ? 'Введите значение' : 'Не указано'),
    type: integer || decimal ? 'number' : 'text',
    ...(integer ? { min: '1', max: '2147483647', step: '1', inputmode: 'numeric' } : {}),
    ...(decimal ? { min: '0', step: 'any', inputmode: 'decimal' } : {}),
    autocomplete: 'off',
  });
}

function inventoryAuditDataRow(item, index, definition, includeManufacturer = false, selected = false) {
  const name = String(item.name || 'Позиция');
  const current = inventoryAuditCurrentValue(item, definition);
  const locked = definition.value === 'referencePrice' && supplierPurchase(item).locked;
  return `<div class="data-edit-row inventory-audit-data-row" role="group" aria-label="${escapeHtml(definition.label + ': ' + name)}">
    ${compactCheck({ checked: selected, disabled: locked,
      data: `data-inventory-audit-selected="${index}"`,
      aria: `Выбрать ${definition.label}: ${name}` })}
    <span class="data-edit-row__name" title="${escapeHtml(name)}"><strong>${escapeHtml(name)}</strong></span>
    ${inventoryAuditDataControl(definition, `auditItem-${index}`, {
      locked, value: definition.value === 'position' && Number(current) === 0 ? '' : current ?? '',
    })}
  </div>`;
}

function inventoryAuditParseDataValue(definition, raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null; // Empty input means leave that item unchanged.
  if (definition.kind === 'criterion') {
    const group = inventoryCriterionGroups().find(row => row.legacyField === definition.value);
    if (!group?.values?.some(entry => entry.name === value))
      throw new Error('Выберите существующее значение из списка «' + definition.label + '».');
    return value;
  }
  if (definition.kind === 'unit') {
    if (!UNIT_OPTIONS.some(option => option.value === value)) throw new Error('Выберите допустимую единицу.');
    return value;
  }
  if (definition.kind === 'usage') {
    if (!INVENTORY_AUDIT_USAGE.some(option => option.value === value)) throw new Error('Выберите способ использования.');
    return value;
  }
  if (definition.kind === 'integer' || definition.kind === 'decimal') {
    // Native number inputs already validate; Number additionally accepts 19, 20,
    // 21, 22 without the broken regex from the previous narrow implementation.
    const number = Number(value.replace(',', '.').replace(/\s/g, ''));
    if (!Number.isFinite(number) || number < 0
      || (definition.kind === 'integer' && (!Number.isSafeInteger(number) || number < 1 || number > 2147483647))) {
      throw new Error(definition.kind === 'integer'
        ? 'Укажите целый положительный порядковый номер от 1.'
        : 'Укажите корректное неотрицательное число.');
    }
    return number;
  }
  return value;
}

function inventoryAuditDataPayload(definition, value, item = {}) {
  if (definition.value === 'usage') return {
    canConsume: value === 'consume' || value === 'both',
    canSell: value === 'sale' || value === 'both',
  };
  if (definition.value === 'minStock' || definition.value === 'targetStock')
    return { [definition.value]: inventoryStockThresholdStored(item, value) };
  return { [definition.value]: value };
}

function inventoryAuditValueMatches(item, definition, expected) {
  if (!item) return false;
  const actual = inventoryAuditCurrentValue(item, definition);
  if (definition.kind === 'decimal' || definition.kind === 'integer') {
    if (expected == null) return actual == null || actual === '';
    return actual != null && Math.abs(Number(actual) - Number(expected)) < 0.00000001;
  }
  return String(actual ?? '') === String(expected);
}

async function applyInventoryAuditDataChanges(layer, { items, definition, perItem, data, status, submit, onSaved, clearAll = false, clearItems = new Set(), selectedIndices = null, keepOpen = false,
  afterApplied = () => {}, onProgress = () => {} }) {
  if (!definition) {
    status.textContent = 'Выберите характеристику.';
    return false;
  }
    if (!perItem && definition.value === 'referencePrice') {
      const locked = items.filter(item => supplierPurchase(item).locked);
      if (locked.length) {
        status.textContent = `У ${locked.length} позиций цена определяется основным поставщиком. Исключите их из выбора или измените цену у поставщика.`;
        return;
      }
    }
    const targets = [];
    const uniqueNumbers = new Set();
    let startingValue;
    try {
      if (!perItem) {
        if (clearAll) {
          if (!inventoryAuditCanClear(definition)) throw new Error('Эту характеристику нельзя очистить.');
          startingValue = definition.value === 'position' ? 'end'
            : definition.kind === 'decimal' ? null : '';
        } else {
          startingValue = inventoryAuditParseDataValue(definition, data.get('auditValue'));
          if (startingValue === null) throw new Error('Укажите новое значение.');
        }
        if (definition.value === 'position' && !clearAll
          && startingValue + items.length - 1 > 2147483647)
          throw new Error('Диапазон порядковых номеров слишком велик.');
      }
      for (const [index, item] of items.entries()) {
        if (perItem && selectedIndices && !selectedIndices.has(index)) continue;
        if (perItem && definition.value === 'referencePrice' && supplierPurchase(item).locked) continue;
        const raw = perItem ? String(data.get(`auditItem-${index}`) ?? '').trim() : '';
        const shouldClear = perItem && clearItems.has(index);
        if (perItem && !shouldClear &&
          (!raw || raw === String(inventoryAuditCurrentValue(item, definition) ?? '').trim())) continue;
        let value;
        if (!perItem) {
          value = definition.value === 'position' && !clearAll ? startingValue + index : startingValue;
        } else if (shouldClear) {
          if (!inventoryAuditCanClear(definition))
            throw new Error('Нельзя очистить «' + definition.label + '»: ' + item.name);
          value = definition.value === 'position' ? 'end'
            : definition.kind === 'decimal' ? null : '';
        } else {
          value = inventoryAuditParseDataValue(definition, raw);
        }
        if (definition.value === 'position' && value > 0) {
          const numberKey = `${String(item.manufacturer || '')}::${value}`;
          if (uniqueNumbers.has(numberKey))
            throw new Error(`Номер ${value} повторяется у производителя «${manufacturerName(item)}».`);
          uniqueNumbers.add(numberKey);
        }
        if (definition.value === 'minStock' || definition.value === 'targetStock') {
          inventoryStockThresholdStored(item, value); // fail before any writes if tube size is absent
        }
        // Use the persisted manufacturer ID/value, not its display fallback
        // ("Без производителя"), when planning manufacturer-local order.
        targets.push({ itemId: item.itemId, manufacturer: String(item.manufacturer || ''),
          name: item.name, value });
      }
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Проверьте данные.';
      return;
    }
    if (!targets.length) {
      status.textContent = 'Введите значения хотя бы для одной позиции.';
      return;
    }
    // A blank number means moving the item to the tail, never writing zero.
    const clearingPositions = definition.value === 'position'
      && (clearAll || clearItems.size > 0);
    const changes = targets.filter(entry =>
      clearingPositions
        || !inventoryAuditValueMatches(getInventoryItem(entry.itemId), definition, entry.value));
    if (!changes.length) {
      if (clearAll || clearItems.size) {
        // An explicit clear is complete even when those fields were empty already.
        if (keepOpen) afterApplied();
        else layer.v2Close?.();
        status.textContent = clearingPositions ? 'Позиции уже в конце списка.' : 'Значения уже очищены.';
        return true;
      }
      status.textContent = 'У выбранных позиций уже указаны эти значения.';
      return;
    }
    submit.disabled = true;
    const failed = new Map();
    onProgress(0, changes.length);
    try {
      if (definition.value === 'position') {
        // Compute all final manufacturer orders BEFORE saving anything.
        // One Core transaction commits the entire multi-selection, including
        // selected rows from several manufacturers; no partial writes.
        const groups=new Map();
        for (const entry of changes) {
          if (!groups.has(entry.manufacturer)) groups.set(entry.manufacturer, []);
          groups.get(entry.manufacturer).push(entry);
        }
        const plans=[...groups].map(([manufacturer,entries])=>({
          entries,
          plan:clearingPositions
            ? planInventoryMoveToEnd(getInventoryItems(),manufacturer,
              entries.map(entry=>entry.itemId))
            : planInventoryPositionReorder(getInventoryItems(),entries.map(entry=>({
              itemId:entry.itemId,manufacturer,value:entry.value,
            }))),
        }));
        if (plans.some(({plan})=>!plan))
          throw new Error('Невозможно определить порядковые номера. Обновите склад ' +
            'и укажите номера в пределах списка каждого производителя.');
        await reorderInventoryItemsBatch(plans.map(({plan})=>plan));
        onProgress(changes.length,changes.length);
        if (clearingPositions) {
          for (const {entries,plan} of plans) {
            const current=getInventoryItems()
              .filter(item=>String(item.manufacturer||'')===plan.manufacturer)
              .sort(inventoryPositionComparator);
            const actual=current.slice(-entries.length).map(item=>String(item.itemId));
            const expected=plan.itemIds.slice(-entries.length);
            if (actual.length!==expected.length ||
              actual.some((id,index)=>id!==expected[index]))
              throw new Error('Перемещение в конец не подтверждено сервером.');
          }
        }
      } else {
        // Canonical Core batch update keeps every selected item in one
        // transaction per 100 entries. Only one inventory read verifies the
        // resulting values, not one entire snapshot per product.
        for (let index = 0; index < changes.length; index += 100) {
          const batch = changes.slice(index, index + 100);
          try {
            await updateInventoryItemsBatch(batch.map(entry => ({
              itemId: entry.itemId,
              patch: inventoryAuditDataPayload(definition, entry.value, getInventoryItem(entry.itemId)),
            })));
          } catch (error) {
            const reason = error instanceof Error ? error.message : 'Ошибка сохранения';
            batch.forEach(entry => failed.set(entry.itemId, reason));
          }
          onProgress(Math.min(index + 100, changes.length), changes.length);
        }
        if (failed.size < changes.length) await loadInventory();
      }
      const unresolved = changes.filter(entry => clearingPositions
        ? !(Number(getInventoryItem(entry.itemId)?.position) > 0)
        : !inventoryAuditValueMatches(getInventoryItem(entry.itemId), definition, entry.value));
      if (unresolved.length || failed.size) {
        const examples = unresolved.slice(0, 2).map(entry => entry.name).join(', ');
        const detail = [...failed.values()][0];
        status.textContent = `Изменено ${changes.length - unresolved.length} из ${changes.length}. Не подтверждено: ${unresolved.length}.`
          + (examples ? ` ${examples}.` : '') + (detail ? ` ${detail}` : '');
        return;
      }
      if (keepOpen) {
        onSaved();
        afterApplied();
        status.textContent = `Изменено ${changes.length} позиций.`;
      } else {
        layer.v2Close?.();
        onSaved();
        openNotice({ title: 'Изменить данные', message: `Изменено ${changes.length} позиций.` });
      }
      return true;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Не удалось сохранить данные.';
    } finally {
      if (submit.isConnected) submit.disabled = false;
    }
  return false;
}

function openInventoryAuditCriteria(root, {
  mode, ids = [], fieldName = 'category', onSaved = () => {},
  keepOpen = false, initialCommon = false, initialCommonValue = '',
  existingLayer = null,
} = {}) {
  const items = inventoryAuditItems(ids);
  if (!items.length) return openNotice({ title: 'Инвентаризация', message: 'Позиции не найдены.' });
  const isData = mode === 'data';
  const includesDifferentManufacturers = new Set(items.map(manufacturerName)).size > 1;
  let definition = inventoryAuditFieldDefinition(fieldName);
  if (isData && !definition) return openNotice({ title: 'Данные', message: 'Выберите характеристику.' });
  const fields = isData
    ? '<div class="form-grid" data-inventory-audit-data-editor>' +
      compactCheck({ label: 'Одно значение для всех',
        data: 'data-inventory-data-common', checked: initialCommon }) +
      '<div data-inventory-audit-data-common hidden></div>' +
      '<div data-inventory-audit-data-individual></div></div>'
    : `<details data-inventory-audit-excluded hidden>
         <summary data-inventory-audit-excluded-count>Исключено: 0</summary>
         <div class="form-grid" data-inventory-audit-excluded-list></div>
       </details>
       <div class="form-grid" data-inventory-audit-active>${items.map(inventoryAuditInput).join('')}</div>`;
  const markup = `<form class="form-grid" data-inventory-audit-criteria>
    ${isData && existingLayer ? select({
      label: 'Что изменить', name: 'auditEditField', value: definition.value,
      options: INVENTORY_AUDIT_EDIT_FIELDS.map(({ value, label }) => ({ value, label })),
    }) : ''}
    <p data-inventory-audit-included-count>${isData ? 'Выбрано' : 'В инвентаризации'}: ${items.length} позиций</p>
    ${fields}
    <p class="form-error" role="status" data-inventory-audit-status></p>
    <div data-inventory-audit-actions>
      ${actionBlock(button('Применить', { type:'submit', data:'data-inventory-audit-apply' }))}
    </div>
  </form>`;
  const layer = existingLayer?.isConnected ? existingLayer : mountModal(root, modal(markup, {
    title: isData ? 'Изменить данные' : 'Инвентаризация остатков',
    variant: 'q',
  }));
  if (!layer) return null;
  if (existingLayer) {
    const body = layer.querySelector('[data-v2-q-body]');
    if (!body) return null;
    body.innerHTML = markup;
  }
  const form = layer.querySelector('[data-inventory-audit-criteria]');
  const submit = layer.querySelector('[data-inventory-audit-apply]');
  const status = layer.querySelector('[data-inventory-audit-status]');
  const balances = new Map(items.map(item => [item.itemId, Number(item.balance) || 0]));
  const knownContainers = new Map(items.map(item => [item.itemId, item.containerCount == null ? null : Number(item.containerCount)]));
  let saving = false;
  const includedIds = new Set(items.map(item => item.itemId));
  const activeList = form.querySelector('[data-inventory-audit-active]');
  const excludedGroup = form.querySelector('[data-inventory-audit-excluded]');
  const excludedList = form.querySelector('[data-inventory-audit-excluded-list]');
  const excludedCount = form.querySelector('[data-inventory-audit-excluded-count]');
  const includedCount = form.querySelector('[data-inventory-audit-included-count]');
  const dataMode = form.querySelector('[data-inventory-data-common]');
  const commonHost = form.querySelector('[data-inventory-audit-data-common]');
  const individualHost = form.querySelector('[data-inventory-audit-data-individual]');
  const dataActions = form.querySelector('[data-inventory-audit-actions]');
  let dataCommonTouched = false;
  let dataInitial = '';
  let dataUniform = true;
  const selectedDataIds = new Set();
  let dataActionMode = '';
  let supplierPreview = null;
  let supplierCompanyId = '';
  let supplierRequestVersion = 0;
  let supplierApplied = false;
  let pendingInitialCommonValue = initialCommon && String(initialCommonValue).trim()
    ? String(initialCommonValue).trim() : null;

  function checkedDataIndices() {
    return new Set([...individualHost?.querySelectorAll('[data-inventory-audit-selected]:checked') || []]
      .map(check => Number(check.dataset.inventoryAuditSelected)));
  }

  function resizeDataText(control) {
    if (control?.tagName !== 'TEXTAREA') return;
    control.style.height = 'auto';
    control.style.height = Math.min(control.scrollHeight, 78) + 'px';
  }

  function syncDataActions() {
    if (!isData) return;
    if (definition.value === 'supplier') {
      if (commonHost) commonHost.hidden = false;
      if (individualHost) individualHost.hidden = false;
      if (dataActions) dataActions.hidden = false;
      if (submit) {
        submit.hidden = false;
        submit.textContent = 'Применить';
        submit.disabled = saving || supplierApplied || !supplierPreview?.some(entry => entry.row);
      }
      return;
    }
    const common = Boolean(dataMode?.checked);
    if (commonHost) commonHost.hidden = !common;
    if (individualHost) individualHost.hidden = common;
    const value = String(commonHost?.querySelector('[name="auditValue"]')?.value ?? '').trim();
    const commonApply = dataCommonTouched && value !== '' && (!dataUniform || value !== dataInitial);
    const commonClear = inventoryAuditCanClear(definition) && items.length > 0;

    const selected = checkedDataIndices();
    const individualApply = items.some((item, index) => {
      if (!selected.has(index)) return false;
      const control = individualHost?.querySelector('[name="auditItem-' + index + '"]');
      const entered = String(control?.value ?? '').trim();
      return entered !== '' &&
        entered !== String(inventoryAuditCurrentValue(item, definition) ?? '').trim();
    });
    const individualClear = inventoryAuditCanClear(definition) && selected.size > 0;

    const canApply = common ? commonApply : individualApply;
    const canClear = common ? commonClear : individualClear;
    // These are mutually exclusive operations: edited values take priority.
    // Checking unchanged rows exposes Clear; typing exposes Apply instead.
    dataActionMode = canApply ? 'apply' : canClear ? 'clear' : '';
    if (dataActions) dataActions.hidden = false;
    if (submit) {
      submit.hidden = false;
      submit.disabled = saving || !dataActionMode;
      if (!saving) submit.textContent = dataActionMode === 'clear'
        ? definition.value === 'position' ? 'В конец' : 'Очистить' : 'Применить';
      submit.classList.toggle('ui-button--secondary', dataActionMode === 'clear');
    }
  }

  function renderDataFields() {
    if (!isData || !definition || !commonHost || !individualHost) return;
    const commonToggle = dataMode?.closest('.ui-compact-check');
    if (commonToggle) commonToggle.style.display = '';
    if (dataMode) {
      dataMode.disabled = definition.value === 'supplier';
      if (definition.value === 'supplier') dataMode.checked = true;
    }
    if (definition.value === 'supplier') {
      supplierRequestVersion++;
      supplierPreview = null;
      supplierCompanyId = '';
      supplierApplied = false;
      commonHost.hidden = false;
      individualHost.hidden = false;
      // These are the same compact data-edit rows as for every other field.
      // The right-hand editor is frozen; the supplier's actual catalog name
      // appears on a single secondary line without changing row identity.
      individualHost.innerHTML = '<div class="inventory-audit-data-list">' +
        items.map((item, index) => {
          const name = String(item.name || 'Позиция');
          return '<div class="data-edit-row inventory-audit-data-row inventory-audit-data-row--supplier" ' +
            'data-inventory-supplier-item="' + index + '">' +
            compactCheck({ checked: true, disabled: true,
              aria: 'Выбрано: ' + name }) +
            '<span class="data-edit-row__name" title="' + escapeHtml(name) + '">' +
              '<strong>' + escapeHtml(name) + '</strong></span>' +
            field({ label: '', name: 'auditSupplier-' + index,
              value: String(item.supplier || ''), disabled: true }) +
            '<span class="inventory-audit-supplier-caption">' +
              '<span data-inventory-supplier-name="' + index + '"></span>' +
              '<span data-inventory-supplier-result="' + index + '"></span>' +
            '</span></div>';
        }).join('') + '</div>';
      commonHost.innerHTML = actionBlock(button('Выбрать поставщика', {
        data: 'data-inventory-bulk-supplier-open',
      })) + '<p data-inventory-supplier-company class="ui-list__secondary"></p>';
      const companyHost = commonHost.querySelector('[data-inventory-supplier-company]');
      commonHost.querySelector('[data-inventory-bulk-supplier-open]')?.addEventListener('click', () => {
        if (saving) return;
        // X selects a company; the same Q rows remain mounted throughout
        // preview and confirmed writes. No Q is opened or replaced.
        openInventoryBulkSupplierLink(items, onSaved, '', '', null, (companyId, companyName) => {
          const version = ++supplierRequestVersion;
          const startingToken = getInventorySupplierAuthToken();
          supplierPreview = null;
          supplierCompanyId = companyId;
          supplierApplied = false;
          companyHost.textContent = companyName;
          const usable = () => form.isConnected && definition.value === 'supplier'
            && version === supplierRequestVersion
            && startingToken === getInventorySupplierAuthToken();
          items.forEach((item, index) => {
            const caption = individualHost.querySelector('[data-inventory-supplier-name="' + index + '"]');
            const result = individualHost.querySelector('[data-inventory-supplier-result="' + index + '"]');
            if (caption) caption.textContent = '';
            if (result) { result.textContent = ''; result.removeAttribute('title'); }
          });
          status.textContent = 'Сопоставление…';
          syncDataActions();
          void prepareInventorySupplierLinks(items.map(item => item.itemId), companyId, usable)
            .then(matches => {
              if (!usable() || !matches) return;
              supplierPreview = matches;
              matches.forEach((entry, index) => {
                const caption = individualHost.querySelector('[data-inventory-supplier-name="' + index + '"]');
                if (caption) caption.textContent = entry.row?.name || '';
                const row = individualHost.querySelector('[data-inventory-supplier-item="' + index + '"]');
                if (row && entry.reason) row.title = entry.reason;
              });
              status.textContent = 'Найдено: ' +
                matches.filter(entry => entry.row).length + ' из ' + matches.length;
              syncDataActions();
            }).catch(error => {
              if (!usable()) return;
              status.textContent = error instanceof Error ? error.message : 'Не удалось сопоставить позиции.';
              syncDataActions();
            });
        });
      });
      status.textContent = '';
      syncDataActions();
      return;
    }
    supplierRequestVersion++;
    supplierPreview = null;
    supplierCompanyId = '';
    supplierApplied = false;
    const values = items.map(item => String(inventoryAuditCurrentValue(item, definition) ?? '').trim());
    dataUniform = new Set(values).size === 1;
    dataInitial = dataUniform ? values[0] || '' : '';
    dataCommonTouched = false;
    commonHost.innerHTML = inventoryAuditDataControl(definition, 'auditValue', {
      shared: true, value: dataInitial,
      placeholder: dataUniform ? '' : 'Разные значения',
    }) + (!dataUniform
      ? '<p class="ui-list__secondary">У выбранных товаров разные значения.</p>'
      : '');
    individualHost.innerHTML = '<div class="inventory-audit-data-list">' + items.map((item, index) =>
      inventoryAuditDataRow(item, index, definition, includesDifferentManufacturers,
        selectedDataIds.has(item.itemId))).join('') + '</div>';
    individualHost.querySelectorAll('textarea').forEach(resizeDataText);
    if (pendingInitialCommonValue !== null) {
      const control = commonHost.querySelector('[name="auditValue"]');
      if (control) {
        control.value = pendingInitialCommonValue;
        dataCommonTouched = true;
      }
      pendingInitialCommonValue = null;
    }
    status.textContent = '';
    syncDataActions();
  }

  if (isData) {
    const fieldHost = existingLayer ? form : layer.querySelector('[data-v2-q-header-content]');
    if (fieldHost) {
      if (!existingLayer) fieldHost.innerHTML = select({
        label: 'Изменить данные', name: 'auditEditField', value: definition.value,
        options: INVENTORY_AUDIT_EDIT_FIELDS.map(({ value, label }) => ({ value, label })),
      });
      fieldHost.querySelector('[name="auditEditField"]')?.addEventListener('change', event => {
        const next = inventoryAuditFieldDefinition(event.target.value);
        if (!next || saving) return;
        definition = next;
        renderDataFields();
        if (definition.value === 'supplier')
          commonHost.querySelector('[data-inventory-bulk-supplier-open]')?.click();
      });
    }
    dataMode?.addEventListener('change', syncDataActions);
    commonHost?.addEventListener('input', event => {
      if (event.target?.name === 'auditValue') dataCommonTouched = true;
      syncDataActions();
    });
    commonHost?.addEventListener('change', event => {
      if (event.target?.name === 'auditValue') dataCommonTouched = true;
      syncDataActions();
    });
    const onIndividualEdit = event => {
      const control = event.target;
      resizeDataText(control);
      const match = /^auditItem-(\d+)$/.exec(control?.name || '');
      if (match && !saving) {
        const index = Number(match[1]);
        const item = items[index];
        const previous = String(inventoryAuditCurrentValue(item, definition) ?? '').trim();
        if (String(control.value ?? '').trim() !== previous) {
          const check = individualHost.querySelector('[data-inventory-audit-selected="' + index + '"]');
          if (check && !check.disabled) {
            check.checked = true;
            selectedDataIds.add(item.itemId);
          }
        }
      }
      if (control?.matches?.('[data-inventory-audit-selected]')) {
        const item = items[Number(control.dataset.inventoryAuditSelected)];
        if (item) {
          if (control.checked) selectedDataIds.add(item.itemId);
          else selectedDataIds.delete(item.itemId);
        }
      }
      syncDataActions();
    };
    individualHost?.addEventListener('input', onIndividualEdit);
    individualHost?.addEventListener('change', onIndividualEdit);
    renderDataFields();
  }

  // Move existing nodes, not re-rendered fields. Typed measurements survive
  // exclude/restore, and excluded rows never participate in saving.
  function setStocktakeIncluded(index, included) {
    const row = form.querySelector(`[data-inventory-audit-row="${index}"]`);
    const item = items[index];
    if (!row || !item || !activeList || !excludedList || saving) return;
    if (included) includedIds.add(item.itemId);
    else includedIds.delete(item.itemId);
    const fields = row.querySelector('[data-inventory-audit-fields]');
    if (fields) {
      fields.hidden = !included;
      fields.querySelectorAll('input, select, textarea').forEach(control => {
        control.disabled = !included;
      });
    }
    (included ? activeList : excludedList).append(row);
    for (const host of [activeList, excludedList]) {
      [...host.children].sort((a, b) =>
        Number(a.dataset.inventoryAuditRow) - Number(b.dataset.inventoryAuditRow))
        .forEach(node => host.append(node));
    }
    const excluded = items.length - includedIds.size;
    excludedGroup.hidden = excluded === 0;
    if (!excluded) excludedGroup.open = false;
    excludedCount.textContent = `Исключено: ${excluded}`;
    includedCount.textContent = `В инвентаризации: ${includedIds.size} из ${items.length}`;
    const preview = calculate();
    status.textContent = preview.invalid ? 'Проверьте введённые значения.' : '';
  }

  if (!isData) {
    form.addEventListener('change', event => {
      const check = event.target.closest?.('[data-inventory-audit-include]');
      if (!check || saving) return;
      setStocktakeIncluded(Number(check.dataset.inventoryAuditInclude), check.checked);
    });
  }

  function calculate() {
    const data = new FormData(form);
    const lines = [];
    let measured = 0;
    let invalid = 0;
    for (const [index, item] of items.entries()) {
      const result = form.querySelector(`[data-inventory-audit-result="${index}"]`);
      if (result) {
        result.textContent = result.dataset.inventoryAuditPrevious || '';
        result.classList.remove('form-error');
        result.removeAttribute('title');
      }
      if (!isData && !includedIds.has(item.itemId)) continue;
      try {
        const measurement = inventoryAuditMeasure(item, index, data);
        if (!measurement) continue;
        measured++;
        const expected = balances.get(item.itemId);
        const diff = Math.round((measurement.actual - expected) * 1000) / 1000;
        const beforeTubes = knownContainers.get(item.itemId);
        const hasPhysicalCount = measurement.containers !== undefined;
        const physicalChanged = hasPhysicalCount && (beforeTubes == null || beforeTubes !== measurement.containers);
        if (result) result.textContent = `Остаток: ${numberText(measurement.actual)} ${item.unit}`;
        if (Math.abs(diff) >= 0.000001 || physicalChanged) lines.push({
          itemId: item.itemId, quantity: diff, expectedQuantity: expected,
          actualQuantity: measurement.actual,
          ...(hasPhysicalCount ? {
            expectedContainerCount: beforeTubes,
            actualContainerCount: measurement.containers,
          } : {}),
          ...(measurement.note ? { note: measurement.note } : {}),
        });
      } catch (error) {
        invalid++;
        if (result) {
          result.textContent = 'Ошибка';
          result.classList.add('form-error');
          result.title = error instanceof Error ? error.message : 'Проверьте измерения.';
        }
      }
    }
    return { lines, measured, invalid };
  }

  if (!isData) {
    // The form is never rebuilt while iOS keyboard is open.
    form.addEventListener('input', event => {
      if (saving) return;
      const input = event.target;
      const match = /^(auditTubes|auditGross)-(\d+)$/.exec(String(input?.name || ''));
      if (match) {
        const partnerName = `${match[1] === 'auditTubes' ? 'auditGross' : 'auditTubes'}-${match[2]}`;
        const partner = form.elements.namedItem(partnerName);
        const raw = String(input.value || '').trim();
        const value = raw ? Number(raw.replace(',', '.')) : NaN;
        if (value === 0) {
          // A zero in either field explicitly counts zero tubes and zero grams.
          if (partner && partner.value !== '0') {
            partner.value = '0';
            partner.dataset.inventoryAuditAutoZero = 'true';
          }
        } else if (partner && (partner.dataset.inventoryAuditAutoZero === 'true'
          || Number.isFinite(value) && value > 0 && partner.value === '0')) {
          partner.value = '';
          delete partner.dataset.inventoryAuditAutoZero;
        }
        delete input.dataset.inventoryAuditAutoZero;
      }
      const result = calculate();
      status.textContent = result.invalid ? 'Проверьте введённые значения.' : '';
    });
  }

  async function saveDataChange() {
    if (!isData || saving) return;
    syncDataActions();
    if (!dataActionMode || submit.hidden) return;
    const clear = dataActionMode === 'clear';
    const common = Boolean(dataMode?.checked);
    const selectedIndices = common ? null : checkedDataIndices();
    const clearAll = clear && common;
    const clearItems = clear && !common ? selectedIndices : new Set();
    const data = new FormData(form);
    const action = submit;
    const initialLabel = action?.textContent || 'Применить';
    saving = true;
    syncDataActions();
    if (action) action.textContent = clear
      ? definition.value === 'position' ? 'Перемещаю…' : 'Очищаю…' : 'Применяю…';
    try {
      const saved = await applyInventoryAuditDataChanges(layer, {
        items, definition, perItem: !common, data, status, submit, onSaved,
        clearAll, clearItems, selectedIndices,
        keepOpen: isData && keepOpen,
        onProgress: (completed, total) => {
          const progress = (clear
            ? definition.value === 'position' ? 'Перемещение' : 'Очистка' : 'Применение') +
            ` · ${completed} из ${total}`;
          if (action?.isConnected) action.textContent = progress;
          if (status?.isConnected) status.textContent = progress;
        },
        afterApplied: () => {
          // The same rows remain in the editor in their existing order,
          // refreshed from confirmed server values; clear every checkmark.
          selectedDataIds.clear();
          if (dataMode) dataMode.checked = false;
          items.splice(0, items.length, ...items.map(item =>
            getInventoryItem(item.itemId)).filter(Boolean));
          renderDataFields();
        },
      });
      if (!saved && status?.textContent && layer.isConnected) {
        openNotice({
          title: clear ? definition.value === 'position'
            ? 'Перестановка не завершена' : 'Очистка не завершена' : 'Изменения не сохранены',
          message: status.textContent,
        });
      }
    } finally {
      if (action?.isConnected) action.textContent = initialLabel;
      saving = false;
      syncDataActions();
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    if (isData && definition.value === 'supplier') {
      if (saving || supplierApplied || !supplierCompanyId || !supplierPreview?.some(entry => entry.row)) return;
      saving = true;
      syncDataActions();
      const version = supplierRequestVersion;
      const startingToken = getInventorySupplierAuthToken();
      const usable = () => form.isConnected && version === supplierRequestVersion
        && definition.value === 'supplier'
        && startingToken === getInventorySupplierAuthToken();
      try {
        const result = await applyInventorySupplierLinks(supplierPreview, supplierCompanyId, {
          usable,
          onProgress: (completed, total) => {
            if (usable()) status.textContent = 'Применение · ' + completed + ' из ' + total;
          },
        });
        if (!usable() || !result) return;
        supplierApplied = true;
        supplierPreview.forEach((entry, index) => {
          const outcome = individualHost.querySelector('[data-inventory-supplier-result="' + index + '"]');
          if (!outcome) return;
          const success = result.confirmedIds.has(String(entry.itemId));
          outcome.textContent = success ? 'Применено' : 'Не применено';
          const failure = result.failuresById.get(String(entry.itemId)) || entry.reason;
          if (!success && failure) outcome.title = failure;
        });
        status.textContent = 'Применено: ' + result.confirmedIds.size + ' из ' + supplierPreview.length;
        if (result.confirmedIds.size) onSaved();
      } catch (error) {
        if (usable()) status.textContent = 'Сохранение не подтверждено: ' +
          (error instanceof Error ? error.message : 'Ошибка сервера');
      } finally {
        saving = false;
        if (usable()) syncDataActions();
      }
      return;
    }
    if (!isData) {
      const review = calculate();
      if (review.invalid) {
        status.textContent = `Проверьте ошибки измерений: ${review.invalid}.`;
        return;
      }
      if (!includedIds.size) {
        status.textContent = 'Верните хотя бы одну позицию в инвентаризацию.';
        return;
      }
      if (!review.measured) {
        status.textContent = 'Введите данные хотя бы по одной позиции.';
        return;
      }
      if (!review.lines.length) {
        if (!keepOpen) layer.v2Close?.();
        else status.textContent = 'Изменений остатков нет.';
        onSaved();
        return;
      }
      // Prevent silently losing counts if an older Core instance is still live.
      if (items.some(item => includedIds.has(item.itemId) && isWeighedInventoryItem(item)
        && !Object.prototype.hasOwnProperty.call(getInventoryItem(item.itemId) || {}, 'containerCount'))) {
        status.textContent = 'Сервер склада ещё не поддерживает учёт тюбиков. Сохранение отменено.';
        return;
      }
      saving = true;
      submit.disabled = true;
      status.textContent = 'Проверка актуальных остатков…';
      try {
        await loadInventory();
        if (items.some(item => {
          if (!includedIds.has(item.itemId)) return false;
          const actualItem = getInventoryItem(item.itemId);
          return !actualItem
            || Math.abs((Number(actualItem.balance) || 0) - balances.get(item.itemId)) > 0.000001
            || (isWeighedInventoryItem(item) && (
              String(actualItem.tareWeight ?? '') !== String(item.tareWeight ?? '')
              || (actualItem.containerCount == null ? null : Number(actualItem.containerCount)) !== knownContainers.get(item.itemId)
            ));
        })) {
          throw new Error('Учётные остатки или тара изменились. Закройте форму и проведите инвентаризацию заново.');
        }
        status.textContent = 'Сохранение…';
        await createInventoryMovement({
          kind: 'ADJUSTMENT', sourceType: 'inventory-count',
          note: 'Инвентаризация фактических остатков', lines: review.lines,
        });
        if (keepOpen && existingLayer) {
          onSaved();
          openInventoryAuditCriteria(root, {
            mode: 'stock', ids, onSaved, keepOpen: true, existingLayer: layer,
          });
          const resultStatus = layer.querySelector('[data-inventory-audit-status]');
          if (resultStatus) resultStatus.textContent = 'Остатки сохранены.';
        } else {
          layer.v2Close?.();
          onSaved();
          openNotice({ title: 'Инвентаризация', message: 'Остатки сохранены.' });
        }
      } catch(error) {
        status.textContent = error instanceof Error ? error.message : 'Не удалось сохранить остатки.';
      } finally {
        saving = false;
        if (submit.isConnected) submit.disabled = false;
      }
      return;
    }

    await saveDataChange();
  });
  return layer;
}


function openStockCreateOptions(root, onChanged, defaults = {}) {
  const layer = mountModal(document.body, modal(
    actionBlock(
      button('+ Позиция', { data: 'data-stock-create-manual' }) +
      button('Из прайса', { variant: 'secondary', data: 'data-stock-create-supplier' }),
      { className: 'stock-create-actions' },
    ),
    { title: 'Добавить', variant: 'x', xRole: 'action', surface: 'app' },
  ));
  if (!layer) return;
  layer.querySelector('[data-stock-create-manual]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openQuickStockItemX(defaults, onChanged);
  });
  layer.querySelector('[data-stock-create-supplier]')?.addEventListener('click', async () => {
    layer.v2Close?.();
    try {
      const { openSupplierCatalogCreation } = await import('./counterparties.js');
      await openSupplierCatalogCreation(onChanged);
    } catch (error) {
      openNotice({ title: 'Контрагенты',
        message: error instanceof Error ? error.message : 'Не удалось открыть контрагентов.' });
    }
  });
}

let inventoryRankRepairPending = false;
if (typeof window !== 'undefined') window.addEventListener('professional:auth-logout',
  () => { inventoryRankRepairPending = false; });

function inventoryNeedsPositionRepair(rows = []) {
  const groups = new Map();
  for (const item of rows) {
    const manufacturer = String(item.manufacturer || '');
    if (!groups.has(manufacturer)) groups.set(manufacturer, []);
    groups.get(manufacturer).push(Number(item.position));
  }
  return [...groups.values()].some(numbers => numbers.sort((a,b)=>a-b)
    .some((position,index)=>!Number.isSafeInteger(position) || position!==index+1));
}

function renderStock(root) {
  STOCK_VIEW.manufacturersType = '';
  // Root stock catalog must never inherit an invisible legacy filter.
  STOCK_VIEW.itemsFilters = emptyStockFilters();
  const locations = inventoryLocations().filter(place=>!place.isPrimary);
  const hasUnallocated=getInventoryItems().some(item=>itemLocationBalance(item,'primary')>0.000001);
  const scopes = [
    {value: INVENTORY_TOTAL_SCOPE, label: 'Общий остаток'},
    ...locations.map(place=>({value:place.locationId,label:'Склад · '+storageName(place)})),
    ...(hasUnallocated ? [{value:'primary',label:'Остатки без распределения'}] : []),
  ];
  if (!scopes.some(entry=>entry.value===STOCK_VIEW.storageScope))
    STOCK_VIEW.storageScope=INVENTORY_TOTAL_SCOPE;
  const desktop=inventoryDesktop(root);
  const scopeSelector=select({name:'inventoryStockScope',aria:'Выбрать склад',
    value:STOCK_VIEW.storageScope,options:scopes});
  root.innerHTML = page([
    context('Остатки',{
      v:desktop?null:{data:'data-inventory-stock-menu',aria:'Настройки остатков'},
      c:desktop?null:{label:'+',data:'data-inventory-add-item',aria:'Добавить позицию'},
    }),
    '<div data-inventory-stock-group-list'+(desktop?' data-inventory-desktop-table':'')+'></div>',
  ]);
  // Z1 owns the scope selector in its Shared Header, not in the scrollable
  // brand list. Keep a visible fallback if the host has not been mounted.
  const headerRows=desktop?[inventoryDesktopHeader(root,'Остатки',scopeSelector,[
    {label:'Вид',data:'data-inventory-desktop-view',aria:'Вид'},
    {label:GROUP_ICON,className:'v2-desktop-tool-icon',data:'data-inventory-desktop-groups',aria:'Группы'},
    {label:'Склады',data:'data-inventory-desktop-storage',aria:'Склады'},
    {label:DATA_EXCHANGE_ICON,className:'v2-desktop-tool-icon',data:'data-inventory-desktop-excel',aria:'Excel склада'},
    {label:'+',className:'v2-desktop-tool-primary',data:'data-inventory-add-item',aria:'Добавить позицию'},
  ])].filter(Boolean):setV2ZHeaderRows(root,[scopeSelector]);
  const listHost=root.querySelector('[data-inventory-stock-group-list]');
  if (!headerRows.length) listHost?.insertAdjacentHTML('beforebegin',
    '<div data-inventory-scope-selector>'+scopeSelector+'</div>');
  const scopeInput=headerRows[0]?.querySelector('[name="inventoryStockScope"]')
    || root.querySelector('[name="inventoryStockScope"]');
  // Companies are navigated directly; no search or filter on Z1.
  const visibleRows=()=>getInventoryItems().filter(item=>inventoryItemBelongsToStorage(item,STOCK_VIEW.storageScope));
  let disposeBrandReorder=()=>{};
  const refresh=()=>{
    disposeBrandReorder();
    const locationId=STOCK_VIEW.storageScope;
    const criteria=inventoryCriterionGroups();
    const first=stockRootCriterion(criteria);
    disposeBrandReorder=renderStockBrandList(listHost,visibleRows(),{
      scope:locationId,
      desktop,
      itemsForView:visibleRows,
      criteria,
      brandValues:first?.values||[],
      onReorder:first ? async ids=>{
        await reorderInventoryCriterionValues(first.id,ids);
      } : null,
      onReorderError:error=>{
        if(!listHost?.isConnected)return;
        const message=document.createElement('div');
        message.className='form-error';
        message.textContent=error instanceof Error?error.message:'Порядок компаний не сохранился.';
        listHost.prepend(message);
      },
      // Z1 company → native Z2, never a Q with forced item selection.
      onBrandOpen:brand=>openManufacturerStock(root,brand.name,{criteria,itemsForView:visibleRows}),
    });
  };
  scopeInput?.addEventListener('change',event=>{
    STOCK_VIEW.storageScope=event.target.value;
    refresh();
  });
  root.querySelector('[data-inventory-stock-menu]')?.addEventListener('click',()=>{
    openSharedProfileSettingsMenu({
      title:'Настройки остатков',
      actions:[
        {id:'groups',label:'Группы',onSelect:()=>
          openInventoryClassificationGroups(refresh)},
        {id:'storage',label:'Склады',onSelect:()=>
          openInventoryStorageLocations(()=>renderStock(root))},
        {id:'appearance',label:'Вид',onSelect:()=>
          openInventoryProductAppearanceQ(getInventoryItems()[0]?.itemId || '',
            ()=>renderStock(root), STOCK_VIEW.storageScope)},
      ],
    });
  });
  const h=headerRows[0];
  h?.querySelector('[data-inventory-desktop-view]')?.addEventListener('click',()=>openInventoryProductAppearanceQ(getInventoryItems()[0]?.itemId||'',()=>renderStock(root),STOCK_VIEW.storageScope));
  h?.querySelector('[data-inventory-desktop-groups]')?.addEventListener('click',()=>openInventoryClassificationGroups(refresh));
  h?.querySelector('[data-inventory-desktop-storage]')?.addEventListener('click',()=>openInventoryStorageLocations(()=>renderStock(root)));
  h?.querySelector('[data-inventory-desktop-excel]')?.addEventListener('click',event=>{const anchor=event.currentTarget;void import('./excel-v2.js').then(m=>m.openInventoryStockExcel(anchor));});
  (h?.querySelector('[data-inventory-add-item]')||root.querySelector('[data-inventory-add-item]'))?.addEventListener('click',()=>
    openStockCreateOptions(root,()=>renderStock(root)));
  refresh();
  // Historical gaps and missing ranks are repaired once through a dedicated
  // capability. Never call old Core's "clear" endpoint: it wrote actual 0s.
  // The server changes ONLY manufacturer-local position values atomically.
  if (!inventoryRankRepairPending && inventoryNeedsPositionRepair(getInventoryItems())) {
    inventoryRankRepairPending = true;
    void repairInventoryPositions().then(() => {
      if (inventoryNeedsPositionRepair(getInventoryItems()))
        throw new Error('Некоторые порядковые номера не восстановлены.');
      if (root.isConnected) renderStock(root);
    }).catch(error => {
      if (root.isConnected) openNotice({
        title:'Нумерация склада',
        message:error instanceof Error ? error.message : 'Не удалось восстановить номера.',
      });
    }).finally(() => { inventoryRankRepairPending = false; });
  }
  notifyContext();
}

function renderMovements(root) {
  const desktop=inventoryDesktop(root);
  root.innerHTML = `${context('Движения', {
    c: desktop?null:{ label: '+', data: 'data-inventory-add-movement', aria: 'Добавить движение' },
  })}${desktop?'<div data-inventory-desktop-table></div>':movementJournalMarkup()}`;
  const header=desktop?inventoryDesktopHeader(root,'Движения',field({name:'inventoryMovementSearch',type:'search',placeholder:'Поиск',autocomplete:'off',data:'data-inventory-movement-search'}),[
    {label:DATA_EXCHANGE_ICON,className:'v2-desktop-tool-icon',data:'data-inventory-desktop-excel',aria:'Excel движений'},
    {label:'+',className:'v2-desktop-tool-primary',data:'data-inventory-add-movement',aria:'Добавить движение'},
  ]):null;
  const host=root.querySelector('[data-inventory-desktop-table]');
  if(host){
    const search=header?.querySelector('[data-inventory-movement-search]');
    const refresh=()=>{
      const term=normalizedSearch(search?.value||'');
      const rows=getInventoryMovements().filter(m=>!term||normalizedSearch([movementTitle(m),movementSubtitle(m),movementMoment(m.occurredAt),...(m.lines||[]).map(l=>l.name||getInventoryItem(l.itemId)?.name||'')].join(' ')).includes(term));
      host.innerHTML=rows.length?inventoryTable(rows,[
        {key:'date',label:'Дата / время',render:m=>escapeHtml(movementMoment(m.occurredAt))},
        {key:'movement',label:'Операция',render:m=>inventoryRowButton(movementTitle({...m,personUei:''}),'data-inventory-movement',m.movementId)},
        {key:'person',label:'Код клиента',render:m=>escapeHtml(m.personUei||'')},
        {key:'count',label:'Позиций',narrow:true,render:m=>String((m.lines||[]).length)},
        {key:'note',label:'Примечание',render:m=>escapeHtml(movementSubtitle(m))},
      ],'Движения'):emptyState('Движений не найдено');
      bindInventoryTableRows(host,'[data-inventory-movement]',control=>openMovementDetails(root,control.dataset.inventoryMovement));
    };
    search?.addEventListener('input',refresh);refresh();
  }else root.querySelectorAll('[data-inventory-movement]').forEach(control=>control.addEventListener('click',()=>openMovementDetails(root,control.dataset.inventoryMovement)));
  header?.querySelector('[data-inventory-desktop-excel]')?.addEventListener('click',event=>{const anchor=event.currentTarget;void import('./excel-v2.js').then(m=>m.openInventoryMovementExcel(anchor));});
  (header?.querySelector('[data-inventory-add-movement]')||root.querySelector('[data-inventory-add-movement]'))?.addEventListener('click', () => openMovementEditor(root, '', ''));
  notifyContext();
}

async function renderOrders(root) {
  await renderInventoryOrders(root);
  notifyContext();
}

export async function renderInventory(root, section = 'stock') {
  root.innerHTML = emptyState('Склад', 'Загружаем данные…');
  try {
    await Promise.all([
      // Reuse a confirmed stock read when navigating rapidly among its tabs.
      // Explicit stocktake and correction still force a fresh read.
      loadInventory({ preferRecent: true }),
      ...(section === 'stock' ? [
        // Older Core builds may not yet have deployed the criteria migration.
        // Never make the entire stock catalog disappear in that case.
        loadInventoryCriteria().catch(error=>{
          console.error('Inventory criteria unavailable',error);
        }),
      ] : []),
    ]);
  } catch (error) {
    root.innerHTML = emptyState('Склад недоступен', error instanceof Error ? error.message : 'Не удалось загрузить данные.');
    return () => {};
  }

  // Excel A/B labels survived the schema migration in InventoryItem.location.
  // Before switching the Stock view to named locations, automatically restore
  // their actual locations and remaining physical balances via Core's atomic
  // stock-transfer API. The operation is idempotent and has no extra button.
  let legacyError=null;
  if (section === 'stock') {
    try {
      await reconcileLegacyInventoryStorage();
    } catch (error) {
      legacyError=error instanceof Error ? error.message : 'Не удалось восстановить старые склады.';
    }
  }
  if (section === 'movements') renderMovements(root);
  else if (section === 'orders') await renderOrders(root);
  else {
    renderStock(root);
    if (legacyError) openNotice({
      title:'Не удалось сопоставить склады',
      message:legacyError+'. Существующие товары не удалены; проверьте склады и повторите вход.',
    });
  }
  return () => {};
}
