import {
  actionBlock, button, emptyState, field, modal, mountModal, openNotice,
  page, select, v2ListEntries, v2ListEntry, v2Section, workspaceHeaderContext,
} from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { apiRequest } from '../auth.js';
import { getInventoryItems } from './data.js';
import { loadInventory } from './service.js';

const PATH = '/inventory/counterparties';
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
            subtitle: [row.supplierSku && 'Арт. ' + row.supplierSku, row.manufacturer].filter(Boolean).join(' · '),
            rightTop: money(row.actualPrice ?? row.listPrice),
            rightBottom: row.unit || '',
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
        actionBlock((offset ? button('Назад', { data: 'data-catalog-prev', variant: 'secondary' }) : '') +
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
    <p>Прайс: ${money(row.listPrice)}</p>
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

function openImport(company, onSaved) {
  const layer = mountModal(document.body, modal(`
    <p>Загрузите полный прайс. Товары не добавятся в склад автоматически.</p>
    <input type="file" accept=".xlsx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-counterparty-file>
    <div data-counterparty-preview></div>
    <p class="form-error" data-counterparty-import-error role="alert"></p>
    ${actionBlock(button('Сохранить прайс', { data: 'data-counterparty-import-save', disabled: true }))}
    `, { title: 'Загрузка прайса', variant: 'q', surface: 'app' }));
  if (!layer) return;
  const input = layer.querySelector('[data-counterparty-file]');
  const preview = layer.querySelector('[data-counterparty-preview]');
  const errorHost = layer.querySelector('[data-counterparty-import-error]');
  const save = layer.querySelector('[data-counterparty-import-save]');
  let file = null, result = null;
  input.addEventListener('change', async () => {
    file = input.files?.[0] || null; result = null; save.disabled = true;
    if (!file) return;
    preview.innerHTML = 'Читаем прайс…';
    try {
      result = await upload(company.id, '/pricelists/preview', file);
      if (!layer.isConnected) return;
      const rows = result.sample || [];
      preview.innerHTML = `<p>${escapeHtml(file.name)} · ${result.count} поз.</p>` +
        (result.status === 'READY' ? '<p>Проверьте названия и цены перед сохранением.</p>' :
          '<p>Автоматически распознать весь прайс нельзя. Оригинал сохранится, а для переноса товаров используйте шаблон Excel.</p>') +
        (result.errors || []).map(value => '<p>' + escapeHtml(value) + '</p>').join('') +
        (rows.length ? v2ListEntries(rows.map(row => v2ListEntry({
          title: row.name, subtitle: row.supplierSku || '', rightTop: money(row.actualPrice ?? row.listPrice),
          interactive: false,
        }))) : '');
      save.disabled = false;
      save.textContent = result.status === 'READY' ? 'Сохранить прайс' : 'Сохранить оригинал';
      errorHost.textContent = '';
    } catch (cause) {
      preview.innerHTML = '';
      errorHost.textContent = errText(cause);
    }
  });
  save.addEventListener('click', async () => {
    if (!file || !result) return;
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
}

async function openCompany(companyId, onChanged = () => {}) {
  let companies;
  try { companies = await json(); }
  catch (cause) { return openNotice({ title: 'Контрагенты', message: errText(cause) }); }
  const layer = mountModal(document.body, modal('<div data-counterparty-detail></div>', {
    title: 'Контрагент', variant: 'q', surface: 'app',
  }));
  if (!layer) return;
  const refresh = async () => {
    try { companies = await json(); }
    catch (cause) { return openNotice({ title: 'Контрагент', message: errText(cause) }); }
    const company = companies.find(value => value.id === companyId);
    if (!company) { layer.v2Close?.(); onChanged(); return; }
    const host = layer.querySelector('[data-counterparty-detail]');
    if (!host) return;
    host.innerHTML = `<p><strong>${escapeHtml(company.name)}</strong> · ${kindLabel(company.kind)}</p>
      ${[company.contactName,company.phone,company.email,company.website].filter(Boolean).map(value => '<p>' + escapeHtml(value) + '</p>').join('')}
      ${actionBlock(button('Редактировать', { variant: 'secondary', data: 'data-company-edit' }) +
        button('Загрузить прайс', { data: 'data-company-upload' }) +
        button('Шаблон Excel', { variant: 'secondary', data: 'data-company-template' }))}
      ${v2Section('Прайс-листы', company.priceLists?.length
        ? v2ListEntries(company.priceLists.map(list => v2ListEntry({
          title: list.filename,
          subtitle: 'Версия ' + list.revision + ' · ' + new Date(list.createdAt).toLocaleDateString('ru-RU'),
          rightTop: list.parserStatus === 'READY' ? 'Товаров: ' + list._count.rows : 'Нужен шаблон',
          interactive: true, initial: '',
          data: 'data-company-pricelist="' + escapeHtml(list.id) + '"',
          aria: 'Скачать оригинал прайса',
        })))
        : emptyState('Нет прайсов', 'Загрузите Excel или PDF целиком.'))}
      ${actionBlock(button('Каталог товаров', { data: 'data-company-catalog', variant: 'secondary' }))}`;
    host.querySelector('[data-company-edit]')?.addEventListener('click', () => openCompanyEditor(company, () => {
      void refresh(); onChanged();
    }));
    host.querySelector('[data-company-upload]')?.addEventListener('click', () => openImport(company, () => {
      void refresh(); onChanged();
    }));
    host.querySelector('[data-company-template]')?.addEventListener('click', () => {
      void download('/template/xlsx', 'price-list-template.xlsx').catch(err =>
        openNotice({ title: 'Excel', message: errText(err) }));
    });
    host.querySelector('[data-company-catalog]')?.addEventListener('click', () => { void openCatalog(company); });
    host.querySelectorAll('[data-company-pricelist]').forEach(node => node.addEventListener('click', () => {
      const list = company.priceLists.find(value => value.id === node.dataset.companyPricelist);
      if (!list) return;
      void download('/' + urlId(company.id) + '/pricelists/' + urlId(list.id) + '/download',
        'prais-' + list.revision + '.' + list.format).catch(err =>
        openNotice({ title: 'Прайс', message: errText(err) }));
    }));
  };
  void refresh();
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
export async function renderCounterparties(root) {
  root.innerHTML = page([
    workspaceHeaderContext({
      title: 'Контрагенты',
      c: { label: '+', data: 'data-counterparty-add', aria: 'Новый контрагент' },
    }),
    '<div data-counterparties-list></div>',
  ]);
  const host = root.querySelector('[data-counterparties-list]');
  const show = async () => {
    host.innerHTML = emptyState('Контрагенты', 'Загружаем…');
    try {
      const companies = await json();
      if (!root.isConnected) return;
      host.innerHTML = companies.length
        ? v2ListEntries(companies.map(company => v2ListEntry({
          title: company.name, subtitle: kindLabel(company.kind),
          rightTop: company.priceLists?.length ? String(company.priceLists.length) + ' прайс.' : '',
          interactive: true, initial: '',
          data: 'data-counterparty-open="' + escapeHtml(company.id) + '"',
          aria: 'Открыть контрагента ' + company.name,
        })))
        : emptyState('Контрагентов пока нет', 'Нажмите +, чтобы создать компанию.');
      host.querySelectorAll('[data-counterparty-open]').forEach(node => {
        node.addEventListener('click', () => { void openCompany(node.dataset.counterpartyOpen, show); });
      });
    } catch (cause) { host.innerHTML = emptyState('Контрагенты недоступны', errText(cause)); }
  };
  root.querySelector('[data-counterparty-add]')?.addEventListener('click', () => openCompanyEditor(null, () => { void show(); }));
  await show();
  window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
  return () => {};
}
