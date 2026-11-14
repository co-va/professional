import {
  actionBlock,
  button,
  details,
  columnLayout,
  emptyState,
  entityVisualCard,
  entityCardStack,
  field,
  modal,
  mountModal,
  mountV2ZLayer,
  openNotice,
  openEntityCardAppearanceQ,
  openSharedProfileSettingsMenu,
  page,
  select,
  setV2ZHeaderRows,
  shortDateTimeParts,
  twoColumnLayout,
  v2ListEntries,
  v2ListEntry,
  initV2ListReorder,
  v2Section,
  v2ZLayer,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { compactCheck } from '../../ui/selection/check-list.js';
import { canUseCapability } from '../access.js';
import { setSharedActionVisible } from '../../ui/page/page.js';
import { getCardAppearanceTemplate, saveCardAppearanceTemplate } from '../card-appearance-templates.js';
import { loadAuxiliaryState } from '../runtime/auxiliary-state.js';
import { inventoryManufacturerCompletion, isWeighedInventoryItem, netStocktakeGrams } from './completeness.js';
import { openInventoryProductAppearanceQ, openInventoryProductOverview } from './product-overview.js';
import {
  getInventoryItem,
  getInventoryItems,
  getInventoryMovement,
  getInventoryMovements,
  inventoryOrderSuggestions,
} from './data.js';
import {
  correctInventoryMovement,
  createInventoryItem,
  createInventoryMovement,
  loadInventory,
  updateInventoryItem,
  reorderInventoryItems,
} from './service.js';

const UNIT_OPTIONS = ['шт.', 'г', 'кг', 'мл', 'л', 'м', 'уп.'].map((value) => ({ value, label: value }));
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
const MANUFACTURER_CARD_APPEARANCE = {
  lines: [
    {}, {}, {}, {}, {},
    { field: 'manufacturer', zone: 'full', align: 'left', size: 'xl', color: 'white', bold: true },
    {},
    { field: 'count', zone: 'full', align: 'left', size: 'm', color: 'white' },
    { field: 'completion', zone: 'right', align: 'right', size: 'm', color: 'white' },
  ],
};

function numberText(value, maximum = 3) {
  const number = Number(value) || 0;
  return number.toLocaleString('ru-RU', { maximumFractionDigits: maximum }).replaceAll('\u00a0', ' ');
}

// The exact physical count is an independent stock fact. Before the first
// measurement, only the theoretical minimum can be displayed (not as fact).
function tubeCountText(item = {}) {
  if (!isWeighedInventoryItem(item)) return '';
  if (Number.isSafeInteger(item.containerCount) && item.containerCount >= 0) {
    return `${numberText(item.containerCount)} тюб.`;
  }
  const amount = Number(item.balance);
  const capacity = Number(item.packageQuantity);
  return Number.isFinite(amount) && amount >= 0 && Number.isFinite(capacity) && capacity > 0
    ? `тюб. неизвестно · минимум ${Math.ceil(amount / capacity)}`
    : 'тюб. неизвестно';
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
    item.location,
    item.sku,
    item.barcode,
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
  return [{ value: '', label: 'Все типы' }, ...values.map((value) => ({ value, label: value }))];
}

function manufacturerGroups(query = '', type = STOCK_VIEW.manufacturersType) {
  const needle = normalizedSearch(query);
  const groups = new Map();
  getInventoryItems().forEach((item) => {
    if (!matchesType(item, type)) return;
    const manufacturer = manufacturerName(item);
    if (needle && !`${manufacturer} ${itemSearchText(item)}`.toLocaleLowerCase('ru-RU').includes(needle)) return;
    const rows = groups.get(manufacturer) || [];
    rows.push(item);
    groups.set(manufacturer, rows);
  });
  const result = [...groups.entries()].map(([name, items]) => ({ name, items }));
  const byName = (left, right) => left.name.localeCompare(right.name, 'ru', { numeric: true, sensitivity: 'base' });
  if (STOCK_VIEW.manufacturersSort === 'name-desc') result.sort((left, right) => byName(right, left));
  else if (STOCK_VIEW.manufacturersSort === 'count-desc') result.sort((left, right) => right.items.length - left.items.length || byName(left, right));
  else if (STOCK_VIEW.manufacturersSort === 'count-asc') result.sort((left, right) => left.items.length - right.items.length || byName(left, right));
  else result.sort(byName);
  return result;
}

function movementTitle(movement = {}) {
  if (movement.personUei) return String(movement.personUei);
  if (movement.kind === 'RECEIPT') return 'Приход';
  if (movement.kind === 'CONSUMPTION') return 'Расход';
  if (movement.kind === 'WRITE_OFF') return 'Списание';
  if (movement.kind === 'SALE') return 'Продажа';
  if (movement.kind === 'RETURN') return 'Возврат';
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

function itemIdentityFields(item = {}, defaults = {}) {
  return `
    ${field({ label: 'Производитель', name: 'manufacturer', value: item.manufacturer || defaults.manufacturer || '', autocomplete: 'off' })}
    ${field({ label: 'Наименование', name: 'name', value: item.name || '', required: true, autocomplete: 'off' })}`;
}

// Core resolves the nominal package price from the selected primary supplier.
function itemPrimaryPrice(item = {}) {
  const price = Number(item.basePrice);
  return item.primaryOfferId && item.basePriceSource === 'primary-offer'
    && item.basePrice != null && Number.isFinite(price) ? price : null;
}

function itemPackageFields(item = {}) {
  const primaryPrice = itemPrimaryPrice(item);
  return columnLayout([
    select({ label: 'Единица', name: 'unit', value: item.unit || 'шт.', options: UNIT_OPTIONS }),
    field({ label: 'Упаковка', name: 'packageQuantity', value: item.packageQuantity ?? '', type: 'number', min: '0', step: '0.001', inputmode: 'decimal' }),
    field({
      label: 'Цена', name: 'referencePrice', value: primaryPrice ?? item.referencePrice ?? '',
      type: 'number', min: '0', step: '0.0001', inputmode: 'decimal',
      disabled: primaryPrice !== null,
    }),
  ], { columns: 3, ariaLabel: 'Единица, упаковка и цена' });
}

function advancedItemFields(item = {}) {
  // Existing Shared sections provide hierarchy without a local UI component or geometry override.
  // Each category stays independent, preserving category/type and stock semantics.
  const classification = `
    ${field({ label: 'Категория', name: 'category', value: item.category || '' })}
    ${field({ label: 'Тип продукта', name: 'productType', value: item.productType || '' })}
    ${select({ label: 'Использование', name: 'usage', value: itemUsageMode(item), options: [
      { value: 'consume', label: 'Расход' },
      { value: 'sale', label: 'Продажа' },
      { value: 'both', label: 'Расход и продажа' },
      { value: 'track', label: 'Только учёт' },
    ] })}`;
  const mass = columnLayout([
    field({ label: 'Брутто, г', name: 'grossWeight', value: item.grossWeight ?? '', type: 'number', min: '0', step: '0.001', inputmode: 'decimal' }),
    field({ label: 'Нетто, г', name: 'netWeight', value: '', disabled: true }),
    field({ label: 'Тара, г', name: 'tareWeight', value: item.tareWeight ?? '', type: 'number', min: '0', step: '0.001', inputmode: 'decimal' }),
  ], { columns: 3, ariaLabel: 'Масса упаковки: брутто, нетто и тара' });
  const identifiers = columnLayout([
    field({ label: '№', name: 'position', value: Number(item.position) > 0 ? item.position : '',
      type: 'number', min: '1', step: '1', inputmode: 'numeric' }),
    field({ label: 'Артикул', name: 'sku', value: item.sku || '' }),
    field({ label: 'Штрихкод', name: 'barcode', value: item.barcode || '' }),
  ], { columns: 3, ariaLabel: 'Порядок, артикул и штрихкод' });
  const inventory = `
    ${field({ label: 'Место хранения', name: 'location', value: item.location || '' })}
    ${twoColumnLayout(
      field({ label: 'Минимум', name: 'minStock', value: item.minStock ?? '', type: 'number', min: '0', step: '0.001', inputmode: 'decimal' }),
      field({ label: 'Цель', name: 'targetStock', value: item.targetStock ?? '', type: 'number', min: '0', step: '0.001', inputmode: 'decimal' }),
      { ariaLabel: 'Правила остатка' },
    )}`;
  return [
    v2Section('Маркировка', `<div class="form-grid">${identifiers}</div>`),
    v2Section('Классификация', `<div class="form-grid">${classification}</div>`),
    v2Section('Упаковка и цена', `<div class="form-grid">${itemPackageFields(item)}${mass}</div>`),
    v2Section('Хранение и запас', `<div class="form-grid">${inventory}</div>`),
  ].join('');
}

function collectOptionalNumber(form, name) {
  const raw = String(new FormData(form).get(name) ?? '').trim();
  return raw === '' ? null : Number(raw.replace(',', '.'));
}

function openItemEditor(root, itemId = '', defaults = {}, onSaved = () => {}) {
  const item = itemId ? getInventoryItem(itemId) : null;
  const creating = !item;
  const markup = `
    <form data-inventory-item-form>
      ${creating
        ? `${itemIdentityFields(item || {}, defaults)}${itemPackageFields(item || {})}`
        : `${v2Section('Основное', `<div class="form-grid">${itemIdentityFields(item, defaults)}</div>`)}${advancedItemFields(item)}`}
      ${actionBlock(button(creating ? 'Применить' : 'Сохранить', { type: 'button', data: 'data-inventory-item-save', aria: creating ? 'Добавить продукт' : 'Сохранить продукт' }))}
      <div class="form-error" data-inventory-item-save-error role="alert" hidden></div>
    </form>`;
  const layer = mountModal(document.body, modal(markup, {
    title: creating ? 'Новый продукт' : item.name,
    variant: creating ? 'x' : 'q',
    surface: creating ? '' : 'app',
    xRole: creating ? 'editor' : '',
  }));
  if (!layer) return;

  // Net content is derived from gross and tare; it is not a separate API field.
  const form = layer.querySelector('[data-inventory-item-form]');
  const primary = layer.querySelector('[data-inventory-item-save]');
  const saveError = layer.querySelector('[data-inventory-item-save-error]');
  const actions = primary?.closest('.modal-actions');
  const signature = () => JSON.stringify([...new FormData(form).entries()]
    .filter(([name]) => name !== 'netWeight')
    .map(([name, value]) => [name, typeof value === 'string' ? value : '']));
  const initialSignature = signature();
  const syncDirty = () => {
    if (!creating) setSharedActionVisible(actions, signature() !== initialSignature);
  };
  form.addEventListener('input', () => {
    if (saveError) { saveError.hidden = true; saveError.textContent = ''; }
    syncDirty();
  });
  form.addEventListener('change', syncDirty);
  const netInput = form.querySelector('[name="netWeight"]');
  if (netInput) {
    const updateNet = () => {
      const grossRaw = String(form.elements.namedItem('grossWeight')?.value ?? '').trim();
      const tareRaw = String(form.elements.namedItem('tareWeight')?.value ?? '').trim();
      const gross = Number(grossRaw.replace(',', '.'));
      const tare = Number(tareRaw.replace(',', '.'));
      netInput.value = grossRaw && tareRaw && Number.isFinite(gross) && Number.isFinite(tare) && gross >= tare && tare >= 0
        ? numberText(gross - tare) : '';
    };
    form.addEventListener('input', (event) => {
      if (event.target.matches('[name="grossWeight"], [name="tareWeight"]')) updateNet();
    });
    updateNet();
  }

  // A priced primary supplier controls this locked price field.
  // Reflect an edited package size without sending derived pricing to Core.
  const priceInput = form.elements.namedItem('referencePrice');
  const primaryOffer = item?.supplierOffers?.find((offer) => offer.offerId === item.primaryOfferId);
  const primaryOfferPrice = primaryOffer?.effectivePrice == null
    ? (primaryOffer?.actualPrice ?? (
        primaryOffer?.listPrice == null ? null
          : Number(primaryOffer.listPrice) * (1 - Number(primaryOffer.discountPercent || 0) / 100)
      ))
    : primaryOffer.effectivePrice;
  if (priceInput?.disabled && primaryOfferPrice != null) {
    const packSize = Number(primaryOffer.unitsPerOffer) || 1;
    const updatePrimaryPrice = () => {
      const raw = String(form.elements.namedItem('packageQuantity')?.value ?? '').trim();
      const units = Number(raw.replace(',', '.'));
      const quantity = raw && Number.isFinite(units) && units > 0 ? units : 1;
      const price = Number(primaryOfferPrice) / packSize * quantity;
      priceInput.value = Number.isFinite(price)
        ? String(Math.round((price + Number.EPSILON) * 10000) / 10000) : '';
    };
    form.elements.namedItem('packageQuantity')?.addEventListener('input', updatePrimaryPrice);
  }

  syncDirty();

  const save = async () => {
    if (primary.disabled || (!creating && signature() === initialSignature)) return;

    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    if (!name) {
      openNotice({ title: 'Наименование', message: 'Укажите наименование позиции.' });
      return;
    }
    const requestedPositionText = String(data.get('position') ?? '').trim();
    const requestedPosition = requestedPositionText === '' ? 0 : Number(requestedPositionText);
    if (!creating && (!Number.isSafeInteger(requestedPosition) || requestedPosition < 0)) {
      openNotice({ title: 'Порядок', message: 'Укажите целый положительный номер или оставьте поле пустым.' });
      return;
    }
    const value = {
      manufacturer: String(data.get('manufacturer') || '').trim(),
      name,
      unit: String(data.get('unit') || 'шт.'),
      packageQuantity: collectOptionalNumber(form, 'packageQuantity'),
      // Never overwrite the manual fallback when the primary supplier supplies the price.
      ...(!priceInput?.disabled ? { referencePrice: collectOptionalNumber(form, 'referencePrice') } : {}),
    };
    // The product card defines master data; only movements change stock balances.
    if (!creating) {
      const usage = String(data.get('usage') || 'consume');
      Object.assign(value, {
        productType: String(data.get('productType') || '').trim(),
        category: String(data.get('category') || '').trim(),
        supplier: String(data.get('supplier') || '').trim(),
        location: String(data.get('location') || '').trim(),
        sku: String(data.get('sku') || '').trim(),
        barcode: String(data.get('barcode') || '').trim(),
        position: requestedPosition,
        minStock: collectOptionalNumber(form, 'minStock'),
        targetStock: collectOptionalNumber(form, 'targetStock'),
        grossWeight: collectOptionalNumber(form, 'grossWeight'),
        tareWeight: collectOptionalNumber(form, 'tareWeight'),
        canConsume: usage === 'consume' || usage === 'both',
        canSell: usage === 'sale' || usage === 'both',
      });
    }
    primary.disabled = true;
    try {
      if (creating) {
        await createInventoryItem(value);
      } else {
        await updateInventoryItem(item.itemId, value);
      }
      layer.v2Close?.();
      onSaved();
    } catch (error) {
      primary.disabled = false;
      // Keep the Q and its unsaved fields visible; never signal success for a
      // backend that silently ignored the entered position.
      if (saveError) {
        saveError.textContent = error instanceof Error ? error.message : 'Ошибка склада';
        saveError.hidden = false;
      }
    }
  };
  primary.addEventListener('click', () => { void save(); });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });
  notifyContext();
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
  if (correcting && movement.kind === 'ADJUSTMENT'
      && movement.lines?.some(line => line.actualContainerCount != null)) {
    openNotice({ title: 'Инвентаризация', message: 'Для исправления физического пересчёта проведите новую инвентаризацию.' });
    return;
  }
  let actualKind = movement?.kind || kind;
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
        { value: 'WRITE_OFF', label: 'Списание' },
        { value: 'RETURN', label: 'Возврат' },
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
    if (event.target.matches?.('input[name="movementKind"]')) {
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
      const showContainers = isWeighedInventoryItem(item)
        && (['RECEIPT', 'RETURN', 'WRITE_OFF'].includes(actualKind) || previous?.containerDelta != null);
      const quantityPlaceholder = {
        RECEIPT: 'Поступило', CONSUMPTION: 'Израсходовано',
        WRITE_OFF: 'Списано', RETURN: 'Возвращено',
      }[actualKind] || 'Количество';
      const quantityInput = field({
        label: '', placeholder: `${quantityPlaceholder}, ${item.unit}`,
        name: `quantity-${item.itemId}`,
        value: previous?.quantity ?? '',
        type: 'number', min: '0', step: '0.001', inputmode: 'decimal',
      });
      const containerInput = showContainers ? field({
        label: '', placeholder: outgoing ? 'Тюбиков выбыло, шт.' : 'Тюбиков поступило, шт.',
        name: `containers-${item.itemId}`,
        value: containers, type: 'number', min: '0', step: '1', inputmode: 'numeric',
      }) : '';
      const balance = `${numberText(item.balance)} ${item.unit}`;
      return `<section data-inventory-movement-row data-item-id="${escapeHtml(item.itemId)}"
          data-row-direction="${escapeHtml(previous?.direction || '')}">
        <div class="field-inline-label"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(balance)}</span></div>
        ${showContainers
          ? twoColumnLayout(quantityInput, containerInput, { ariaLabel: `Количество и тара: ${item.name}` })
          : quantityInput}
      </section>`;
    }).join('');
    const editorMarkup = `<form class="form-grid" data-inventory-movement-form>
      ${actualKind === 'RECEIPT' && !correcting ? field({
        label: 'Поставщик', name: 'supplier', placeholder: 'Необязательно',
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
        lines.push({
          itemId, quantity,
          ...(direction ? { direction } : {}),
          ...(tubeCount != null ? { containerDelta: outgoing ? -tubeCount : tubeCount } : {}),
        });
      }
      if (!lines.length) { errorHost.textContent = 'Выберите материалы.'; return; }
      const values = new FormData(form);
      const note = String(values.get('note') || '').trim();
      saveButton.disabled = true;
      try {
        if (correcting) {
          await correctInventoryMovement(movement.movementId, { lines, note });
        } else {
          await createInventoryMovement({
            kind: actualKind,
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
    placeholder: 'Название, тип, артикул…',
    data,
  })}</div>`;
}

function manufacturerCardFields({ name, items } = {}) {
  const allItems = Array.isArray(items) ? items : [];
  const audit = inventoryManufacturerCompletion(allItems);
  const count = allItems.length;
  const ready = count - audit.incomplete;
  return [
    { value: 'manufacturer', label: 'Компания', text: name || '' },
    { value: 'count', label: 'Позиции', text: `${count} ${count === 1 ? 'позиция' : count > 1 && count < 5 ? 'позиции' : 'позиций'}` },
    { value: 'completion', label: 'Заполненность', text: `${audit.percentage}%` },
    { value: 'incomplete', label: 'Не заполнено', text: String(audit.incomplete) },
    { value: 'ready', label: 'Заполнено', text: String(ready) },
  ];
}

function manufacturerCardAppearance() {
  return getCardAppearanceTemplate('inventory-manufacturer')?.appearance || MANUFACTURER_CARD_APPEARANCE;
}

function stockManufacturerCardsMarkup(query = '') {
  const groups = manufacturerGroups(query);
  if (!getInventoryItems().length) return emptyState('Склад пуст', 'Добавьте первую позицию.');
  if (!groups.length) return emptyState('Ничего не найдено', 'Измените поиск или фильтр.');
  const cards = groups.map((group) => entityVisualCard({
    appearance: manufacturerCardAppearance(),
    fields: manufacturerCardFields(group),
    interactive: true,
    data: `data-inventory-manufacturer="${escapeHtml(group.name)}"`,
    aria: `Открыть товары ${group.name}`,
  }));
  return entityCardStack(cards);
}

function openManufacturerAppearance(root, onSaved = () => {}) {
  const samples = manufacturerGroups();
  const sample = samples[0] || { name: EMPTY_MANUFACTURER, items: [] };
  return openEntityCardAppearanceQ(root, {
    title: 'Вид',
    typeOptions: [{ value: 'inventory-manufacturer', label: 'Компания' }],
    initialType: 'inventory-manufacturer',
    resolve: () => ({
      appearance: manufacturerCardAppearance(),
      fields: manufacturerCardFields(sample),
    }),
    save: async ({ appearance }) => {
      saveCardAppearanceTemplate('inventory-manufacturer', { appearance });
    },
    allowPhoto: false,
    onSaved,
  });
}

function stockListMarkup(manufacturer, query = '') {
  const needle = normalizedSearch(query);
  const group = getInventoryItems().filter(item => manufacturerName(item) === manufacturer);
  const items = sortItems(group.filter((item) => {
    if (!matchesType(item, STOCK_VIEW.itemsType)) return false;
    return !needle || itemSearchText(item).includes(needle);
  }), STOCK_VIEW.itemsSort);
  if (!items.length) return emptyState('Ничего не найдено', 'Измените поиск или фильтр.');
  // Reordering a partial list would silently misplace hidden products.
  const canReorder = STOCK_VIEW.itemsSort === 'position-asc'
    && !needle && !STOCK_VIEW.itemsType && items.length > 1;
  return v2ListEntries(items.map((item) => v2ListEntry({
    title: `${Number(item.position) > 0 ? `${item.position} · ` : ''}${item.name}`,
    reorderHandle: canReorder,
    reorderAria: 'Изменить порядок материала',

    subtitle: [productTypeText(item), item.location, tubeCountText(item)].filter(Boolean).join(' · '),
    rightTop: `${numberText(item.balance)} ${item.unit}`,
    rightBottom: item.lastPurchasePrice == null ? '' : moneyText(item.lastPurchasePrice),
    interactive: true,
    initial: '',
    data: `data-inventory-item="${escapeHtml(item.itemId)}" data-reorder-id="${escapeHtml(item.itemId)}"`,
    aria: `Открыть ${item.name}`,
  })));
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
    { value: 'type-asc', label: 'По типу' },
    { value: 'balance-desc', label: 'Остаток: больше сначала' },
    { value: 'balance-asc', label: 'Остаток: меньше сначала' },
  ];
}

function openStockControls(trigger, level, manufacturer, onChange, mode = 'sort') {
  const sortKey = level === 'manufacturers' ? 'manufacturersSort' : 'itemsSort';
  const typeKey = level === 'manufacturers' ? 'manufacturersType' : 'itemsType';
  const isFilter = level === 'items' && mode === 'filter';
  let applied = STOCK_VIEW[typeKey];
  let draft = applied;
  const content = `<div data-inventory-stock-controls>
    ${mode !== 'filter' ? select({
      label: 'Сортировка',
      name: 'inventorySort',
      value: STOCK_VIEW[sortKey],
      options: stockSortOptions(level),
      aria: 'Сортировка остатков',
    }) : ''}
    ${isFilter ? select({
      label: 'Фильтр',
      name: 'inventoryType',
      value: draft,
      options: stockTypeOptions(manufacturer),
      aria: 'Фильтр по типу продукта',
    }) : ''}
    ${isFilter ? `<div class="modal-actions" data-inventory-stock-filter-actions hidden>
      ${button('Применить', { data: 'data-inventory-stock-filter-action' })}
    </div>` : ''}
  </div>`;
  const modalRoot = mountModal(trigger, modal(content, {
    title: mode === 'filter' ? 'Фильтр' : 'Сортировка',
    variant: 'x',
  }));
  modalRoot?.querySelector('input[name="inventorySort"]')?.addEventListener('change', (event) => {
    saveInventorySortMode(sortKey, event.target.value);
    onChange?.();
  });
  if (!isFilter || !modalRoot) return;
  const action = modalRoot.querySelector('[data-inventory-stock-filter-action]');
  const actions = modalRoot.querySelector('[data-inventory-stock-filter-actions]');
  const syncAction = () => {
    const changed = draft !== applied;
    const reset = !changed && Boolean(applied);
    actions.hidden = !changed && !reset;
    action.textContent = changed ? 'Применить' : 'Сбросить';
    action.classList.toggle('ui-button--secondary', reset);
  };
  modalRoot.querySelector('input[name="inventoryType"]')?.addEventListener('change', event => {
    draft = String(event.target.value || '');
    syncAction();
  });
  action.addEventListener('click', () => {
    if (draft !== applied) {
      applied = draft;
      STOCK_VIEW[typeKey] = applied;
      onChange?.();
      modalRoot.v2Close?.();
      return;
    }
    if (!applied) return;
    applied = '';
    draft = '';
    STOCK_VIEW[typeKey] = '';
    const input = modalRoot.querySelector('input[name="inventoryType"]');
    if (input) {
      input.value = '';
      const label = input.closest('.ui-select')?.querySelector('.ui-select__value');
      if (label) label.textContent = 'Все типы';
    }
    onChange?.();
    syncAction();
  });
  syncAction();
}
function bindManufacturerCards(root, host) {
  host.querySelectorAll('[data-inventory-manufacturer]').forEach((control) => {
    control.addEventListener('click', () => openManufacturerStock(root, control.dataset.inventoryManufacturer));
  });
}

function openManufacturerStock(root, manufacturer) {
  // Each visit to a physical shelf opens in the explicit numerical order.
  // A remembered name/price filter must not silently replace shelf sequence.
  saveInventorySortMode('itemsSort', 'position-asc');
  STOCK_VIEW.itemsType = '';
  const markup = `
    ${context(manufacturer, {
      v: { data: 'data-inventory-item-controls', aria: 'Сортировка и фильтр товаров' },
      c: { label: '+', data: 'data-inventory-add-item', aria: 'Добавить позицию' },
    })}
    <div data-inventory-company-list>${stockListMarkup(manufacturer)}</div>`;
  const layer = mountV2ZLayer(root, v2ZLayer(markup, { className: 'inventory-manufacturer-z' }), { stack: true });
  if (!layer) return;
  const [searchRow] = setV2ZHeaderRows(layer, [stockSearchField('', 'data-inventory-company-search')]);
  const searchInput = searchRow?.querySelector('[data-inventory-company-search]') || null;

  const listHost = layer.querySelector('[data-inventory-company-list]');
  let disposeReorder = () => {};
  const renderList = () => {
    disposeReorder();
    const query = searchInput?.value || '';
    if (listHost) listHost.innerHTML = stockListMarkup(manufacturer, query);
    listHost?.querySelectorAll('[data-inventory-item]').forEach((control) => control.addEventListener('click', () => {
      const itemId = control.dataset.inventoryItem;
      openInventoryProductOverview(itemId, {
        edit: (onSaved) => openItemEditor(root, itemId, {}, onSaved),
        onChanged: renderList,
      });
    }));
    if (STOCK_VIEW.itemsSort !== 'position-asc' || STOCK_VIEW.itemsType || normalizedSearch(query)) return;
    disposeReorder = initV2ListReorder(listHost, {
      onReorder: async (ids) => {
        await reorderInventoryItems(manufacturer === EMPTY_MANUFACTURER ? '' : manufacturer, ids);
        // The list is already in the correct DOM order after drop.
        // Refresh only visible number text; do not rebuild the Z or its rows.
        listHost?.querySelectorAll('[data-inventory-item]').forEach(node => {
          const item = getInventoryItem(node.dataset.inventoryItem);
          const label = node.querySelector('.list-entry__text > strong');
          if (item && label) label.textContent = `${item.position} · ${item.name}`;
        });
      },
      onError: (error) => {
        // An error inside the same Z stays readable after the transient
        // system notice is gone. Never mount another modal or shift Z itself.
        if (!listHost?.isConnected) return;
        let message = listHost.querySelector('[data-inventory-reorder-error]');
        if (!message) {
          message = document.createElement('div');
          message.className = 'form-error';
          message.dataset.inventoryReorderError = '';
          message.setAttribute('role', 'alert');
          listHost.prepend(message);
        }
        message.textContent = error instanceof Error
          ? error.message : 'Не удалось изменить порядок материалов.';
      },
    });
  };

  searchInput?.addEventListener('input', renderList);
  layer.querySelector('[data-inventory-item-controls]')?.addEventListener('click', () => {
    openSharedProfileSettingsMenu({
      title: '',
      actions: [
        {
          id: 'appearance',
          label: 'Вид',
          variant: 'secondary',
          onSelect: () => {
            // One shared inventory-item appearance for all products.
            // This product supplies only preview values in the existing card constructor.
            const sample = getInventoryItems().find((item) => manufacturerName(item) === manufacturer);
            if (sample) openInventoryProductAppearanceQ(sample.itemId, renderList);
          },
        },
        { id: 'sort', label: 'Сортировка', variant: 'secondary', onSelect: () => openStockControls(layer, 'items', manufacturer, renderList, 'sort') },
        { id: 'filter', label: 'Фильтр', variant: 'secondary', onSelect: () => openStockControls(layer, 'items', manufacturer, renderList, 'filter') },
        ...(canUseCapability('inventory.stocktake.access') ? [{
          id: 'inventory', label: 'Инвентаризация', variant: 'secondary',
          onSelect: () => openInventoryAuditSelection(layer, {
            manufacturer, onSaved: renderList,
          }),
        }] : []),
      ],
    });
  });
  layer.querySelector('[data-inventory-add-item]')?.addEventListener('click', () => openItemEditor(root, '', { manufacturer: manufacturer === EMPTY_MANUFACTURER ? '' : manufacturer }, renderList));
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
    left: line.name || getInventoryItem(line.itemId)?.name || 'Позиция',
    right: `${movementSign(line)}${numberText(line.quantity)} ${line.unit || getInventoryItem(line.itemId)?.unit || ''}`,
  })), { variant: 'split' });
  const physicalAudit = movement.kind === 'ADJUSTMENT' &&
    movement.lines?.some(line => line.actualContainerCount != null);
  const markup = `<div class="form-grid">
    ${movementMoment(movement.occurredAt) ? `<p>${escapeHtml(movementMoment(movement.occurredAt))}</p>` : ''}
    ${movement.personUei ? `<p>${escapeHtml(movement.personUei)}</p>` : ''}
    ${movementSubtitle(movement) ? `<p>${escapeHtml(movementSubtitle(movement))}</p>` : ''}
    ${lines}
    ${physicalAudit ? '' : actionBlock(button('Исправить', { data: 'data-inventory-movement-correct' }))}
  </div>`;
  const layer = mountModal(root, modal(markup, { title: movementTitle(movement), variant: 'q' }));
  layer?.querySelector('[data-inventory-movement-correct]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openMovementEditor(root, movementId);
  });
}

function orderMarkup() {
  const items = inventoryOrderSuggestions();
  if (!items.length) return emptyState('Заказывать пока нечего', 'Когда будет указан минимальный остаток, здесь появятся предложения.');
  return v2ListEntries(items.sort(inventoryPositionComparator).map((item) => v2ListEntry({
    title: item.name,
    subtitle: `Осталось ${numberText(item.balance)} ${item.unit}`,
    rightTop: `${numberText(item.suggestedQuantity)} ${item.unit}`,
    rightBottom: 'Рекомендация',
    initial: '',
  })));
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
  const number = Number(item.position);
  const prefix = Number.isSafeInteger(number) && number > 0 ? `№ ${number}` : 'Без №';
  const name = includeManufacturer ? `${manufacturerName(item)} · ${item.name}` : item.name;
  return `${prefix} · ${name}`;
}

function inventoryAuditFilters(items, manufacturer = '') {
  const definitions = [
    ['manufacturer', 'Производитель'],
    ['productType', 'Тип продукта'],
    ['category', 'Категория'],
    ['location', 'Место хранения'],
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
      next.textContent = `${isCommon() ? 'Применить' : 'Продолжить'} · ${selected.size}`;
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
    const selectedItems = inventoryAuditItems([...selected]);
    if (isCommon()) {
      busy = true;
      sync();
      try {
        const data = new FormData();
        data.set('auditValue', valueHost?.querySelector('[name="auditValue"]')?.value ?? '');
        await applyInventoryAuditDataChanges(layer, {
          items: selectedItems,
          definition: inventoryAuditFieldDefinition(fieldSelector?.value),
          perItem: false, data, status, submit: next, onSaved,
        });
      } finally {
        busy = false;
        sync();
      }
      return;
    }
    openInventoryAuditCriteria(layer, {
      mode: isData() ? 'data' : 'stock',
      ids: [...selected],
      fieldName: fieldSelector?.value || 'category',
      onSaved: () => { layer.v2Close?.(); onSaved(); },
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
  { value: 'category', label: 'Категория', kind: 'text' },
  { value: 'productType', label: 'Тип продукта', kind: 'text' },
  { value: 'name', label: 'Наименование', kind: 'text' },
  { value: 'manufacturer', label: 'Производитель', kind: 'text' },
  { value: 'position', label: 'Порядковый номер', kind: 'integer' },
  { value: 'sku', label: 'Артикул', kind: 'text' },
  { value: 'barcode', label: 'Штрихкод', kind: 'text' },
  { value: 'location', label: 'Место хранения', kind: 'text' },
  { value: 'supplier', label: 'Поставщик', kind: 'text' },
  { value: 'referencePrice', label: 'Цена', kind: 'decimal' },
  { value: 'unit', label: 'Единица', kind: 'unit' },
  { value: 'packageQuantity', label: 'Упаковка', kind: 'decimal' },
  { value: 'grossWeight', label: 'Брутто, г', kind: 'decimal' },
  { value: 'tareWeight', label: 'Тара, г', kind: 'decimal' },
  { value: 'minStock', label: 'Минимум', kind: 'decimal' },
  { value: 'targetStock', label: 'Цель', kind: 'decimal' },
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
  if (definition.value === 'referencePrice') return itemPrimaryPrice(item) ?? item.referencePrice;
  return item[definition.value];
}

function inventoryAuditDataControl(definition, name, { shared = false, locked = false } = {}) {
  const label = shared
    ? definition.value === 'position' ? 'Начальный номер (дальше по порядку)' : 'Новое значение'
    : '';
  if (locked) return field({ label, name, placeholder: 'Цена от поставщика', disabled: true });
  if (definition.kind === 'unit' || definition.kind === 'usage') return select({
    label, name, value: '',
    options: [{ value: '', label: shared ? 'Выберите значение' : 'Без изменения' },
      ...(definition.kind === 'unit' ? UNIT_OPTIONS : INVENTORY_AUDIT_USAGE)],
  });
  const integer = definition.kind === 'integer';
  const decimal = definition.kind === 'decimal';
  return field({
    label, name, value: '',
    placeholder: shared ? 'Введите значение' : 'Изменить',
    type: integer || decimal ? 'number' : 'text',
    ...(integer ? { min: '1', max: '2147483647', step: '1', inputmode: 'numeric' } : {}),
    ...(decimal ? { min: '0', step: 'any', inputmode: 'decimal' } : {}),
    autocomplete: 'off',
  });
}

function inventoryAuditDataRow(item, index, definition, includeManufacturer = false) {
  const name = inventoryAuditItemLabel(item, includeManufacturer);
  const current = inventoryAuditCurrentValue(item, definition);
  const shown = definition.value === 'usage'
    ? INVENTORY_AUDIT_USAGE.find(option => option.value === current)?.label || ''
    : String(current ?? '');
  const locked = definition.value === 'referencePrice' && itemPrimaryPrice(item) !== null;
  return `<div class="data-edit-row" role="group" aria-label="${escapeHtml(definition.label + ': ' + name)}">
    <span class="data-edit-row__name" title="${escapeHtml(name)}"><strong>${escapeHtml(name)}</strong>${shown ? ` <small>· ${escapeHtml(shown)}</small>` : ''}</span>
    ${inventoryAuditDataControl(definition, `auditItem-${index}`, { locked })}
  </div>`;
}

function inventoryAuditParseDataValue(definition, raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null; // Empty input means leave that item unchanged.
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
      throw new Error('Укажите корректное неотрицательное число' +
        (definition.kind === 'integer' ? ' (целый номер от 1)' : '') + '.');
    }
    return number;
  }
  return value;
}

function inventoryAuditDataPayload(definition, value) {
  if (definition.value === 'usage') return {
    canConsume: value === 'consume' || value === 'both',
    canSell: value === 'sale' || value === 'both',
  };
  return { [definition.value]: value };
}

function inventoryAuditValueMatches(item, definition, expected) {
  if (!item) return false;
  const actual = inventoryAuditCurrentValue(item, definition);
  if (definition.kind === 'decimal' || definition.kind === 'integer')
    return actual != null && Math.abs(Number(actual) - Number(expected)) < 0.00000001;
  return String(actual ?? '') === String(expected);
}

async function applyInventoryAuditDataChanges(layer, { items, definition, perItem, data, status, submit, onSaved }) {
  if (!definition) {
    status.textContent = 'Выберите характеристику.';
    return false;
  }
    if (!perItem && definition.value === 'referencePrice') {
      const locked = items.filter(item => itemPrimaryPrice(item) !== null);
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
        startingValue = inventoryAuditParseDataValue(definition, data.get('auditValue'));
        if (startingValue === null) throw new Error('Укажите новое значение.');
        if (definition.value === 'position' && startingValue + items.length - 1 > 2147483647)
          throw new Error('Диапазон порядковых номеров слишком велик.');
      }
      for (const [index, item] of items.entries()) {
        if (perItem && definition.value === 'referencePrice' && itemPrimaryPrice(item) !== null) continue;
        const raw = perItem ? data.get(`auditItem-${index}`) : data.get('auditValue');
        const value = perItem ? inventoryAuditParseDataValue(definition, raw)
          : definition.value === 'position' ? startingValue + index : startingValue;
        if (value === null) continue;
        if (definition.value === 'position') {
          const numberKey = `${manufacturerName(item)}::${value}`;
          if (uniqueNumbers.has(numberKey))
            throw new Error(`Номер ${value} повторяется у производителя «${manufacturerName(item)}».`);
          uniqueNumbers.add(numberKey);
        }
        targets.push({ itemId: item.itemId, manufacturer: manufacturerName(item), name: item.name, value });
      }
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Проверьте данные.';
      return;
    }
    if (!targets.length) {
      status.textContent = 'Введите значения хотя бы для одной позиции.';
      return;
    }
    const changes = targets.filter(entry =>
      !inventoryAuditValueMatches(getInventoryItem(entry.itemId), definition, entry.value));
    if (!changes.length) {
      status.textContent = 'У выбранных позиций уже указаны эти значения.';
      return;
    }
    submit.disabled = true;
    const failed = new Map();
    try {
      if (definition.value === 'position') {
        // Core shifts occupied slots when inserting a numbered product.
        // Serial writes plus a fresh snapshot are needed to verify final order.
        let pending = [...changes];
        for (let pass = 0; pass < 4 && pending.length; pass++) {
          for (const entry of pending.sort((a, b) =>
            a.manufacturer.localeCompare(b.manufacturer, 'ru', { numeric: true }) || a.value - b.value)) {
            if (failed.has(entry.itemId)) continue;
            try {
              await updateInventoryItem(entry.itemId, inventoryAuditDataPayload(definition, entry.value));
            } catch (error) {
              failed.set(entry.itemId, error instanceof Error ? error.message : 'Ошибка сохранения');
            }
          }
          await loadInventory();
          pending = changes.filter(entry => !failed.has(entry.itemId)
            && !inventoryAuditValueMatches(getInventoryItem(entry.itemId), definition, entry.value));
          status.textContent = `Проверено: ${changes.length - pending.length - failed.size} из ${changes.length}`;
        }
      } else {
        // Existing item API accepts a patch of individual master-data fields.
        for (let index = 0; index < changes.length; index += 4) {
          const batch = changes.slice(index, index + 4);
          const results = await Promise.allSettled(batch.map(entry =>
            updateInventoryItem(entry.itemId, inventoryAuditDataPayload(definition, entry.value))));
          results.forEach((result, offset) => {
            if (result.status === 'rejected') failed.set(batch[offset].itemId,
              result.reason instanceof Error ? result.reason.message : 'Ошибка сохранения');
          });
          status.textContent = `Обработано: ${Math.min(index + 4, changes.length)} из ${changes.length}`;
        }
        await loadInventory();
      }
      const unresolved = changes.filter(entry =>
        !inventoryAuditValueMatches(getInventoryItem(entry.itemId), definition, entry.value));
      if (unresolved.length || failed.size) {
        const examples = unresolved.slice(0, 2).map(entry => entry.name).join(', ');
        const detail = [...failed.values()][0];
        status.textContent = `Изменено ${changes.length - unresolved.length} из ${changes.length}. Не подтверждено: ${unresolved.length}.`
          + (examples ? ` ${examples}.` : '') + (detail ? ` ${detail}` : '');
        return;
      }
      layer.v2Close?.();
      onSaved();
      openNotice({ title: 'Инвентаризация', message: `Изменено ${changes.length} позиций.` });
      return true;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Не удалось сохранить данные.';
    } finally {
      if (submit.isConnected) submit.disabled = false;
    }
  return false;
}

function openInventoryAuditCriteria(root, { mode, ids = [], fieldName = 'category', onSaved = () => {} } = {}) {
  const items = inventoryAuditItems(ids);
  if (!items.length) return openNotice({ title: 'Инвентаризация', message: 'Позиции не найдены.' });
  const isData = mode === 'data';
  const includesDifferentManufacturers = new Set(items.map(manufacturerName)).size > 1;
  const definition = inventoryAuditFieldDefinition(fieldName);
  if (isData && !definition) return openNotice({ title: 'Данные', message: 'Выберите характеристику.' });
  const fields = isData
    ? `<div class="form-grid">${items.map((item, index) =>
      inventoryAuditDataRow(item, index, definition, includesDifferentManufacturers)).join('')}</div>`
    : `<div class="form-grid" data-inventory-audit-active>${items.map(inventoryAuditInput).join('')}</div>
       <details data-inventory-audit-excluded hidden>
         <summary data-inventory-audit-excluded-count>Исключено: 0</summary>
         <div class="form-grid" data-inventory-audit-excluded-list></div>
       </details>`;
  const markup = `<form data-inventory-audit-criteria>
    <p data-inventory-audit-included-count>${isData ? 'Выбрано' : 'В инвентаризации'}: ${items.length} позиций</p>
    ${fields}
    <p class="form-error" role="status" data-inventory-audit-status></p>
    ${actionBlock(button(isData ? 'Применить' : 'Сохранить', { type:'submit', data:'data-inventory-audit-apply' }))}
  </form>`;
  const layer = mountModal(root, modal(markup, {
    title: isData ? 'Инвентаризация данных' : 'Инвентаризация остатков',
    variant: 'q',
  }));
  if (!layer) return null;
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
      const match = /^(auditTubes|auditGross)-(\\d+)$/.exec(String(input?.name || ''));
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

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    const data = new FormData(form);
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
        layer.v2Close?.();
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
        layer.v2Close?.();
        onSaved();
        openNotice({ title: 'Инвентаризация', message: 'Остатки сохранены.' });
      } catch(error) {
        status.textContent = error instanceof Error ? error.message : 'Не удалось сохранить остатки.';
      } finally {
        saving = false;
        if (submit.isConnected) submit.disabled = false;
      }
      return;
    }

    saving = true;
    try {
      await applyInventoryAuditDataChanges(layer, {
        items, definition, perItem: true, data, status, submit, onSaved,
      });
    } finally {
      saving = false;
    }
  });
  return layer;
}


function renderStock(root) {
  STOCK_VIEW.manufacturersType = '';
  root.innerHTML = page([
    context('Остатки', {
      v: { data: 'data-inventory-stock-menu', aria: 'Настройки остатков' },
      c: { label: '+', data: 'data-inventory-add-item', aria: 'Добавить позицию' },
    }),
    '<div data-inventory-manufacturer-list></div>',
  ]);
  // Canonical Z1 header search: identical shell/spacing to Contacts.
  // Only manufacturer cards belong to the scrollable Z1 body.
  const [searchRow] = setV2ZHeaderRows(root, [`<div class="people-search ui-search-field">
    ${field({ name: 'inventorySearch', type: 'search', placeholder: 'Название, тип, артикул…', autocomplete: 'off', data: 'data-inventory-stock-search' })}
  </div>`]);
  const searchInput = searchRow?.querySelector('[data-inventory-stock-search]') || null;
  const listHost = root.querySelector('[data-inventory-manufacturer-list]');
  const renderManufacturers = () => {
    const query = searchInput?.value || '';
    if (listHost) listHost.innerHTML = stockManufacturerCardsMarkup(query);
    if (listHost) bindManufacturerCards(root, listHost);
  };
  searchInput?.addEventListener('input', renderManufacturers);
  root.querySelector('[data-inventory-stock-menu]')?.addEventListener('click', () => {
    openSharedProfileSettingsMenu({
      title: 'Настройки остатков',
      actions: [
        { id: 'appearance', label: 'Вид', onSelect: () => openManufacturerAppearance(root, renderManufacturers) },
        { id: 'controls', label: 'Сортировка', onSelect: () => openStockControls(root, 'manufacturers', '', renderManufacturers) },
        ...(canUseCapability('inventory.stocktake.access') ? [{
          id: 'inventory', label: 'Инвентаризация',
          onSelect: () => openInventoryAuditSelection(root, {
            onSaved: renderManufacturers,
          }),
        }] : []),
      ],
    });
  });
  root.querySelector('[data-inventory-add-item]')?.addEventListener('click', () => openItemEditor(root, '', {}, () => renderStock(root)));
  renderManufacturers();
  notifyContext();
}

function renderMovements(root) {
  root.innerHTML = `${context('Движения', {
    c: { label: '+', data: 'data-inventory-add-movement', aria: 'Добавить движение' },
  })}${movementJournalMarkup()}`;
  root.querySelector('[data-inventory-add-movement]')?.addEventListener('click', () => openMovementEditor(root, '', ''));
  root.querySelectorAll('[data-inventory-movement]').forEach((control) => control.addEventListener('click', () => openMovementDetails(root, control.dataset.inventoryMovement)));
  notifyContext();
}

function renderOrders(root) {
  root.innerHTML = `${context('Заказ')}${orderMarkup()}`;
  notifyContext();
}

export async function renderInventory(root, section = 'stock') {
  root.innerHTML = emptyState('Склад', 'Загружаем данные…');
  try {
    await Promise.all([
      loadInventory(),
      ...(section === 'stock' ? [loadAuxiliaryState('service')] : []),
    ]);
  } catch (error) {
    root.innerHTML = emptyState('Склад недоступен', error instanceof Error ? error.message : 'Не удалось загрузить данные.');
    return () => {};
  }

  if (section === 'movements') renderMovements(root);
  else if (section === 'orders') renderOrders(root);
  else renderStock(root);
  return () => {};
}
