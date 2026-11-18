import {
  actionBlock, button, emptyState, field, modal, mountModal, openNotice,
  page, select, list, v2ListEntries, v2ListEntry, v2Section, workspaceHeaderContext,
  mountV2ZLayer, v2ZLayer, openSharedProfileSettingsMenu,
  entityVisualCard, entityCardStack, openEntityCardAppearanceQ,
} from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { compactCheck } from '../../ui/selection/check-list.js';
import { apiRequest } from '../auth.js';
import { getInventoryItems } from './data.js';
import { loadInventory } from './service.js';
import { getCardAppearanceTemplate, saveCardAppearanceTemplate } from '../card-appearance-templates.js';
import { loadAuxiliaryState } from '../runtime/auxiliary-state.js';

const PATH = '/inventory/counterparties';
const COUNTERPARTY_CARD_SCOPE = 'inventory-counterparty';
// Same entity card/constructor used for company cards in Stock. This is
// presentation inside Z1, not an F/E navigation card or a new UI primitive.
const COUNTERPARTY_CARD_DEFAULT = {
  lines: [
    {}, {}, {}, {}, {},
    { field: 'name', zone: 'full', align: 'left', size: 'xl', color: 'white', bold: true },
    {},
    { field: 'kind', zone: 'full', align: 'left', size: 'm', color: 'white' },
    { field: 'files', zone: 'right', align: 'right', size: 'm', color: 'white' },
  ],
};
const TYPES = [
  { value: 'SUPPLIER', label: 'Поставщик' },
  { value: 'MANUFACTURER', label: 'Производитель' },
  { value: 'DISTRIBUTOR', label: 'Дистрибьютор' },
  { value: 'MARKETPLACE', label: 'Маркетплейс' },
  { value: 'STORE', label: 'Магазин' },
  { value: 'OTHER', label: 'Другое' },
];
const kindLabel = kind => TYPES.find(row => row.value === kind)?.label || 'Другое';
const money = amount => amount == null ? '—'
  : Number(amount).toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replaceAll('\u00a0', ' ') + ' ₽';
const urlId = value => encodeURIComponent(String(value || ''));
const supplierAvailability = value => value === true ? 'Есть у поставщика'
  : value === false ? 'Нет у поставщика' : 'Наличие не указано';
function discountLabel(base, paid, given) {
  const list = Number(base), actual = Number(paid);
  if (base != null && paid != null && Number.isFinite(list) && list > 0 && Number.isFinite(actual) && actual >= 0) {
    const difference = Math.round((1 - actual / list) * 10000) / 100;
    return difference >= 0 ? 'Расчётная скидка: ' + difference.toLocaleString('ru-RU') + '%'
      : 'Цена выше прайса на ' + Math.abs(difference).toLocaleString('ru-RU') + '%';
  }
  return given == null ? 'Скидка не указана' : 'Скидка поставщика: ' + Number(given).toLocaleString('ru-RU') + '%';
}
const errText = (error, fallback = 'Не удалось загрузить данные') => error instanceof Error ? error.message : fallback;
function message(payload, status) {
  const server = Array.isArray(payload?.message) ? payload.message.join('; ') : payload?.message;
  return typeof server === 'string' && server.trim() ? server : 'Ошибка сервера (HTTP ' + status + ')';
}

async function json(path = '', { method = 'GET', body } = {}) {
  const response = await apiRequest(PATH + path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(message(value, response.status));
  return value;
}
async function upload(id, action, file, confirmedPdf = false) {
  const data = new FormData();
  data.append('file', file);
  if (confirmedPdf) data.append('confirmedPdf', 'true');
  const response = await apiRequest(PATH + '/' + urlId(id) + action, {
    method: 'POST', body: data, timeoutMs: 90000,
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(message(value, response.status));
  return value;
}
async function download(path, filename) {
  const response = await apiRequest(PATH + path, { timeoutMs: 35000 });
  if (!response.ok) throw new Error('Не удалось скачать файл (HTTP ' + response.status + ')');
  const blob = await response.blob();
  const address = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = address; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(address), 1500);
}

function companyForm(company = {}) {
  // Creating a company passes null; default arguments only cover undefined.
  // Normalise before reading fields so the Header + can always open its Q.
  company = company || {};
  return `<form data-counterparty-form>
    ${field({ label: 'Название', name: 'name', value: company.name || '', required: true })}
    ${select({ label: 'Тип', name: 'kind', value: company.kind || 'SUPPLIER', options: TYPES })}
    ${field({ label: 'Представитель', name: 'contactName', value: company.contactName || '' })}
    ${field({ label: 'Телефон', name: 'phone', value: company.phone || '', type: 'tel' })}
    ${field({ label: 'Email', name: 'email', value: company.email || '', type: 'email' })}
    ${field({ label: 'Сайт', name: 'website', value: company.website || '' })}
    ${field({ label: 'Примечание', name: 'note', value: company.note || '' })}
    <p class="form-error" data-counterparty-error role="alert"></p>
    ${actionBlock(button('Применить', { type: 'submit' }))}
  </form>`;
}
function openCompanyEditor(company, onSaved) {
  const layer = mountModal(document.body, modal(companyForm(company), {
    title: company?.id ? 'Контрагент' : 'Новый контрагент', variant: 'q', surface: 'app',
  }));
  const form = layer?.querySelector('[data-counterparty-form]');
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const save = form.querySelector('button[type="submit"]');
    const error = form.querySelector('[data-counterparty-error]');
    const input = Object.fromEntries(new FormData(form).entries());
    if (!String(input.name || '').trim()) { error.textContent = 'Укажите название'; return; }
    save.disabled = true;
    try {
      const updated = await json(company?.id ? '/' + urlId(company.id) : '', {
        method: company?.id ? 'PUT' : 'POST', body: input,
      });
      layer.v2Close?.();
      onSaved?.(updated);
    } catch (cause) { error.textContent = errText(cause); }
    finally { save.disabled = false; }
  });
  return layer;
}

async function openCatalog(company, { itemId = '', onLinked = () => {} } = {}) {
  const layer = mountModal(document.body, modal(
    `<div class="ui-search-field">${field({ name: 'catalogSearch', type: 'search',
      placeholder: 'Название, артикул, производитель…' })}</div>
    ${actionBlock(button('Поиск', { data: 'data-counterparty-catalog-search' }))}
    <div data-counterparty-catalog-results></div>
    <div data-counterparty-catalog-pages></div>`, {
      title: 'Прайс · ' + company.name, variant: 'q', surface: 'app',
    }));
  if (!layer) return;
  const search = layer.querySelector('[name="catalogSearch"]');
  const results = layer.querySelector('[data-counterparty-catalog-results]');
  const pages = layer.querySelector('[data-counterparty-catalog-pages]');
  let offset = 0;
  let run = 0;
  const show = async () => {
    const revision = ++run;
    results.innerHTML = emptyState('Каталог', 'Загружаем…');
    try {
      const data = await json('/' + urlId(company.id) + '/catalog?search=' +
        encodeURIComponent(search.value.trim()) + '&skip=' + offset);
      if (!layer.isConnected || revision !== run) return;
      const entries = data.items || [];
      results.innerHTML = entries.length
        ? v2ListEntries(entries.map(row => v2ListEntry({
            title: row.name,
            subtitle: [row.supplierSku && 'Арт. ' + row.supplierSku,
              row.brand || row.manufacturer, row.supplierNote].filter(Boolean).join(' · '),
            rightTop: money(row.listPrice),
            rightBottom: supplierAvailability(row.supplierAvailable),
            interactive: true, initial: '',
            data: 'data-counterparty-catalog-row="' + escapeHtml(row.id) + '"',
            aria: 'Выбрать позицию ' + row.name,
          })))
        : emptyState('Товары не найдены', data.priceList
          ? 'Попробуйте другой запрос.' : 'Загрузите прайс-лист этого контрагента.');
      results.querySelectorAll('[data-counterparty-catalog-row]').forEach(node => {
        node.addEventListener('click', () => {
          const row = entries.find(value => value.id === node.dataset.counterpartyCatalogRow);
          if (row) openCatalogRow(company, row, { itemId, onLinked });
        });
      });
      pages.innerHTML = `<p>${offset + (entries.length ? 1 : 0)}–${offset + entries.length} из ${data.count}</p>` +
        actionBlock((offset ? button('Предыдущие', { data: 'data-catalog-prev', variant: 'secondary' }) : '') +
          (offset + entries.length < data.count
            ? button('Далее', { data: 'data-catalog-next', variant: 'secondary' }) : ''));
      pages.querySelector('[data-catalog-prev]')?.addEventListener('click', () => { offset = Math.max(0, offset - 100); void show(); });
      pages.querySelector('[data-catalog-next]')?.addEventListener('click', () => { offset += 100; void show(); });
    } catch (error) {
      results.innerHTML = emptyState('Каталог недоступен', errText(error));
    }
  };
  layer.querySelector('[data-counterparty-catalog-search]')?.addEventListener('click', () => {
    offset = 0; void show();
  });
  search.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); offset = 0; void show(); }
  });
  void show();
}

async function openCatalogRow(company, row, { itemId = '', onLinked = () => {} } = {}) {
  try { await loadInventory(); }
  catch (cause) { return openNotice({ title: 'Остатки', message: errText(cause) }); }
  const items = getInventoryItems();
  const layer = mountModal(document.body, modal(`<div>
    <p><strong>${escapeHtml(row.name)}</strong></p>
    <p>${escapeHtml([row.manufacturer, row.supplierSku && 'Арт. ' + row.supplierSku].filter(Boolean).join(' · '))}</p>
    <p>Наличие: ${supplierAvailability(row.supplierAvailable)}</p>
    ${row.supplierNote ? '<p>' + escapeHtml(row.supplierNote) + '</p>' : ''}
    <p>Цена поставщика: ${money(row.listPrice)}</p>
    <p>РРЦ: ${money(row.retailPrice)}</p>
    <p>Моя закупочная цена: ${money(row.actualPrice)}</p>
    <p>${escapeHtml(discountLabel(row.listPrice, row.actualPrice, row.discountPercent))}</p>
    ${select({ label: 'Моя рабочая карточка', name: 'itemId', value: itemId,
      options: [{ value: '', label: 'Выбрать товар' },
        ...items.map(item => ({ value: item.itemId, label: [item.manufacturer, item.name].filter(Boolean).join(' · ') }))],
      searchable: true })}
    <p class="form-error" data-catalog-link-error role="alert"></p>
    ${actionBlock(button('Связать', { data: 'data-catalog-row-link' }) +
      button('Новая рабочая карточка', { variant: 'secondary', data: 'data-catalog-new-item' }))}
  </div>`, { title: 'Подключить товар', variant: 'q', surface: 'app' }));
  if (!layer) return;
  const errorHost = layer.querySelector('[data-catalog-link-error]');
  const link = async chosen => {
    await json('/' + urlId(company.id) + '/catalog/' + urlId(row.id) + '/link', {
      method: 'POST', body: { itemId: chosen },
    });
    await loadInventory();
    layer.v2Close?.();
    onLinked?.();
    openNotice({ title: 'Поставщик', message: 'Товар связан с рабочей карточкой.' });
  };
  layer.querySelector('[data-catalog-row-link]')?.addEventListener('click', async event => {
    const itemIdValue = layer.querySelector('[name="itemId"]')?.value;
    if (!itemIdValue) { errorHost.textContent = 'Выберите рабочую карточку.'; return; }
    event.currentTarget.disabled = true;
    try { await link(itemIdValue); }
    catch (cause) { errorHost.textContent = errText(cause); event.currentTarget.disabled = false; }
  });
  layer.querySelector('[data-catalog-new-item]')?.addEventListener('click', async () => {
    const before = new Set(getInventoryItems().map(value => value.itemId));
    const { openItemEditor } = await import('./inventory.js');
    openItemEditor(layer, '', {
      name: row.name, manufacturer: row.manufacturer, sku: row.supplierSku, barcode: row.barcode,
    }, async createdId => {
      const resolved = createdId || getInventoryItems().find(value => !before.has(value.itemId))?.itemId;
      if (!resolved) { errorHost.textContent = 'Карточка создана, но её связь не подтверждена. Выберите её вручную.'; return; }
      try { await link(resolved); }
      catch (cause) { errorHost.textContent = errText(cause); }
    });
  });
}

// The X explains the preferred template before the native file picker.
// Alternate .xlsx layouts and PDF remain eligible for server-side preview.
function openImportGuidance(company, onSaved) {
  const layer = mountModal(document.body, modal(
    '<div class="form-grid">' +
      '<p>Для загрузки ассортимента рекомендуем шаблон Excel приложения (.xlsx).</p>' +
      '<p>Другой Excel .xlsx или PDF тоже можно выбрать. Позиции появятся только при успешном распознавании файла.</p>' +
      button('Выбрать файл', { data: 'data-counterparty-pick-file' }) +
    '</div>',
    { title: 'Загрузка ассортимента', variant: 'x', xRole: 'action', surface: 'app' },
  ));
  layer?.querySelector('[data-counterparty-pick-file]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openImport(company, onSaved);
  });
}

// The native OS file picker opens directly from the X button's user gesture.
// The confirmation Q appears only after a file is chosen.
function openImport(company, onSaved) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  input.hidden = true;
  document.body.appendChild(input);

  const cleanup = () => input.remove();
  input.addEventListener('change', () => {
    const file = input.files?.[0] || null;
    cleanup();
    if (file) openImportPreview(company, onSaved, file);
  }, { once: true });
  input.addEventListener('cancel', cleanup, { once: true });
  // Must remain synchronous with the V-menu click for iOS/WebKit.
  input.click();
}

function openImportPreview(company, onSaved, file) {
  const layer = mountModal(document.body, modal(`
    <div data-counterparty-preview></div>
    <p class="form-error" data-counterparty-import-error role="alert"></p>
    ${actionBlock(button('Загрузить позиции', { data: 'data-counterparty-import-save', disabled: true }))}
    `, { title: 'Проверка файла', variant: 'q', surface: 'app' }));
  if (!layer) return;
  const preview = layer.querySelector('[data-counterparty-preview]');
  const errorHost = layer.querySelector('[data-counterparty-import-error]');
  const save = layer.querySelector('[data-counterparty-import-save]');
  let result = null;
  const check = async () => {
    preview.textContent = 'Проверяем файл…';
    try {
      result = await upload(company.id, '/pricelists/preview', file);
      if (!layer.isConnected) return;
      const rows = result.sample || [];
      preview.innerHTML = `<p>${escapeHtml(file.name)} · ${result.count} поз.</p>` +
        (result.status === 'READY' ? '<p>Проверьте позиции и цены перед загрузкой.</p>' :
          '<p>Содержимое не распознано полностью. Можно сохранить исходный файл, не создавая позиции.</p>') +
        (result.errors || []).map(value => '<p>' + escapeHtml(value) + '</p>').join('') +
        (rows.length ? v2ListEntries(rows.map(row => v2ListEntry({
          title: row.name,
          subtitle: [row.supplierSku, supplierAvailability(row.supplierAvailable)].filter(Boolean).join(' · '),
          rightTop: money(row.listPrice), interactive: false,
        }))) : '');
      save.disabled = false;
      save.textContent = result.status === 'READY' ? 'Загрузить позиции' : 'Сохранить файл';
      errorHost.textContent = '';
    } catch (cause) {
      preview.textContent = '';
      errorHost.textContent = errText(cause);
    }
  };
  save.addEventListener('click', async () => {
    if (!result) return;
    save.disabled = true;
    try {
      await upload(company.id, '/pricelists', file, result.format === 'pdf' && result.status === 'READY');
      layer.v2Close?.();
      onSaved?.();
    } catch (cause) {
      errorHost.textContent = errText(cause);
      save.disabled = false;
    }
  });
  void check();
}

function counterpartyInformation(company = {}) {
  // Reuse existing small/primary/secondary typography, without "data" rows
  // or locally styled dividers. Editing remains in the existing V → Q flow.
  const primary = String(company.contactName || '').trim();
  const secondary = [company.phone, company.email, company.website, company.note]
    .filter(value => String(value || '').trim());
  return '<div data-counterparty-information>' +
    (primary ? '<span class="ui-list__secondary">Менеджер</span>' : '') +
    (primary ? '<strong class="ui-list__title">' + escapeHtml(primary) + '</strong>' : '') +
    secondary.map(value => '<span class="ui-list__secondary">' + escapeHtml(value) + '</span>').join('') +
    '</div>';
}

// Tapping a supplier product opens its data Q. Selection is exclusively
// the compact checkbox; item details never initiate stock creation or linking.
function openCatalogProductDetails(row, status = null) {
  const stockItem = status?.itemId
    ? getInventoryItems().find(item => String(item.itemId) === String(status.itemId)) : null;
  const rows = [
    ['Артикул', row.supplierSku],
    ['Название', row.name],
    ['Короткое название', stockItem?.name],
    ['Производитель', row.manufacturer || row.brand],
    ['Штрихкод', row.barcode],
    ['Категория', row.category],
    ['Наличие', supplierAvailability(row.supplierAvailable)],
    ['Цена поставщика', money(row.listPrice)],
    ['РРЦ', money(row.retailPrice)],
    ['Моя закупочная цена', money(row.actualPrice)],
    ['Скидка', discountLabel(row.listPrice, row.actualPrice, row.discountPercent)],
    ['Карточка склада', status?.status === 'linked' ? stockItem?.name || 'Связана'
      : status?.status === 'matched' ? 'Найдено совпадение'
      : status?.status === 'conflict' ? 'Неоднозначное совпадение' : 'Не связана'],
    ['Примечание', row.supplierNote],
  ].filter(([,value]) => value != null && String(value).trim() !== '');
  return mountModal(document.body, modal(list({
    className: 'ui-list--dense',
    items: rows.map(([title, value]) => ({ title, right: [String(value)] })),
  }), { title: 'Данные товара', variant: 'q', surface: 'app' }));
}

function catalogItemList(items = [], selectedCatalogIds = new Set(), linkedCatalogIds = null, matchedCatalogItems = null) {
  // The link indicator belongs next to the supplier SKU, not before the title.
  // Only a persisted Core supplier offer is a confirmed link.
  return '<div class="inventory-counterparty-product-list">' + items.map(item =>
    '<div class="inventory-counterparty-product-row">' +
      compactCheck({
        checked: selectedCatalogIds.has(String(item.id)),
        aria: 'Выбрать позицию ' + item.name,
        data: 'data-company-product-check="' + escapeHtml(item.id) + '"',
      }) +
      list({
        className: 'ui-list--dense',
        items: [{
          className: item.supplierAvailable === true ? 'is-supplier-available'
            : item.supplierAvailable === false ? 'is-supplier-unavailable' : '',
          title: item.name,
          secondary: item.supplierSku || '—',
          secondaryIndicatorColor: linkedCatalogIds === null ? ''
            : linkedCatalogIds.has(String(item.id)) ? '#37B24D'
              : matchedCatalogItems?.has(String(item.id)) ? '#F6D32D' : '#A8AAAC',
          secondaryIndicatorLabel: linkedCatalogIds === null ? ''
            : linkedCatalogIds.has(String(item.id)) ? 'Связан с карточкой склада'
              : matchedCatalogItems?.has(String(item.id))
                ? 'Совпадает артикул или штрихкод; связь не подтверждена'
                : 'Не найдено совпадений с карточками склада',
          right: [
            money(item.listPrice) + ' · ' + (item.discountPercent == null ? '—'
              : Number(item.discountPercent).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + '%'),
            'К оплате ' + money(item.actualPrice),
          ],
          interactive: true,
          data: 'data-company-product="' + escapeHtml(item.id) + '"',
          aria: 'Данные товара ' + item.name + '. ' + supplierAvailability(item.supplierAvailable),
        }],
      }) +
    '</div>',
  ).join('') + '</div>';
}

function catalogDisclosure(title, content, nested = false, count = null, check = '') {
  // Same Stock disclosure and compact check. The check is outside <details>
  // so selecting a category never opens/closes the product rows.
  const positionCount = Number.isSafeInteger(count) && count >= 0
    ? '<div class="inventory-editor-heading__controls"><span class="ui-list__secondary">' +
      count + ' поз.</span></div>' : '';
  const selection = check ? '<div class="inventory-editor-heading__selection">' + check + '</div>' : '';
  return '<section class="inventory-editor-panel' + (nested ? ' inventory-editor-panel--nested' : '') +
    (check ? ' inventory-editor-panel--catalog-choice' : '') + '">' +
    '<details><summary class="inventory-editor-summary">' + escapeHtml(title) + '</summary>' +
    '<div class="inventory-editor-panel__body">' + content + '</div></details>' +
    selection + positionCount + '</section>';
}

function catalogBrands(items = []) {
  const brands = new Map();
  for (const item of items) {
    const brand = String(item.brand || item.manufacturer || '').trim() || 'Без компании';
    const category = String(item.category || '').trim();
    if (!brands.has(brand)) brands.set(brand, new Map());
    const categories = brands.get(brand);
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(item);
  }
  return brands;
}

// Brand is a V2 List row, not a disclosure. Count catalog items across
// all categories; category headings do not count as products.
function catalogGroupsMarkup(brands) {
  return v2ListEntries([...brands].map(([brand, categories]) => v2ListEntry({
    title: brand,
    rightTop: [...categories.values()].reduce((sum, rows) => sum + rows.length, 0) + ' поз.',
    interactive: true,
    initial: '',
    omitEmptySubtitle: true,
    data: 'data-company-brand="' + escapeHtml(brand) + '"',
    aria: 'Открыть ассортимент ' + brand,
  })));
}

// Only product categories use the existing native disclosure. No extra
// heading for products and no additional UI primitives.
function catalogBrandMarkup(categories, selectedCatalogIds, linkedCatalogIds = null, matchedCatalogItems = null) {
  return '<div class="inventory-item-accordion">' +
    [...categories].map(([category, rows]) =>
      category ? catalogDisclosure(category, catalogItemList(rows, selectedCatalogIds, linkedCatalogIds, matchedCatalogItems), false, rows.length,
        compactCheck({
          checked: rows.length > 0 && rows.every(row => selectedCatalogIds.has(String(row.id))),
          aria: 'Выбрать все позиции категории ' + category,
          data: 'data-company-category-check="' + escapeHtml(category) + '"',
        })) : catalogItemList(rows, selectedCatalogIds, linkedCatalogIds, matchedCatalogItems),
    ).join('') + '</div>' +
    actionBlock(
      button('Создать карточку', { data: 'data-company-selection-card' }) +
      button('Удалить', {
        variant: 'delete-outline',
        data: 'data-company-selection-delete',
      }),
      { className: 'inventory-counterparty-selection-actions' },
    );
}

// Matching is a hint, never a substitute for a persisted Core supplier link.
// An ambiguous SKU/barcode on either side is not treated as a match.
function findCatalogMatches(catalogRows = [], stockItems = []) {
  const normalize = value => String(value || '').trim().toLocaleUpperCase('ru-RU');
  const index = (rows, field) => {
    const ids = new Map();
    for (const row of rows) {
      const value = normalize(row[field]);
      if (!value) continue;
      const group = ids.get(value) || [];
      group.push(row);
      ids.set(value, group);
    }
    return ids;
  };
  const skuStock = index(stockItems, 'sku'), barcodeStock = index(stockItems, 'barcode');
  const skuCatalog = index(catalogRows, 'supplierSku'), barcodeCatalog = index(catalogRows, 'barcode');
  const matches = new Map();
  for (const row of catalogRows) {
    const candidates = new Set();
    const sku = normalize(row.supplierSku), barcode = normalize(row.barcode);
    if (sku && skuCatalog.get(sku)?.length === 1 && skuStock.get(sku)?.length === 1)
      candidates.add(skuStock.get(sku)[0].itemId);
    if (barcode && barcodeCatalog.get(barcode)?.length === 1 && barcodeStock.get(barcode)?.length === 1)
      candidates.add(barcodeStock.get(barcode)[0].itemId);
    if (candidates.size === 1) matches.set(String(row.id), [...candidates][0]);
  }
  return matches;
}

// The existing Core routes already support one-to-one create/link. A selected
// group is processed one product at a time so unit choices and matching cannot
// silently create incorrect stock cards or duplicate supplier offers.
async function openSelectedCatalogCards(company, rows, onLinked = () => {}, suggestedItemId = () => '') {
  if (!rows.length) return;
  try { await loadInventory(); }
  catch (error) { openNotice({ title: 'Остатки', message: errText(error) }); return; }
  const menu = mountModal(document.body, modal(
    list({
      className: 'ui-list--dense',
      items: [
        { title: 'Создать новую', interactive: true,
          data: 'data-company-create-new', aria: 'Создать новую карточку' },
        { title: 'Выбрать из склада', interactive: true,
          data: 'data-company-use-existing', aria: 'Выбрать существующую карточку' },
      ],
    }),
    { title: 'Создать карточку · ' + rows.length + ' поз.', variant: 'q', surface: 'app' },
  ));
  if (!menu) return;

  const needsUnits = (row, itemId) => {
    const item = getInventoryItems().find(entry => String(entry.itemId) === String(itemId));
    const norm = value => String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/\.$/, '');
    return Boolean(row.unit && item?.unit && norm(row.unit) !== norm(item.unit));
  };
  const link = async (row, itemId, unitsPerOffer = null) => {
    if (!itemId) throw new Error('Не выбрана карточка склада.');
    if (needsUnits(row, itemId) && !(unitsPerOffer > 0))
      throw new Error('Укажите количество единиц склада в предложении.');
    await json('/' + urlId(company.id) + '/catalog/' + urlId(row.id) + '/link', {
      method: 'POST', body: { itemId, ...(unitsPerOffer > 0 ? { unitsPerOffer } : {}) },
    });
    await loadInventory();
    onLinked(row);
  };
  const finishLink = (row, itemId, onDone) => {
    if (!needsUnits(row, itemId)) {
      void link(row, itemId).then(onDone).catch(error =>
        openNotice({ title: 'Связь с карточкой', message: errText(error) }));
      return;
    }
    const entry = getInventoryItems().find(item => String(item.itemId) === String(itemId));
    const unitLayer = mountModal(document.body, modal(
      '<p>' + escapeHtml(row.name) + '</p>' +
      '<p class="ui-list__secondary">У поставщика: ' + escapeHtml(row.unit) +
      ' · В карточке: ' + escapeHtml(entry?.unit || '—') + '</p>' +
      field({ label: 'Единиц склада в предложении', name: 'unitsPerOffer', type: 'number',
        min: '0.001', step: 'any', required: true }) +
      '<p class="form-error" role="alert" data-company-link-units-error></p>' +
      actionBlock(button('Применить', { data: 'data-company-link-units-save' })),
      { title: 'Количество в упаковке', variant: 'q', surface: 'app' },
    ));
    unitLayer?.querySelector('[data-company-link-units-save]')?.addEventListener('click', async event => {
      const save = event.currentTarget;
      const status = unitLayer.querySelector('[data-company-link-units-error]');
      const units = Number(unitLayer.querySelector('[name="unitsPerOffer"]')?.value);
      if (!Number.isFinite(units) || units <= 0) {
        status.textContent = 'Укажите положительное количество.'; return;
      }
      save.disabled = true;
      try {
        await link(row, itemId, units);
        unitLayer.v2Close?.();
        onDone();
      } catch (error) {
        status.textContent = errText(error);
        save.disabled = false;
      }
    });
  };
  const progress = index => rows.length === 1 ? '' : (index + 1) + ' из ' + rows.length;
  const next = (mode, index) => {
    if (index < rows.length) void run(mode, index).catch(error =>
      openNotice({ title: 'Создать карточку', message: errText(error) }));
  };
  const run = async (mode, index) => {
    const row = rows[index];
    if (!row) return;
    if (mode === 'new') {
      const { openItemEditor } = await import('./inventory.js');
      openItemEditor(document.body, '', {
        name: row.name, manufacturer: row.manufacturer, sku: row.supplierSku, barcode: row.barcode,
      }, async itemId => {
        finishLink(row, itemId, () => next(mode, index + 1));
      });
      return;
    }
    const inventoryItems = getInventoryItems();
    const sku = String(row.supplierSku || '').trim().toLocaleLowerCase('ru-RU');
    const linked = inventoryItems.filter(item =>
      Array.isArray(item.supplierOffers) && item.supplierOffers.some(offer =>
        String(offer.counterpartyId || '') === String(company.id)
          && String(offer.catalogItemId || '') === String(row.id)));
    const matches = sku ? inventoryItems.filter(item =>
      String(item.sku || '').trim().toLocaleLowerCase('ru-RU') === sku) : [];
    const suggested = linked.length === 1 ? linked[0].itemId
      : suggestedItemId(row) || (matches.length === 1 ? matches[0].itemId : '');
    const layer = mountModal(document.body, modal(
      '<p>' + escapeHtml(row.name) + '</p>' +
      (progress(index) ? '<p class="ui-list__secondary">' + progress(index) + '</p>' : '') +
      select({
        label: 'Карточка склада', name: 'itemId', value: suggested,
        options: [{ value: '', label: 'Выберите товар' },
          ...inventoryItems.map(item => ({ value: item.itemId,
            label: [item.manufacturer, item.name].filter(Boolean).join(' · ') }))],
        searchable: true,
      }) +
      '<p class="form-error" data-company-link-error role="alert"></p>' +
      actionBlock(button('Применить', { data: 'data-company-apply-link' })),
      { title: 'Использовать существующую', variant: 'q', surface: 'app' },
    ));
    const submit = layer?.querySelector('[data-company-apply-link]');
    submit?.addEventListener('click', async () => {
      const itemId = layer.querySelector('[name="itemId"]')?.value;
      const errorHost = layer.querySelector('[data-company-link-error]');
      if (!itemId) { errorHost.textContent = 'Выберите товар.'; return; }
      submit.disabled = true;
      try {
        if (needsUnits(row, itemId)) {
          layer.v2Close?.();
          finishLink(row, itemId, () => next(mode, index + 1));
          return;
        }
        await link(row, itemId);
        layer.v2Close?.();
        next(mode, index + 1);
      } catch (error) {
        errorHost.textContent = errText(error);
        submit.disabled = false;
      }
    });
  };
  menu.querySelector('[data-company-create-new]')?.addEventListener('click', () => {
    menu.v2Close?.();
    void run('new', 0).catch(error =>
      openNotice({ title: 'Создать карточку', message: errText(error) }));
  });
  menu.querySelector('[data-company-use-existing]')?.addEventListener('click', () => {
    menu.v2Close?.();
    void run('existing', 0).catch(error =>
      openNotice({ title: 'Карточка склада', message: errText(error) }));
  });
}

function openCounterpartyFiles(company) {
  const files = Array.isArray(company.priceLists) ? company.priceLists : [];
  const content = files.length
    ? v2ListEntries(files.map(file => v2ListEntry({
      title: file.filename,
      subtitle: 'Версия ' + file.revision + ' · ' +
        new Date(file.createdAt).toLocaleDateString('ru-RU'),
      rightTop: file.parserStatus === 'READY'
        ? String(file._count?.rows || 0) + ' поз.' : 'Нужен Excel',
      interactive: true,
      initial: '',
      data: 'data-company-file="' + escapeHtml(file.id) + '"',
      aria: 'Скачать ' + file.filename,
    })))
    : '<p>История загрузок пуста.</p>';
  const layer = mountModal(document.body, modal(content, {
    title: 'История загрузок', variant: 'q', surface: 'app',
  }));
  layer?.querySelectorAll('[data-company-file]').forEach(node => {
    node.addEventListener('click', () => {
      const file = files.find(row => row.id === node.dataset.companyFile);
      if (!file) return;
      void download('/' + urlId(company.id) + '/pricelists/' + urlId(file.id) +
        '/download', 'catalog-' + file.revision + '.' + file.format)
        .catch(error => openNotice({ title: 'Файл', message: errText(error) }));
    });
  });
}

async function openCompany(companyId, root, onChanged = () => {}) {
  let companies;
  try { companies = await json(); }
  catch (error) { return openNotice({ title: 'Контрагенты', message: errText(error) }); }
  let company = companies.find(row => row.id === companyId);
  if (!company) return openNotice({ title: 'Контрагент', message: 'Компания не найдена.' });
  const markup = workspaceHeaderContext({
    title: 'Контрагент', subtitle: company.name,
    v: { data: 'data-company-actions', aria: 'Действия контрагента' },
  }) + '<div data-counterparty-detail></div>';
  const layer = mountV2ZLayer(root, v2ZLayer(markup), { stack: true });
  if (!layer) return null;
  const host = layer.querySelector('[data-counterparty-detail]');
  let revision = 0;
  // A selected set is actionable. Core owns both saved links and recoverable exclusions.
  const selectedCatalogIds = new Set();
  let linkedCatalogIds = null;
  let matchedCatalogItems = null;
  let catalogLinkStatuses = new Map();
  const readConfirmedLinks = () => new Set(getInventoryItems().flatMap(item =>
    Array.isArray(item.supplierOffers) ? item.supplierOffers : [])
    .filter(offer => String(offer.counterpartyId || '') === String(companyId)
      && offer.catalogItemId)
    .map(offer => String(offer.catalogItemId)));
  const refreshCatalogLinkStatuses = async () => {
    const data = await json('/' + urlId(companyId) + '/catalog/link-status');
    if (!Array.isArray(data?.statuses)) throw new Error('Статусы связей недоступны.');
    catalogLinkStatuses = new Map(data.statuses.map(item => [String(item.catalogItemId), item]));
    linkedCatalogIds = new Set(data.statuses.filter(item => item.status === 'linked')
      .map(item => String(item.catalogItemId)));
    matchedCatalogItems = new Map(data.statuses.filter(item => item.status === 'matched' && item.itemId)
      .map(item => [String(item.catalogItemId), String(item.itemId)]));
  };

  const excludedPath = '/'+urlId(companyId)+'/catalog?excluded=true';
  const openExcludedCatalogItems = async () => {
    let entries = [];
    try {
      const first = await json(excludedPath + '&skip=0');
      entries = Array.isArray(first.items) ? [...first.items] : [];
      for (let skip = 100; skip < (Number(first.count) || 0); skip += 100) {
        const page = await json(excludedPath + '&skip=' + skip);
        entries.push(...(Array.isArray(page.items) ? page.items : []));
      }
    } catch (error) {
      openNotice({ title: 'Исключённые', message: errText(error) });
      return;
    }
    if (!entries.length) {
      openNotice({ title: 'Исключённые', message: 'Исключённых позиций нет.' });
      return;
    }
    const selected = new Set();
    const restoreLayer = mountModal(document.body, modal(
      catalogItemList(entries, selected, linkedCatalogIds, matchedCatalogItems) +
        '<p class="form-error" data-company-restore-error role="alert"></p>' +
        actionBlock(button('Восстановить', { data: 'data-company-restore-apply' })),
      { title: 'Исключённые', variant: 'q', surface: 'app' },
    ));
    if (!restoreLayer) return;
    const apply = restoreLayer.querySelector('[data-company-restore-apply]');
    const sync = () => {
      apply.disabled = !selected.size;
      restoreLayer.querySelectorAll('[data-company-product-check]').forEach(input => {
        input.checked = selected.has(String(input.dataset.companyProductCheck));
      });
    };
    restoreLayer.querySelectorAll('[data-company-product-check]').forEach(input => {
      input.addEventListener('change', () => {
        const id = String(input.dataset.companyProductCheck);
        if (input.checked) selected.add(id);
        else selected.delete(id);
        sync();
      });
    });
    restoreLayer.querySelectorAll('[data-company-product]').forEach(node => {
      node.addEventListener('click', () => {
        const row = entries.find(item => String(item.id) === String(node.dataset.companyProduct));
        if (row) openCatalogProductDetails(row, catalogLinkStatuses.get(String(row.id)));
      });
    });
    apply.addEventListener('click', async () => {
      if (!selected.size) return;
      apply.disabled = true;
      const error = restoreLayer.querySelector('[data-company-restore-error]');
      try {
        await json('/' + urlId(companyId) + '/catalog/selection', {
          method: 'POST', body: { rowIds: [...selected], excluded: false },
        });
        restoreLayer.v2Close?.();
        await showCatalog();
      } catch (cause) {
        error.textContent = errText(cause);
        sync();
      }
    });
    sync();
  };

  const showCatalog = async () => {
    const currentRun = ++revision;
    const list = host.querySelector('[data-company-catalog-list]');
    if (!list) return;
    list.innerHTML = emptyState('Ассортимент', 'Загружаем…');
    try {
      const data = await json('/' + urlId(companyId) + '/catalog?skip=0');
      if (!layer.isConnected || !list.isConnected || currentRun !== revision) return;
      const entries = Array.isArray(data.items) ? [...data.items] : [];
      const count = Math.max(0, Number(data.count) || 0);
      // The API returns at most 100 rows per request. Read all existing pages
      // before grouping so companies after the first page are not invisible.
      for (let skip = 100; skip < count; skip += 100) {
        const page = await json('/' + urlId(companyId) + '/catalog?skip=' + skip);
        if (!layer.isConnected || !list.isConnected || currentRun !== revision) return;
        entries.push(...(Array.isArray(page.items) ? page.items : []));
      }
      if (!layer.isConnected || !list.isConnected || currentRun !== revision) return;
      // Prefer Core's canonical persisted-link / unique-match classification.
      // Preserve a read-only local hint when an older server lacks this endpoint.
      try {
        await loadInventory();
        try {
          await refreshCatalogLinkStatuses();
        } catch {
          linkedCatalogIds = readConfirmedLinks();
          matchedCatalogItems = findCatalogMatches(entries, getInventoryItems());
          catalogLinkStatuses = new Map(entries.map(row => {
            const id = String(row.id);
            const itemId = matchedCatalogItems.get(id);
            return [id, linkedCatalogIds.has(id)
              ? { status: 'linked', itemId: getInventoryItems().find(item =>
                item.supplierOffers?.some(offer =>
                  String(offer.counterpartyId) === String(companyId)
                    && String(offer.catalogItemId) === id))?.itemId || '' }
              : itemId ? { status: 'matched', itemId } : { status: 'unlinked', itemId: null }];
          }));
        }
      } catch {
        linkedCatalogIds = null;
        matchedCatalogItems = null;
        catalogLinkStatuses = new Map();
      }
      if (!layer.isConnected || !list.isConnected || currentRun !== revision) return;
      const brands = catalogBrands(entries);
      list.innerHTML = entries.length
        ? catalogGroupsMarkup(brands)
        : emptyState('Ассортимент не загружен');
      if (!entries.length) return;
      const byId = new Map(entries.map(row => [row.id, row]));
      list.querySelectorAll('[data-company-brand]').forEach(node => {
        node.addEventListener('click', () => {
          const brand = node.dataset.companyBrand;
          const categories = brands.get(brand);
          if (!categories) return;
          const brandLayer = mountModal(document.body, modal(catalogBrandMarkup(categories, selectedCatalogIds, linkedCatalogIds, matchedCatalogItems), {
            title: brand, variant: 'q', surface: 'app',
          }));
          const syncSelections = () => {
            brandLayer?.querySelectorAll('[data-company-product-check]').forEach(check => {
              check.checked = selectedCatalogIds.has(String(check.dataset.companyProductCheck));
            });
            brandLayer?.querySelectorAll('[data-company-category-check]').forEach(check => {
              const rows = categories.get(check.dataset.companyCategoryCheck) || [];
              const selected = rows.filter(row => selectedCatalogIds.has(String(row.id))).length;
              check.checked = rows.length > 0 && selected === rows.length;
              check.indeterminate = selected > 0 && selected < rows.length;
            });
            const actions = brandLayer?.querySelector('.inventory-counterparty-selection-actions');
            if (selectedCatalogIds.size) actions?.removeAttribute('data-ui-action-hidden');
            else actions?.setAttribute('data-ui-action-hidden', '');
            const create = brandLayer?.querySelector('[data-company-selection-card]');
            if (create) create.textContent = 'Создать карточку · ' + selectedCatalogIds.size;
          };
          const linked = row => {
            linkedCatalogIds = readConfirmedLinks();
            selectedCatalogIds.delete(String(row.id));
            const item = getInventoryItems().find(entry => entry.supplierOffers?.some(offer =>
              String(offer.counterpartyId) === String(companyId)
                && String(offer.catalogItemId) === String(row.id)));
            catalogLinkStatuses.set(String(row.id), { status: 'linked', itemId: item?.itemId || '' });
            const product = [...(brandLayer?.querySelectorAll('[data-company-product]') || [])]
              .find(node => String(node.dataset.companyProduct) === String(row.id));
            const indicator = product?.querySelector('.ui-list__secondary .ui-list__indicator');
            if (indicator) {
              indicator.style.setProperty('--ui-list-indicator', '#37B24D');
              indicator.setAttribute('aria-label', 'Связан с карточкой склада');
              indicator.title = 'Связан с карточкой склада';
            }
            syncSelections();
            void refreshCatalogLinkStatuses().catch(() => {});
          };
          brandLayer?.querySelectorAll('[data-company-category-check]').forEach(check => {
            check.addEventListener('change', () => {
              const rows = categories.get(check.dataset.companyCategoryCheck) || [];
              for (const row of rows) {
                if (check.checked) selectedCatalogIds.add(String(row.id));
                else selectedCatalogIds.delete(String(row.id));
              }
              syncSelections();
            });
          });
          brandLayer?.querySelectorAll('[data-company-product-check]').forEach(check => {
            check.addEventListener('change', () => {
              const id = String(check.dataset.companyProductCheck);
              if (check.checked) selectedCatalogIds.add(id);
              else selectedCatalogIds.delete(id);
              syncSelections();
            });
          });
          brandLayer?.querySelector('[data-company-selection-card]')?.addEventListener('click', () => {
            const rows = entries.filter(row => selectedCatalogIds.has(String(row.id)));
            if (rows.length) void openSelectedCatalogCards(company, rows, linked,
              row => matchedCatalogItems?.get(String(row.id)) || '');
          });
          brandLayer?.querySelector('[data-company-selection-delete]')?.addEventListener('click', () => {
            const ids = entries.filter(row => selectedCatalogIds.has(String(row.id)))
              .map(row => String(row.id));
            if (!ids.length) return;
            const confirm = mountModal(document.body, modal(
              '<p>Исключить ' + ids.length + ' позиций из ассортимента? ' +
              'Их можно вернуть через «Исключённые».</p>' +
              '<p class="form-error" data-company-exclude-error role="alert"></p>' +
              actionBlock(button('Удалить', { variant: 'delete-outline',
                data: 'data-company-exclude-apply' })),
              { title: 'Исключить позиции', variant: 'q', surface: 'app' },
            ));
            const submit = confirm?.querySelector('[data-company-exclude-apply]');
            submit?.addEventListener('click', async () => {
              submit.disabled = true;
              const error = confirm.querySelector('[data-company-exclude-error]');
              try {
                await json('/' + urlId(companyId) + '/catalog/selection', {
                  method: 'POST', body: { rowIds: ids, excluded: true },
                });
                ids.forEach(id => selectedCatalogIds.delete(id));
                confirm.v2Close?.();
                brandLayer?.v2Close?.();
                await showCatalog();
              } catch (cause) {
                error.textContent = errText(cause);
                submit.disabled = false;
              }
            });
          });
          brandLayer?.querySelectorAll('[data-company-product]').forEach(product => {
            product.addEventListener('click', () => {
              const row = byId.get(String(product.dataset.companyProduct));
              if (row) openCatalogProductDetails(row, catalogLinkStatuses.get(String(row.id)));
            });
          });
          syncSelections();
        });
      });
    } catch (error) {
      if (layer.isConnected && currentRun === revision && list.isConnected) {
        list.innerHTML = emptyState('Ассортимент недоступен', errText(error));
      }
    }
  };

  const refresh = async () => {
    try { companies = await json(); }
    catch (error) { return openNotice({ title: 'Контрагенты', message: errText(error) }); }
    if (!layer.isConnected) return;
    company = companies.find(row => row.id === companyId);
    if (!company) { layer.v2Close?.(); onChanged(); return; }
    // Separate plain contact details and assortment with the existing Z-section
    // vertical rhythm. No extra card, divider, or feature-specific CSS.
    host.innerHTML = '<section class="v2-section"><div class="v2-section__content">' +
      counterpartyInformation(company) + '</div></section>' +
      v2Section('Ассортимент', '<div data-company-catalog-list></div>');
    void showCatalog();
  };
  layer.querySelector('[data-company-actions]')?.addEventListener('click', () => {
    const files = Array.isArray(company.priceLists) ? company.priceLists : [];
    openSharedProfileSettingsMenu({ title: 'Контрагент', actions: [
      { id: 'edit', label: 'Редактировать', onSelect: () =>
        openCompanyEditor(company, () => { void refresh(); onChanged(); }) },
      { id: 'upload', label: 'Загрузить файл', onSelect: () =>
        openImportGuidance(company, () => { void refresh(); onChanged(); }) },
      { id: 'excluded', label: 'Исключённые', onSelect: () => void openExcludedCatalogItems() },
      { id: 'template', label: 'Шаблон Excel', onSelect: () =>
        void download('/template/xlsx', 'catalog-template.xlsx').catch(error =>
          openNotice({ title: 'Excel', message: errText(error) })) },
      ...(files.length ? [{ id: 'history', label: 'История загрузок',
        onSelect: () => openCounterpartyFiles(company) }] : []),
    ] });
  });
  void refresh();
  return layer;
}

export async function openSupplierAssociation(itemId, onSaved = () => {}) {
  let companies = [];
  try { companies = await json(); }
  catch (cause) { return openNotice({ title: 'Контрагенты', message: errText(cause) }); }
  if (!companies.length) return openNotice({ title: 'Контрагенты', message: 'Сначала создайте контрагента в отдельном разделе склада.' });
  const layer = mountModal(document.body, modal(`
    ${select({ label: 'Контрагент', name: 'counterpartyId', value: '', searchable: true,
      options: [{ value: '', label: 'Выберите компанию' },
        ...companies.map(company => ({ value: company.id, label: company.name }))] })}
    <p class="form-error" data-supplier-association-error role="alert"></p>
    ${actionBlock(button('Связать компанию', { data: 'data-associate-company' }) +
      button('Выбрать из прайса', { variant: 'secondary', data: 'data-associate-catalog' }))}`,
    { title: 'Подключить поставщика', variant: 'q', surface: 'app' }));
  if (!layer) return;
  const getCompany = () => companies.find(company => company.id === layer.querySelector('[name="counterpartyId"]')?.value);
  const fail = err => { layer.querySelector('[data-supplier-association-error]').textContent = errText(err); };
  layer.querySelector('[data-associate-company]')?.addEventListener('click', async event => {
    const company = getCompany();
    if (!company) return fail(new Error('Выберите контрагента'));
    event.currentTarget.disabled = true;
    try {
      await json('/' + urlId(company.id) + '/link-item', { method: 'POST', body: { itemId } });
      await loadInventory();
      layer.v2Close?.(); onSaved();
    } catch (cause) { fail(cause); event.currentTarget.disabled = false; }
  });
  layer.querySelector('[data-associate-catalog]')?.addEventListener('click', () => {
    const company = getCompany();
    if (!company) return fail(new Error('Выберите контрагента'));
    void openCatalog(company, { itemId, onLinked: () => { layer.v2Close?.(); onSaved(); } });
  });
}
function counterpartyCardFields(company = {}) {
  const files = Array.isArray(company.priceLists) ? company.priceLists : [];
  const ready = files.find(file => file.parserStatus === 'READY');
  const positionCount = Number(ready?._count?.rows);
  return [
    { value: 'name', label: 'Название', text: company.name || '' },
    { value: 'kind', label: 'Тип', text: kindLabel(company.kind) },
    { value: 'files', label: 'Файлы', text: String(files.length) + ' файл.' },
    { value: 'positions', label: 'Позиции', text: Number.isFinite(positionCount) && ready?._count?.rows != null
      ? String(positionCount) : '' },
    { value: 'contactName', label: 'Представитель', text: company.contactName || '' },
    { value: 'phone', label: 'Телефон', text: company.phone || '' },
    { value: 'email', label: 'Email', text: company.email || '' },
    { value: 'website', label: 'Сайт', text: company.website || '' },
  ];
}

function counterpartyCardAppearance() {
  return getCardAppearanceTemplate(COUNTERPARTY_CARD_SCOPE)?.appearance || COUNTERPARTY_CARD_DEFAULT;
}

function openCounterpartyAppearance(root, sample, onSaved = () => {}) {
  return openEntityCardAppearanceQ(root, {
    title: 'Вид',
    typeOptions: [{ value: COUNTERPARTY_CARD_SCOPE, label: 'Контрагент' }],
    initialType: COUNTERPARTY_CARD_SCOPE,
    resolve: () => ({
      appearance: counterpartyCardAppearance(),
      fields: counterpartyCardFields(sample),
    }),
    save: async ({ appearance }) => {
      saveCardAppearanceTemplate(COUNTERPARTY_CARD_SCOPE, { appearance });
    },
    allowPhoto: false,
    onSaved,
  });
}

export async function renderCounterparties(root) {
  root.innerHTML = page([
    workspaceHeaderContext({
      title: 'Контрагенты',
      v: { data: 'data-counterparty-view-menu', aria: 'Настройки контрагентов' },
      c: { label: '+', data: 'data-counterparty-add', aria: 'Новый контрагент' },
    }),
    '<div data-counterparties-list></div>',
  ]);
  const host = root.querySelector('[data-counterparties-list]');
  let currentCompanies = [];
  const renderCards = () => {
    if (!host?.isConnected) return;
    host.innerHTML = currentCompanies.length
      ? entityCardStack(currentCompanies.map(company => entityVisualCard({
        appearance: counterpartyCardAppearance(),
        fields: counterpartyCardFields(company),
        interactive: true,
        data: 'data-counterparty-open="' + escapeHtml(company.id) + '"',
        aria: 'Открыть контрагента ' + company.name,
      })))
      : emptyState('Контрагентов пока нет', 'Нажмите +, чтобы создать компанию.');
    host.querySelectorAll('[data-counterparty-open]').forEach(node => {
      node.addEventListener('click', () => {
        void openCompany(node.dataset.counterpartyOpen, root, show);
      });
    });
  };
  const show = async () => {
    host.innerHTML = emptyState('Контрагенты', 'Загружаем…');
    try {
      const companies = await json();
      if (!root.isConnected) return;
      currentCompanies = Array.isArray(companies) ? companies : [];
      renderCards();
    } catch (cause) { host.innerHTML = emptyState('Контрагенты недоступны', errText(cause)); }
  };
  root.querySelector('[data-counterparty-view-menu]')?.addEventListener('click', () => {
    openSharedProfileSettingsMenu({
      title: '',
      actions: [
        { id: 'appearance', label: 'Вид', onSelect: () =>
          openCounterpartyAppearance(root, currentCompanies[0] || {}, renderCards) },
      ],
    });
  });
  root.querySelector('[data-counterparty-add]')?.addEventListener('click', () => openCompanyEditor(null, () => { void show(); }));
  // Existing service-scoped auxiliary API includes appearance templates.
  await loadAuxiliaryState('service').catch(() => {});
  await show();
  window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
  return () => {};
}
