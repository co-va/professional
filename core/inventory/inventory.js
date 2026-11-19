import {
  actionBlock,
  button,
  compactButton,
  details,
  columnLayout,
  datePicker,
  initDatePickers,
  emptyState,
  entityVisualCard,
  entityCardStack,
  field,
  textareaField,
  modal,
  mountModal,
  mountV2ZLayer,
  openNotice,
  openEntityCardAppearanceQ,
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
  v2Section,
  v2ZLayer,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { compactCheck } from '../../ui/selection/check-list.js';
import { canUseCapability } from '../access.js';
import { setSharedActionVisible } from '../../ui/page/page.js';
import { getCardAppearanceTemplate, saveCardAppearanceTemplate } from '../card-appearance-templates.js';
import {
  inventoryManufacturerCompletion, isWeighedInventoryItem, netStocktakeGrams,
  inventoryStockThresholdInput, inventoryStockThresholdStored, inventoryStockThresholdUnit,
} from './completeness.js';
import { openInventoryProductAppearanceQ, openInventoryProductOverview } from './product-overview.js';
import { renderInventoryOrders, openInventoryOrderFromSelection } from './orders.js';
import { classificationOptions, openInventoryClassificationGroups,
  inventoryCriterionGroups, criterionOptions } from './classification.js';
import { openInventoryStorageLocations, reconcileLegacyInventoryStorage } from './storage.js';
import { openInventoryTransfer } from './movement-transfer.js';
import { renderStockBrandList, buildStockCatalogGroups } from './stock-catalog.js';
import { catalogDisclosure } from './catalog-ui.js';
import { INVENTORY_TOTAL_SCOPE, inventoryDisplayBalance, inventoryDisplayTarget,
  inventoryItemBelongsToStorage, itemLocationBalance, inventoryLocations,
  openInventoryStockTargets, storageName } from './stock-targets.js';
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
  createInventoryItem,
  createInventoryMovement,
  loadInventory,
  loadInventoryCriteria,
  reorderInventoryCriterionValues,
  clearInventoryItemPositions,
  updateInventoryItem,
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
  return [{ value: '', label: 'Все подкатегории' }, ...values.map((value) => ({ value, label: value }))];
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


const INVENTORY_CARD_UNITS = [
  ...UNIT_OPTIONS,
  { value: 'кг', label: 'кг' }, { value: 'л', label: 'л' },
  { value: 'м', label: 'м' }, { value: 'см', label: 'см' },
  { value: 'м²', label: 'м²' }, { value: 'пара', label: 'пара' },
  { value: 'компл.', label: 'компл.' },
];

// Receipt, physical contents and consumption are different dimensions.
// Do not offer volume or mass as a receipt unit, or packs as one-piece nominal.
const INVENTORY_RECEIPT_UNITS = [{ value: 'шт.', label: 'шт.' }, { value: 'уп.', label: 'уп.' }];
const INVENTORY_CONSUMPTION_UNITS = [
  { value: 'шт.', label: 'шт.' }, { value: 'мл', label: 'мл' }, { value: 'г', label: 'г' },
  { value: 'л', label: 'л' }, { value: 'кг', label: 'кг' },
];
const INVENTORY_PACK_CONTENT_UNITS = [
  { value: 'шт.', label: 'шт.' }, { value: 'г', label: 'г' }, { value: 'кг', label: 'кг' },
  { value: 'мл', label: 'мл' }, { value: 'л', label: 'л' },
];
const INVENTORY_PIECE_NOMINAL_UNITS = [
  { value: 'шт.', label: 'шт.' }, { value: 'г', label: 'г' }, { value: 'кг', label: 'кг' },
  { value: 'мл', label: 'мл' }, { value: 'л', label: 'л' },
];
function retainLegacyUnit(options, value) {
  return !value || options.some(row => row.value === value)
    ? options : [...options, { value, label: value + ' (ранее)' }];
}
// The API stores stock units per receipt unit, not a separate pack piece count.
// Reconstruct count only when stock-unit and per-piece conversion are known.
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
// Restores the packaging as recorded, never guesses "N pieces" from grams.
function inventoryPackContent(item = {}) {
  if (item.receiptUnit !== 'уп.') return { quantity: '', unit: 'шт.' };
  const count = inventoryPackPieceCount(item);
  if (count) return { quantity: count, unit: 'шт.' };
  const stock = String(item.unit || '');
  const stored = Number(item.packageQuantity);
  const nominal = Number(item.nominalQuantity);
  const nominalUnit = String(item.nominalUnit || '');
  const factor = nominalUnit === stock ? 1
    : nominalUnit === 'кг' && stock === 'г' || nominalUnit === 'л' && stock === 'мл' ? 1000
    : nominalUnit === 'г' && stock === 'кг' || nominalUnit === 'мл' && stock === 'л' ? 0.001 : null;
  if (nominal > 0 && stored > 0 && factor != null) {
    if (Math.abs(nominal * factor - stored) < 0.001
        && INVENTORY_PACK_CONTENT_UNITS.some(row => row.value === nominalUnit))
      return { quantity: String(nominal), unit: nominalUnit };
    // Old records may be N separate nominal pieces without an explicit
    // piece conversion. Never re-label their total volume as a bulk pack.
    return { quantity: '', unit: 'шт.' };
  }
  if (stored > 0 && ['г', 'мл'].includes(stock)) return { quantity: String(stored), unit: stock };
  return { quantity: '', unit: 'шт.' };
}
function inventoryBaseContentUnit(unit) {
  return unit === 'кг' ? 'г' : unit === 'л' ? 'мл' : unit;
}
function inventoryContentInBaseUnits(quantity, unit) {
  const factor = ['кг', 'л'].includes(unit) ? 1000 : 1;
  const value = Number(quantity) * factor;
  return Number.isFinite(value) && value > 0 ? value : null;
}
// Keep physical stock in pieces until a measured conversion is known.
function inventoryNewStockUnit({ receipt, packUnit, consumeUnit, saleUnit, nominalUnit,
  nominalQuantity, netWeight } = {}) {
  if (receipt === 'уп.' && packUnit && packUnit !== 'шт.') return inventoryBaseContentUnit(packUnit);
  const requested = [consumeUnit, saleUnit].find(unit => ['г','мл','кг','л'].includes(unit));
  if (!requested) return 'шт.';
  const base = inventoryBaseContentUnit(requested);
  if (base === inventoryBaseContentUnit(nominalUnit) && Number(nominalQuantity) > 0) return base;
  if (base === 'г' && netWeight > 0) return base;
  return 'шт.';
}
function inventoryStockPerPiece(stockUnit, nominalUnit, nominalQuantity, netWeight) {
  if (stockUnit === 'шт.') return 1;
  // When weighing the contents, use measured net mass (gross minus tare),
  // not a printed nominal or an assumed ml-to-gram equivalence.
  if (stockUnit === 'г' && netWeight > 0) return netWeight;
  if (stockUnit === inventoryBaseContentUnit(nominalUnit) && nominalQuantity > 0)
    return inventoryContentInBaseUnits(nominalQuantity, nominalUnit);
  return null;
}

const RESOURCE_UNIT_OPTIONS = [
  { value: 'проц.', label: 'проц.' }, { value: 'примен.', label: 'примен.' },
  { value: 'цикл', label: 'цикл' }, { value: 'ч', label: 'ч' },
  { value: 'дн.', label: 'дн.' }, { value: 'км', label: 'км' },
];

function itemPrimaryPrice(item = {}) {
  const price = Number(item.basePrice);
  return item.primaryOfferId && item.basePriceSource === 'primary-offer'
    && item.basePrice != null && Number.isFinite(price) ? price : null;
}

function editorDate(value) {
  return value ? String(value).slice(0, 10) : '';
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

// Shared input and selector owners supply the controls. Only their placement is local.
function editorNumber({ label, name, value = '', unit = '', ...opts } = {}) {
  return '<div class="inventory-editor-number">' +
    field({ label, name, value, type: 'number', inputmode: 'decimal', min: '0', step: 'any', ...opts }) +
    '<span class="inventory-editor-number__suffix" data-inventory-unit-for="' + escapeHtml(name) + '">' + escapeHtml(unit) + '</span>' +
    '</div>';
}

function editorPanel(title, body, key, { controls = '', opened = true, nested = false } = {}) {
  // Native details/summary is the same disclosure mechanism as orders.
  // The checkbox is a sibling of details so it never collapses the section.
  return '<section class="inventory-editor-panel' + (nested ? ' inventory-editor-panel--nested' : '') +
    '" data-inventory-panel="' + escapeHtml(key) + '">' +
    '<details' + (opened ? ' open' : '') + '><summary class="inventory-editor-summary">' +
      escapeHtml(title) + '</summary><div class="inventory-editor-panel__body">' + body + '</div></details>' +
    (controls ? '<div class="inventory-editor-heading__controls">' + controls + '</div>' : '') +
    '</section>';
}

function parseSaleMarkup(raw) {
  const input = String(raw ?? '').trim().replace(',', '.');
  if (!input) return { mode: 'percent', value: null };
  const matched = input.match(/^(\d+(?:\.\d+)?)\s*(%|₽|руб\.?)?$/i);
  if (!matched) throw new Error('Наценка: укажите 20% или 200 ₽.');
  const value = Number(matched[1]);
  if (!Number.isFinite(value) || value < 0) throw new Error('Неверная наценка.');
  return { mode: /^(₽|руб)/i.test(matched[2] || '') ? 'amount' : 'percent', value };
}


/**
 * Purchase price is for one receipt unit; sale price is for saleQuantity
 * units of saleUnit. Convert through known inventory stock quantities only.
 * Unknown package / physical conversions must never be assumed to be 1:1.
 */
function salePurchaseCost({ purchasePrice, receiptUnit, stockUnit, saleUnit,
  saleQuantity = 1, packageQuantity, nominalQuantity, nominalUnit, packPieces, conversionRules = [] } = {}) {
  if (purchasePrice == null || String(purchasePrice).trim() === '') return null;
  const purchase = Number(purchasePrice);
  const amount = saleQuantity == null || saleQuantity === '' ? 1 : Number(saleQuantity);
  if (!Number.isFinite(purchase) || purchase < 0 || !Number.isFinite(amount) || amount <= 0
      || !receiptUnit || !saleUnit) return null;
  if (receiptUnit === saleUnit) return purchase * amount;
  // N pieces in a purchase pack. Nominal is always per ONE piece.
  const count = receiptUnit === 'уп.' ? Number(packPieces) : 1;
  if (receiptUnit === 'уп.' && count > 0 && saleUnit === 'шт.') return purchase * amount / count;

  const metricFactor = (from, to) => {
    if (from === to) return 1;
    const factors = { 'кг>г': 1000, 'г>кг': 0.001, 'л>мл': 1000, 'мл>л': 0.001 };
    return factors[from + '>' + to] ?? null;
  };
  // One piece has nominalQuantity of nominalUnit. A pack has count pieces.
  if (['уп.', 'шт.'].includes(receiptUnit) && count > 0 && Number(nominalQuantity) > 0) {
    const converted = metricFactor(nominalUnit, saleUnit);
    if (converted != null) return purchase * amount / (count * Number(nominalQuantity) * converted);
  }
  // Direct metric conversion does not need inventory stock granularity.
  const direct = metricFactor(receiptUnit, saleUnit);
  if (direct != null) return purchase * amount / direct;

  const stockPerUnit = (unit) => {
    if (!unit || !stockUnit) return null;
    const directMetric = metricFactor(unit, stockUnit);
    if (directMetric != null) return directMetric;
    if (unit === receiptUnit && Number(packageQuantity) > 0) return Number(packageQuantity);
    const rule = conversionRules.find(row => row.unit === unit && Number(row.stockPerUnit) > 0);
    if (rule) return Number(rule.stockPerUnit);
    // Conversion between physical contents and the known nominal.
    if (unit === nominalUnit && Number(packageQuantity) > 0 && Number(nominalQuantity) > 0
        && ['уп.', 'шт.'].includes(receiptUnit)) {
      return Number(packageQuantity) / Number(nominalQuantity);
    }
    return null;
  };
  const stockPerReceipt = stockPerUnit(receiptUnit);
  const stockPerSale = stockPerUnit(saleUnit);
  if (!(stockPerReceipt > 0) || !(stockPerSale > 0)) return null;
  return purchase * amount * stockPerSale / stockPerReceipt;
}

function markedUpSalePrice(cost, markup) {
  if (cost == null || !Number.isFinite(cost) || markup?.value == null) return null;
  const value = markup.mode === 'amount' ? cost + markup.value : cost * (1 + markup.value / 100);
  return Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : null;
}

function inventoryCalculationUnit(item = {}) {
  return UNIT_OPTIONS.some(option => option.value === item.unit) ? item.unit : 'шт.';
}
const STOCK_DISPOSAL_UNITS = UNIT_OPTIONS;

function stockDisposalFields(item = {}, purpose = 'consume') {
  const sale = purpose === 'sale';
  const key = sale ? 'sale' : 'consume';
  const unit = item[key + 'Unit'] || item.unit || 'шт.';
  return '<div class="inventory-editor-disposal" data-inventory-use="' + key + '">' +
    '<div class="inventory-editor-row" data-inventory-disposal-row="' + key + '">' +
      select({ label: sale ? 'Ед. продажи' : 'Ед. списания', name: key + 'Unit', value: unit, options: retainLegacyUnit(sale ? INVENTORY_CARD_UNITS : INVENTORY_CONSUMPTION_UNITS, unit) }) +
      editorNumber({ label: 'Количество', name: key + 'Quantity', value: item[key + 'Quantity'] ?? '', unit }) +
    '</div></div>';
}

function itemMassFields(item = {}) {
  return '<div class="inventory-editor-row inventory-editor-row--three" data-inventory-gross-net-tare>' +
    editorNumber({ label: 'Брутто', name: 'grossWeight', value: item.grossWeight ?? '', unit: 'г', data: 'aria-label="Брутто, г"' }) +
    editorNumber({ label: 'Тара', name: 'tareWeight', value: item.tareWeight ?? '', unit: 'г', data: 'aria-label="Тара, г"' }) +
    editorNumber({ label: 'Нетто', name: 'netWeight', value: item.netPackageWeight ?? '', unit: 'г', readonly: true, data: 'aria-label="Нетто, г"' }) +
    '</div>';
}

function itemNetOnlyFields(item = {}) {
  const net = item.grossWeight != null && Number(item.tareWeight) === 0
    ? item.grossWeight : '';
  return '<div data-inventory-net-only>' +
    editorNumber({ label: 'Вес содержимого', name: 'netOnlyWeight', value: net, unit: 'г' }) +
    '</div>';
}

function itemPackageFields(item = {}) {
  const content = inventoryPackContent(item);
  return '<div class="inventory-editor-measure" data-inventory-pack-count hidden>' +
    '<span class="inventory-editor-label">В упаковке</span>' +
    '<div class="inventory-editor-measure__control">' +
      field({ name: 'packContentQuantity', value: content.quantity, type: 'number',
        min: '0.001', step: 'any', inputmode: 'decimal' }) +
      select({ name: 'packContentUnit', aria: 'Единица содержимого упаковки',
        value: content.unit, options: INVENTORY_PACK_CONTENT_UNITS }) +
    '</div></div>' +
    // Internal API quantity in accounting units, never a second input.
    '<input type="hidden" name="packageQuantity" value="' + escapeHtml(item.packageQuantity ?? '') + '">';
}

function advancedItemFields(item = {}, defaults = {}) {
  const primaryPrice = itemPrimaryPrice(item);
  const price = primaryPrice ?? item.referencePrice ?? '';
  const receipt = item.receiptUnit || (item.itemId ? '' : 'шт.');
  const threshold = item.thresholdUnit || receipt || inventoryStockThresholdUnit(item);
  const isResource = item.resourceLimit != null && Boolean(item.resourceUnit);
  const isPeriod = Boolean(item.serviceStartAt || item.serviceEndAt);
  const identity = '<div class="inventory-editor-group">' +
    field({ label: 'Наименование', name: 'name', value: item.name || '', required: true, autocomplete: 'off' }) +
    '<div class="inventory-editor-row inventory-editor-row--receipt" data-inventory-receipt-row>' +
      '<div class="inventory-editor-measure inventory-editor-measure--receipt" data-inventory-receipt-choices>' +
        '<span class="inventory-editor-label">Ед. прихода</span>' +
        '<div class="inventory-editor-extra-toggles">' +
          compactCheck({ label: 'Шт.', checked: receipt === 'шт.', data: 'data-inventory-receipt-choice="шт."' }) +
          compactCheck({ label: 'Уп.', checked: receipt === 'уп.', data: 'data-inventory-receipt-choice="уп."' }) +
        '</div>' +
        '<input type="hidden" name="receiptUnit" value="' + escapeHtml(receipt) + '">' +
      '</div>' +
      itemPackageFields(item) +
    '</div>' +
    '<div class="inventory-editor-row inventory-editor-row--nominal">' +
      '<div class="inventory-editor-measure" data-inventory-one-piece-nominal>' +
        '<span class="inventory-editor-label" data-inventory-nominal-label>Номинал</span>' +
        '<div class="inventory-editor-measure__control">' +
          field({ name: 'nominalQuantity', value: item.nominalQuantity ?? '', type: 'number', min: '0.001', step: 'any', inputmode: 'decimal' }) +
          select({ name: 'nominalUnit', aria: 'Единица номинала', value: item.nominalUnit || '', options: [{ value: '', label: '—' }, ...retainLegacyUnit(INVENTORY_PIECE_NOMINAL_UNITS, item.nominalUnit)] }) +
        '</div></div>' +
      editorNumber({ label: 'Закупка', name: 'purchasePrice', value: price, unit: '₽', disabled: primaryPrice !== null }) +
    '</div>' +
    (!item.itemId ? '<p class="inventory-editor-label">Остальные сведения можно заполнить позже.</p>' : '') +
    '</div>';

  // Optional usage modes share one row. Basic consumption remains the default.
  const saleFields = '<div class="inventory-editor-group">' +
    stockDisposalFields(item, 'sale') +
    '<div class="inventory-editor-row" data-inventory-sale-price-row>' +
      field({ label: 'Наценка', name: 'saleMarkup',
        value: item.saleMarkupValue == null ? '' : String(item.saleMarkupValue) + (item.saleMarkupMode === 'amount' ? ' ₽' : '%'),
        placeholder: '20% / 200 ₽' }) +
      editorNumber({ label: 'Цена продажи', name: 'salePrice', value: item.salePrice ?? '', unit: '₽', data: 'aria-label="Цена продажи, ₽"' }) +
    '</div></div>';
  const resourceFields = '<div class="inventory-editor-row inventory-editor-row--three" data-inventory-resource-fields>' +
    editorNumber({ label: 'Ресурс', name: 'resourceLimit', value: item.resourceLimit ?? '', unit: item.resourceUnit || 'проц.' }) +
    select({ label: 'Ед. ресурса', name: 'resourceUnit', value: item.resourceUnit || 'проц.', options: RESOURCE_UNIT_OPTIONS }) +
    select({ label: 'По окончании', name: 'resourceExhaustionAction', value: item.resourceExhaustionAction || 'REVIEW',
      options: [{ value: 'REVIEW', label: 'Проверить' }, { value: 'WRITE_OFF', label: 'Списать' }] }) +
    '</div>';
  const periodFields = '<div class="inventory-editor-row" data-inventory-period-fields>' +
    datePicker({ label: 'Дата с', name: 'serviceStartAt', value: editorDate(item.serviceStartAt),
      placeholder: 'Выбрать дату', modalSurface: 'app' }) +
    datePicker({ label: 'Дата по', name: 'serviceEndAt', value: editorDate(item.serviceEndAt),
      placeholder: 'Выбрать дату', modalSurface: 'app' }) +
    '</div>';
  const usage = '<div class="inventory-editor-group">' +
    '<input type="hidden" name="usage" value="' + escapeHtml(itemUsageMode(item)) + '">' +
    '<input type="hidden" name="calculationUnit" value="' + escapeHtml(inventoryCalculationUnit(item)) + '">' +
    stockDisposalFields(item, 'consume') +
    '<div data-inventory-container-mode>' +
      select({ label: 'Тара', name: 'containerMode', value: item.containerMode || (item.grossWeight != null || item.tareWeight != null ? 'WITH' : ''), options: [
        { value: '', label: 'Не указана' }, { value: 'WITH', label: 'С тарой' }, { value: 'NONE', label: 'Без тары' },
      ] }) +
    '</div>' +
    itemMassFields(item) +
    itemNetOnlyFields(item) +
    '<input type="hidden" name="resourceEnabled" value="' + (isResource ? '1' : '0') + '">' +
    '<input type="hidden" name="periodEnabled" value="' + (isPeriod ? '1' : '0') + '">' +
    editorPanel('Продажа', saleFields, 'sale', {
      nested: true, opened: false,
      controls: compactCheck({ checked: item.canSell === true, aria: 'Использовать продажу',
        data: 'data-inventory-usage-check="sale"' }),
    }) +
    editorPanel('Ресурс', resourceFields, 'resource', {
      nested: true, opened: false,
      controls: compactCheck({ checked: Boolean(isResource), aria: 'Использовать ресурс',
        data: 'data-inventory-extra-check="resource"' }),
    }) +
    editorPanel('Срок', periodFields, 'period', {
      nested: true, opened: false,
      controls: compactCheck({ checked: isPeriod, aria: 'Использовать срок',
        data: 'data-inventory-extra-check="period"' }),
    }) +
    '</div>';

  const criteriaFields = inventoryCriterionGroups().map(group=>{
    const key=group.legacyField || 'criteriaValue:'+group.id;
    const current=group.legacyField
      ? String(item[group.legacyField] || defaults[group.legacyField] || '')
      : String(item.criteriaValues?.[group.id] || defaults.criteriaValues?.[group.id] || '');
    return select({label:group.name,name:key,value:current,
      options:criterionOptions(group,current)});
  }).join('');
  const classification = '<div class="inventory-editor-group">' +
    field({ label: 'Полное наименование', name: 'catalogName', value: item.catalogName || '' }) +
    criteriaFields +
    columnLayout([
      field({ label: '№', name: 'position', value: Number(item.position) > 0 ? item.position : '',
        type: 'number', min: '1', step: '1', inputmode: 'numeric' }),
      field({ label: 'Артикул', name: 'sku', value: item.sku || '' }),
      field({ label: 'Штрихкод', name: 'barcode', value: item.barcode || '' }),
    ], { columns: 3, ariaLabel: 'Порядок, артикул и штрихкод' }) +
    '</div>';
  const stock = '<div class="inventory-editor-group">' +
    select({ label: 'Единица запаса', name: 'thresholdUnit', value: threshold,
      options: retainLegacyUnit(INVENTORY_PACK_CONTENT_UNITS, threshold) }) +
    '<div class="inventory-editor-row">' +
      editorNumber({ label: 'Критический', name: 'minStock', value: inventoryStockThresholdInput(item, item.minStock), unit: threshold, data: 'aria-label="Критический остаток"' }) +
      editorNumber({ label: 'Желаемый', name: 'targetStock', value: inventoryStockThresholdInput(item, item.targetStock), unit: threshold, data: 'aria-label="Желаемый остаток"' }) +
    '</div></div>';
  return '<div class="inventory-item-accordion">' +
    editorPanel('Складская единица', identity, 'identity', {
      controls: compactButton({ kind: 'info', data: 'data-inventory-unit-help', aria: 'Как заполнить складскую единицу' }),
    }) +
    editorPanel('Использование', usage, 'usage', { opened: Boolean(item.itemId) }) +
    editorPanel('Классификация', classification, 'classification', { opened: false }) +
    editorPanel('Запас и контроль', stock, 'stock', { opened: Boolean(item.itemId) }) +
    '</div>';
}

function collectOptionalNumber(form, name) {
  const raw = String(new FormData(form).get(name) ?? '').trim();
  return raw === '' ? null : Number(raw.replace(',', '.'));
}

export function openItemEditor(root, itemId = '', defaults = {}, onSaved = () => {}) {
  const item = itemId ? getInventoryItem(itemId) : null;
  const creating = !item;
  const draft = item || {
    unit: 'шт.', name: defaults.name || '', manufacturer: defaults.manufacturer || '',
    sku: defaults.sku || '', barcode: defaults.barcode || '',
    canConsume: defaults.usage !== 'sale', canSell: defaults.usage === 'sale',
  };
  const markup = `
    <form data-inventory-item-form>
      ${advancedItemFields(draft, defaults)}
      ${actionBlock(button(creating ? 'Применить' : 'Сохранить', { type: 'button', data: 'data-inventory-item-save', aria: creating ? 'Добавить складскую единицу' : 'Сохранить складскую единицу' }))}
      <div class="form-error" data-inventory-item-save-error role="alert" hidden></div>
    </form>`;
  const layer = mountModal(document.body, modal(markup, {
    title: creating ? 'Новая складская единица' : item.name,
    variant: 'q',
    surface: 'app',
  }));
  if (!layer) return;


  const form = layer.querySelector('[data-inventory-item-form]');
  initDatePickers(form);
  layer.querySelector('[data-inventory-unit-help]')?.addEventListener('click', () => {
    const help = '<div class="modal-title"><h2>Складская единица</h2>' +
      '<p>1. Выберите приход: шт. или уп. Для упаковки укажите 10 шт., 5 кг или 900 г.</p>' +
      '<p>2. Если это ампулы или другие отдельные штуки, номинал — объём одной штуки (например, 5 мл). Если это сахар или земля, второго номинала нет.</p>' +
      '<p>3. Выберите удобный расход. Массу тары, точную норму и цену можно внести позже. Неизвестные значения не мешают создать позицию.</p>' +
      '<p>Примеры: пилки — уп. 10 шт., расход 1 шт.; сахар — уп. 1000 г, расход 5 г; краситель — шт., номинал 80 мл, расход г после измерения.</p></div>';
    mountModal(document.body, modal(help, { title: 'Складская единица', variant: 'technical', surface: 'app' }));
  });
  const primary = layer.querySelector('[data-inventory-item-save]');
  const saveError = layer.querySelector('[data-inventory-item-save-error]');
  const actions = primary?.closest('.modal-actions');
  const input = (name) => form.elements.namedItem(name);
  const pressed = (kind) => kind === 'consume'
    ? draft.canConsume !== false
    : Boolean(form.querySelector('[data-inventory-usage-check="sale"]')?.checked);
  const extraOn = (kind) => Boolean(form.querySelector('[data-inventory-extra-check="' + kind + '"]')?.checked);
  const signature = () => JSON.stringify([...new FormData(form).entries()]
    .filter(([name]) => name !== 'netWeight')
    .map(([name, value]) => [name, typeof value === 'string' ? value : '']));
  let initialSignature = '';
  let initialFormFields = new Map();
  const syncDirty = () => {
    if (!creating) setSharedActionVisible(actions, signature() !== initialSignature);
  };
  const netInput = input('netWeight');
  const purchaseInput = input('purchasePrice');
  const markupInput = input('saleMarkup');
  const sellingInput = input('salePrice');
  // For a new item, the nominal unit initially owns the consumption unit.
  // An explicit choice of a different consumption unit always wins.
  let consumptionUnitEdited = !creating;
  let thresholdUnitEdited = !creating;
  const primaryOffer = item?.supplierOffers?.find((offer) => offer.offerId === item.primaryOfferId);
  const primaryOfferPrice = primaryOffer?.effectivePrice == null
    ? (primaryOffer?.actualPrice ?? (primaryOffer?.listPrice == null ? null
      : Number(primaryOffer.listPrice) * (1 - Number(primaryOffer.discountPercent || 0) / 100)))
    : primaryOffer.effectivePrice;

  const setNumberUnit = (name, unit) => {
    const suffix = form.querySelector('[data-inventory-unit-for="' + name + '"]');
    if (suffix) suffix.textContent = unit || '';
  };
  // Programmatic selection must update both Shared select's hidden value and
  // its visible trigger, without replacing the shared UI component.
  const setSelectValue = (name, value) => {
    const fieldInput = input(name);
    if (!fieldInput || fieldInput.value === value) return;
    const trigger = fieldInput.closest('.ui-select')?.querySelector('[data-ui-select-trigger]');
    const options = JSON.parse(trigger?.dataset.options || '[]');
    fieldInput.value = value;
    const text = trigger?.querySelector('.ui-select__value');
    if (text) text.textContent = options.find(row => row.value === value)?.label || value;
  };
  const updateNet = () => {
    const mode = String(input('containerMode')?.value || '');
    if (mode === 'NONE') {
      const value = Number(String(input('netOnlyWeight')?.value || '').replace(',', '.'));
      return Number.isFinite(value) && value > 0 ? value : null;
    }
    const grossRaw = String(input('grossWeight')?.value || '').trim();
    const tareRaw = String(input('tareWeight')?.value || '').trim();
    const gross = Number(grossRaw.replace(',', '.'));
    const tare = Number(tareRaw.replace(',', '.'));
    const net = grossRaw && tareRaw && Number.isFinite(gross) && Number.isFinite(tare)
      && gross > tare && tare >= 0 ? gross - tare : null;
    if (netInput) netInput.value = net === null ? '' : numberText(net);
    return net;
  };
  const updatePrimaryPrice = () => {
    if (!purchaseInput?.disabled || primaryOfferPrice == null) return;
    const packSize = Number(primaryOffer?.unitsPerOffer) || 1;
    const entered = Number(input('packageQuantity')?.value);
    const net = updateNet();
    const quantity = entered > 0 ? entered : net > 0 ? net : 1;
    const price = Number(primaryOfferPrice) / packSize * quantity;
    purchaseInput.value = Number.isFinite(price)
      ? String(Math.round((price + Number.EPSILON) * 10000) / 10000) : '';
  };
  const saleCost = (purchasePrice) => salePurchaseCost({
    purchasePrice,
    receiptUnit: String(input('receiptUnit')?.value || ''),
    stockUnit: String(input('calculationUnit')?.value || ''),
    saleUnit: String(input('saleUnit')?.value || ''),
    saleQuantity: input('saleQuantity')?.value,
    packageQuantity: input('packageQuantity')?.value,
    nominalQuantity: input('nominalQuantity')?.value,
    nominalUnit: String(input('nominalUnit')?.value || ''),
    packPieces: input('receiptUnit')?.value === 'уп.'
      && input('packContentUnit')?.value === 'шт.' ? input('packContentQuantity')?.value : null,
    conversionRules: item?.conversionRules || [],
  });
  const deriveSellingPrice = () => {
    if (!sellingInput || !markupInput?.value.trim()) return;
    try {
      const price = markedUpSalePrice(saleCost(purchaseInput?.value), parseSaleMarkup(markupInput.value));
      // Never keep a package-level price when the requested unit cannot be converted.
      sellingInput.value = price == null ? '' : String(price);
    } catch {}
  };

  const syncFields = () => {
    const consume = pressed('consume');
    const sale = pressed('sale');
    input('usage').value = consume && sale ? 'both' : consume ? 'consume' : sale ? 'sale' : 'track';
    const receipt = String(input('receiptUnit')?.value || '');
    const contentUnit = String(input('packContentUnit')?.value || 'шт.');
    const bulk = receipt === 'уп.' && contentUnit !== 'шт.';
    const nominal = String(input('nominalUnit')?.value || '');
    const nominalQuantity = Number(input('nominalQuantity')?.value || 0);
    const pack = form.querySelector('[data-inventory-pack-count]');
    pack.hidden = receipt !== 'уп.';
    form.querySelector('[data-inventory-one-piece-nominal]').hidden = bulk;
    const nominalLabel = form.querySelector('[data-inventory-nominal-label]');
    if (nominalLabel) nominalLabel.textContent = receipt === 'уп.'
      ? 'Номинал 1 шт.' : 'Номинал';
    // Prefer entered units, never demand a conversion from a newcomer.
    if (creating && !consumptionUnitEdited) {
      const preferred = bulk ? contentUnit : nominal;
      if (INVENTORY_CONSUMPTION_UNITS.some(row => row.value === preferred))
        setSelectValue('consumeUnit', preferred);
      else if (bulk) setSelectValue('consumeUnit', inventoryBaseContentUnit(contentUnit));
    }
    const consumeUnit = String(input('consumeUnit')?.value || 'шт.');
    const saleUnit = String(input('saleUnit')?.value || 'шт.');
    const netForChoice = updateNet();
    // For a new product with unknown gram weight, preserve physical piece
    // accounting until the professional records a real measurement.
    const stock = creating ? inventoryNewStockUnit({
      receipt, packUnit: contentUnit, consumeUnit: consume ? consumeUnit : '',
      saleUnit: sale ? saleUnit : '', nominalUnit: bulk ? null : nominal,
      nominalQuantity: bulk ? null : nominalQuantity, netWeight: netForChoice,
    }) : String(item?.unit || input('calculationUnit')?.value || 'шт.');
    input('calculationUnit').value = stock;
    const consumptionRow = form.querySelector('[data-inventory-use="consume"]');
    if (consumptionRow) consumptionRow.hidden = !consume;
    // Optional fields stay in their own native details sections. The checkbox
    // changes use/saving, never whether clicking the heading may show fields.
    setNumberUnit('consumeQuantity', consumeUnit);
    setNumberUnit('saleQuantity', saleUnit);
    const preferredThreshold = receipt === 'уп.' && contentUnit !== 'шт.' ? 'уп.' : 'шт.';
    if (creating && !thresholdUnitEdited) setSelectValue('thresholdUnit', preferredThreshold);
    const threshold = String(input('thresholdUnit')?.value || preferredThreshold);
    setNumberUnit('minStock', threshold);
    setNumberUnit('targetStock', threshold);
    const measuredConsumption = (consume && ['г','кг'].includes(consumeUnit)) || (sale && ['г','кг'].includes(saleUnit));
    const massFromVolume = measuredConsumption && ['мл','л'].includes(nominal);
    const needsPhysicalMass = measuredConsumption
      && (['шт.','уп.'].includes(receipt) || massFromVolume
        || item?.grossWeight != null);
    const container = form.querySelector('[data-inventory-container-mode]');
    container.hidden = !needsPhysicalMass;
    const mode = String(input('containerMode')?.value || '');
    form.querySelector('[data-inventory-gross-net-tare]').hidden = !needsPhysicalMass || mode !== 'WITH';
    form.querySelector('[data-inventory-net-only]').hidden = !needsPhysicalMass || mode !== 'NONE';
    const net = updateNet();
    const quantity = receipt === 'уп.' ? Number(input('packContentQuantity')?.value) : 1;
    const perPiece = bulk ? null : inventoryStockPerPiece(stock, nominal, nominalQuantity, net);
    // Bulk packaging uses ONE mass/volume; multi-piece packs use count ×
    // nominal per piece. The API still receives one stock-unit quantity.
    const calculated = bulk
      ? inventoryContentInBaseUnits(quantity, contentUnit)
      : perPiece > 0 && quantity > 0 ? perPiece * quantity : null;
    const packageInput = input('packageQuantity');
    if (calculated != null) packageInput.value = String(Math.round(calculated * 1000000) / 1000000);
    else if (creating || receipt !== item?.receiptUnit) packageInput.value = '';
    // Resource and time are optional characteristics of any physical item.
    // They are not an exclusive item "type".
    const resource = extraOn('resource');
    const period = extraOn('period');
    input('resourceEnabled').value = resource ? '1' : '0';
    input('periodEnabled').value = period ? '1' : '0';
    setNumberUnit('resourceLimit', String(input('resourceUnit')?.value || 'проц.'));
    updatePrimaryPrice();
  };

  for (const checkbox of form.querySelectorAll('[data-inventory-usage-check], [data-inventory-extra-check]')) {
    checkbox.addEventListener('change', () => {
      syncFields();
      deriveSellingPrice();
      syncDirty();
    });
  }
  form.addEventListener('input', (event) => {
    if (saveError) { saveError.hidden = true; saveError.textContent = ''; }
    if (['grossWeight', 'tareWeight', 'netOnlyWeight', 'nominalQuantity', 'packContentQuantity', 'purchasePrice'].includes(event.target?.name)) {
      syncFields();
      deriveSellingPrice();
    }
    if (['saleMarkup', 'saleQuantity'].includes(event.target.name)) deriveSellingPrice();
    syncDirty();
  });
  form.addEventListener('change', (event) => {
    const receiptChoice = event.target?.closest?.('[data-inventory-receipt-choice]');
    if (receiptChoice) {
      // Two existing compact checks act as a single exclusive choice.
      const chosen = receiptChoice.dataset.inventoryReceiptChoice;
      for (const checkbox of form.querySelectorAll('[data-inventory-receipt-choice]'))
        checkbox.checked = checkbox.dataset.inventoryReceiptChoice === chosen;
      input('receiptUnit').value = chosen;
      syncFields();
      deriveSellingPrice();
      syncDirty();
      return;
    }
    if (event.target?.name === 'consumeUnit') consumptionUnitEdited = true;
    if (event.target?.name === 'thresholdUnit') {
      thresholdUnitEdited = true;
      const selected = String(input('thresholdUnit')?.value || '');
      setNumberUnit('minStock', selected);
      setNumberUnit('targetStock', selected);
    }
    if (['receiptUnit', 'packContentUnit', 'nominalUnit', 'consumeUnit', 'saleUnit',
      'containerMode', 'resourceUnit', 'resourceExhaustionAction'].includes(event.target?.name)) {
      syncFields();
      deriveSellingPrice();
    }
    syncDirty();
  });
  syncFields();
  // Existing stock positions may carry a package-level salePrice calculated
  // before unit-aware markup was implemented. Update only prices that match
  // that legacy formula; preserve an intentionally entered manual price.
  // Keep the server value as the initial signature so Save remains available.
  initialSignature = signature();
  initialFormFields = new Map([...new FormData(form).entries()].map(
    ([key, value]) => [key, typeof value === 'string' ? value : '']));
  if (pressed('sale') && markupInput?.value.trim() && sellingInput) {
    try {
      const current = String(sellingInput.value || '').trim();
      const markup = parseSaleMarkup(markupInput.value);
      const legacy = markedUpSalePrice(Number(purchaseInput?.value), markup);
      const corrected = markedUpSalePrice(saleCost(purchaseInput?.value), markup);
      if (corrected != null && (!current
          || legacy != null && Number.isFinite(Number(current))
            && Math.abs(Number(current) - legacy) < 0.005)) {
        sellingInput.value = String(corrected);
      }
    } catch {
      // Invalid markup remains editable and is validated on Save.
    }
  }
  syncDirty();


  const save = async () => {
    if (primary.disabled) return;
    try {
    const data = new FormData(form);
    if (!creating && signature() === initialSignature) {
      openNotice({title:'Сохранение',message:'Изменений нет. Выберите новое значение или измените поле.'});
      return;
    }
    const name = String(data.get('name') || '').trim();
    if (!name) return openNotice({ title: 'Наименование', message: 'Укажите наименование позиции.' });
    // Editing only classification, name or identifiers must not resubmit
    // untouched legacy packaging, quantities and sale settings. Core accepts
    // field-level updates; unrelated historical fields stay exactly as stored.
    if (!creating) {
      const changed = [...data.entries()].filter(([key, value]) =>
        String(value ?? '') !== String(initialFormFields.get(key) ?? ''));
      const simpleFields = new Set([
        'name','catalogName','manufacturer','category','productType','sku','barcode','position',
      ]);
      if (changed.length && changed.every(([key]) =>
        simpleFields.has(key) || key.startsWith('criteriaValue:'))) {
        const edits = {};
        for (const [key, value] of changed) {
          if (key.startsWith('criteriaValue:')) {
            const id = key.slice('criteriaValue:'.length);
            if (id) (edits.criteriaValues ||= {})[id] = String(value ?? '');
          } else if (key === 'position') {
            const raw = String(value ?? '').trim();
            const number = raw ? Number(raw) : 0;
            if (!Number.isSafeInteger(number) || number < 0)
              throw new Error('Порядковый номер должен быть целым неотрицательным числом.');
            edits.position = number;
          } else {
            edits[key] = String(value ?? '').trim();
          }
        }
        primary.disabled = true;
        await updateInventoryItem(item.itemId, edits);
        layer.v2Close?.();
        onSaved(item.itemId);
        return;
      }
    }
    const requestedPositionText = String(data.get('position') ?? '').trim();
    const requestedPosition = requestedPositionText === '' ? 0 : Number(requestedPositionText);
    if (!creating && (!Number.isSafeInteger(requestedPosition) || requestedPosition < 0)) {
      openNotice({ title: 'Порядок', message: 'Укажите целый положительный номер или оставьте поле пустым.' });
      return;
    }
    const unit = String(data.get('calculationUnit') || 'шт.');
    const usage = String(data.get('usage') || 'track');
    const sale = usage === 'sale' || usage === 'both';
    const consumption = usage === 'consume' || usage === 'both';
    const consumptionUnit = consumption ? String(data.get('consumeUnit') || unit) : null;
    const saleUnit = sale ? String(data.get('saleUnit') || unit) : null;
    // The only required field for a new catalog item is its name.
    // Receipt mode and package contents are optional and can be completed
    // later. Never fabricate package quantities for an unselected mode.
    const receiptUnit = String(data.get('receiptUnit') || '') || null;
    const packUnit = receiptUnit === 'уп.' ? String(data.get('packContentUnit') || 'шт.') : null;
    const packAmount = receiptUnit === 'уп.' ? collectOptionalNumber(form, 'packContentQuantity')
      : receiptUnit === 'шт.' ? 1 : null;
    const bulk = receiptUnit === 'уп.' && packUnit !== 'шт.';
    if (packAmount != null && receiptUnit === 'уп.' && packAmount <= 0) {
      openNotice({ title: 'В упаковке', message: 'Количество должно быть больше нуля.' });
      return;
    }
    if (receiptUnit === 'уп.' && packUnit === 'шт.' && packAmount != null
        && (!Number.isSafeInteger(packAmount) || packAmount < 1)) {
      openNotice({ title: 'В упаковке', message: 'Укажите целое число штук.' });
      return;
    }
    // Keep the incomplete bulk-package fields unset instead of forcing
    // the owner to invent a nominal just to save the item.
    const nominalQuantity = bulk ? packAmount : collectOptionalNumber(form, 'nominalQuantity');
    const nominalUnit = bulk ? (packAmount == null ? null : packUnit)
      : String(data.get('nominalUnit') || '') || null;
    if ((nominalQuantity == null) !== (nominalUnit == null) || nominalQuantity != null && nominalQuantity <= 0) {
      openNotice({ title: 'Номинал', message: 'Укажите и число, и единицу — либо оставьте оба поля пустыми.' });
      return;
    }
    const thresholdUnit = String(data.get('thresholdUnit') || '') || 'шт.';
    if (!creating && bulk && inventoryBaseContentUnit(packUnit) !== unit) {
      openNotice({ title: 'Единицы склада', message: 'Нельзя менять уже установленную базовую единицу этой позиции без корректного преобразования.' });
      return;
    }
    if (!creating && thresholdUnit !== (item?.thresholdUnit || inventoryStockThresholdUnit(item))
        && (item?.minStock != null || item?.targetStock != null)) {
      const priorMin = item.minStock == null ? '' : String(item.minStock);
      const priorTarget = item.targetStock == null ? '' : String(item.targetStock);
      if (String(data.get('minStock') ?? '') === priorMin && String(data.get('targetStock') ?? '') === priorTarget) {
        openNotice({ title: 'Ед. запаса', message: 'При смене единицы запаса скорректируйте критический и желаемый остаток.' });
        return;
      }
    }
    const containerMode = String(data.get('containerMode') || '') || null;
    let gross = item?.grossWeight ?? null;
    let tare = item?.tareWeight ?? null;
    // A newcomer may not know the weight yet. Preserve what is known,
    // including just one measurement, and compute net only from both facts.
    if (containerMode === 'WITH') {
      gross = collectOptionalNumber(form, 'grossWeight');
      tare = collectOptionalNumber(form, 'tareWeight');
      if (gross != null && tare != null && gross <= tare) {
        openNotice({ title: 'Тара', message: 'Брутто должно быть больше массы тары.' });
        return;
      }
    } else if (containerMode === 'NONE') {
      gross = collectOptionalNumber(form, 'netOnlyWeight');
      tare = gross == null ? null : 0;
    }
    const net = gross != null && tare != null ? Number(gross) - Number(tare) : null;
    const perPiece = bulk ? null : inventoryStockPerPiece(unit, nominalUnit, nominalQuantity, net);
    const calculatedPack = bulk ? (packAmount == null ? null
        : inventoryContentInBaseUnits(packAmount, packUnit))
      : perPiece > 0 && packAmount != null ? perPiece * packAmount : null;
    const oldPack = item?.packageQuantity ?? null;
    const packageQuantity = calculatedPack
      ?? (!creating && receiptUnit === item?.receiptUnit ? oldPack : null);
    if (packageQuantity != null && packageQuantity <= 0) {
      openNotice({ title: 'Содержимое', message: 'Количество содержимого должно быть больше нуля.' });
      return;
    }
    // A quantity always keeps its own labeled unit; conversions are explicit
    // and never assume that ml has the same numerical mass in grams.
    const rules = Array.isArray(item?.conversionRules) ? [...item.conversionRules] : [];
    // Unknown quantity-to-weight conversions are allowed in the catalogue.
    // Actual measured movements will require their own known conversion.
    // One physical piece and its nominal are independent from the
    // number of pieces in a purchase pack. Store the bridge explicitly.
    const setConversion = (target, stockPerUnit) => {
      if (!target || target === unit || !(stockPerUnit > 0)) return;
      const index = rules.findIndex(rule => rule.unit === target);
      if (index >= 0) rules.splice(index, 1);
      rules.push({ unit: target, stockPerUnit });
    };
    if (!bulk && perPiece > 0) {
      setConversion('шт.', perPiece);
      if (nominalUnit && nominalQuantity > 0)
        setConversion(nominalUnit, perPiece / nominalQuantity);
      // A real later net measurement makes measured consumption possible
      // without changing an existing product's stored stock unit.
      if (net > 0) setConversion('г', perPiece / net);
    }
    // A missing conversion is an incomplete optional measurement, not a
    // reason to prevent product creation. Conversion-dependent movements
    // still validate against known values.
    const referencePrice = collectOptionalNumber(form, 'purchasePrice');
    let markup = { mode: 'percent', value: null };
    try { if (sale) markup = parseSaleMarkup(data.get('saleMarkup')); }
    catch (error) {
      openNotice({ title: 'Наценка', message: error.message }); return;
    }
    const enteredPrice = sale ? collectOptionalNumber(form, 'salePrice') : null;
    const calculatedPrice = sale ? markedUpSalePrice(saleCost(purchaseInput?.value), markup) : null;
    // The product may be created before a sale price is known.
    const resourceEnabled = String(data.get('resourceEnabled')) === '1';
    const resourceLimit = resourceEnabled ? collectOptionalNumber(form, 'resourceLimit') : null;
    // Resource tracking is optional even if its section is opened.
    // A blank resource is not an obligation to fill it on item creation.
    if (resourceEnabled && resourceLimit != null && !(resourceLimit > 0)) {
      openNotice({ title: 'Ресурс', message: 'Ресурс должен быть больше нуля.' }); return;
    }
    const periodEnabled = String(data.get('periodEnabled')) === '1';
    const startDate = periodEnabled ? String(data.get('serviceStartAt') || '') : '';
    const endDate = periodEnabled ? String(data.get('serviceEndAt') || '') : '';
    if (periodEnabled && startDate && endDate && endDate < startDate) {
      openNotice({ title: 'Срок эксплуатации', message: 'Дата окончания не может быть раньше даты начала.' }); return;
    }
    const value = {
      name,
      conversionRules: rules,
      catalogName: String(data.get('catalogName') || '').trim(),
      nominalQuantity, nominalUnit, receiptUnit, thresholdUnit, containerMode,
      unit, packageQuantity,
      ...(!purchaseInput?.disabled ? { referencePrice } : {}),
      // Hidden classification groups are not rendered in the form, so retain
      // their legacy values. Never erase an existing manufacturer's name.
      manufacturer: String(data.get('manufacturer') ?? item?.manufacturer ?? '').trim(),
      category: String(data.get('category') ?? item?.category ?? '').trim(),
      productType: String(data.get('productType') ?? item?.productType ?? '').trim(),
      ...(() => {
        const additional=inventoryCriterionGroups().filter(group=>!group.legacyField);
        if(!additional.length)return {};
        return {criteriaValues:Object.fromEntries(additional.map(group=>
          [group.id,String(data.get('criteriaValue:'+group.id) || '')]))};
      })(),
      sku: String(data.get('sku') || '').trim(),
      barcode: String(data.get('barcode') || '').trim(),
      ...(!creating ? { position: requestedPosition } : {}),
      grossWeight: gross,
      tareWeight: tare,
      canConsume: consumption,
      canSell: sale,
      consumeUnit: consumptionUnit,
      consumeQuantity: consumption ? collectOptionalNumber(form, 'consumeQuantity') : null,
      saleUnit,
      saleQuantity: sale ? collectOptionalNumber(form, 'saleQuantity') : null,
      saleMarkupMode: markup.mode,
      saleMarkupValue: sale ? markup.value : null,
      salePrice: sale ? enteredPrice ?? calculatedPrice : null,
      resourceLimit,
      resourceUnit: resourceEnabled && resourceLimit != null
        ? String(data.get('resourceUnit') || 'проц.') : null,
      // One item is retired per completed resource cycle; the backend
      // counts finished cycles and carries the unfinished portion forward.
      resourceStockQuantity: resourceEnabled && resourceLimit != null
        && String(data.get('resourceExhaustionAction') || 'REVIEW') === 'WRITE_OFF' ? 1 : null,
      resourceExhaustionAction: resourceEnabled && resourceLimit != null
        ? String(data.get('resourceExhaustionAction') || 'REVIEW') : null,
      serviceStartAt: startDate || null,
      serviceEndAt: endDate || null,
    };
    try {
      const minimum = collectOptionalNumber(form, 'minStock');
      const target = collectOptionalNumber(form, 'targetStock');
      // Both stock-control thresholds are optional. Zero is a valid value;
      // the user may set either, both, or neither without a forced ordering.
      value.minStock = inventoryStockThresholdStored({ ...value }, minimum);
      value.targetStock = inventoryStockThresholdStored({ ...value }, target);
    } catch (error) {
      openNotice({ title: 'Правила остатка', message: error.message }); return;
    }
    primary.disabled = true;
    const priorIds = creating ? new Set(getInventoryItems().map(row => row.itemId)) : null;
    if (creating) await createInventoryItem(value);
    else await updateInventoryItem(item.itemId, value);
    const savedId = creating ? getInventoryItems().find(row => !priorIds.has(row.itemId))?.itemId : item.itemId;
    layer.v2Close?.();
    onSaved(savedId);
    } catch (error) {
      primary.disabled = false;
      const message = error instanceof Error ? error.message : 'Не удалось сохранить товар.';
      if (saveError) {
        saveError.textContent = message;
        saveError.hidden = false;
      }
      // The error below a sticky bottom action is outside the visible viewport
      // on iPhone. Always surface the actual server/validation failure at once.
      openNotice({title:'Не удалось сохранить',message});
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

function stockListMarkup(manufacturer, query = '', rowsProvider = null, expanded = new Set(), selected = new Set(), allowCategoryReorder = false) {
  const needle = normalizedSearch(query);
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

  const itemRow = item => ({
    title: `${Number(item.position) > 0 ? `${item.position} · ` : ''}${item.name}`,
    secondary: [item.sku, productTypeText(item)].filter(Boolean).join(' · '),
    right: [
      `${numberText(inventoryDisplayBalance(item,STOCK_VIEW.storageScope))} ${item.unit || ''}`,
      item.lastPurchasePrice == null ? '' : moneyText(item.lastPurchasePrice),
    ].filter(Boolean),
    interactive: true,
    data: `data-inventory-item="${escapeHtml(item.itemId)}"`,
    aria: `Открыть ${item.name}`,
  });
  // The compact selector is a sibling of the clickable stock row, never a
  // child of its button. Checking an item does not open its Q overview.
  const itemList = rows => rows.map(item =>
    '<div class="inventory-counterparty-product-row">' +
      compactCheck({
        checked:selected.has(String(item.itemId)),
        aria:'Выбрать складскую единицу ' + item.name,
        data:'data-stock-item-check="' + escapeHtml(item.itemId) + '"',
      }) +
      list({className:'ui-list--dense',items:[itemRow(item)]}) +
    '</div>'
  ).join('');
  const criteria = inventoryCriterionGroups();
  const categoryCriterion = criteria.find(entry => entry.legacyField === 'category');
  const byCategory = Boolean(categoryCriterion);
  const byType = criteria.some(entry => entry.legacyField === 'productType');
  if (!byCategory && !byType) return itemList(items);

  // Preserve existing group disclosure state after editing a product or
  // searching. Searching opens only matched groups for immediate access.
  const disclosure = (label, content, key, nested = false, reorderId = '', rows = []) =>
    catalogDisclosure(label, content, nested, null,
      compactCheck({
        checked: rows.length > 0 && rows.every(item => selected.has(String(item.itemId))),
        aria: 'Выбрать все позиции группы ' + label,
        data: 'data-stock-group-check="' + escapeHtml(key) + '"',
      }), reorderId).replace('<details>',
      '<details data-stock-disclosure="' + escapeHtml(key) + '"' +
      (needle || expanded.has(key) ? ' open' : '') + '>');
  const categories = new Map();
  for (const item of items) {
    const category = byCategory ? String(item.category || '').trim() || 'Без категории' : '';
    const type = byType ? String(item.productType || '').trim() || 'Без типа' : '';
    if (!categories.has(category)) categories.set(category,new Map());
    const types=categories.get(category);
    if (!types.has(type)) types.set(type,[]);
    types.get(type).push(item);
  }
  // Position numbers control rows INSIDE each category; persisted criterion
  // value order controls the category sections themselves. These two orders
  // must never overwrite one another.
  const order = new Map((categoryCriterion?.values || []).map((v,i)=>[v.name,i]));
  const ids = new Map((categoryCriterion?.values || []).map(v=>[v.name,v.id]));
  const grouped = [...categories.entries()].sort(([a],[b])=>
    (order.get(a) ?? Number.MAX_SAFE_INTEGER) -
    (order.get(b) ?? Number.MAX_SAFE_INTEGER)
    || a.localeCompare(b,'ru',{numeric:true,sensitivity:'base'}));
  const content = grouped.map(([category,types])=>{
    const typeContent=[...types.entries()].map(([type,rows])=>
      byType ? disclosure(type,itemList(rows),'t:'+category+'::'+type,true,'',rows)
        : itemList(rows)).join('');
    const reorderId=allowCategoryReorder ? ids.get(category) || '' : '';
    const categoryRows = [...types.values()].flat();
    return byCategory ? disclosure(category,typeContent,'c:'+category,false,reorderId,categoryRows)
      : typeContent;
  }).join('');
  return byCategory
    ? '<div class="list-entries inventory-stock-category-sequence">' + content + '</div>'
    : content;
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

function openStockControls(trigger, level, manufacturer, onChange, mode = 'sort') {
  const sortKey = level === 'manufacturers' ? 'manufacturersSort' : 'itemsSort';
  const isFilter = level === 'items' && mode === 'filter';
  const currentItems = getInventoryItems().filter(item =>
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
function bindManufacturerCards(root, host) {
  host.querySelectorAll('[data-inventory-manufacturer]').forEach((control) => {
    control.addEventListener('click', () => openManufacturerStock(root, control.dataset.inventoryManufacturer));
  });
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
  const expandedStockGroups = new Set();
  // One selection drives both actions; no separate stock mutation owner.
  const selectedStockItems = new Set();
  const markup = `
    ${context(manufacturer, {
      c: { label: '+', data: 'data-inventory-add-item', aria: 'Добавить позицию' },
    })}
    <div data-stock-selected-actions hidden>
      <p class="ui-list__secondary">Выбрано: <strong data-stock-selected-count>0</strong></p>
      ${actionBlock(
        button('Действия', { data: 'data-stock-selected-action' }) +
        button('Удалить', { variant: 'delete-outline', data: 'data-stock-selected-delete' })
      )}
    </div>
    <div data-inventory-company-list>${stockListMarkup(manufacturer, '', rowsProvider, expandedStockGroups)}</div>`;
  const layer = mountV2ZLayer(root, v2ZLayer(markup, { className: 'inventory-manufacturer-z' }), { stack: true });
  if (!layer) return;
  const [searchRow] = setV2ZHeaderRows(layer, [stockSearchField('', 'data-inventory-company-search')]);
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
    const choice = mountModal(document.body, modal(
      '<p class="ui-list__secondary">Выбрано позиций: ' + ids.length + '</p>',
      { title: 'Действия', variant: 'q', surface: 'app' },
    ));
    if (!choice) return;
    const header = choice.querySelector('[data-v2-q-header-content]');
    if (!header) { choice.v2Close?.(); return; }
    header.innerHTML = select({
      label: '', name: 'stockSelectedAction', value: '',
      options: [
        { value: '', label: 'Действия' },
        { value: 'edit', label: 'Изменить данные' },
        { value: 'audit', label: 'Инвентаризация остатков' },
        { value: 'transfer', label: 'Переместить' },
        { value: 'order', label: 'Создать заказ' },
      ],
    });
    header.querySelector('[name="stockSelectedAction"]')?.addEventListener('change', event => {
      const action = event.target.value;
      if (!action) return;
      choice.v2Close?.();
      if (action === 'edit') {
        openInventoryAuditCriteria(layer, { mode: 'data', ids, onSaved: renderList, keepOpen: true });
      } else if (action === 'audit') {
        openInventoryAuditCriteria(layer, { mode: 'stock', ids, onSaved: renderList });
      } else if (action === 'transfer') {
        openInventoryTransfer(renderList, {
          selectedItemIds: ids,
          fromLocationId: STOCK_VIEW.storageScope === INVENTORY_TOTAL_SCOPE
            ? '' : STOCK_VIEW.storageScope,
        });
      } else if (action === 'order') {
        openInventoryOrderFromSelection(layer, ids, renderList);
      }
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
    const categoryCriterion = criteria.find(group=>group.legacyField==='category');
    const categories = new Set((rowsProvider?.() ||
      getInventoryItems().filter(item=>manufacturerName(item)===manufacturer))
      .map(item=>String(item.category||'').trim()).filter(Boolean));
    const allowCategoryReorder = !query.trim() && !hasStockFilters(STOCK_VIEW.itemsFilters)
      && STOCK_VIEW.itemsSort==='position-asc'
      && categoryCriterion?.values?.filter(value=>categories.has(value.name)).length>1;
    if (listHost) listHost.innerHTML = stockListMarkup(
      manufacturer, query, rowsProvider, expandedStockGroups, selectedStockItems,
      allowCategoryReorder);
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
          const group=inventoryCriterionGroups().find(entry=>entry.id===categoryCriterion.id);
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
    listHost?.querySelectorAll('[data-inventory-item]').forEach(control=>
      control.addEventListener('click', () => {
        const itemId = control.dataset.inventoryItem;
        openInventoryProductOverview(itemId, {
          stockScope: STOCK_VIEW.storageScope,
          edit: onSaved => openItemEditor(root, itemId, {}, onSaved),
          onChanged: renderList,
        });
      }));
    listHost?.querySelectorAll('[data-stock-disclosure]').forEach(details =>
      details.addEventListener('toggle', () => {
        if (!details.isConnected || (searchInput?.value || '').trim()) return;
        const key = details.dataset.stockDisclosure;
        if (details.open) expandedStockGroups.add(key);
        else expandedStockGroups.delete(key);
      }));
  };

  searchInput?.addEventListener('input', renderList);
  layer.querySelector('[data-inventory-add-item]')?.addEventListener('click', () => {
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
  { value: 'supplier', label: 'Поставщик', kind: 'text' },
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
  if (definition.value === 'referencePrice') return itemPrimaryPrice(item) ?? item.referencePrice;
  if (definition.value === 'minStock' || definition.value === 'targetStock')
    return inventoryStockThresholdInput(item, item[definition.value]);
  return item[definition.value];
}

function inventoryAuditCanClear(definition) { return !['name', 'unit', 'usage'].includes(definition.value); }

function inventoryAuditDataControl(definition, name, { shared = false, locked = false, value = '', placeholder = '' } = {}) {
  const label = shared
    ? definition.value === 'position' ? 'Начальный номер (дальше по порядку)' : 'Новое значение'
    : '';
  if (locked) return field({ label, name, placeholder: 'Цена от поставщика', disabled: true });
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
  const locked = definition.value === 'referencePrice' && itemPrimaryPrice(item) !== null;
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
      throw new Error('Укажите корректное неотрицательное число' +
        (definition.kind === 'integer' ? ' (целый номер от 1)' : '') + '.');
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
        if (clearAll) {
          if (!inventoryAuditCanClear(definition)) throw new Error('Эту характеристику нельзя очистить.');
          startingValue = definition.value === 'position' ? 0
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
        if (perItem && definition.value === 'referencePrice' && itemPrimaryPrice(item) !== null) continue;
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
          value = definition.value === 'position' ? 0
            : definition.kind === 'decimal' ? null : '';
        } else {
          value = inventoryAuditParseDataValue(definition, raw);
        }
        if (definition.value === 'position' && value > 0) {
          const numberKey = `${manufacturerName(item)}::${value}`;
          if (uniqueNumbers.has(numberKey))
            throw new Error(`Номер ${value} повторяется у производителя «${manufacturerName(item)}».`);
          uniqueNumbers.add(numberKey);
        }
        if (definition.value === 'minStock' || definition.value === 'targetStock') {
          inventoryStockThresholdStored(item, value); // fail before any writes if tube size is absent
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
    // Even a previously cleared number may leave legacy gaps behind.
    // Explicit Clear always asks Core to normalize that manufacturer's order.
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
        status.textContent = 'Значения уже очищены.';
        return true;
      }
      status.textContent = 'У выбранных позиций уже указаны эти значения.';
      return;
    }
    submit.disabled = true;
    const failed = new Map();
    onProgress(0, changes.length);
    try {
      if (definition.value === 'position' && (clearAll || clearItems.size > 0)) {
        // One atomic Core operation clears selected numbers and compacts all
        // remaining ranks for the affected manufacturer(s), without any
        // separate per-product updates or full stock snapshots.
        onProgress(0, changes.length);
        try {
          await clearInventoryItemPositions(changes.map(entry => entry.itemId));
          onProgress(changes.length, changes.length);
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'Ошибка очистки';
          changes.forEach(entry => failed.set(entry.itemId, reason));
        }
      } else if (definition.value === 'position') {
        // Core currently provides only single-item writes for assigning
        // numerical positions. Never silently repeat all writes four times:
        // each PUT already returns a full verified stock snapshot.
        const ordered = [...changes].sort((a, b) =>
          a.manufacturer.localeCompare(b.manufacturer, 'ru', { numeric: true })
          || a.value - b.value);
        onProgress(0, ordered.length);
        let completed = 0;
        let timedOut = false;
        for (const entry of ordered) {
          status.textContent = `Порядок: ${completed} из ${ordered.length} · ${entry.name}`;
          try {
            await updateInventoryItem(entry.itemId,
              inventoryAuditDataPayload(definition, entry.value, getInventoryItem(entry.itemId)));
          } catch (error) {
            const timeout = error?.name === 'AbortError';
            failed.set(entry.itemId, timeout
              ? 'Сервер не ответил. Проверьте сохранённые номера.'
              : error instanceof Error ? error.message : 'Ошибка сохранения');
            if (timeout) {
              // A timed-out write might still commit. Stop before sending more
              // position edits and reconcile the confirmed server snapshot.
              timedOut = true;
              break;
            }
          }
          completed += 1;
          onProgress(completed, ordered.length);
        }
        if (timedOut) {
          try {
            await loadInventory();
            for (const entry of changes) {
              if (inventoryAuditValueMatches(getInventoryItem(entry.itemId),
                definition, entry.value)) failed.delete(entry.itemId);
            }
          } catch {
            // Keep the visible timeout and entered numbers for a safe retry.
          }
        }
        // Each successful item mutation already refreshes the complete stock
        // snapshot. Verify all requested numbers below without an extra GET.
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
      const unresolved = changes.filter(entry =>
        !inventoryAuditValueMatches(getInventoryItem(entry.itemId), definition, entry.value));
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
  const markup = `<form data-inventory-audit-criteria>
    <p data-inventory-audit-included-count>${isData ? 'Выбрано' : 'В инвентаризации'}: ${items.length} позиций</p>
    ${fields}
    <p class="form-error" role="status" data-inventory-audit-status></p>
    <div data-inventory-audit-actions${isData ? ' hidden' : ''}>
      ${actionBlock(button(isData ? 'Применить' : 'Сохранить', { type:'submit', data:'data-inventory-audit-apply' }))}
    </div>
  </form>`;
  const layer = mountModal(root, modal(markup, {
    title: isData ? 'Изменить данные' : 'Инвентаризация остатков',
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
  const dataMode = form.querySelector('[data-inventory-data-common]');
  const commonHost = form.querySelector('[data-inventory-audit-data-common]');
  const individualHost = form.querySelector('[data-inventory-audit-data-individual]');
  const dataActions = form.querySelector('[data-inventory-audit-actions]');
  let dataCommonTouched = false;
  let dataInitial = '';
  let dataUniform = true;
  const selectedDataIds = new Set();
  let dataActionMode = '';
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
    if (dataActions) dataActions.hidden = !dataActionMode;
    if (submit) {
      submit.hidden = !dataActionMode;
      submit.disabled = saving || !dataActionMode;
      if (!saving) submit.textContent = dataActionMode === 'clear' ? 'Очистить' : 'Применить';
      submit.classList.toggle('ui-button--secondary', dataActionMode === 'clear');
    }
  }

  function renderDataFields() {
    if (!isData || !definition || !commonHost || !individualHost) return;
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
    const header = layer.querySelector('[data-v2-q-header-content]');
    if (header) {
      header.innerHTML = select({
        label: 'Изменить данные', name: 'auditEditField', value: definition.value,
        options: INVENTORY_AUDIT_EDIT_FIELDS.map(({ value, label }) => ({ value, label })),
      });
      header.querySelector('[name="auditEditField"]')?.addEventListener('change', event => {
        const next = inventoryAuditFieldDefinition(event.target.value);
        if (!next || saving) return;
        definition = next;
        renderDataFields();
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
    saving = true;
    syncDataActions();
    if (action) action.textContent = clear ? 'Очищаю…' : 'Применяю…';
    try {
      const saved = await applyInventoryAuditDataChanges(layer, {
        items, definition, perItem: !common, data, status, submit, onSaved,
        clearAll, clearItems, selectedIndices,
        keepOpen: isData && keepOpen,
        onProgress: (completed, total) => {
          const progress = (clear ? 'Очистка' : 'Применение') +
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
          title: clear ? 'Очистка не завершена' : 'Изменения не сохранены',
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

    await saveDataChange();
  });
  return layer;
}


function openStockCreateOptions(root, onChanged, defaults = {}) {
  // The first Stock + choice stays distinct from the supplier catalog.
  // Creating a position must open the normal inventory editor directly.
  const layer = mountModal(document.body, modal(
    actionBlock(
      button('Создать позицию', { data: 'data-stock-create-manual' }) +
      button('Из ассортимента контрагента', {
        variant: 'secondary', data: 'data-stock-create-supplier',
      }),
    ),
    { title: 'Добавить товар', variant: 'q', surface: 'app' },
  ));
  if (!layer) return;
  layer.querySelector('[data-stock-create-manual]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openItemEditor(root, '', defaults, onChanged);
  });
  layer.querySelector('[data-stock-create-supplier]')?.addEventListener('click', async () => {
    layer.v2Close?.();
    try {
      const { openSupplierCatalogCreation } = await import('./counterparties.js');
      await openSupplierCatalogCreation(onChanged);
    } catch (error) {
      openNotice({
        title: 'Контрагенты',
        message: error instanceof Error ? error.message : 'Не удалось открыть контрагентов.',
      });
    }
  });
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
  const scopeSelector=select({name:'inventoryStockScope',aria:'Выбрать склад',
    value:STOCK_VIEW.storageScope,options:scopes});
  root.innerHTML = page([
    context('Остатки',{
      v:{data:'data-inventory-stock-menu',aria:'Настройки остатков'},
      c:{label:'+',data:'data-inventory-add-item',aria:'Добавить позицию'},
    }),
    '<div data-inventory-stock-group-list></div>',
  ]);
  // Z1 owns the scope selector in its Shared Header, not in the scrollable
  // brand list. Keep a visible fallback if the host has not been mounted.
  const headerRows=setV2ZHeaderRows(root,[scopeSelector]);
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
    const first=criteria[0];
    disposeBrandReorder=renderStockBrandList(listHost,visibleRows(),{
      scope:locationId,
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
  root.querySelector('[data-inventory-add-item]')?.addEventListener('click',()=>
    openStockCreateOptions(root,()=>renderStock(root)));
  refresh();
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
  renderInventoryOrders(root);
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
  else if (section === 'orders') renderOrders(root);
  else {
    renderStock(root);
    if (legacyError) openNotice({
      title:'Не удалось сопоставить склады',
      message:legacyError+'. Существующие товары не удалены; проверьте склады и повторите вход.',
    });
  }
  return () => {};
}
