import {
  actionBlock, button, emptyState, field, modal, mountModal, openNotice,
  page, select, list, v2ListEntries, v2ListEntry, v2Section, workspaceHeaderContext,
  mountV2ZLayer, v2ZLayer, openSharedProfileSettingsMenu,
  entityVisualCard, entityCardStack, openEntityCardAppearanceQ,
} from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
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

function catalogItemList(items = []) {
  // Same compact Core UI List used in saved purchase orders.
  return list({
    className: 'ui-list--dense',
    items: items.map(item => ({
      title: item.name,
      secondary: item.supplierSku ? 'Арт. ' + item.supplierSku : '',
      right: item.listPrice == null ? [] : [money(item.listPrice)],
      interactive: true,
      data: 'data-company-product="' + escapeHtml(item.id) + '"',
      aria: 'Открыть позицию ' + item.name,
    })),
  });
}

function catalogDisclosure(title, content, nested = false) {
  // Same native disclosure as Stock's inventory-editor-panel and Orders.
  // The built-in <summary> marker is the existing black triangle.
  return '<section class="inventory-editor-panel' + (nested ? ' inventory-editor-panel--nested' : '') + '">' +
    '<details><summary class="inventory-editor-summary">' + escapeHtml(title) + '</summary>' +
    '<div class="inventory-editor-panel__body">' + content + '</div></details></section>';
}

function catalogGroupsMarkup(items = []) {
  const brands = new Map();
  for (const item of items) {
    const brand = String(item.brand || item.manufacturer || '').trim() || 'Без компании';
    const category = String(item.category || '').trim();
    if (!brands.has(brand)) brands.set(brand, new Map());
    const categories = brands.get(brand);
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(item);
  }
  return '<div class="inventory-item-accordion">' + [...brands].map(([brand, categories]) =>
    catalogDisclosure(brand, [...categories].map(([category, rows]) =>
      category
        ? catalogDisclosure(category, catalogItemList(rows), true)
        : catalogItemList(rows),
    ).join('')),
  ).join('') + '</div>';
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
      list.innerHTML = entries.length
        ? catalogGroupsMarkup(entries)
        : emptyState('Ассортимент не загружен');
      if (!entries.length) return;
      const byId = new Map(entries.map(row => [row.id, row]));
      list.querySelectorAll('[data-company-product]').forEach(node => {
        node.addEventListener('click', () => {
          const row = byId.get(node.dataset.companyProduct);
          if (row) void openCatalogRow(company, row);
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
