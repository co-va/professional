import {
  actionBlock, button, compactButton, field, modal, mountModal, openNotice, select,
} from '../../ui/ui.js';
import { compactCheck } from '../../ui/selection/check-list.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { getInventoryItem, getInventoryItems } from './data.js';
import { createInventoryItem, updateInventoryItem } from './service.js';
import { inventoryCriterionGroups, criterionOptions } from './classification.js';
import { stockNestedCriteria, stockRootCriterion } from './stock-catalog.js';
import {
  inventoryStockThresholdInput, inventoryStockThresholdStored, inventoryStockThresholdUnit,
} from './completeness.js';

// One stock item owns identity and stock. Supplier offers remain separate records.
const normalized = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
const textValue = value => String(value ?? '').trim();
const numberValue = value => value == null || value === '' ? '' : String(value);
const optionalAmount = (raw, label, { integer = false, positive = false } = {}) => {
  const value = textValue(raw).replace(',', '.');
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || positive && n <= 0 || integer && !Number.isSafeInteger(n))
    throw new Error('Проверьте поле «' + label + '».');
  return n;
};
const checkedName = (root, name) => root.querySelector('[data-stock-receipt="' + name + '"]')?.checked;
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const same = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
const displayMoney = value => value == null || !Number.isFinite(Number(value)) ? ''
  : Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';

function exclusiveReceipt(form, unit) {
  for (const box of form.querySelectorAll('[data-stock-receipt]'))
    box.checked = box.dataset.stockReceipt === unit;
  const hidden = form.querySelector('[name="receiptUnit"]');
  if (hidden) hidden.value = unit;
  const quantity = form.querySelector('[name="packPieces"]');
  if (quantity) quantity.disabled = unit !== 'уп.';
}

function receiptMarkup(unit) {
  return '<div class="stock-position-receipt">' +
    '<span class="inventory-editor-label">Приход</span>' +
    '<div class="inventory-editor-extra-toggles">' +
      compactCheck({ label: 'Шт.', checked: unit !== 'уп.', data: 'data-stock-receipt="шт."' }) +
      compactCheck({ label: 'Уп.', checked: unit === 'уп.', data: 'data-stock-receipt="уп."' }) +
    '</div><input name="receiptUnit" type="hidden" value="' + escapeHtml(unit || 'шт.') + '"></div>';
}

function quantityPriceMarkup({ receipt = 'шт.', count = '', price = '', locked = false } = {}) {
  return '<div class="stock-position-two-fields">' +
    field({ label: 'Шт. в упаковке', name: 'packPieces', value: count, type: 'number',
      inputmode: 'numeric', min: '1', step: '1', disabled: receipt !== 'уп.' }) +
    field({ label: 'Закупка, ₽', name: 'purchasePrice', value: price, type: 'number',
      inputmode: 'decimal', min: '0', step: 'any', disabled: locked }) +
    '</div>';
}

function checkUniqueName(name, currentId = '') {
  if (!name) throw new Error('Укажите короткое название.');
  if (getInventoryItems().some(item => item.itemId !== currentId
      && normalized(item.name) === normalized(name)))
    throw new Error('Такое название уже есть. Укажите другое, например добавьте номер 002.');
}

function showFailure(layer, error) {
  const message = error instanceof Error ? error.message : 'Не удалось сохранить позицию.';
  const notice = layer?.querySelector('[data-stock-position-error]');
  if (notice) { notice.hidden = false; notice.textContent = message; }
  openNotice({ title: 'Не удалось сохранить', message });
}

function registerReceiptToggle(form, onChange = () => {}) {
  form.addEventListener('change', event => {
    const control = event.target?.closest?.('[data-stock-receipt]');
    if (!control) return;
    exclusiveReceipt(form, control.dataset.stockReceipt);
    onChange();
  });
}

function savedItemId(before) {
  return getInventoryItems().find(row => !before.has(row.itemId))?.itemId || '';
}

export function openQuickStockItemX(defaults = {}, onSaved = () => {}) {
  const content = '<form data-quick-stock-position class="stock-position-form">' +
    field({ label: 'Короткое название', name: 'name', value: defaults.name || '',
      required: true, autocomplete: 'off' }) +
    receiptMarkup('шт.') +
    quantityPriceMarkup() +
    actionBlock(button('Применить', { data: 'data-quick-stock-apply', type: 'submit' })) +
    '<p class="form-error" data-stock-position-error hidden role="alert"></p></form>';
  const layer = mountModal(document.body, modal(content, {
    title: 'Новая позиция', variant: 'x', surface: 'app', xRole: 'editor',
  }));
  if (!layer) return null;
  const form = layer.querySelector('[data-quick-stock-position]');
  registerReceiptToggle(form);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const apply = form.querySelector('[data-quick-stock-apply]');
    if (apply.disabled) return;
    try {
      const data = new FormData(form);
      const name = textValue(data.get('name'));
      checkUniqueName(name);
      const receipt = textValue(data.get('receiptUnit'));
      const pack = receipt === 'уп.' ? optionalAmount(data.get('packPieces'),
        'Шт. в упаковке', { integer: true, positive: true }) : 1;
      if (receipt === 'уп.' && pack == null)
        throw new Error('Укажите количество штук в упаковке.');
      const price = optionalAmount(data.get('purchasePrice'), 'Закупка');
      const before = new Set(getInventoryItems().map(row => row.itemId));
      apply.disabled = true;
      await createInventoryItem({
        name, receiptUnit: receipt, unit: 'шт.', packageQuantity: pack,
        thresholdUnit: 'шт.', canConsume: false, canSell: false,
        ...(price == null ? {} : { referencePrice: price }),
        ...(defaults.manufacturer ? { manufacturer: defaults.manufacturer } : {}),
      });
      const itemId = savedItemId(before);
      layer.v2Close?.();
      onSaved(itemId);
    } catch (error) {
      apply.disabled = false;
      showFailure(layer, error);
    }
  });
  return layer;
}

function panel(title, key, contents, { checked = null, opened = false } = {}) {
  const control = checked === null ? '' :
    '<div class="inventory-editor-heading__controls">' +
      compactCheck({ checked, aria: title + ': включить', data: 'data-stock-option="' + key + '"' }) +
    '</div>';
  return '<section class="inventory-editor-panel" data-stock-panel="' + key + '">' +
    '<details' + (opened ? ' open' : '') + '><summary class="inventory-editor-summary">' +
    escapeHtml(title) + '</summary><div class="inventory-editor-panel__body">' +
    contents + '</div></details>' + control + '</section>';
}

function numberField(label, name, value, unit = '', disabled = false) {
  return '<div class="stock-position-number">' +
    field({ label, name, value: numberValue(value), type: 'number', min: '0',
      inputmode: 'decimal', step: 'any', disabled }) +
    (unit ? '<span class="stock-position-unit">' + escapeHtml(unit) + '</span>' : '') +
    '</div>';
}

function supplierPurchase(item) {
  const linked = Boolean(item?.primaryOfferId);
  const priced = item?.basePriceSource === 'primary-offer' && item?.basePrice != null;
  return { locked: linked, value: linked ? priced ? item.basePrice : ''
    : item?.referencePrice ?? '' };
}

function packPieces(item) {
  if (item?.receiptUnit !== 'уп.') return '';
  if (item.unit === 'шт.' && Number.isSafeInteger(Number(item.packageQuantity))
      && Number(item.packageQuantity) > 0) return item.packageQuantity;
  const factor = Number(item.conversionRules?.find(row => row.unit === 'шт.')?.stockPerUnit);
  if (factor > 0 && Number(item.packageQuantity) > 0) {
    const count = Number(item.packageQuantity) / factor;
    if (Number.isSafeInteger(count) && count > 0) return count;
  }
  return '';
}

function consumptionContents(item) {
  if (item?.receiptUnit === 'уп.') return { quantity: packPieces(item), unit: 'шт.' };
  return {
    quantity: item?.nominalQuantity ?? '',
    unit: item?.nominalUnit || 'г',
  };
}

function supplierLinkedText(item) {
  return item?.primaryOfferId ? '<p class="stock-position-note">Цена определяется выбранным контрагентом.</p>' : '';
}

function stockUnit(item) {
  return item?.thresholdUnit || inventoryStockThresholdUnit(item) || 'шт.';
}

function groupChoices(item, groups) {
  const rows = groups.map(group => ({
    id: group.id,
    value: textValue(group.legacyField
      ? item?.[group.legacyField] : item?.criteriaValues?.[group.id]),
  })).filter(row => row.value);
  return rows.length ? rows : [{ id: '', value: '' }];
}

function saleCost(purchase, receipt, count) {
  if (purchase == null) return null;
  // Sale always sells one whole receipt unit, not a consumption fraction.
  return purchase;
}

export function openStockItemQEditor(itemId = '', defaults = {}, onSaved = () => {}) {
  const current = itemId ? getInventoryItem(itemId) : null;
  const creating = !current;
  const item = current || {
    name: defaults.name || '', manufacturer: defaults.manufacturer || '',
    receiptUnit: 'шт.', unit: 'шт.', canConsume: false, canSell: false,
  };
  const receipt = item.receiptUnit || 'шт.';
  const purchase = supplierPurchase(item);
  const count = packPieces(item);
  const contents = consumptionContents(item);
  const allGroups = inventoryCriterionGroups();
  const root = stockRootCriterion(allGroups);
  const groups = stockNestedCriteria(allGroups);
  let slots = groupChoices(item, groups);
  const originalSlots = JSON.stringify(slots);
  const originalReceipt = receipt;
  const originalCount = count;
  const originalPrice = purchase.value;
  const original = {
    name: item.name || '', manufacturer: item.manufacturer || '',
    position: numberValue(item.position > 0 ? item.position : ''),
    sku: item.sku || '', barcode: item.barcode || '',
    consumeOn: item.canConsume === true,
    consumeQuantity: numberValue(item.consumeQuantity ?? 1),
    contentQuantity: numberValue(contents.quantity),
    contentUnit: contents.unit,
    saleOn: item.canSell === true,
    markup: numberValue(item.saleMarkupValue),
    markupMode: item.saleMarkupMode || 'percent',
    minStock: numberValue(creating ? '' : inventoryStockThresholdInput(item, item.minStock)),
    targetStock: numberValue(creating ? '' : inventoryStockThresholdInput(item, item.targetStock)),
  };
  const classification = '<div class="inventory-editor-group">' +
    '<div class="inventory-editor-row">' +
      select({ label: 'Производитель', name: 'manufacturer', value: original.manufacturer,
        options: criterionOptions(root, original.manufacturer) }) +
      field({ label: '№ позиции', name: 'position', value: original.position,
        type: 'number', min: '1', step: '1', inputmode: 'numeric' }) +
    '</div>' +
    '<div class="stock-position-group-heading"><span>Группы</span>' +
      compactButton({ kind: 'add', data: 'data-stock-group-add',
        aria: 'Добавить подгруппу' }) + '</div>' +
    '<div data-stock-groups></div>' +
    '<div class="inventory-editor-row">' +
      field({ label: 'Артикул', name: 'sku', value: original.sku }) +
      field({ label: 'Штрихкод', name: 'barcode', value: original.barcode }) +
    '</div></div>';
  const consumption = '<div class="inventory-editor-group">' +
    '<div data-stock-content-fields></div>' +
    '<div class="inventory-editor-row">' +
      numberField('Количество расхода', 'consumeQuantity', original.consumeQuantity) +
      numberField('Себестоимость', 'consumeCost', '', '₽', true) +
    '</div></div>';
  const sale = '<div class="inventory-editor-group">' +
    '<div class="inventory-editor-row">' +
      field({ label: 'Наценка', name: 'markup', value: original.markup,
        type: 'number', min: '0', step: 'any', inputmode: 'decimal' }) +
      select({ label: 'Тип наценки', name: 'markupMode', value: original.markupMode,
        options: [{ value: 'percent', label: '%' }, { value: 'amount', label: '₽' }] }) +
    '</div>' +
    numberField('Цена продажи', 'salePriceCalculated', item.salePrice ?? '', '₽', true) +
    '</div>';
  const stock = '<div class="inventory-editor-group">' +
    '<div class="inventory-editor-row">' +
      numberField('Критический остаток', 'minStock', original.minStock, stockUnit(item)) +
      numberField('Желаемый остаток', 'targetStock', original.targetStock, stockUnit(item)) +
    '</div></div>';
  const position = '<div class="inventory-editor-group">' +
    field({ label: 'Короткое название', name: 'name', value: original.name,
      required: true, autocomplete: 'off' }) +
    receiptMarkup(receipt) +
    quantityPriceMarkup({ receipt, count, price: purchase.value, locked: purchase.locked }) +
    supplierLinkedText(item) + '</div>';
  const html = '<form data-stock-full-position class="stock-position-form">' +
    '<div class="inventory-item-accordion">' +
      panel('Позиция', 'position', position, { opened: true }) +
      panel('Классификация', 'classification', classification) +
      panel('Расход', 'consume', consumption, { checked: original.consumeOn }) +
      panel('Продажа', 'sale', sale, { checked: original.saleOn }) +
      panel('Запас и контроль', 'stock', stock) +
    '</div>' + actionBlock(button(creating ? 'Применить' : 'Сохранить',
      { data: 'data-stock-full-apply', type: 'submit' })) +
    '<p class="form-error" data-stock-position-error hidden role="alert"></p></form>';
  const layer = mountModal(document.body, modal(html, {
    title: creating ? 'Новая позиция' : item.name, variant: 'q', surface: 'app',
  }));
  if (!layer) return null;
  const form = layer.querySelector('[data-stock-full-position]');
  const input = name => form.elements.namedItem(name);
  const read = name => textValue(input(name)?.value);
  const enabled = type => Boolean(form.querySelector('[data-stock-option="' + type + '"]')?.checked);
  const initialChecks = { consume: original.consumeOn, sale: original.saleOn };
  registerReceiptToggle(form, () => { drawContent(); updatePrices(); });
  const drawGroups = () => {
    const host = form.querySelector('[data-stock-groups]');
    const used = new Set(slots.map(row => row.id).filter(Boolean));
    host.innerHTML = slots.map((slot, index) => {
      const group = groups.find(row => row.id === slot.id);
      const options = [{ value: '', label: 'Выберите группу' },
        ...groups.filter(row => row.id === slot.id || !used.has(row.id))
          .map(row => ({ value: row.id, label: row.name }))];
      return '<div class="stock-position-group-row" data-stock-group-row="' + index + '">' +
        select({ name: 'groupKind' + index, aria: 'Группа ' + (index + 1),
          value: slot.id, options }) +
        select({ name: 'groupValue' + index, aria: 'Значение группы ' + (index + 1),
          value: slot.value, options: group ? criterionOptions(group, slot.value)
            : [{ value: '', label: 'Выберите значение' }] }) +
        '</div>';
    }).join('');
    const plus = form.querySelector('[data-stock-group-add]');
    if (plus) plus.disabled = slots.length >= groups.length ||
      !slots.every(row => row.id && row.value);
  };
  form.querySelector('[data-stock-group-add]')?.addEventListener('click', () => {
    if (slots.length >= groups.length || !slots.every(row => row.id && row.value)) return;
    slots.push({ id: '', value: '' });
    drawGroups();
  });
  form.addEventListener('change', event => {
    const target = event.target;
    const kind = String(target?.name || '').match(/^groupKind(\d+)$/);
    const val = String(target?.name || '').match(/^groupValue(\d+)$/);
    if (kind && slots[Number(kind[1])]) {
      slots[Number(kind[1])] = { id: textValue(target.value), value: '' };
      drawGroups();
    } else if (val && slots[Number(val[1])]) {
      slots[Number(val[1])].value = textValue(target.value);
      drawGroups();
    }
  });
  const drawContent = () => {
    const host = form.querySelector('[data-stock-content-fields]');
    const isPack = read('receiptUnit') === 'уп.';
    if (isPack) {
      host.innerHTML = '<div class="stock-position-static-content">' +
        '<span class="inventory-editor-label">Содержимое</span>' +
        '<span data-stock-pack-content></span></div>';
    } else {
      const n = input('contentQuantity')?.value ?? original.contentQuantity;
      const u = input('contentUnit')?.value ?? original.contentUnit;
      host.innerHTML = '<div class="inventory-editor-row">' +
        field({ label: 'Содержимое', name: 'contentQuantity', value: n, type: 'number',
          min: '0', step: 'any', inputmode: 'decimal' }) +
        select({ label: 'Единица', name: 'contentUnit', value: u,
          options: [{ value: 'г', label: 'г' }, { value: 'мл', label: 'мл' },
            { value: 'шт.', label: 'шт.' }] }) + '</div>';
    }
    updatePrices();
  };
  const updatePrices = () => {
    const price = optionalFinite(read('purchasePrice'));
    const countNow = Number(read('packPieces'));
    const content = read('receiptUnit') === 'уп.' ? countNow
      : Number(read('contentQuantity'));
    const unit = read('receiptUnit') === 'уп.' ? 'шт.' : read('contentUnit');
    const quantity = Number(read('consumeQuantity') || 1);
    const expense = price == null || !Number.isFinite(quantity) || quantity < 0 ? null
      : content > 0 ? price * quantity / content
      : read('receiptUnit') === 'шт.' && unit === 'шт.' ? price * quantity : null;
    if (input('consumeCost')) input('consumeCost').value = expense == null ? '' : formatPrice(expense);
    const packText = form.querySelector('[data-stock-pack-content]');
    if (packText) packText.textContent = countNow > 0 && Number.isSafeInteger(countNow)
      ? countNow + ' шт.' : '—';
    const markup = optionalFinite(read('markup'));
    const retail = saleCost(price, read('receiptUnit'), countNow);
    const salePrice = retail == null || markup == null ? null
      : read('markupMode') === 'amount' ? retail + markup : retail * (1 + markup / 100);
    if (input('salePriceCalculated')) input('salePriceCalculated').value =
      salePrice == null ? '' : formatPrice(salePrice);
  };
  function formatPrice(value) { return String(Math.round((value + Number.EPSILON) * 100) / 100); }
  function optionalFinite(value) {
    if (value == null || value === '') return null;
    const n = Number(String(value).replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  form.addEventListener('input', updatePrices);
  form.addEventListener('change', updatePrices);
  drawGroups();
  drawContent();
  const commit = async event => {
    event.preventDefault();
    const apply = form.querySelector('[data-stock-full-apply]');
    if (apply.disabled) return;
    try {
      const name = read('name');
      checkUniqueName(name, item.itemId);
      const receiptNow = read('receiptUnit');
      const packNow = receiptNow === 'уп.'
        ? optionalAmount(read('packPieces'), 'Шт. в упаковке', { integer: true, positive: true }) : 1;
      if (receiptNow === 'уп.' && packNow == null)
        throw new Error('Укажите количество штук в упаковке.');
      const priceNow = purchase.locked ? null : optionalAmount(read('purchasePrice'), 'Закупка');
      const patch = {};
      if (name !== original.name) patch.name = name;
      if (receiptNow !== originalReceipt) patch.receiptUnit = receiptNow;
      if (receiptNow !== originalReceipt || receiptNow === 'уп.' && String(packNow) !== String(originalCount))
        patch.packageQuantity = packNow;
      if (!purchase.locked && !same(priceNow, optionalFinite(originalPrice)))
        patch.referencePrice = priceNow;
      for (const key of ['manufacturer', 'sku', 'barcode']) {
        if (read(key) !== original[key]) patch[key] = read(key);
      }
      const pos = read('position');
      if (pos !== original.position) {
        if (pos && (!Number.isSafeInteger(Number(pos)) || Number(pos) < 1))
          throw new Error('Номер позиции должен быть положительным целым числом.');
        patch.position = pos ? Number(pos) : null;
      }
      if (JSON.stringify(slots) !== originalSlots) {
        const mapped = new Map(slots.filter(row => row.id && row.value).map(row => [row.id, row.value]));
        for (const group of groups.filter(row => row.legacyField)) {
          const next = mapped.get(group.id) || '';
          if (next !== textValue(item[group.legacyField])) patch[group.legacyField] = next;
        }
        const custom = groups.filter(row => !row.legacyField);
        if (custom.length) patch.criteriaValues = Object.fromEntries(custom.map(group =>
          [group.id, mapped.get(group.id) || '']));
      }
      const consumeNow = enabled('consume');
      if (consumeNow !== initialChecks.consume) patch.canConsume = consumeNow;
      if (consumeNow) {
        const qty = optionalAmount(read('consumeQuantity'), 'Количество расхода', { positive: true });
        if (qty == null) throw new Error('Укажите количество расхода.');
        if (qty !== Number(original.consumeQuantity) || consumeNow !== initialChecks.consume)
          patch.consumeQuantity = qty;
        const consumeUnit = receiptNow === 'уп.' ? 'шт.' : read('contentUnit');
        if (receiptNow !== originalReceipt || consumeUnit !== item.consumeUnit || consumeNow !== initialChecks.consume)
          patch.consumeUnit = consumeUnit;
        if (receiptNow === 'шт.') {
          const contentQty = optionalAmount(read('contentQuantity'), 'Содержимое', { positive: true });
          if (contentQty != null && !consumeUnit) throw new Error('Укажите единицу содержимого.');
          if (read('contentQuantity') !== original.contentQuantity || read('contentUnit') !== original.contentUnit) {
            patch.nominalQuantity = contentQty;
            patch.nominalUnit = contentQty == null ? null : consumeUnit;
          }
        }
      }
      const saleNow = enabled('sale');
      if (saleNow !== initialChecks.sale) patch.canSell = saleNow;
      if (saleNow) {
        const markup = optionalAmount(read('markup'), 'Наценка');
        const mode = read('markupMode');
        if (markup !== optionalFinite(original.markup) || mode !== original.markupMode
            || saleNow !== initialChecks.sale || receiptNow !== originalReceipt
            || hasOwn(patch, 'referencePrice')) {
          patch.saleMarkupMode = mode;
          patch.saleMarkupValue = markup;
          patch.salePrice = optionalFinite(input('salePriceCalculated')?.value);
        }
        if (saleNow !== initialChecks.sale || receiptNow !== originalReceipt) {
          patch.saleUnit = receiptNow;
          patch.saleQuantity = 1;
        }
      }
      for (const [key, label] of [['minStock', 'Критический остаток'], ['targetStock', 'Желаемый остаток']]) {
        const now = read(key);
        if (now !== original[key]) {
          const amount = optionalAmount(now, label);
          patch[key] = amount == null ? null : inventoryStockThresholdStored(item, amount);
        }
      }
      if (!Object.keys(patch).length) {
        openNotice({ title: 'Сохранение', message: 'Нет изменений.' });
        return;
      }
      apply.disabled = true;
      if (creating) {
        const before = new Set(getInventoryItems().map(row => row.itemId));
        await createInventoryItem({ ...patch, name, receiptUnit: receiptNow,
          unit: 'шт.', packageQuantity: packNow, thresholdUnit: 'шт.',
          canConsume: consumeNow, canSell: saleNow });
        const savedId = savedItemId(before);
        layer.v2Close?.();
        onSaved(savedId);
      } else {
        await updateInventoryItem(item.itemId, patch);
        layer.v2Close?.();
        onSaved(item.itemId);
      }
    } catch (error) {
      apply.disabled = false;
      showFailure(layer, error);
    }
  };
  form.addEventListener('submit', commit);
  return layer;
}
