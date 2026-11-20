import {
  actionBlock, button, emptyState, entityCardDefaultRows, entityVisualCard, field,
  modal, mountModal, openEntityCardAppearanceQ, openNotice, openSharedProfileSettingsMenu,
  page, select, twoColumnLayout, v2ListEntries, v2ListEntry, v2Section,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { getCardAppearanceTemplate, saveCardAppearanceTemplate } from '../card-appearance-templates.js';
import { flushBusinessPersistence, isBusinessServerReady } from '../business-persistence.js';
import { loadBusinessState } from '../runtime/business-state.js';
import { getInventoryItem, getInventoryMovements } from './data.js';
import { inventoryCriterionGroups } from './classification.js';
import { inventoryLocations, itemLocationBalance, storageName,
  openInventoryStockTargets, inventoryDisplayBalance, INVENTORY_TOTAL_SCOPE } from './stock-targets.js';
import {
  archiveInventorySupplierOffer, createInventorySupplierOffer, setInventoryPrimarySupplierOffer,
  updateInventoryItem, updateInventorySupplierOffer,
} from './service.js';

const PRODUCT_APPEARANCE_SCOPE = 'inventory-item';
const DEFAULT_PRODUCT_APPEARANCE = {
  lines: entityCardDefaultRows([
    { row: 2, column: 'left', field: 'manufacturer', size: 'm', color: '#FFFFFF' },
    { row: 4, column: 'left', field: 'name', size: 'xl', color: '#FFFFFF', bold: true },
    { row: 6, column: 'left', field: 'category', size: 'm', color: '#FFFFFF' },
    { row: 7, column: 'left', field: 'productType', size: 'm', color: '#FFFFFF' },
    { row: 8, column: 'left', field: 'storage', size: 'm', color: '#FFFFFF' },
    { row: 9, column: 'left', field: 'balance', size: 'm', color: '#FFFFFF' },
    { row: 9, column: 'right', field: 'basePrice', size: 'm', color: '#FFFFFF' },
  ]),
};

const num = (value, digits = 3) => Number(value).toLocaleString('ru-RU', {
  maximumFractionDigits: digits,
}).replaceAll('\u00a0', ' ');
const money = (value) => value == null || value === ''
  ? ''
  : num(Number(value), 2) + ' ₽';
const optionalText = (value) => value == null || value === '' ? '' : String(value);
const candidatePrice = (offer) => {
  if (offer.effectivePrice != null) return Number(offer.effectivePrice);
  if (offer.actualPrice != null) return Number(offer.actualPrice);
  if (offer.listPrice == null) return null;
  return Number(offer.listPrice) * (1 - Number(offer.discountPercent || 0) / 100);
};

// Field order belongs to the stock card's View constructor. Do not expose
// technical inventory data (weight, packaging, barcode, etc.) in its picker.
// Legacy criterion labels are account-editable; read their current names.
const inventoryFieldLabel = (legacyField, fallback) =>
  inventoryCriterionGroups().find(group => group.legacyField === legacyField)?.name || fallback;

const positive = value => {
  const n=Number(value);
  return value != null && value !== '' && Number.isFinite(n) && n > 0 ? n : null;
};

function supplierListPrice(item, offer) {
  if (offer?.listPrice == null) return null;
  const price=Number(offer.listPrice);
  if (!Number.isFinite(price) || price < 0) return null;
  // Match Core's basePrice unit: one nominal item package rather than the
  // supplier's potentially larger carton of purchasable units.
  const ownSize = positive(item.packageQuantity);
  const offerSize = positive(offer.unitsPerOffer);
  // The supplier's quoted pack price is still stored, but cannot be
  // normalized until both quantities have a verified conversion.
  return ownSize != null && offerSize != null ? price * ownSize / offerSize : null;
}

function consumptionUnitCost(item) {
  const base=item.baseUnitPrice == null ? null : Number(item.baseUnitPrice);
  if (base == null || !Number.isFinite(base) || base < 0) return '';
  const stock=String(item.unit || '').trim();
  const usage=String(item.consumeUnit || stock).trim();
  if (!stock || !usage) return '';
  let factor = stock===usage ? 1 : null;
  const metric = {'кг>г':0.001,'г>кг':1000,'л>мл':0.001,'мл>л':1000};
  // Each factor is the number of stock units per one consumption unit.
  if (factor==null) factor=metric[stock+'>'+usage] ?? null;
  if (factor==null) {
    const rule=(item.conversionRules || []).find(row=>row.unit===usage &&
      positive(row.stockPerUnit) != null);
    factor=rule ? Number(rule.stockPerUnit) : null;
  }
  // Never guess gram/ml or pack/piece equivalence for unknown conversions.
  return factor==null ? '' : money(base*factor) + '/' + usage;
}

function actualInventoryConsumption(item, stockScope = INVENTORY_TOTAL_SCOPE) {
  const movements=getInventoryMovements();
  // Core currently sends at most the latest 600 movements. At the limit the
  // sum may be partial; an empty display is safer than a false lifetime total.
  if (!Array.isArray(movements) || movements.length>=600) return '';
  const originals=new Map(movements.map(m=>[m.movementId,m]));
  let used=0;
  for(const movement of movements) {
    const consumption=movement.kind==='CONSUMPTION' ||
      (movement.kind==='CORRECTION' &&
       originals.get(movement.originalMovementId)?.kind==='CONSUMPTION');
    if (!consumption) continue;
    for(const line of movement.lines || []) {
      if(line.itemId!==item.itemId)continue;
      if(stockScope!==INVENTORY_TOTAL_SCOPE && (line.storageLocationId || 'primary')!==stockScope)continue;
      const amount=Number(line.quantity);
      if(!Number.isFinite(amount)||amount<0)continue;
      used+=line.direction==='OUT'?amount:-amount;
    }
  }
  return num(Math.max(0,Math.round(used*1000)/1000)) + ' ' + (item.unit||'');
}

function stockScopeName(scope) {
  if (scope === INVENTORY_TOTAL_SCOPE) return 'Складские остатки';
  if (scope === 'primary') return 'Не распределено';
  const place = inventoryLocations().find(row=>row.locationId===scope);
  const label = storageName(place).trim();
  if (!label) return 'Склад недоступен';
  return /^склад(?:\s|$)/i.test(label) ? label : 'Склад ' + label;
}

function productCardFields(item, stockScope = INVENTORY_TOTAL_SCOPE) {
  const primary=(item.supplierOffers || []).find(offer =>
    offer.offerId && offer.offerId===item.primaryOfferId) || null;
  const purchasePrice=item.basePrice ?? item.referencePrice;
  const discount=primary?.discountPercent;
  const discountText=discount==null || discount==='' ? '' :
    num(Number(discount),2) + '%';
  const entries = [
    ['manufacturer', inventoryFieldLabel('manufacturer','Производитель'), item.manufacturer],
    ['name', 'Наименование', item.name],
    ['sku', 'Артикул', item.sku],
    ['primarySupplier', 'Поставщик', primary?.supplier || item.primarySupplier || ''],
    ['supplierListPrice', 'Цена', money(supplierListPrice(item,primary))],
    ['supplierDiscount', 'Скидка', discountText],
    ['basePrice', 'Стоимость', money(purchasePrice)],
    ['storage', 'Склад', stockScopeName(stockScope)],
    ['balance', 'Остаток', num(inventoryDisplayBalance(item, stockScope)) + ' ' + (item.unit||'')],
    ['consumption', 'Расход', actualInventoryConsumption(item, stockScope)],
    ['baseUnitPrice', 'Себестоимость', consumptionUnitCost(item)],
    ['saleIndicator', 'Продажа', item.canSell===true ? 'Продажа ☑' : 'Продажа ☐'],
    ['salePrice', 'Цена продажи', item.canSell===true ? money(item.salePrice) : ''],
  ];
  return entries.map(([value, label, text]) => ({value,label,text:optionalText(text)}));
}

function productCardAppearance() {
  return getCardAppearanceTemplate(PRODUCT_APPEARANCE_SCOPE)?.appearance || DEFAULT_PRODUCT_APPEARANCE;
}

function productCard(item, stockScope = INVENTORY_TOTAL_SCOPE) {
  return entityVisualCard({
    appearance: productCardAppearance(),
    fields: productCardFields(item, stockScope),
    interactive: true,
    data: 'data-inventory-product-card',
    aria: 'Редактировать складскую единицу ' + item.name,
  });
}

function supplierRows(item) {
  const offers = Array.isArray(item.supplierOffers) ? item.supplierOffers : [];
  if (!offers.length) return emptyState('Поставщиков пока нет', 'Выберите компанию из раздела «Контрагенты».');
  return v2ListEntries(offers.map((offer) => {
    const primary = item.primaryOfferId === offer.offerId;
    const amount = candidatePrice(offer);
    const pack = positive(offer.unitsPerOffer);
    return v2ListEntry({
      title: offer.supplier || 'Место покупки',
      subtitle: primary ? 'Основной' : '',
      rightTop: money(amount) || '—',
      rightBottom: pack != null ? num(pack) + ' ' + item.unit : '',
      initial: '',
      interactive: true,
      data: 'data-inventory-supplier-offer="' + escapeHtml(offer.offerId) + '"',
      aria: 'Изменить предложение ' + (offer.supplier || ''),
    });
  }));
}

function offerValue(data, name, { required = false, positive = false, max = Infinity } = {}) {
  const raw = String(data.get(name) ?? '').trim();
  if (!raw) {
    if (required) throw new Error('Заполните обязательные поля.');
    return null;
  }
  const number = Number(raw.replace(',', '.'));
  if (!Number.isFinite(number) || number < 0 || (positive && number === 0) || number > max) {
    throw new Error('Проверьте поле ' + name + '.');
  }
  return number;
}

function openSupplierEditor(itemId, offerId = '', onSaved = () => {}) {
  const item = getInventoryItem(itemId);
  if (!item) return null;
  const offer = item.supplierOffers?.find((row) => row.offerId === offerId) || null;
  const isPrimary = Boolean(offer && item.primaryOfferId === offer.offerId);
  const markup = `<form data-inventory-offer-form>
    ${field({ label: 'Место покупки', name: 'supplier', value: offer?.supplier || '', required: true })}
    ${twoColumnLayout(
      field({ label: 'Прайс, ₽', name: 'listPrice', value: offer?.listPrice ?? '', type: 'number', min: '0', step: '0.01', inputmode: 'decimal' }),
      field({ label: 'Цена, ₽', name: 'actualPrice', value: offer?.actualPrice ?? '', type: 'number', min: '0', step: '0.01', inputmode: 'decimal' }),
      { ariaLabel: 'Цены предложения' },
    )}
    ${twoColumnLayout(
      field({ label: 'Скидка, %', name: 'discountPercent', value: offer?.discountPercent ?? '', type: 'number', min: '0', max: '100', step: '0.01', inputmode: 'decimal' }),
      field({ label: 'Содержимое, ' + item.unit, name: 'unitsPerOffer', value: offer?.unitsPerOffer ?? '', type: 'number', min: '0.001', step: '0.001', inputmode: 'decimal' }),
      { ariaLabel: 'Скидка и содержимое закупаемой упаковки' },
    )}
    <p data-inventory-offer-calculated-discount></p>
    ${select({ label: 'Основной', name: 'primary', value: isPrimary ? 'yes' : 'no', options: [
      { value: 'no', label: 'Нет' }, { value: 'yes', label: 'Да' },
    ] })}
    ${field({ label: 'Артикул поставщика', name: 'supplierSku', value: offer?.supplierSku || '' })}
    ${field({ label: 'Примечание', name: 'note', value: offer?.note || '' })}
    <div class="form-error" data-inventory-offer-error role="alert"></div>
    ${actionBlock(button('Применить', { type: 'submit', data: 'data-inventory-offer-save' }))}
    ${offer ? button('Удалить поставщика', { variant: 'critical', data: 'data-inventory-offer-delete' }) : ''}
  </form>`;
  const layer = mountModal(document.body, modal(markup, {
    title: offer ? 'Поставщик' : 'Добавить поставщика',
    variant: 'x', xRole: 'editor',
  }));
  if (!layer) return null;
  const form = layer.querySelector('[data-inventory-offer-form]');
  const discountSummary = layer.querySelector('[data-inventory-offer-calculated-discount]');
  const showDiscount = () => {
    const baseText = form.querySelector('[name="listPrice"]')?.value?.trim() || '';
    const actualText = form.querySelector('[name="actualPrice"]')?.value?.trim() || '';
    const base = Number(baseText.replace(',', '.'));
    const actual = Number(actualText.replace(',', '.'));
    if (!baseText || !actualText || !Number.isFinite(base) || base <= 0 || !Number.isFinite(actual) || actual < 0) {
      discountSummary.textContent = 'Скидка: —';
      return;
    }
    const delta = Math.round((1 - actual / base) * 10000) / 100;
    discountSummary.textContent = delta >= 0
      ? 'Ваша скидка от прайса: ' + delta.toLocaleString('ru-RU') + '%'
      : 'Цена выше прайса на ' + Math.abs(delta).toLocaleString('ru-RU') + '%';
  };
  form.querySelector('[name="listPrice"]')?.addEventListener('input', showDiscount);
  form.querySelector('[name="actualPrice"]')?.addEventListener('input', showDiscount);
  showDiscount();
  const primaryButton = layer.querySelector('[data-inventory-offer-save]');
  const errorHost = layer.querySelector('[data-inventory-offer-error]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (primaryButton.disabled) return;
    const data = new FormData(form);
    const supplier = String(data.get('supplier') || '').trim();
    if (!supplier) {
      errorHost.textContent = 'Укажите место покупки.';
      return;
    }
    let value;
    try {
      value = {
        supplier,
        listPrice: offerValue(data, 'listPrice'),
        actualPrice: offerValue(data, 'actualPrice'),
        discountPercent: offerValue(data, 'discountPercent', { max: 100 }),
        unitsPerOffer: offerValue(data, 'unitsPerOffer', { positive: true }),
        supplierSku: String(data.get('supplierSku') || '').trim(),
        note: String(data.get('note') || '').trim(),
      };
    } catch (error) {
      errorHost.textContent = error.message || 'Проверьте значения.';
      return;
    }
    primaryButton.disabled = true;
    errorHost.textContent = '';
    try {
      let savedOfferId = offerId;
      if (offer) await updateInventorySupplierOffer(itemId, offerId, value);
      else {
        const known = new Set((item.supplierOffers || []).map((row) => row.offerId));
        await createInventorySupplierOffer(itemId, value);
        savedOfferId = getInventoryItem(itemId)?.supplierOffers?.find((row) => !known.has(row.offerId))?.offerId || '';
      }
      const selectedPrimary = data.get('primary') === 'yes';
      if (selectedPrimary && savedOfferId && getInventoryItem(itemId)?.primaryOfferId !== savedOfferId) {
        await setInventoryPrimarySupplierOffer(itemId, savedOfferId);
      } else if (isPrimary && !selectedPrimary) {
        await setInventoryPrimarySupplierOffer(itemId, '');
      } else if (selectedPrimary && !savedOfferId) {
        throw new Error('Не удалось определить сохранённое предложение.');
      }
      layer.v2Close?.();
      onSaved();
    } catch (error) {
      errorHost.textContent = error instanceof Error ? error.message : 'Не удалось сохранить поставщика.';
    } finally {
      primaryButton.disabled = false;
    }
  });
  layer.querySelector('[data-inventory-offer-delete]')?.addEventListener('click', () => {
    const confirm = mountModal(document.body, modal(
      `<div class="modal-title"><h2>Удалить поставщика?</h2><p>История закупок сохранится.</p></div>
      <div class="form-error" data-inventory-offer-delete-error role="alert"></div>
      <div class="modal-actions">
        ${button('Удалить', { variant: 'critical', data: 'data-inventory-offer-confirm-delete' })}
        ${button('Отмена', { variant: 'secondary', data: 'data-inventory-offer-cancel-delete' })}
      </div>`, { title: 'Удаление поставщика', variant: 'x', xRole: 'action' },
    ));
    if (!confirm) return;
    confirm.querySelector('[data-inventory-offer-cancel-delete]')?.addEventListener('click', () => confirm.v2Close?.());
    confirm.querySelector('[data-inventory-offer-confirm-delete]')?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      try {
        await archiveInventorySupplierOffer(itemId, offerId);
        confirm.v2Close?.();
        layer.v2Close?.();
        onSaved();
      } catch (error) {
        event.currentTarget.disabled = false;
        const host = confirm.querySelector('[data-inventory-offer-delete-error]');
        if (host) host.textContent = error instanceof Error ? error.message : 'Не удалось удалить поставщика.';
      }
    });
  });
  return layer;
}

function stockCardPreviewExamples(item) {
  // Examples communicate the future value's real size and units. They are
  // used only in the View constructor, never on actual cards or in the DB.
  const unit = String(item.unit || 'шт.');
  return {
    manufacturer: 'Бренд',
    name: 'Товар',
    sku: 'А-001',
    primarySupplier: 'Поставщик',
    supplierListPrice: '1 000 ₽',
    supplierDiscount: '10%',
    basePrice: '900 ₽',
    storage: 'Склад',
    balance: '0 ' + unit,
    consumption: '5 ' + unit,
    baseUnitPrice: '10 ₽/' + unit,
    saleIndicator: 'Продажа ☐',
    salePrice: '1 500 ₽',
  };
}

export function openInventoryProductAppearanceQ(itemId, onSaved = () => {}, stockScope = INVENTORY_TOTAL_SCOPE) {
  const item = getInventoryItem(itemId) || { itemId: '', name: '' };
  return openEntityCardAppearanceQ(document.body, {
    title: 'Вид',
    typeOptions: [{ value: PRODUCT_APPEARANCE_SCOPE, label: 'Складская единица' }],
    initialType: PRODUCT_APPEARANCE_SCOPE,
    targetOptions: () => [],
    allowPhoto: false,
    resolve: () => ({
      appearance: productCardAppearance(),
      fields: (() => {
        const current = getInventoryItem(itemId) || item;
        const examples = stockCardPreviewExamples(current);
        return productCardFields(current, stockScope).map(field => ({
          ...field,
          text: String(field.text || '').trim()
            ? field.text : examples[field.value] || field.label,
        }));
      })(),
    }),
    save: async ({ appearance }) => {
      // The Inventory section can open without loading Journal state.
      // Never report a saved appearance while the persistence queue is offline.
      if (!isBusinessServerReady()) await loadBusinessState();
      if (!isBusinessServerReady()) throw new Error('Нет соединения для сохранения вида карты.');
      saveCardAppearanceTemplate(PRODUCT_APPEARANCE_SCOPE, { appearance });
      await flushBusinessPersistence();
    },
    onSaved,
  });
}

function confirmProductDelete(itemId, overview, onChanged) {
  const item = getInventoryItem(itemId);
  if (!item) return;
  if (Math.abs(Number(item.balance) || 0) > 0.000001) {
    openNotice({ title: 'Есть остаток', message: 'Сначала оформите списание или другое движение, чтобы остаток стал нулевым.' });
    return;
  }
  const confirm = mountModal(document.body, modal(
    `<div class="modal-title"><h2>Удалить складскую единицу?</h2><p>История движений и закупок сохранится.</p></div>
    <div class="form-error" data-inventory-product-delete-error role="alert"></div>
    <div class="modal-actions">
      ${button('Удалить', { variant: 'critical', data: 'data-inventory-product-confirm-delete' })}
      ${button('Отмена', { variant: 'secondary', data: 'data-inventory-product-cancel-delete' })}
    </div>`, { title: 'Удаление складской единицы', variant: 'x', xRole: 'action' },
  ));
  if (!confirm) return;
  confirm.querySelector('[data-inventory-product-cancel-delete]')?.addEventListener('click', () => confirm.v2Close?.());
  confirm.querySelector('[data-inventory-product-confirm-delete]')?.addEventListener('click', async (event) => {
    const control = event.currentTarget;
    control.disabled = true;
    try {
      await updateInventoryItem(itemId, { archived: true });
      confirm.v2Close?.();
      overview.v2Close?.();
      onChanged();
    } catch (error) {
      control.disabled = false;
      const host = confirm.querySelector('[data-inventory-product-delete-error]');
      if (host) host.textContent = error instanceof Error ? error.message
        : 'Не удалось удалить складскую единицу.';
    }
  });
}

function locationOverview(item) {
  const unit = item.unit || 'шт.';
  const threshold = item.thresholdUnit || item.receiptUnit || unit;
  const totalGoal = item.targetStock == null ? 'Не задан'
    : num(Number(item.targetStock)) + ' ' + threshold;
  const rows = [{
    title: 'Общий остаток', subtitle: 'Желаемый: ' + totalGoal,
    rightTop: num(Number(item.balance || 0)) + ' ' + unit,
  }, ...inventoryLocations().map(place => {
    const configured = (item.locationTargets || [])
      .find(row => row.locationId === place.locationId);
    return {
      title: storageName(place),
      subtitle: 'Желаемый: ' + (configured
        ? num(Number(configured.targetStock)) + ' ' + threshold : 'Не задан'),
      rightTop: num(itemLocationBalance(item, place.locationId)) + ' ' + unit,
    };
  })];
  return v2ListEntries(rows.map(row => v2ListEntry(row)));
}

export function openInventoryProductOverview(itemId, { edit = () => {}, onChanged = () => {}, stockScope = INVENTORY_TOTAL_SCOPE } = {}) {
  const initial = getInventoryItem(itemId);
  if (!initial) return null;
  const layer = mountModal(document.body, modal('<div data-inventory-product-overview></div>', {
    variant: 'q',
    surface: 'app',
    className: 'inventory-product-overview-q',
  }));
  if (!layer) return null;
  layer.querySelector('.modal-sheet')?.setAttribute('aria-label', 'Карточка складской единицы: ' + (initial.name || 'Складская единица'));

  const render = () => {
    const item = getInventoryItem(itemId);
    if (!item) {
      layer.v2Close?.();
      onChanged();
      return;
    }
    const host = layer.querySelector('[data-inventory-product-overview]');
    if (!host) return;
    host.innerHTML = page([
      workspaceHeaderContext({
        title: item.name,
        v: { data: 'data-inventory-product-menu', aria: 'Действия с товаром' },
      }),
      productCard(item, stockScope),
      v2Section('Остатки', locationOverview(item) +
        actionBlock(button('Настроить', {
          variant: 'secondary', data: 'data-inventory-product-targets',
          aria: 'Настроить желаемые остатки по складам',
        }))),
      v2Section('Поставщики', supplierRows(item)),
      actionBlock(button('Добавить', {
        variant: 'secondary', data: 'data-inventory-supplier-add', aria: 'Связать с контрагентом',
      })),
    ]);
    host.querySelector('[data-inventory-product-card]')?.addEventListener('click', () => {
      edit(() => {
        render();
        onChanged();
      });
    });
    host.querySelector('[data-inventory-product-targets]')?.addEventListener('click', () => {
      openInventoryStockTargets(itemId, () => { render(); onChanged(); });
    });
    host.querySelector('[data-inventory-supplier-add]')?.addEventListener('click', async () => {
      const { openSupplierAssociation } = await import('./counterparties.js');
      openSupplierAssociation(itemId, () => { render(); onChanged(); });
    });
    host.querySelectorAll('[data-inventory-supplier-offer]').forEach((row) => row.addEventListener('click', () => {
      openSupplierEditor(itemId, row.dataset.inventorySupplierOffer, () => {
        render();
        onChanged();
      });
    }));
    host.querySelector('[data-inventory-product-menu]')?.addEventListener('click', () => {
      openSharedProfileSettingsMenu({
        title: 'Складская единица',
        actions: [{
          id: 'archive-item',
          label: 'Удалить складскую единицу',
          variant: 'critical',
          onSelect: () => confirmProductDelete(itemId, layer, onChanged),
        }],
      });
    });
    window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
  };

  render();
  return layer;
}
