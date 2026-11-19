import {
  actionBlock, button, emptyState, field, modal, mountModal, openNotice,
  page, select, list, v2ListEntries, v2ListEntry, v2Section, workspaceHeaderContext,
  mountV2ZLayer, v2ZLayer, openSharedProfileSettingsMenu,
  entityVisualCard, entityCardStack, openEntityCardAppearanceQ, normalizeEntityCardAppearance,
} from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { compactCheck } from '../../ui/selection/check-list.js';
import { apiRequest, getAuthToken } from '../auth.js';
import { getInventoryItems } from './data.js';
import { catalogDisclosure } from './catalog-ui.js';
import { invalidateInventoryNavigationCache, loadInventory } from './service.js';
import { getCardAppearanceTemplate, saveCardAppearanceTemplate } from '../card-appearance-templates.js';
import { loadAuxiliaryState } from '../runtime/auxiliary-state.js';

const PATH = '/inventory/counterparties';
// Session-bound view caches only. Never persist another account's suppliers
// or their prices to disk, and never keep stale rows after an explicit write.
const COMPANY_CACHE_MS = 15000;
let companyCache = { token: '', rows: null, at: 0, inFlight: null, generation: 0 };
const sharedCatalogCache = new Map();
function currentCompanyCache() {
  const token = getAuthToken();
  if (companyCache.token !== token) {
    companyCache = { token, rows: null, at: 0, inFlight: null, generation: 0 };
    sharedCatalogCache.clear();
  }
  return companyCache;
}
if (typeof window !== 'undefined') window.addEventListener('professional:auth-logout', () => {
  companyCache = { token: '', rows: null, at: 0, inFlight: null, generation: 0 };
  sharedCatalogCache.clear();
});
const COUNTERPARTY_CARD_SCOPE = 'inventory-counterparty';
// Same entity card/constructor used for company cards in Stock. This is
// presentation inside Z1, not an F/E navigation card or a new UI primitive.
const COUNTERPARTY_CARD_DEFAULT = {
  lines: [
    {}, {}, {}, {}, {},
    { field: 'name', zone: 'full', align: 'left', size: 'xl', color: 'white', bold: true },
    { field: 'discountPercent', zone: 'full', align: 'left', size: 'm', color: 'white' },
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
  if (String(method).toUpperCase() !== 'GET') invalidateInventoryNavigationCache();
  return value;
}
async function loadCompanies({ force = false } = {}) {
  const state = currentCompanyCache();
  if (!force && Array.isArray(state.rows) && Date.now() - state.at < COMPANY_CACHE_MS)
    return state.rows;
  if (!force && state.inFlight) return state.inFlight;
  const token = state.token;
  const generation = state.generation;
  const promise = json();
  if (!force) state.inFlight = promise;
  try {
    const rows = await promise;
    if (getAuthToken() === token) {
      // A new account or a write may have invalidated the original state.
      if (companyCache === state && state.generation === generation) {
        state.rows = Array.isArray(rows) ? rows : [];
        state.at = Date.now();
      }
    }
    return rows;
  } finally {
    if (state.inFlight === promise) state.inFlight = null;
  }
}
async function importExcel(action, file, fields = {}) {
  const data = new FormData();
  data.append('file', file);
  Object.entries(fields).forEach(([key, value]) => {
    if (value != null && String(value) !== '') data.append(key, String(value));
  });
  const response = await apiRequest(PATH + '/import' + action, {
    method: 'POST', body: data, timeoutMs: 90000,
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(message(value, response.status));
  invalidateInventoryNavigationCache();
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
    <div class="inventory-editor-number" data-counterparty-discount>
      ${field({ label: 'Скидка по договору', name: 'discountPercent', value: company.discountPercent ?? '', type: 'number', min: '0', max: '100', step: '0.01', inputmode: 'decimal' })}
      <span class="inventory-editor-number__suffix" aria-hidden="true">%</span>
    </div>
    <p class="form-error" data-counterparty-error role="alert"></p>
    ${actionBlock(button('Применить', { type: 'submit' }))}
  </form>`;
}
// Check all eight fields from the existing editor against a fresh Core GET.
function counterpartyFieldMismatch(input, stored) {
  if (!stored || typeof stored !== 'object') return 'контрагент';
  const fields = [
    ['name', 'Название'], ['kind', 'Тип'], ['contactName', 'Представитель'],
    ['phone', 'Телефон'], ['email', 'Email'], ['website', 'Сайт'],
    ['note', 'Примечание'],
  ];
  for (const [key, label] of fields) {
    if (String(input[key] ?? '').trim() !== String(stored[key] ?? '').trim()) return label;
  }
  const expected = input.discountPercent;
  const actual = stored.discountPercent == null ? null : Number(stored.discountPercent);
  if (expected !== actual) return 'Скидка по договору';
  return '';
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
    const rawDiscount = String(input.discountPercent ?? '').trim();
    const discount = rawDiscount === '' ? null : Number(rawDiscount.replace(',', '.'));
    if (discount !== null && (!Number.isFinite(discount) || discount < 0 || discount > 100)) {
      error.textContent = 'Скидка должна быть от 0 до 100%.';
      return;
    }
    input.discountPercent = discount;
    save.disabled = true;
    let created = null;
    try {
      const updated = await json(company?.id ? '/' + urlId(company.id) : '', {
        method: company?.id ? 'PUT' : 'POST', body: input,
      });
      if (!company?.id) created = updated;
      // An HTTP 200 is not evidence that every field was actually persisted.
      // Read the authoritative Core record before closing the editor.
      const id = String(company?.id || updated?.id || '');
      if (!id) throw new Error('Core не вернул идентификатор контрагента.');
      const stored = (await json()).find(row => String(row.id) === id);
      if (!stored) throw new Error('Core не подтвердил сохранение контрагента.');
      const mismatch = counterpartyFieldMismatch(input, stored);
      if (mismatch) throw new Error('Core не сохранил поле «' + mismatch + '». Изменения не подтверждены.');
      layer.v2Close?.();
      onSaved?.(stored);
    } catch (cause) {
      if (created?.id) {
        // Creation cannot be safely retried: the entity already exists in Core.
        layer.v2Close?.();
        onSaved?.(created);
        openNotice({ title: 'Сохранение не подтверждено',
          message: 'Контрагент создан, но сохранение всех полей не подтверждено. ' +
            errText(cause) + ' Не создавайте его повторно.' });
      } else {
        error.textContent = errText(cause);
      }
    } finally { save.disabled = false; }
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

// Stock can start with a supplier catalog without first creating a local item.
// Reuses the same supplier catalog/row Q as the existing association flow.
export async function openSupplierCatalogCreation(onSaved = () => {}) {
  let companies;
  try { companies = await loadCompanies(); }
  catch (error) {
    openNotice({ title: 'Контрагенты', message: errText(error) });
    return;
  }
  const suppliers = (Array.isArray(companies) ? companies : [])
    .filter(company => Array.isArray(company.priceLists)
      && company.priceLists.some(entry => entry.parserStatus === 'READY'));
  if (!suppliers.length) {
    openNotice({ title: 'Ассортимент', message: 'Сначала загрузите прайс контрагента.' });
    return;
  }
  const layer = mountModal(document.body, modal(
    v2ListEntries(suppliers.map(company => v2ListEntry({
      title: company.name,
      rightTop: (company.priceLists || []).length + ' загрузок',
      interactive: true, initial: '',
      data: 'data-stock-supplier-choose="' + escapeHtml(company.id) + '"',
      aria: 'Выбрать ассортимент ' + company.name,
    }))),
    { title: 'Из ассортимента', variant: 'q', surface: 'app' },
  ));
  layer?.querySelectorAll('[data-stock-supplier-choose]').forEach(node => {
    node.addEventListener('click', () => {
      const company = suppliers.find(entry => entry.id === node.dataset.stockSupplierChoose);
      if (!company) return;
      layer.v2Close?.();
      openCatalog(company, { onLinked: onSaved });
    });
  });
}

async function openCatalogRow(company, row, { itemId = '', onLinked = () => {} } = {}) {
  try { await loadInventory({ preferRecent: true }); }
  catch (cause) { return openNotice({ title: 'Остатки', message: errText(cause) }); }
  const items = getInventoryItems();
  const layer = mountModal(document.body, modal(`<div>
    <p><strong>${escapeHtml(row.name)}</strong></p>
    <p>${escapeHtml([row.manufacturer, row.supplierSku && 'Арт. ' + row.supplierSku].filter(Boolean).join(' · '))}</p>
    <p>Наличие: ${supplierAvailability(row.supplierAvailable)}</p>
    ${row.supplierNote ? '<p>' + escapeHtml(row.supplierNote) + '</p>' : ''}
    <p>Прайсовая цена: ${money(row.listPrice)}</p>
    <p>Скидка: ${supplierDiscount(row, company)}</p>
    <p>Цена со скидкой: ${money(supplierEffectivePrice(row, company))}</p>
    <p>РРЦ: ${money(row.retailPrice)}</p>
    ${select({ label: 'Карточка склада', name: 'itemId', value: itemId,
      options: [{ value: '', label: 'Выбрать товар' },
        ...items.map(item => ({ value: item.itemId, label: [item.manufacturer, item.name].filter(Boolean).join(' · ') }))],
      searchable: true })}
    <div data-catalog-row-unit-fields hidden>
      ${field({ label: 'Единиц склада в предложении', name: 'unitsPerOffer',
        type: 'number', min: '0.001', step: 'any' })}
    </div>
    <p class="form-error" data-catalog-link-error role="alert"></p>
    ${actionBlock(button('Применить', { data: 'data-catalog-row-link' }) +
      (itemId ? '' : button('Новая карточка', { variant: 'secondary', data: 'data-catalog-new-item' })))}
  </div>`, { title: 'Подключить товар', variant: 'q', surface: 'app' }));
  if (!layer) return;
  const errorHost = layer.querySelector('[data-catalog-link-error]');
  const needsUnits = chosen => {
    const stock = getInventoryItems().find(entry => String(entry.itemId) === String(chosen));
    const unit = value => String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/\.$/, '');
    return Boolean(row.unit && stock?.unit && unit(row.unit) !== unit(stock.unit));
  };
  const unitFields = layer.querySelector('[data-catalog-row-unit-fields]');
  const updateUnits = () => {
    unitFields.hidden = !needsUnits(layer.querySelector('[name="itemId"]')?.value);
  };
  layer.querySelector('[name="itemId"]')?.addEventListener('change', updateUnits);
  updateUnits();
  const link = async chosen => {
    const units = Number(layer.querySelector('[name="unitsPerOffer"]')?.value);
    if (needsUnits(chosen) && !(Number.isFinite(units) && units > 0))
      throw new Error('Укажите количество единиц склада в предложении.');
    await json('/' + urlId(company.id) + '/catalog/' + urlId(row.id) + '/link', {
      method: 'POST', body: { itemId: chosen,
        ...(needsUnits(chosen) ? { unitsPerOffer: units } : {}) },
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

// One global intake for all supplier files; the OS picker opens on a direct tap.
function openImport(onSaved) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  input.hidden = true;
  document.body.appendChild(input);
  const cleanup = () => input.remove();
  input.addEventListener('change', () => {
    const file = input.files?.[0] || null;
    cleanup();
    if (file) openImportPreview(onSaved, file);
  }, { once: true });
  input.addEventListener('cancel', cleanup, { once: true });
  input.click();
}

function openImportPreview(onSaved, file) {
  const layer = mountModal(document.body, modal(
    '<div data-counterparty-preview></div><div data-counterparty-target></div>' +
    '<p class="form-error" data-counterparty-import-error role="alert"></p>' +
    actionBlock(button('Загрузить', { data: 'data-counterparty-import-save', disabled: true })),
    { title: 'Проверка Excel', variant: 'q', surface: 'app' }));
  if (!layer) return;
  const preview = layer.querySelector('[data-counterparty-preview]');
  const target = layer.querySelector('[data-counterparty-target]');
  const errorHost = layer.querySelector('[data-counterparty-import-error]');
  const save = layer.querySelector('[data-counterparty-import-save]');
  let result = null;
  const chosenCompany = () => String(layer.querySelector('[name="counterpartyId"]')?.value || '');
  const proposedName = () => String(layer.querySelector('[name="newCounterpartyName"]')?.value || '').trim();
  const sync = () => {
    const nameField = layer.querySelector('[name="newCounterpartyName"]')?.closest('.field');
    if (nameField) nameField.hidden = Boolean(chosenCompany());
    save.disabled = !result || result.status !== 'READY'
      || (!chosenCompany() && (!proposedName() || Boolean(result.ambiguousMatch)));
  };
  const check = async () => {
    preview.textContent = 'Проверяем Excel…';
    try {
      const [parsed, companies] = await Promise.all([importExcel('/preview', file), loadCompanies()]);
      if (!layer.isConnected) return;
      result = parsed;
      preview.innerHTML = '<p>' + escapeHtml(file.name) + ' · ' + parsed.count + ' поз.</p>' +
        (parsed.errors || []).map(value => '<p>' + escapeHtml(value) + '</p>').join('') +
        ((parsed.sample || []).length ? v2ListEntries(parsed.sample.map(row => v2ListEntry({
          title: row.name,
          subtitle: [row.supplierSku, supplierAvailability(row.supplierAvailable)].filter(Boolean).join(' · '),
          rightTop: money(row.listPrice), interactive: false,
        }))) : '');
      const known = Array.isArray(companies) ? companies : [];
      target.innerHTML = select({
        label: 'Контрагент', name: 'counterpartyId',
        value: parsed.matchedCounterpartyId || '', searchable: true,
        options: [{ value: '', label: 'Новый контрагент' },
          ...known.map(row => ({ value: row.id, label: row.name }))],
      }) + field({ label: 'Название нового контрагента', name: 'newCounterpartyName',
        value: parsed.supplierName || '' });
      if (parsed.ambiguousMatch) errorHost.textContent =
        'Есть несколько контрагентов с таким названием. Выберите нужного.';
      if (parsed.status !== 'READY') errorHost.textContent =
        'Сначала исправьте файл. Позиции не загружены.';
      target.addEventListener('input', sync);
      target.addEventListener('change', sync);
      sync();
    } catch (cause) {
      result = null;
      preview.textContent = '';
      errorHost.textContent = errText(cause);
      save.disabled = true;
    }
  };
  save.addEventListener('click', async () => {
    if (!result || result.status !== 'READY' || save.disabled) return;
    save.disabled = true;
    const counterpartyId = chosenCompany();
    const name = proposedName();
    let imported;
    try {
      imported = await importExcel('', file, {
        ...(counterpartyId ? { counterpartyId } : { name }),
        ...(result.format === 'pdf' ? { confirmedPdf: 'true' } : {}),
      });
    } catch (cause) {
      errorHost.textContent = errText(cause);
      save.disabled = false;
      return;
    }
    // The import is already committed in Core. A failed list refresh must never
    // present it as a failed import or encourage repeating the same upload.
    layer.v2Close?.();
    try { await onSaved?.(); }
    catch (cause) {
      openNotice({ title: 'Excel', message: 'Прайс сохранён, но список пока не обновился: ' +
        errText(cause) });
      return;
    }
    openNotice({ title: 'Excel',
      message: (imported.duplicate ? 'Этот файл уже загружен. ' : 'Прайс загружен. ') +
        'Контрагент: ' + imported.counterpartyName + '.' });
  });
  void check();
}

function supplierEffectivePrice(row = {}, company = {}) {
  if (row.effectivePrice != null) return Number(row.effectivePrice);
  if (row.listPrice == null) return null;
  const discount = Number(row.appliedDiscountPercent ?? row.discountPercent ?? company.discountPercent ?? 0);
  return Math.round((Number(row.listPrice) * (1 - discount / 100) + Number.EPSILON) * 100) / 100;
}

function supplierDiscount(row = {}, company = {}) {
  const discount = row.appliedDiscountPercent ?? row.discountPercent ?? company.discountPercent;
  return discount == null ? 'Не задана' : Number(discount).toLocaleString('ru-RU', {
    maximumFractionDigits: 4,
  }) + '%';
}

// Reuse the Inventory "Изменить данные" interaction and its shared UI primitives.
// Core already owns editing a catalog item: do not add a second bulk-edit API.
const SUPPLIER_CATALOG_EDIT_FIELDS = [
  { value: 'name', label: 'Наименование поставщика', kind: 'text', required: true },
  { value: 'supplierSku', label: 'Артикул', kind: 'text' },
  { value: 'barcode', label: 'Штрихкод', kind: 'text' },
  { value: 'manufacturer', label: 'Производитель', kind: 'text' },
  { value: 'brand', label: 'Бренд', kind: 'text' },
  { value: 'category', label: 'Группа поставщика', kind: 'text' },
  { value: 'listPrice', label: 'Прайсовая цена, ₽', kind: 'number', min: '0', step: '0.01' },
  { value: 'retailPrice', label: 'РРЦ, ₽', kind: 'number', min: '0', step: '0.01' },
  { value: 'discountPercent', label: 'Скидка по позиции, %', kind: 'number',
    min: '0', max: '100', step: '0.0001' },
  { value: 'unit', label: 'Ед. поставщика', kind: 'text' },
  { value: 'packageQuantity', label: 'В упаковке', kind: 'number', min: '0.001', step: 'any' },
  { value: 'supplierNote', label: 'Примечание поставщика', kind: 'text' },
];

function supplierCatalogDataControl(definition, name, value = '', label = '') {
  return field({
    label, name, value,
    ...(definition.kind === 'number'
      ? { type: 'number', min: definition.min, max: definition.max,
        step: definition.step, inputmode: 'decimal' } : {}),
    placeholder: 'Изменить',
    autocomplete: 'off',
  });
}

function supplierCatalogEditValue(definition, raw) {
  const value = String(raw ?? '').trim();
  // As in Inventory data audit, an empty bulk field leaves that position unchanged.
  if (!value) return null;
  if (definition.kind !== 'number') return value;
  const number = Number(value.replace(',', '.').replace(/\s/g, ''));
  if (!Number.isFinite(number) || number < 0
    || (definition.value === 'discountPercent' && number > 100)
    || (definition.value === 'packageQuantity' && number <= 0)
    || (['listPrice', 'retailPrice'].includes(definition.value) && number > 1e9)) {
    throw new Error('Проверьте значение поля «' + definition.label + '».');
  }
  return number;
}

function supplierCatalogValueMatches(actual, expected, definition) {
  return definition.kind === 'number'
    ? actual != null && Number(actual) === expected
    : String(actual ?? '').trim() === String(expected).trim();
}

// The selected supplier list follows Inventory's "Изменить данные" flow:
// one field, one active input, one checkbox per chosen position, one Apply.
function supplierCatalogBulkDisplay(value, definition) {
  if (value == null || String(value).trim() === '') return '—';
  if (definition.kind !== 'number') return String(value);
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  if (definition.value === 'listPrice' || definition.value === 'retailPrice') return money(amount);
  return amount.toLocaleString('ru-RU', { maximumFractionDigits: 4 }) +
    (definition.value === 'discountPercent' ? '%' : '');
}

function supplierCatalogBulkRow(row, definition, selected) {
  const id = String(row.id);
  return '<div class="inventory-counterparty-product-row" data-company-bulk-item="' +
    escapeHtml(id) + '">' +
    compactCheck({ checked: selected, aria: 'Выбрать ' + row.name,
      data: 'data-company-bulk-check="' + escapeHtml(id) + '"' }) +
    list({ className: 'ui-list--dense', items: [{
      title: row.name,
      right: [supplierCatalogBulkDisplay(row[definition.value], definition)],
    }] }) +
    '</div>';
}

function openSupplierBulkEditor(company, rows, onSaved = () => {}) {
  if (!rows.length) return;
  const definitions = new Map(SUPPLIER_CATALOG_EDIT_FIELDS.map(item => [item.value, item]));
  const selected = new Set(rows.map(row => String(row.id)));
  const rowsById = new Map(rows.map(row => [String(row.id), row]));
  const layer = mountModal(document.body, modal(
    '<form data-company-bulk-editor>' +
      select({ label: 'Что изменить', name: 'supplierBulkField', value: 'category',
        options: SUPPLIER_CATALOG_EDIT_FIELDS.map(({ value, label }) => ({ value, label })) }) +
      '<div data-company-bulk-value></div>' +
      '<div class="inventory-counterparty-bulk-selection">' +
        compactCheck({ checked: true, label: 'Выбрать все',
          data: 'data-company-bulk-all', aria: 'Выбрать все позиции' }) +
      '</div>' +
      '<p class="ui-list__secondary" data-company-bulk-count></p>' +
      '<div data-company-bulk-list></div>' +
      '<p class="form-error" role="alert" data-company-bulk-error></p>' +
      '<p class="ui-list__secondary" role="status" data-company-bulk-result></p>' +
      actionBlock(button('Применить', { type: 'submit', data: 'data-company-bulk-save' })) +
    '</form>',
    { title: 'Изменить данные', variant: 'q', surface: 'app' },
  ));
  if (!layer) return;
  const form = layer.querySelector('[data-company-bulk-editor]');
  const fieldInput = form.querySelector('[name="supplierBulkField"]');
  const valueHost = form.querySelector('[data-company-bulk-value]');
  const all = form.querySelector('[data-company-bulk-all]');
  const count = form.querySelector('[data-company-bulk-count]');
  const listHost = form.querySelector('[data-company-bulk-list]');
  const error = form.querySelector('[data-company-bulk-error]');
  const result = form.querySelector('[data-company-bulk-result]');
  const submit = form.querySelector('[data-company-bulk-save]');
  let busy = false;
  let changed = false;
  const definition = () => definitions.get(fieldInput.value);
  const valueInput = () => valueHost.querySelector('[name="supplierBulkValue"]');
  const resetMessages = () => { error.textContent = ''; result.textContent = ''; };

  // On close, update the parent assortment only if data was actually changed.
  // Do not close or clear selection on each Apply: subsequent fields can be edited.
  const originalClose = layer.v2Close;
  layer.v2Close = () => {
    if (!layer.isConnected) return;
    originalClose?.();
    if (changed) onSaved();
  };

  const preview = () => {
    const def = definition();
    if (!def) return;
    let next = null;
    try { next = supplierCatalogEditValue(def, valueInput()?.value); }
    catch { /* Keep the stored value visible until the new input is valid. */ }
    listHost.querySelectorAll('[data-company-bulk-item]').forEach(node => {
      const id = String(node.dataset.companyBulkItem);
      const row = rowsById.get(id);
      const right = node.querySelector('.ui-list__right-secondary span');
      if (row && right) right.textContent = supplierCatalogBulkDisplay(
        selected.has(id) && next !== null ? next : row[def.value], def);
    });
  };
  const sync = () => {
    all.checked = selected.size === rows.length;
    count.textContent = 'Выбрано ' + selected.size + ' из ' + rows.length;
    submit.disabled = busy || !selected.size;
    preview();
  };
  const renderList = () => {
    const def = definition();
    if (!def) return;
    listHost.innerHTML = rows.map(row =>
      supplierCatalogBulkRow(row, def, selected.has(String(row.id)))).join('');
    sync();
  };
  const renderField = () => {
    const def = definition();
    if (!def) return;
    valueHost.innerHTML = supplierCatalogDataControl(def, 'supplierBulkValue',
      '', 'На что изменить');
    resetMessages();
    renderList();
  };
  fieldInput.addEventListener('change', renderField);
  valueHost.addEventListener('input', () => { result.textContent = ''; preview(); });
  listHost.addEventListener('change', event => {
    const checkbox = event.target.closest?.('[data-company-bulk-check]');
    if (!checkbox || busy) return;
    const id = String(checkbox.dataset.companyBulkCheck);
    if (checkbox.checked) selected.add(id);
    else selected.delete(id);
    resetMessages();
    sync();
  });
  all.addEventListener('change', () => {
    if (busy) return;
    if (all.checked) rows.forEach(row => selected.add(String(row.id)));
    else selected.clear();
    resetMessages();
    renderList();
  });

  const loadSelected = async () => {
    const base = '/' + urlId(company.id) + '/catalog?skip=';
    const first = await json(base + '0');
    const catalog = Array.isArray(first.items) ? [...first.items] : [];
    const total = Number(first.count) || 0;
    for (let offset = 100; offset < total; offset += 400) {
      const offsets = [];
      for (let skip = offset; skip < Math.min(offset + 400, total); skip += 100)
        offsets.push(skip);
      const pages = await Promise.all(offsets.map(skip => json(base + skip)));
      pages.forEach(page => catalog.push(...(Array.isArray(page.items) ? page.items : [])));
    }
    const byId = new Map(catalog.map(row => [String(row.id), row]));
    if (rows.some(row => !byId.has(String(row.id))))
      throw new Error('Выбор устарел. Закройте редактор и обновите ассортимент.');
    return byId;
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !selected.size) return;
    const def = definition();
    if (!def) { error.textContent = 'Выберите поле для изменения.'; return; }
    let value;
    try {
      value = supplierCatalogEditValue(def, valueInput()?.value);
      if (value === null) throw new Error('Введите новое значение.');
    } catch (cause) { error.textContent = errText(cause); return; }
    const targets = rows.filter(row => selected.has(String(row.id)) &&
      !supplierCatalogValueMatches(row[def.value], value, def));
    if (!targets.length) {
      error.textContent = 'У выбранных позиций уже указано это значение.';
      return;
    }
    busy = true;
    submit.disabled = true;
    error.textContent = '';
    result.textContent = '';
    const failed = new Map();
    try {
      for (let offset = 0; offset < targets.length; offset += 4) {
        const batch = targets.slice(offset, offset + 4);
        const responses = await Promise.allSettled(batch.map(row =>
          json('/' + urlId(company.id) + '/catalog/' + urlId(row.id), {
            method: 'PUT', body: { [def.value]: value },
          })));
        responses.forEach((response, index) => {
          if (response.status === 'fulfilled') changed = true;
          else failed.set(String(batch[index].id), errText(response.reason));
        });
        result.textContent = 'Обработано: ' +
          Math.min(offset + 4, targets.length) + ' из ' + targets.length;
      }
      const saved = await loadSelected();
      const confirmed = targets.filter(row =>
        supplierCatalogValueMatches(saved.get(String(row.id))?.[def.value], value, def));
      // Keep the same checked rows and refresh their right-column values after
      // every Apply; the selector may then change to another field.
      rows.forEach(row => Object.assign(row, saved.get(String(row.id))));
      if (confirmed.length) changed = true;
      valueInput().value = '';
      renderList();
      if (confirmed.length !== targets.length || failed.size) {
        error.textContent = 'Сохранено ' + confirmed.length + ' из ' + targets.length +
          '. Не подтверждено: ' + (targets.length - confirmed.length) +
          (failed.size ? '. ' + [...failed.values()][0] : '');
      } else {
        result.textContent = 'Сохранено: ' + confirmed.length + ' из ' +
          targets.length + '. Можно изменить другое поле.';
      }
    } catch (cause) {
      error.textContent = errText(cause);
    } finally {
      busy = false;
      if (submit.isConnected) sync();
    }
  });
  renderField();
}

function openSupplierProductEditor(company, row, onSaved = () => {}) {
  // The single-row and bulk editors use one authoritative field registry.
  const fields = SUPPLIER_CATALOG_EDIT_FIELDS.map(def =>
    field({ label: def.label, name: def.value,
      value: row[def.value] ?? '',
      ...(def.required ? { required: true } : {}),
      ...(def.kind === 'number' ? { type: 'number', min: def.min, max: def.max,
        step: def.step, inputmode: 'decimal' } : {}),
    }));
  const layer = mountModal(document.body, modal(
    '<form data-company-catalog-edit-form>' + fields.join('') +
    '<p class="ui-list__secondary">Не указана — скидка по договору; 0% — без скидки.</p>' +
    '<p class="form-error" role="alert" data-company-catalog-edit-error></p>' +
    actionBlock(button('Применить', { type: 'submit' })) + '</form>',
    { title: 'Позиция поставщика', variant: 'q', surface: 'app' },
  ));
  if (!layer) return;
  const form = layer.querySelector('[data-company-catalog-edit-form]');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(form).entries());
    const error = form.querySelector('[data-company-catalog-edit-error]');
    const name = String(input.name || '').trim();
    if (!name) { error.textContent = 'Укажите название.'; return; }
    for (const key of ['listPrice', 'retailPrice', 'discountPercent', 'packageQuantity']) {
      const raw = String(input[key] ?? '').trim();
      input[key] = raw === '' ? null : Number(raw.replace(',', '.'));
    }
    const save = form.querySelector('[type="submit"]');
    save.disabled = true;
    try {
      await json('/' + urlId(company.id) + '/catalog/' + urlId(row.id),
        { method: 'PUT', body: input });
      layer.v2Close?.();
      onSaved();
    } catch (cause) {
      error.textContent = errText(cause);
      save.disabled = false;
    }
  });
}

function counterpartyInformation(company = {}) {
  // Header owns the company name; Z2 details show contact information only.
  const representative = String(company.contactName || '').trim();
  const contacts = [company.phone, company.email]
    .map(value => String(value || '').trim()).filter(Boolean);
  return '<div data-counterparty-information>' +
    (representative ? '<strong class="ui-list__title">' +
      escapeHtml(representative) + '</strong>' : '') +
    contacts.map(value => '<span class="ui-list__secondary">' +
      escapeHtml(value) + '</span>').join('') +
    '</div>';
}

// Tapping a supplier product opens its data Q. Selection is exclusively
// the compact checkbox; item details never initiate stock creation or linking.
function openCatalogProductDetails(row, status = null, company = null, onSaved = null) {
  const stockItem = status?.itemId
    ? getInventoryItems().find(item => String(item.itemId) === String(status.itemId)) : null;
  const rows = [
    ['Артикул', row.supplierSku || '—'],
    ['Короткое название', stockItem?.name || '—'],
    ['Наименование поставщика', row.name],
    ['Производитель', row.manufacturer || row.brand],
    ['Штрихкод', row.barcode],
    ['Категория', row.category],
    ['Наличие', supplierAvailability(row.supplierAvailable)],
    ['Прайсовая цена', money(row.listPrice)],
    ['Скидка', supplierDiscount(row, company)],
    ['Цена со скидкой', money(supplierEffectivePrice(row, company))],
    ['РРЦ', money(row.retailPrice)],
    ['Карточка склада', status?.status === 'linked' ? stockItem?.name || 'Связана'
      : status?.status === 'matched' ? 'Найдено совпадение'
      : status?.status === 'conflict' ? 'Неоднозначное совпадение' : 'Не связана'],
    ['Примечание', row.supplierNote],
  ].filter(([,value]) => value != null && String(value).trim() !== '');
  const layer = mountModal(document.body, modal(
    list({ className: 'ui-list--dense',
      items: rows.map(([title, value]) => ({ title, right: [String(value)] })),
    }) + (onSaved ? actionBlock(button('Изменить', { data: 'data-company-product-edit' })) : ''),
    { title: 'Данные товара', variant: 'q', surface: 'app' },
  ));
  layer?.querySelector('[data-company-product-edit]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openSupplierProductEditor(company, row, onSaved);
  });
  return layer;
}

function catalogItemList(items = [], selectedCatalogIds = new Set(), linkedCatalogIds = null, matchedCatalogItems = null, statuses = new Map()) {
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
                : statuses.get(String(item.id))?.status === 'conflict'
                  ? 'Неоднозначная связь: выберите карточку вручную'
                  : 'Не найдено совпадений с карточками склада',
          right: [
            money(item.listPrice) + ' · ' + supplierDiscount(item),
            'Со скидкой ' + money(supplierEffectivePrice(item)),
          ],
          interactive: true,
          data: 'data-company-product="' + escapeHtml(item.id) + '"',
          aria: 'Данные товара ' + item.name + '. ' + supplierAvailability(item.supplierAvailable),
        }],
      }) +
    '</div>',
  ).join('') + '</div>';
}

// Hidden supplier rows use the same company/category disclosures as the
// assortment, never a flat list. Worksheet labels are import metadata,
// not names of manufacturers or product categories.
function catalogExcludedGroups(entries, companyName) {
  const groupName = value => {
    const name = String(value ?? '').trim();
    return /^(?:лист|sheet)\s*[-_№#]?\s*\d+(?:\s*\(\d+\))?$/iu.test(name) ? '' : name;
  };
  const normalized = entries.map(row => ({
    ...row,
    brand: groupName(row.brand) || groupName(row.manufacturer) || companyName,
    category: groupName(row.category),
  }));
  return catalogBrands(normalized);
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

// Shared assortment/hidden category layout: identical native disclosure,
// compact selection and product rows. Only the action footer differs.
function catalogCategoryRowsMarkup(categories, selectedCatalogIds, linkedCatalogIds, matchedCatalogItems, statuses, checkAttribute = 'data-company-category-check') {
  return '<div class="inventory-item-accordion">' +
    [...categories].map(([category, rows]) =>
      category ? catalogDisclosure(category, catalogItemList(rows, selectedCatalogIds, linkedCatalogIds, matchedCatalogItems, statuses), false, rows.length,
        compactCheck({
          checked: rows.length > 0 && rows.every(row => selectedCatalogIds.has(String(row.id))),
          aria: 'Выбрать все позиции категории ' + category,
          data: checkAttribute + '="' + escapeHtml(category) + '"',
        })) : catalogItemList(rows, selectedCatalogIds, linkedCatalogIds, matchedCatalogItems, statuses),
    ).join('') + '</div>';
}

function catalogBrandMarkup(categories, selectedCatalogIds, linkedCatalogIds = null, matchedCatalogItems = null, statuses = new Map()) {
  return catalogCategoryRowsMarkup(categories, selectedCatalogIds, linkedCatalogIds, matchedCatalogItems, statuses) +
    actionBlock(
      button('Создать карточку', { data: 'data-company-selection-card' }) +
      button('Изменить данные', { variant: 'secondary', data: 'data-company-selection-bulk' }) +
      button('Скрыть', {
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
  try { await loadInventory({ preferRecent: true }); }
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

function openCounterpartyFiles(companies = []) {
  const entries = companies.flatMap(company =>
    (Array.isArray(company.priceLists) ? company.priceLists : []).map(file => ({ company, file })));
  const content = entries.length
    ? v2ListEntries(entries.map(({ company, file }, index) => v2ListEntry({
      title: company.name + ' · ' + file.filename,
      subtitle: 'Версия ' + file.revision + ' · ' +
        new Date(file.createdAt).toLocaleDateString('ru-RU'),
      rightTop: file.parserStatus === 'READY' ? String(file._count?.rows || 0) + ' поз.' : 'Нужен Excel',
      interactive: true, initial: '',
      data: 'data-company-file-index="' + index + '"', aria: 'Скачать ' + file.filename,
    }))) : '<p>История загрузок пуста.</p>';
  const layer = mountModal(document.body, modal(content, {
    title: 'История загрузок', variant: 'q', surface: 'app',
  }));
  layer?.querySelectorAll('[data-company-file-index]').forEach(node => {
    node.addEventListener('click', () => {
      const entry = entries[Number(node.dataset.companyFileIndex)];
      if (!entry) return;
      const { company, file } = entry;
      void download('/' + urlId(company.id) + '/pricelists/' + urlId(file.id) +
        '/download', 'catalog-' + file.revision + '.' + file.format)
        .catch(error => openNotice({ title: 'Файл', message: errText(error) }));
    });
  });
}

async function openCompany(companyId, root, onChanged = () => {}, { initialCompanies = null, catalogCache = null } = {}) {
  // The parent has just loaded the company list. Reuse it instead of GETting it again.
  let companies = initialCompanies;
  if (!Array.isArray(companies)) {
    try { companies = await json(); }
    catch (error) { return openNotice({ title: 'Контрагенты', message: errText(error) }); }
  }
  let company = companies.find(row => row.id === companyId);
  if (!company) return openNotice({ title: 'Контрагент', message: 'Компания не найдена.' });
  const markup = workspaceHeaderContext({
    title: company.name,
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
  const refreshCatalogLinkStatuses = async (run = revision) => {
    const data = await json('/' + urlId(companyId) + '/catalog/link-status');
    if (!Array.isArray(data?.statuses)) throw new Error('Статусы связей недоступны.');
    if (run !== revision) return false;
    catalogLinkStatuses = new Map(data.statuses.map(item => [String(item.catalogItemId), item]));
    linkedCatalogIds = new Set(data.statuses.filter(item => item.status === 'linked')
      .map(item => String(item.catalogItemId)));
    matchedCatalogItems = new Map(data.statuses.filter(item => item.status === 'matched' && item.itemId)
      .map(item => [String(item.catalogItemId), String(item.itemId)]));
    return true;
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
      openNotice({ title: 'Скрытые', message: errText(error) });
      return;
    }
    if (!entries.length) {
      openNotice({ title: 'Скрытые', message: 'Скрытых позиций нет.' });
      return;
    }
    // The top-level hidden list uses the exact V2 List entry as the
    // visible assortment. Each brand opens the same category/product Q.
    const brands = catalogExcludedGroups(entries, company.name);
    const selected = new Set();
    const restoreLayer = mountModal(document.body, modal(
      catalogGroupsMarkup(brands),
      { title: 'Скрытые', variant: 'q', surface: 'app' },
    ));
    if (!restoreLayer) return;
    let busy = false;
    const restoreSelected = async (brandLayer) => {
      if (!selected.size || busy) return;
      busy = true;
      const apply = brandLayer.querySelector('[data-company-restore-apply]');
      if (apply) apply.disabled = true;
      const error = brandLayer.querySelector('[data-company-restore-error]');
      if (error) error.textContent = '';
      try {
        await json('/' + urlId(companyId) + '/catalog/selection', {
          method: 'POST', body: { rowIds: [...selected], excluded: false },
        });
        catalogCache?.delete(String(companyId));
        brandLayer.v2Close?.();
        restoreLayer.v2Close?.();
        await showCatalog();
      } catch (cause) {
        if (error) error.textContent = errText(cause);
        if (apply) apply.disabled = !selected.size;
      } finally {
        busy = false;
      }
    };
    restoreLayer.querySelectorAll('[data-company-brand]').forEach(node => {
      node.addEventListener('click', () => {
        const brand = node.dataset.companyBrand;
        const categories = brands.get(brand);
        if (!categories) return;
        const brandLayer = mountModal(document.body, modal(
          catalogCategoryRowsMarkup(categories, selected, linkedCatalogIds,
            matchedCatalogItems, catalogLinkStatuses, 'data-company-restore-category-check') +
          '<p class="form-error" data-company-restore-error role="alert"></p>' +
          actionBlock(button('Восстановить', { data: 'data-company-restore-apply' })),
          { title: brand, variant: 'q', surface: 'app' },
        ));
        if (!brandLayer) return;
        const apply = brandLayer.querySelector('[data-company-restore-apply]');
        const sync = () => {
          brandLayer.querySelectorAll('[data-company-product-check]').forEach(input => {
            input.checked = selected.has(String(input.dataset.companyProductCheck));
          });
          brandLayer.querySelectorAll('[data-company-restore-category-check]').forEach(input => {
            const rows = categories.get(input.dataset.companyRestoreCategoryCheck) || [];
            const marked = rows.filter(row => selected.has(String(row.id))).length;
            input.checked = rows.length > 0 && marked === rows.length;
            input.indeterminate = marked > 0 && marked < rows.length;
          });
          apply.disabled = busy || !selected.size;
        };
        brandLayer.querySelectorAll('[data-company-restore-category-check]').forEach(input => {
          input.addEventListener('change', () => {
            if (busy) return;
            const rows = categories.get(input.dataset.companyRestoreCategoryCheck) || [];
            rows.forEach(row => {
              if (input.checked) selected.add(String(row.id));
              else selected.delete(String(row.id));
            });
            sync();
          });
        });
        brandLayer.querySelectorAll('[data-company-product-check]').forEach(input => {
          input.addEventListener('change', () => {
            if (busy) return;
            const id = String(input.dataset.companyProductCheck);
            if (input.checked) selected.add(id);
            else selected.delete(id);
            sync();
          });
        });
        brandLayer.querySelectorAll('[data-company-product]').forEach(product => {
          product.addEventListener('click', () => {
            const row = [...categories.values()].flat().find(item =>
              String(item.id) === String(product.dataset.companyProduct));
            if (row) openCatalogProductDetails(row, catalogLinkStatuses.get(String(row.id)));
          });
        });
        apply.addEventListener('click', () => void restoreSelected(brandLayer));
        sync();
      });
    });
  };

  // Brand lists reuse confirmed session data. The cache is keyed to the auth
  // session and cleared on logout or any catalog mutation; never localStorage.
  const renderCatalog = (entries, list) => {
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
          const brandLayer = mountModal(document.body, modal(catalogBrandMarkup(categories, selectedCatalogIds, linkedCatalogIds, matchedCatalogItems, catalogLinkStatuses), {
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
            catalogCache?.delete(String(companyId));
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
          brandLayer?.querySelector('[data-company-selection-bulk]')?.addEventListener('click', () => {
            const rows = entries.filter(row => selectedCatalogIds.has(String(row.id)));
            if (rows.length) openSupplierBulkEditor(company, rows, () => {
              selectedCatalogIds.clear();
              brandLayer?.v2Close?.();
              void showCatalog();
            });
          });
          brandLayer?.querySelector('[data-company-selection-delete]')?.addEventListener('click', () => {
            const ids = entries.filter(row => selectedCatalogIds.has(String(row.id)))
              .map(row => String(row.id));
            if (!ids.length) return;
            const confirm = mountModal(document.body, modal(
              '<p>Скрыть ' + ids.length + ' позиций? Их можно восстановить через «Скрытые».</p>' +
              '<p class="form-error" data-company-exclude-error role="alert"></p>' +
              actionBlock(button('Скрыть', { variant: 'delete-outline',
                data: 'data-company-exclude-apply' })),
              { title: 'Подтверждение скрытия', variant: 'x', xRole: 'action', surface: 'app' },
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
              if (row) openCatalogProductDetails(row,
                catalogLinkStatuses.get(String(row.id)), company, () => {
                  brandLayer?.v2Close?.();
                  void showCatalog();
                });
            });
          });
          syncSelections();
        });
      });
  };

  const showCatalog = async ({ preferCache = false } = {}) => {
    const currentRun = ++revision;
    const list = host.querySelector('[data-company-catalog-list]');
    if (!list) return;
    const key = String(companyId);
    const cached = preferCache ? catalogCache?.get(key) : null;
    if (cached) {
      linkedCatalogIds = cached.linked === null ? null : new Set(cached.linked);
      matchedCatalogItems = cached.matched === null ? null : new Map(cached.matched);
      catalogLinkStatuses = new Map(cached.statuses);
      renderCatalog(cached.entries, list);
      // Opening a previously viewed supplier should be immediate. Old data remains
      // visible while the server revalidates after one minute.
      if (Date.now() - cached.at < 60000) return;
    } else {
      catalogCache?.delete(key);
      list.innerHTML = emptyState('Ассортимент', 'Загружаем…');
    }
    try {
      // Independent link classification and catalog pages can load in parallel.
      const statusesPromise = refreshCatalogLinkStatuses(currentRun).catch(() => false);
      const data = await json('/' + urlId(companyId) + '/catalog?skip=0&take=500');
      if (!layer.isConnected || !list.isConnected || currentRun !== revision) return;
      const entries = Array.isArray(data.items) ? [...data.items] : [];
      const count = Math.max(0, Number(data.count) || 0);
      // Older Core returns the original 100-row page and no pageSize.
      const pageSize = Math.max(1, Math.min(500, Number(data.pageSize) || 100));
      // The first page is already useful: show brand groups immediately,
      // instead of keeping the entire supplier catalog behind a spinner.
      renderCatalog(entries, list);
      // Core supports up to 500 rows in one read. Use its explicit page size
      // instead of issuing ten 100-row requests for a 1000-item supplier.
      const parallel = 4;
      for (let skip = pageSize; skip < count; skip += pageSize * parallel) {
        const offsets = [];
        for (let offset = skip; offset < Math.min(count, skip + pageSize * parallel); offset += pageSize)
          offsets.push(offset);
        const pages = await Promise.all(offsets.map(offset =>
          json('/' + urlId(companyId) + '/catalog?skip=' + offset + '&take=500')));
        if (!layer.isConnected || !list.isConnected || currentRun !== revision) return;
        pages.forEach(page => entries.push(...(Array.isArray(page.items) ? page.items : [])));
        // Incrementally add brands/products after each bounded batch.
        renderCatalog(entries, list);
      }
      if (!layer.isConnected || !list.isConnected || currentRun !== revision) return;
      // The link-status query runs independently and must not block listing.
      // The stock snapshot is expensive and unnecessary when Core has already
      // classified catalog links. Read it only for a legacy server fallback.
      if (!(await statusesPromise)) {
        try {
          await loadInventory();
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
        } catch {
          linkedCatalogIds = null;
          matchedCatalogItems = null;
          catalogLinkStatuses = new Map();
        }
      }
      if (!layer.isConnected || !list.isConnected || currentRun !== revision) return;
      catalogCache?.set(key, {
        at: Date.now(), entries,
        linked: linkedCatalogIds === null ? null : [...linkedCatalogIds],
        matched: matchedCatalogItems === null ? null : [...matchedCatalogItems],
        statuses: [...catalogLinkStatuses],
      });
    } catch (error) {
      if (layer.isConnected && currentRun === revision && list.isConnected && !cached)
        list.innerHTML = emptyState('Ассортимент недоступен', errText(error));
    }
  };

  const displayCompany = (preferCache = false) => {
    // Existing section headings and content are not changed by the cache.
    host.innerHTML = v2Section('Представитель', counterpartyInformation(company)) +
      v2Section('Ассортимент', '<div data-company-catalog-list></div>');
    void showCatalog({ preferCache });
  };
  const refresh = async () => {
    try { companies = await json(); }
    catch (error) { return openNotice({ title: 'Контрагенты', message: errText(error) }); }
    if (!layer.isConnected) return;
    company = companies.find(row => row.id === companyId);
    if (!company) { layer.v2Close?.(); onChanged(); return; }
    displayCompany();
  };
  layer.querySelector('[data-company-actions]')?.addEventListener('click', () => {
    openSharedProfileSettingsMenu({ title: 'Контрагент', actions: [
      { id: 'edit', label: 'Редактировать', variant: 'primary', onSelect: () =>
        openCompanyEditor(company, saved => {
          company = { ...company, ...saved };
          // Display saved company details immediately, with only one parent
          // list refresh. The old code started two separate full list GETs.
          catalogCache?.delete(String(companyId));
          displayCompany();
          onChanged();
        }) },
      { id: 'excluded', label: 'Скрытые', onSelect: () =>
        void openExcludedCatalogItems() },
    ] });
  });
  // No second GET to open a company already present in the source list.
  if (Array.isArray(initialCompanies)) displayCompany(true);
  else void refresh();
  return layer;
}

export async function openSupplierAssociation(itemId, onSaved = () => {}) {
  let companies = [];
  try { companies = await loadCompanies(); }
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
    { value: 'discountPercent', label: 'Скидка по договору',
      text: company.discountPercent == null ? ''
        : Number(company.discountPercent)
          .toLocaleString('ru-RU', { maximumFractionDigits: 4 }) + '%' },
  ];
}

function counterpartyCardAppearance() {
  const saved = getCardAppearanceTemplate(COUNTERPARTY_CARD_SCOPE)?.appearance;
  if (!saved) return COUNTERPARTY_CARD_DEFAULT;
  // Existing user layouts stay intact: fill only one empty cell for the new
  // supplier discount; never move or replace a configured card field.
  const appearance = normalizeEntityCardAppearance(saved);
  const columns = ['left', 'center', 'right'];
  if (appearance.lines.some(row => columns.some(col => row.cells[col].field === 'discountPercent')))
    return appearance;
  const preferred = [[6, 'left'], [6, 'right'], [6, 'center']];
  for (let i = 8; i >= 0; i--) for (const column of columns)
    if (!preferred.some(([row, col]) => row === i && col === column))
      preferred.push([i, column]);
  const spot = preferred.find(([row, column]) => !appearance.lines[row].cells[column].field);
  if (spot) {
    const [row, column] = spot;
    appearance.lines[row].cells[column] = {
      ...appearance.lines[row].cells[column],
      field: 'discountPercent', size: 'm', color: '#FFFFFF',
    };
  }
  return appearance;
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
  // In-memory supplier cache is bound to the current authenticated session.
  const catalogCache = sharedCatalogCache;
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
        void openCompany(node.dataset.counterpartyOpen, root, show,
          { initialCompanies: currentCompanies, catalogCache });
      });
    });
  };
  const show = async (invalidate = true, prepared = null) => {
    // Create/edit/import invalidates the cached list; navigation does not.
    if (invalidate === true) {
      catalogCache.clear();
      const state = currentCompanyCache();
      state.rows = null;
      state.at = 0;
      state.generation++;
    }
    if (!currentCompanies.length) host.innerHTML = emptyState('Контрагенты', 'Загружаем…');
    try {
      const companies = await (prepared || loadCompanies({ force: invalidate === true }));
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
        { id: 'excel', label: 'Excel', onSelect: () =>
          openSharedProfileSettingsMenu({ title: 'Excel', actions: [
            { id: 'upload', label: 'Загрузить', variant: 'primary', onSelect: () =>
              openImport(show) },
            { id: 'template', label: 'Шаблон Excel', onSelect: () =>
              void download('/template/xlsx', 'counterparties-template.xlsx').catch(error =>
                openNotice({ title: 'Excel', message: errText(error) })) },
            { id: 'history', label: 'История загрузок', onSelect: () =>
              openCounterpartyFiles(currentCompanies) },
          ] }) },
      ],
    });
  });
  root.querySelector('[data-counterparty-add]')?.addEventListener('click', () => openCompanyEditor(null, () => { void show(); }));
  // Run independent data requests together. Cards still wait for the
  // appearance template before rendering, without a serial network waterfall.
  const companiesPromise = loadCompanies();
  const appearancePromise = loadAuxiliaryState('service').catch(() => {});
  // Attach handlers to both immediately; even if either fails before the
  // other finishes, no unhandled promise is left behind.
  await Promise.allSettled([companiesPromise, appearancePromise]);
  await show(false, companiesPromise);
  window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
  return () => {};
}
