import {
  actionBlock, button, emptyState, field, modal, mountModal, openNotice,
  page, select, list, v2ListEntries, v2ListEntry, v2Section, workspaceHeaderContext,
  mountV2ZLayer, v2ZLayer, openSharedProfileSettingsMenu,
  entityVisualCard, entityCardStack, openEntityCardAppearanceQ, normalizeEntityCardAppearance,
} from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { compactCheck } from '../../ui/selection/check-list.js';
import { apiRequest } from '../auth.js';
import { getInventoryItems } from './data.js';
import { catalogDisclosure } from './catalog-ui.js';
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
  return value;
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
  try { companies = await json(); }
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
  try { await loadInventory(); }
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
      const [parsed, companies] = await Promise.all([importExcel('/preview', file), json()]);
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

// Supplier's price and the tenant's agreement discount are owned by Counterparty,
// not by the stock item. This Q never edits receipts or historical costs.
function openSupplierBatchPrices(company, rows, onSaved = () => {}) {
  if (!rows.length) return;
  const layer = mountModal(document.body, modal(
    '<form data-company-batch-form>' +
    '<p class="ui-list__secondary">Выбрано позиций: ' + rows.length + '</p>' +
    select({ label: 'Изменение цен', name: 'mode', value: 'percent',
      options: [{ value: 'percent', label: 'На процент' },
        { value: 'amount', label: 'На сумму, ₽' }] }) +
    field({ label: 'Изменение (+ или −)', name: 'value', type: 'number',
      step: 'any', value: '', required: true }) +
    '<p class="ui-list__secondary" data-company-batch-example></p>' +
    '<p class="form-error" role="alert" data-company-batch-error></p>' +
    actionBlock(button('Применить', { type: 'submit' })) + '</form>',
    { title: 'Цены поставщика', variant: 'q', surface: 'app' },
  ));
  if (!layer) return;
  const form = layer.querySelector('[data-company-batch-form]');
  const example = form.querySelector('[data-company-batch-example]');
  const sample = rows.find(item => item.listPrice != null);
  const updatePreview = () => {
    const data = new FormData(form);
    const raw = String(data.get('value') ?? '').trim();
    const delta = raw === '' ? NaN : Number(raw.replace(',', '.'));
    const original = Number(sample?.listPrice);
    if (!sample || !Number.isFinite(delta)) { example.textContent = ''; return; }
    const changed = String(data.get('mode')) === 'percent'
      ? original * (1 + delta / 100) : original + delta;
    example.textContent = Number.isFinite(changed) && changed >= 0
      ? 'Например: ' + money(original) + ' → ' +
        money(Math.round((changed + Number.EPSILON) * 100) / 100)
      : 'Проверьте изменение цены.';
  };
  form.addEventListener('input', updatePreview);
  form.addEventListener('change', updatePreview);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    const mode = String(data.get('mode') || '');
    const raw = String(data.get('value') || '').trim();
    const value = raw === '' ? NaN : Number(raw.replace(',', '.'));
    const error = form.querySelector('[data-company-batch-error]');
    if (!Number.isFinite(value)) { error.textContent = 'Укажите изменение цены.'; return; }
    const save = form.querySelector('[type="submit"]');
    save.disabled = true;
    try {
      await json('/' + urlId(company.id) + '/catalog/prices', {
        method: 'POST', body: { rowIds: rows.map(row => String(row.id)), mode, value },
      });
      layer.v2Close?.();
      onSaved();
    } catch (cause) {
      error.textContent = errText(cause);
      save.disabled = false;
    }
  });
}

function openSupplierProductEditor(company, row, onSaved = () => {}) {
  const fields = [
    field({ label: 'Наименование поставщика', name: 'name', value: row.name || '', required: true }),
    field({ label: 'Артикул', name: 'supplierSku', value: row.supplierSku || '' }),
    field({ label: 'Штрихкод', name: 'barcode', value: row.barcode || '' }),
    field({ label: 'Производитель', name: 'manufacturer', value: row.manufacturer || '' }),
    field({ label: 'Бренд', name: 'brand', value: row.brand || '' }),
    field({ label: 'Группа поставщика', name: 'category', value: row.category || '' }),
    field({ label: 'Прайсовая цена, ₽', name: 'listPrice',
      value: row.listPrice ?? '', type: 'number', min: '0', step: '0.01' }),
    field({ label: 'РРЦ, ₽', name: 'retailPrice',
      value: row.retailPrice ?? '', type: 'number', min: '0', step: '0.01' }),
    field({ label: 'Скидка по позиции, %', name: 'discountPercent',
      value: row.discountPercent ?? '', type: 'number', min: '0', max: '100',
      step: '0.0001' }),
    field({ label: 'Ед. поставщика', name: 'unit', value: row.unit || '' }),
    field({ label: 'В упаковке', name: 'packageQuantity', value: row.packageQuantity ?? '',
      type: 'number', min: '0.001', step: 'any' }),
    field({ label: 'Примечание поставщика', name: 'supplierNote', value: row.supplierNote || '' }),
  ];
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
function catalogBrandMarkup(categories, selectedCatalogIds, linkedCatalogIds = null, matchedCatalogItems = null, statuses = new Map()) {
  return '<div class="inventory-item-accordion">' +
    [...categories].map(([category, rows]) =>
      category ? catalogDisclosure(category, catalogItemList(rows, selectedCatalogIds, linkedCatalogIds, matchedCatalogItems, statuses), false, rows.length,
        compactCheck({
          checked: rows.length > 0 && rows.every(row => selectedCatalogIds.has(String(row.id))),
          aria: 'Выбрать все позиции категории ' + category,
          data: 'data-company-category-check="' + escapeHtml(category) + '"',
        })) : catalogItemList(rows, selectedCatalogIds, linkedCatalogIds, matchedCatalogItems, statuses),
    ).join('') + '</div>' +
    actionBlock(
      button('Создать карточку', { data: 'data-company-selection-card' }) +
      button('Цены', { data: 'data-company-selection-prices' }) +
      button('Исключить из ассортимента', {
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

async function openCompany(companyId, root, onChanged = () => {}) {
  let companies;
  try { companies = await json(); }
  catch (error) { return openNotice({ title: 'Контрагенты', message: errText(error) }); }
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
      openNotice({ title: 'Исключённые позиции', message: errText(error) });
      return;
    }
    if (!entries.length) {
      openNotice({ title: 'Исключённые позиции', message: 'Исключённых позиций нет.' });
      return;
    }
    const selected = new Set();
    const restoreLayer = mountModal(document.body, modal(
      catalogItemList(entries, selected, linkedCatalogIds, matchedCatalogItems, catalogLinkStatuses) +
        '<p class="form-error" data-company-restore-error role="alert"></p>' +
        actionBlock(button('Восстановить', { data: 'data-company-restore-apply' })),
      { title: 'Исключённые позиции', variant: 'q', surface: 'app' },
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
          brandLayer?.querySelector('[data-company-selection-prices]')?.addEventListener('click', () => {
            const rows = entries.filter(row => selectedCatalogIds.has(String(row.id)));
            if (rows.length) openSupplierBatchPrices(company, rows, () => {
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
              '<p>Исключить ' + ids.length + ' позиций из ассортимента? ' +
              'Их можно вернуть через «Исключённые».</p>' +
              '<p class="form-error" data-company-exclude-error role="alert"></p>' +
              actionBlock(button('Исключить из ассортимента', { variant: 'delete-outline',
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
    // Both sections share the same canonical v2Section heading and spacing.
    host.innerHTML = v2Section('Представитель', counterpartyInformation(company)) +
      v2Section('Ассортимент', '<div data-company-catalog-list></div>');
    void showCatalog();
  };
  layer.querySelector('[data-company-actions]')?.addEventListener('click', () => {
    openSharedProfileSettingsMenu({ title: 'Контрагент', actions: [
      { id: 'edit', label: 'Редактировать', variant: 'primary', onSelect: () =>
        openCompanyEditor(company, () => { void refresh(); onChanged(); }) },
      { id: 'excluded', label: 'Исключённые позиции', onSelect: () =>
        void openExcludedCatalogItems() },
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
  // Existing service-scoped auxiliary API includes appearance templates.
  await loadAuxiliaryState('service').catch(() => {});
  await show();
  window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
  return () => {};
}
