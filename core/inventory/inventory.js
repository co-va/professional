import {
  actionBlock,
  button,
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
  searchableSelect,
  select,
  setV2ZHeaderRows,
  shortDateTimeParts,
  twoColumnLayout,
  v2ListEntries,
  v2ListEntry,
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
import { inventoryManufacturerCompletion } from './completeness.js';
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
} from './service.js';

const UNIT_OPTIONS = ['шт.', 'г', 'кг', 'мл', 'л', 'м', 'уп.'].map((value) => ({ value, label: value }));
const EMPTY_MANUFACTURER = 'Без производителя';
const INVENTORY_SORT_KEY = 'professional.inventory.sort';
const INVENTORY_SORT_MODES = {
  manufacturersSort: ['name-asc', 'name-desc', 'count-desc', 'count-asc'],
  itemsSort: ['name-asc', 'name-desc', 'type-asc', 'balance-desc', 'balance-asc'],
};

// Reuse the Contacts convention for persistent local sort preferences.
function readInventorySortModes() {
  try {
    const stored = JSON.parse(localStorage.getItem(INVENTORY_SORT_KEY) || '{}');
    return {
      manufacturersSort: INVENTORY_SORT_MODES.manufacturersSort.includes(stored?.manufacturersSort)
        ? stored.manufacturersSort : 'name-asc',
      itemsSort: INVENTORY_SORT_MODES.itemsSort.includes(stored?.itemsSort)
        ? stored.itemsSort : 'name-asc',
    };
  } catch {
    return { manufacturersSort: 'name-asc', itemsSort: 'name-asc' };
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

function sortItems(items = [], mode = STOCK_VIEW.itemsSort) {
  const rows = [...items];
  const byName = (left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'ru', { numeric: true, sensitivity: 'base' });
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

function itemOptions() {
  return getInventoryItems().map((item) => ({
    value: item.itemId,
    label: item.name,
    meta: `${numberText(item.balance)} ${item.unit}`,
  }));
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
  const identifiers = twoColumnLayout(
    field({ label: 'Артикул', name: 'sku', value: item.sku || '' }),
    field({ label: 'Штрихкод', name: 'barcode', value: item.barcode || '' }),
    { ariaLabel: 'Артикул и штрихкод' },
  );
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
  const actions = primary?.closest('.modal-actions');
  const signature = () => JSON.stringify([...new FormData(form).entries()]
    .filter(([name]) => name !== 'netWeight')
    .map(([name, value]) => [name, typeof value === 'string' ? value : '']));
  const initialSignature = signature();
  const syncDirty = () => {
    if (!creating) setSharedActionVisible(actions, signature() !== initialSignature);
  };
  form.addEventListener('input', syncDirty);
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
      if (creating) await createInventoryItem(value);
      else await updateInventoryItem(item.itemId, value);
      layer.v2Close?.();
      onSaved();
    } catch (error) {
      primary.disabled = false;
      openNotice({ title: 'Не удалось сохранить', message: error instanceof Error ? error.message : 'Ошибка склада' });
    }
  };
  primary.addEventListener('click', () => { void save(); });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });
  notifyContext();
}

function movementEditorRow(row = {}, index = 0) {
  const item = getInventoryItem(row.itemId);
  const quantity = row.quantity == null ? '' : Number(row.quantity);
  const direction = row.direction === 'IN' || row.direction === 'OUT' ? row.direction : '';
  return `<div data-inventory-movement-row data-row-index="${index}" data-row-direction="${escapeHtml(direction)}">
    ${twoColumnLayout(
      searchableSelect({
        label: 'Материал',
        name: `itemId-${index}`,
        value: row.itemId || '',
        options: itemOptions(),
        placeholder: 'Выбрать',
        required: true,
      }),
      field({
        label: item?.unit ? `Количество, ${item.unit}` : 'Количество',
        name: `quantity-${index}`,
        value: quantity,
        type: 'number',
        min: '0',
        step: '0.001',
        inputmode: 'decimal',
      }),
      { ariaLabel: 'Материал и количество' },
    )}
  </div>`;
}

function collectMovementRows(host) {
  return [...host.querySelectorAll('[data-inventory-movement-row]')].map((row) => {
    const index = row.dataset.rowIndex;
    const itemId = row.querySelector(`[name="itemId-${CSS.escape(index)}"]`)?.value || '';
    const quantity = Number(String(row.querySelector(`[name="quantity-${CSS.escape(index)}"]`)?.value || '0').replace(',', '.')) || 0;
    const direction = row.dataset.rowDirection === 'IN' || row.dataset.rowDirection === 'OUT' ? row.dataset.rowDirection : undefined;
    return { itemId, quantity, ...(direction ? { direction } : {}) };
  }).filter((row) => row.itemId && row.quantity > 0);
}

function openMovementEditor(root, movementId = '', kind = 'CONSUMPTION') {
  const movement = movementId ? getInventoryMovement(movementId) : null;
  const correcting = Boolean(movement);
  const initialRows = movement?.lines?.length
    ? movement.lines.map((line) => ({ itemId: line.itemId, quantity: line.quantity, direction: line.direction }))
    : [{ itemId: '', quantity: '' }];
  const title = correcting ? movementTitle(movement) : movementTitle({ kind });
  const markup = `
    ${context(title)}
    <form data-inventory-movement-form>
      ${correcting && movement.personUei ? `<div class="entity-details"><div><span>UEI</span><strong>${escapeHtml(movement.personUei)}</strong></div></div>` : ''}
      <div data-inventory-movement-rows>${initialRows.map(movementEditorRow).join('')}</div>
      ${button('+ Добавить позицию', { type: 'button', variant: 'secondary', data: 'data-inventory-add-movement-row' })}
      ${field({ label: 'Примечание', name: 'note', value: movement?.note || '' })}
      ${actionBlock(button(correcting ? 'Исправить' : 'Сохранить', { type: 'button', data: 'data-inventory-movement-save' }))}
    </form>`;
  const layer = mountV2ZLayer(root, v2ZLayer(markup, { className: 'inventory-movement-z' }), { stack: true });
  if (!layer) return;

  let rowIndex = initialRows.length;
  layer.querySelector('[data-inventory-add-movement-row]')?.addEventListener('click', () => {
    layer.querySelector('[data-inventory-movement-rows]')?.insertAdjacentHTML('beforeend', movementEditorRow({}, rowIndex));
    rowIndex += 1;
  });

  layer.addEventListener('change', (event) => {
    const selectInput = event.target.closest?.('input[name^="itemId-"]');
    if (!selectInput) return;
    const row = selectInput.closest('[data-inventory-movement-row]');
    const item = getInventoryItem(selectInput.value);
    const label = row?.querySelector('input[name^="quantity-"]')?.closest('.field')?.querySelector(':scope > span');
    if (label) label.textContent = item?.unit ? `Количество, ${item.unit}` : 'Количество';
  });

  layer.querySelector('[data-inventory-movement-save]')?.addEventListener('click', async () => {
    const form = layer.querySelector('[data-inventory-movement-form]');
    const lines = collectMovementRows(layer);
    if (!lines.length) {
      openNotice({ title: 'Позиции', message: 'Добавьте хотя бы один материал и количество.' });
      return;
    }
    try {
      if (correcting) {
        await correctInventoryMovement(movement.movementId, {
          lines,
          note: String(new FormData(form).get('note') || '').trim(),
        });
      } else {
        await createInventoryMovement({
          kind,
          sourceType: 'manual',
          note: String(new FormData(form).get('note') || '').trim(),
          lines,
        });
      }
      layer.v2Close?.();
      renderMovements(root);
    } catch (error) {
      openNotice({ title: 'Не удалось сохранить', message: error instanceof Error ? error.message : 'Ошибка склада' });
    }
  });
  notifyContext();
}

function openMovementKind(root, trigger) {
  const actions = [
    ['RECEIPT', 'Приход'],
    ['CONSUMPTION', 'Расход'],
    ['WRITE_OFF', 'Списание'],
    ['RETURN', 'Возврат'],
  ];
  const content = actions.map(([kind, label]) => button(label, {
    type: 'button',
    variant: 'secondary',
    data: `data-inventory-kind="${kind}"`,
  })).join('');
  const modalRoot = mountModal(trigger, modal(content, { title: 'Операция', variant: 'x' }));
  modalRoot?.querySelectorAll('[data-inventory-kind]').forEach((control) => {
    control.addEventListener('click', () => {
      const selectedKind = control.dataset.inventoryKind;
      modalRoot.v2Close?.();
      openMovementEditor(root, '', selectedKind);
    });
  });
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
  const items = sortItems(getInventoryItems().filter((item) => {
    if (manufacturerName(item) !== manufacturer) return false;
    if (!matchesType(item, STOCK_VIEW.itemsType)) return false;
    return !needle || itemSearchText(item).includes(needle);
  }), STOCK_VIEW.itemsSort);
  if (!items.length) return emptyState('Ничего не найдено', 'Измените поиск или фильтр.');
  return v2ListEntries(items.map((item) => v2ListEntry({
    title: item.name,
    subtitle: [productTypeText(item), item.location].filter(Boolean).join(' · '),
    rightTop: `${numberText(item.balance)} ${item.unit}`,
    rightBottom: item.lastPurchasePrice == null ? '' : moneyText(item.lastPurchasePrice),
    interactive: true,
    initial: '',
    data: `data-inventory-item="${escapeHtml(item.itemId)}"`,
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
  const content = `<div data-inventory-stock-controls>
    ${mode !== 'filter' ? select({
      label: 'Сортировка',
      name: 'inventorySort',
      value: STOCK_VIEW[sortKey],
      options: stockSortOptions(level),
      aria: 'Сортировка остатков',
    }) : ''}
    ${level === 'items' && mode === 'filter' ? select({
      label: 'Фильтр',
      name: 'inventoryType',
      value: STOCK_VIEW[typeKey],
      options: stockTypeOptions(manufacturer),
      aria: 'Фильтр по типу продукта',
    }) : ''}
  </div>`;
  const modalRoot = mountModal(trigger, modal(content, {
    title: mode === 'filter' ? 'Фильтр' : 'Сортировка',
    variant: 'x',
  }));
  modalRoot?.querySelector('input[name="inventorySort"]')?.addEventListener('change', (event) => {
    saveInventorySortMode(sortKey, event.target.value);
    onChange?.();
  });
  modalRoot?.querySelector('input[name="inventoryType"]')?.addEventListener('change', (event) => {
    STOCK_VIEW[typeKey] = event.target.value;
    onChange?.();
  });
}

function bindManufacturerCards(root, host) {
  host.querySelectorAll('[data-inventory-manufacturer]').forEach((control) => {
    control.addEventListener('click', () => openManufacturerStock(root, control.dataset.inventoryManufacturer));
  });
}

function openManufacturerStock(root, manufacturer) {
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
  const renderList = () => {
    const query = searchInput?.value || '';
    if (listHost) listHost.innerHTML = stockListMarkup(manufacturer, query);
    listHost?.querySelectorAll('[data-inventory-item]').forEach((control) => control.addEventListener('click', () => {
      const itemId = control.dataset.inventoryItem;
      openInventoryProductOverview(itemId, {
        edit: (onSaved) => openItemEditor(root, itemId, {}, onSaved),
        onChanged: renderList,
      });
    }));
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
          onSelect: () => openInventoryAuditMode(layer, {
            manufacturer, query: searchInput?.value || '', type: STOCK_VIEW.itemsType, onSaved: renderList,
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
  if (!movements.length) return emptyState('Движений пока нет', 'Приходы и расходы будут собираться здесь блоками.');
  const rows = movements.map((movement, movementIndex) => {
    const header = `<button type="button" class="ui-list__item ui-list__item--group-header${movementIndex ? ' ui-list__item--group-start' : ''}" data-inventory-movement="${escapeHtml(movement.movementId)}" aria-label="Открыть движение ${escapeHtml(movementTitle(movement))}">
      <span class="ui-list__main"><span class="ui-list__title">${escapeHtml(movementTitle(movement))}</span>${movementSubtitle(movement) ? `<span class="ui-list__secondary">${escapeHtml(movementSubtitle(movement))}</span>` : ''}</span>
      <span class="ui-list__right-secondary"><span>${escapeHtml(movementMoment(movement.occurredAt))}</span></span>
    </button>`;
    const lines = (Array.isArray(movement.lines) ? movement.lines : []).map((line) => `<div class="ui-list__item">
      <span class="ui-list__main"><span class="ui-list__title">${escapeHtml(line.name || '')}</span></span>
      <span class="ui-list__right-secondary"><span>${escapeHtml(`${movementSign(line)}${numberText(line.quantity)} ${line.unit || ''}`)}</span></span>
    </div>`).join('');
    return header + lines;
  }).join('');
  return `<div class="ui-list ui-list--dense" data-ui-list>${rows}</div>`;
}

function orderMarkup() {
  const items = inventoryOrderSuggestions();
  if (!items.length) return emptyState('Заказывать пока нечего', 'Когда будет указан минимальный остаток, здесь появятся предложения.');
  return v2ListEntries(items.map((item) => v2ListEntry({
    title: item.name,
    subtitle: `Осталось ${numberText(item.balance)} ${item.unit}`,
    rightTop: `${numberText(item.suggestedQuantity)} ${item.unit}`,
    rightBottom: 'Рекомендация',
    initial: '',
  })));
}


function inventoryAuditScope({ manufacturer = '', query = '', type = '' } = {}) {
  const needle = normalizedSearch(query);
  return getInventoryItems().filter(item =>
    (!manufacturer || manufacturerName(item) === manufacturer)
    && matchesType(item, type)
    && (!needle || `${manufacturerName(item)} ${itemSearchText(item)}`.toLocaleLowerCase('ru-RU').includes(needle))
  ).map(item => item.itemId);
}

function inventoryAuditItems(ids) {
  const byId = new Map(getInventoryItems().map(item => [item.itemId, item]));
  return ids.map(id => byId.get(id)).filter(Boolean);
}

function openInventoryAuditSelection(root, { mode, manufacturer = '', query = '', type = '', onSaved = () => {} } = {}) {
  // Freeze the current manufacturer/search/type scope before any selection.
  const ids = [...new Set(inventoryAuditScope({ manufacturer, query, type }))];
  if (!ids.length) {
    openNotice({ title: 'Инвентаризация', message: 'В текущей выборке нет позиций.' });
    return null;
  }
  const markup = page([
    context('Инвентаризация'),
    `<div class="form-grid" data-inventory-audit-selection>
      ${compactCheck({ label: 'Выбрать все показанные', data: 'data-inventory-audit-all' })}
      <p data-inventory-audit-count>Выбрано 0 из ${ids.length}</p>
      <div data-inventory-audit-list></div>
    </div>`,
    actionBlock(button('Продолжить', { data: 'data-inventory-audit-next' })),
  ]);
  const layer = mountV2ZLayer(root, v2ZLayer(markup, { className: 'inventory-audit-z' }), { stack: true });
  if (!layer) return null;
  const [searchRow] = setV2ZHeaderRows(layer, [stockSearchField('', 'data-inventory-audit-search')]);
  const search = searchRow?.querySelector('[data-inventory-audit-search]');
  const list = layer.querySelector('[data-inventory-audit-list]');
  const all = layer.querySelector('[data-inventory-audit-all]');
  const count = layer.querySelector('[data-inventory-audit-count]');
  const next = layer.querySelector('[data-inventory-audit-next]');
  const selected = new Set();
  let visible = [];
  const sync = () => {
    if (count) count.textContent = `Выбрано ${selected.size} из ${ids.length}`;
    if (next) { next.disabled = !selected.size; next.textContent = `Продолжить · ${selected.size}`; }
    if (all) { all.checked = visible.length > 0 && visible.every(id => selected.has(id)); all.disabled = !visible.length; }
  };
  const render = () => {
    const needle = normalizedSearch(search?.value);
    const items = inventoryAuditItems(ids).filter(item => !needle ||
      `${manufacturerName(item)} ${itemSearchText(item)}`.toLocaleLowerCase('ru-RU').includes(needle))
      .sort((a,b) => String(a.name).localeCompare(String(b.name), 'ru', { numeric:true }));
    visible = items.map(item => item.itemId);
    if (list) list.innerHTML = items.length
      ? items.map(item => compactCheck({
        label: manufacturer ? item.name : `${manufacturerName(item)} · ${item.name}`,
        checked: selected.has(item.itemId),
        data: `data-inventory-audit-item="${escapeHtml(item.itemId)}"`,
      })).join('')
      : emptyState('Ничего не найдено', 'Измените поиск.');
    sync();
  };
  list?.addEventListener('change', event => {
    const input = event.target.closest?.('[data-inventory-audit-item]');
    if (!input) return;
    if (input.checked) selected.add(input.dataset.inventoryAuditItem);
    else selected.delete(input.dataset.inventoryAuditItem);
    sync();
  });
  all?.addEventListener('change', () => {
    visible.forEach(id => all.checked ? selected.add(id) : selected.delete(id));
    render();
  });
  search?.addEventListener('input', render);
  next?.addEventListener('click', () => {
    if (!selected.size) return;
    openInventoryAuditCriteria(layer, { mode, ids: [...selected], onSaved: () => {
      layer.v2Close?.();
      onSaved();
    }});
  });
  render();
  notifyContext();
  return layer;
}

function openInventoryAuditCriteria(root, { mode, ids = [], onSaved = () => {} } = {}) {
  const items = inventoryAuditItems(ids);
  if (!items.length) return openNotice({ title: 'Инвентаризация', message: 'Позиции не найдены.' });
  const isData = mode === 'data';
  const fields = isData
    ? `<div class="form-grid">
      ${select({ label: 'Что изменить', name: 'auditField', value: 'category', options: [
        { value: 'category', label: 'Категория' },
        { value: 'productType', label: 'Тип продукта' },
      ] })}
      ${field({ label: 'Новое значение', name: 'auditValue', autocomplete:'off' })}
    </div>`
    : `<div class="form-grid">${items.map((item, i) => field({
      label: `${item.name} · сейчас ${numberText(item.balance)} ${item.unit}`,
      name: `auditActual-${i}`, type:'number', value:'', min:'0', step:'0.001', inputmode:'decimal',
    })).join('')}</div>`;
  const markup = `<form data-inventory-audit-criteria>
    <p>Выбрано: ${items.length} позиций</p>
    ${fields}
    <p class="form-error" role="status" data-inventory-audit-status></p>
    ${actionBlock(button(isData ? 'Применить' : 'Завершить', { type:'submit', data:'data-inventory-audit-apply' }))}
  </form>`;
  const layer = mountModal(root, modal(markup, {
    title:isData ? 'Инвентаризация данных' : 'Инвентаризация остатков', variant:'x', xRole:'editor',
  }));
  if (!layer) return null;
  const form = layer.querySelector('[data-inventory-audit-criteria]');
  const submit = layer.querySelector('[data-inventory-audit-apply]');
  const status = layer.querySelector('[data-inventory-audit-status]');
  const balances = new Map(items.map(item => [item.itemId, Number(item.balance) || 0]));
  let saving = false;
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving) return;
    const data = new FormData(form);
    const fieldName = String(data.get('auditField') || '');
    const value = String(data.get('auditValue') || '').trim();
    let changes = [];
    if (isData) {
      if (!['category','productType'].includes(fieldName) || !value) {
        status.textContent = 'Укажите поле и новое значение.';
        return;
      }
      changes = items.filter(item => getInventoryItem(item.itemId)
        && String(getInventoryItem(item.itemId)?.[fieldName] || '').trim() !== value);
      if (!changes.length) { status.textContent = 'У выбранных позиций уже указано это значение.'; return; }
    } else {
      const lines = [];
      for (let i=0; i<items.length; i++) {
        const item = items[i], raw = String(data.get(`auditActual-${i}`) ?? '').trim();
        if (!raw) continue;
        const actual = Number(raw.replace(',','.'));
        if (!Number.isFinite(actual) || actual < 0) { status.textContent = `Проверьте количество: ${item.name}.`; return; }
        const current = getInventoryItem(item.itemId);
        const expected = balances.get(item.itemId);
        if (!current || Math.abs((Number(current.balance)||0) - expected) > .000001) {
          status.textContent = 'Остатки изменились. Повторите инвентаризацию.';
          return;
        }
        if (Math.abs(actual-expected) > .000001) lines.push({
          itemId:item.itemId, quantity:actual-expected, expectedQuantity:expected, actualQuantity:actual,
        });
      }
      if (!lines.length) { status.textContent = 'Введите фактические остатки, отличающиеся от учётных.'; return; }
      saving = true; submit.disabled = true; status.textContent = 'Сохранение…';
      try {
        await createInventoryMovement({ kind:'ADJUSTMENT', sourceType:'inventory-count', note:'Инвентаризация', lines });
        layer.v2Close?.(); onSaved();
        openNotice({ title:'Инвентаризация', message:`Обновлено ${lines.length} позиций.` });
      } catch(error) {
        status.textContent = error instanceof Error ? error.message : 'Не удалось сохранить остатки.';
      } finally { saving = false; if(submit.isConnected) submit.disabled = false; }
      return;
    }
    saving = true; submit.disabled = true;
    let saved = 0; const failed = [];
    // The Core partial-item endpoint updates only the named master-data field.
    for (let i=0; i<changes.length; i+=4) {
      const batch = changes.slice(i, i+4);
      const results = await Promise.allSettled(batch.map(item =>
        updateInventoryItem(item.itemId, { [fieldName]:value })));
      results.forEach((result,j) => result.status === 'fulfilled'
        ? saved++ : failed.push(batch[j].itemId));
      status.textContent = `Сохранение: ${saved} из ${changes.length}`;
    }
    try { await loadInventory(); } catch(error) { failed.push('refresh'); }
    saving = false;
    if (submit.isConnected) submit.disabled = false;
    if (failed.length) {
      status.textContent = `Исправлено ${saved}. Не удалось: ${failed.length}. Повторите для оставшихся.`;
      return;
    }
    layer.v2Close?.(); onSaved();
    openNotice({ title:'Инвентаризация', message:`Изменено ${saved} позиций.` });
  });
  return layer;
}

function openInventoryAuditMode(root, { manufacturer = '', query = '', type = '', onSaved = () => {} } = {}) {
  const markup = `<div class="form-grid">
    ${button('Данные', { variant:'secondary', data:'data-inventory-audit-mode="data"' })}
    ${button('Остатки', { variant:'secondary', data:'data-inventory-audit-mode="stock"' })}
  </div>`;
  const layer = mountModal(root, modal(markup, { title:'Инвентаризация', variant:'x', xRole:'action' }));
  layer?.querySelectorAll('[data-inventory-audit-mode]').forEach(control =>
    control.addEventListener('click', () => {
      const mode = control.dataset.inventoryAuditMode;
      layer.v2Close?.();
      openInventoryAuditSelection(root, { mode, manufacturer, query, type, onSaved });
    }));
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
          onSelect: () => openInventoryAuditMode(root, {
            query: searchInput?.value || '', type: STOCK_VIEW.manufacturersType, onSaved: renderManufacturers,
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
  root.querySelector('[data-inventory-add-movement]')?.addEventListener('click', (event) => openMovementKind(root, event.currentTarget));
  root.querySelectorAll('[data-inventory-movement]').forEach((control) => control.addEventListener('click', () => openMovementEditor(root, control.dataset.inventoryMovement)));
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
