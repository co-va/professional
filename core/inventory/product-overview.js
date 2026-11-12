import {
  actionBlock, button, emptyState, entityCardDefaultRows, entityVisualCard, field,
  modal, mountModal, openEntityCardAppearanceQ, openNotice, openSharedProfileSettingsMenu,
  page, select, twoColumnLayout, v2ListEntries, v2ListEntry, v2Section,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { getCardAppearanceTemplate, saveCardAppearanceTemplate } from '../card-appearance-templates.js';
import { flushBusinessPersistence } from '../business-persistence.js';
import { getInventoryItem } from './data.js';
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

function productCardFields(item) {
  const balance = Number(item.balance) || 0;
  const packSize = Number(item.packageQuantity) || 0;
  const nominalPrice = item.basePrice ?? item.referencePrice;
  const unitPrice = item.baseUnitPrice != null
    ? item.baseUnitPrice
    : (nominalPrice != null && packSize > 0 ? Number(nominalPrice) / packSize : null);
  const isMass = item.unit === 'г' || item.unit === 'кг';
  const entries = [
    ['manufacturer', 'Производитель', item.manufacturer],
    ['name', 'Наименование', item.name],
    ['category', 'Категория', item.category],
    ['productType', 'Тип', item.productType],
    ['unit', 'Единица', item.unit],
    ['packageQuantity', 'В упаковке', packSize > 0 ? num(packSize) + ' ' + item.unit : ''],
    ['balance', 'Остаток', num(balance) + ' ' + item.unit],
    ['packEquivalent', 'Эквивалент упаковок', packSize > 0 ? num(balance / packSize, 2) : ''],
    ['totalMass', 'Общая масса', isMass ? num(balance) + ' ' + item.unit : ''],
    ['basePrice', 'Базовая цена', money(nominalPrice)],
    ['baseUnitPrice', 'Цена за единицу', money(unitPrice)],
    ['lastPurchasePrice', 'Последняя закупка', money(item.lastPurchasePrice)],
    ['supplier', 'Поставщик', item.supplier],
    ['location', 'Место хранения', item.location],
    ['sku', 'Артикул', item.sku],
    ['barcode', 'Штрихкод', item.barcode],
    ['grossWeight', 'Брутто', item.grossWeight == null ? '' : num(item.grossWeight) + ' г'],
    ['tareWeight', 'Тара', item.tareWeight == null ? '' : num(item.tareWeight) + ' г'],
    ['netPackageWeight', 'Нетто', item.netPackageWeight == null ? '' : num(item.netPackageWeight) + ' г'],
  ];
  return entries.map(([value, label, text]) => ({ value, label, text: optionalText(text) }));
}

function productCardAppearance() {
  return getCardAppearanceTemplate(PRODUCT_APPEARANCE_SCOPE)?.appearance || DEFAULT_PRODUCT_APPEARANCE;
}

function productCard(item) {
  return entityVisualCard({
    appearance: productCardAppearance(),
    fields: productCardFields(item),
    interactive: true,
    data: 'data-inventory-product-card',
    aria: 'Редактировать продукт ' + item.name,
  });
}

function supplierRows(item) {
  const offers = Array.isArray(item.supplierOffers) ? item.supplierOffers : [];
  if (!offers.length) return emptyState('Поставщиков пока нет', 'Добавьте место покупки и его цену.');
  return v2ListEntries(offers.map((offer) => {
    const primary = item.primaryOfferId === offer.offerId;
    const amount = candidatePrice(offer);
    const pack = Number(offer.unitsPerOffer) || 1;
    return v2ListEntry({
      title: offer.supplier || 'Место покупки',
      subtitle: primary ? 'Основной' : '',
      rightTop: money(amount) || '—',
      rightBottom: pack > 0 ? num(pack) + ' ' + item.unit : '',
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
      field({ label: 'Содержимое, ' + item.unit, name: 'unitsPerOffer', value: offer?.unitsPerOffer ?? item.packageQuantity ?? 1, type: 'number', min: '0.001', step: '0.001', inputmode: 'decimal' }),
      { ariaLabel: 'Скидка и содержимое закупаемой упаковки' },
    )}
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
        unitsPerOffer: offerValue(data, 'unitsPerOffer', { required: true, positive: true }),
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

function openProductAppearance(itemId, onSaved) {
  const item = getInventoryItem(itemId);
  if (!item) return null;
  return openEntityCardAppearanceQ(document.body, {
    title: 'Вид',
    typeOptions: [{ value: PRODUCT_APPEARANCE_SCOPE, label: 'Продукт' }],
    initialType: PRODUCT_APPEARANCE_SCOPE,
    targetOptions: () => [],
    allowPhoto: false,
    resolve: () => ({
      appearance: productCardAppearance(),
      fields: productCardFields(getInventoryItem(itemId) || item),
    }),
    save: async ({ appearance }) => {
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
    `<div class="modal-title"><h2>Удалить продукт?</h2><p>История движений и закупок сохранится.</p></div>
    <div class="form-error" data-inventory-product-delete-error role="alert"></div>
    <div class="modal-actions">
      ${button('Удалить', { variant: 'critical', data: 'data-inventory-product-confirm-delete' })}
      ${button('Отмена', { variant: 'secondary', data: 'data-inventory-product-cancel-delete' })}
    </div>`, { title: 'Удаление продукта', variant: 'x', xRole: 'action' },
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
      if (host) host.textContent = error instanceof Error ? error.message : 'Не удалось удалить продукт.';
    }
  });
}

export function openInventoryProductOverview(itemId, { edit = () => {}, onChanged = () => {} } = {}) {
  const initial = getInventoryItem(itemId);
  if (!initial) return null;
  const layer = mountModal(document.body, modal('<div data-inventory-product-overview></div>', {
    variant: 'q',
    surface: 'app',
    className: 'inventory-product-overview-q',
  }));
  if (!layer) return null;
  layer.querySelector('.modal-sheet')?.setAttribute('aria-label', initial.name || 'Продукт');

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
        v: { data: 'data-inventory-product-view', aria: 'Вид карты продукта' },
      }),
      productCard(item),
      v2Section('Поставщики', supplierRows(item) + actionBlock(button('Добавить', {
        variant: 'secondary', data: 'data-inventory-supplier-add', aria: 'Добавить место покупки',
      }))),
      button('Удалить продукт', {
        variant: 'critical', data: 'data-inventory-product-delete',
      }),
    ]);
    host.querySelector('[data-inventory-product-view]')?.addEventListener('click', () => {
      openSharedProfileSettingsMenu({
        title: '',
        actions: [{
          id: 'appearance', label: 'Вид',
          onSelect: () => openProductAppearance(itemId, render),
        }],
      });
    });
    host.querySelector('[data-inventory-product-card]')?.addEventListener('click', () => {
      edit(() => {
        render();
        onChanged();
      });
    });
    host.querySelector('[data-inventory-supplier-add]')?.addEventListener('click', () => openSupplierEditor(itemId, '', () => {
      render();
      onChanged();
    }));
    host.querySelectorAll('[data-inventory-supplier-offer]').forEach((row) => row.addEventListener('click', () => {
      openSupplierEditor(itemId, row.dataset.inventorySupplierOffer, () => {
        render();
        onChanged();
      });
    }));
    host.querySelector('[data-inventory-product-delete]')?.addEventListener('click', () => {
      confirmProductDelete(itemId, layer, onChanged);
    });
    window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
  };

  render();
  return layer;
}
