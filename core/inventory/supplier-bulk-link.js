import { actionBlock, button, modal, mountModal, select } from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { apiRequest, getAuthToken } from '../auth.js';
import { getInventoryItem, getInventoryItems } from './data.js';
import { invalidateInventoryNavigationCache, loadInventory } from './service.js';

const urlPart = value => encodeURIComponent(String(value || ''));
const skuKey = value => String(value || '').trim().toLocaleUpperCase('ru-RU');
const unitKey = value => String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/\.$/, '');
const money = value => value == null ? '—' : Number(value).toLocaleString('ru-RU', {
  maximumFractionDigits: 2,
}) + ' ₽';

async function inventoryApi(path, method = 'GET', body = null, timeoutMs = 30000) {
  const response = await apiRequest('/inventory' + path, {
    method, timeoutMs,
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = Array.isArray(result?.message) ? result.message.join('; ')
      : typeof result?.message === 'string' ? result.message : '';
    throw new Error(reason || 'Не удалось связать товар (HTTP ' + response.status + ')');
  }
  return result;
}

// Exact SKU only: both the supplier row and the Stock item must be unique.
// A possible match is never treated as an existing persisted supplier link.
export function matchSupplierCatalog(stockItems = [], catalogRows = [], selectedIds = [], companyId = '') {
  const stockBySku = new Map();
  const rowsBySku = new Map();
  const rowOwners = new Map();
  for (const item of stockItems) {
    const sku = skuKey(item.sku);
    if (sku) stockBySku.set(sku, (stockBySku.get(sku) || 0) + 1);
    for (const offer of Array.isArray(item.supplierOffers) ? item.supplierOffers : []) {
      if (String(offer.counterpartyId || '') !== String(companyId) || !offer.catalogItemId) continue;
      const key = String(offer.catalogItemId);
      if (!rowOwners.has(key)) rowOwners.set(key, new Set());
      rowOwners.get(key).add(String(item.itemId));
    }
  }
  for (const row of catalogRows) {
    const sku = skuKey(row.supplierSku);
    if (sku) {
      const list = rowsBySku.get(sku) || [];
      list.push(row);
      rowsBySku.set(sku, list);
    }
  }
  const stockById = new Map(stockItems.map(item => [String(item.itemId), item]));
  return [...new Set(selectedIds.map(String))].map(itemId => {
    const item = stockById.get(itemId);
    const no = reason => ({ itemId, item, row: null, reason });
    if (!item) return no('Товар не найден');
    const sku = skuKey(item.sku);
    if (!sku) return no('Нет артикула');
    if (stockBySku.get(sku) !== 1) return no('Артикул повторяется на складе');
    const candidates = rowsBySku.get(sku) || [];
    if (!candidates.length) return no('Нет артикула в прайсе');
    if (candidates.length !== 1) return no('Артикул повторяется у поставщика');
    const row = candidates[0];
    const owners = rowOwners.get(String(row.id));
    if (owners && (owners.size !== 1 || !owners.has(itemId)))
      return no('Уже связан с другим товаром');
    const supplierUnit = unitKey(row.unit);
    const stockUnit = unitKey(item.unit);
    if (supplierUnit && stockUnit && supplierUnit !== stockUnit)
      return no('Единицы товара различаются — проверьте вручную');
    // Core needs the number of inventory units represented by one supplier offer.
    // Never guess a conversion between different units.
    const unitsPerOffer = Number(row.packageQuantity) > 0 ? Number(row.packageQuantity)
      : Number(item.packageQuantity) > 0 ? Number(item.packageQuantity)
      : stockUnit === 'шт' ? 1 : null;
    if (!(unitsPerOffer > 0)) return no('Не указано количество в упаковке');
    return { itemId, item, row, unitsPerOffer, reason: '' };
  });
}

function rowMarkup(entry) {
  const name = escapeHtml(entry.item?.name || 'Товар');
  const sku = escapeHtml(entry.item?.sku || '—');
  const description = entry.row
    ? escapeHtml(entry.row.name) + ' · ' + money(entry.row.listPrice)
      + ' · ' + (Number(entry.row.appliedDiscountPercent ?? entry.row.discountPercent ?? 0))
        .toLocaleString('ru-RU') + '% · ' + money(entry.row.effectivePrice)
    : escapeHtml(entry.reason);
  return '<div class="data-edit-row inventory-audit-data-row">' +
    '<span class="data-edit-row__name"><strong>' + name + '</strong><small>Арт. ' + sku + '</small></span>' +
    '<span class="ui-list__secondary">' + description + '</span></div>';
}

export function openInventoryBulkSupplierLink(selectedItems = [], onSaved = () => {}) {
  const selectedIds = [...new Set(selectedItems.map(item => String(item.itemId || '')).filter(Boolean))];
  if (!selectedIds.length) return null;
  const layer = mountModal(document.body, modal(
    '<div data-bulk-supplier-select></div>' +
    '<p class="ui-list__secondary">Совпадения определяются только по уникальному артикулу. Короткое название товара не меняется.</p>' +
    '<p class="form-error" role="status" data-bulk-supplier-status></p>' +
    '<div data-bulk-supplier-list class="inventory-audit-data-list"></div>' +
    actionBlock(button('Применить', { data: 'data-bulk-supplier-apply' })),
    { title: 'Привязать поставщика', variant: 'q', surface: 'app' },
  ));
  if (!layer) return null;
  const picker = layer.querySelector('[data-bulk-supplier-select]');
  const status = layer.querySelector('[data-bulk-supplier-status]');
  const list = layer.querySelector('[data-bulk-supplier-list]');
  const apply = layer.querySelector('[data-bulk-supplier-apply]');
  const actions = apply?.closest('.modal-actions');
  const showApply = visible => {
    if (actions) actions.hidden = !visible;
    if (apply) apply.hidden = !visible;
  };
  const startToken = getAuthToken();
  let companies = [];
  let selectedCompany = '';
  let preview = [];
  let requestVersion = 0;
  let saving = false;
  showApply(false);
  const usable = () => layer.isConnected && startToken === getAuthToken();

  const showCompanySelector = () => {
    picker.innerHTML = select({
      label: 'Поставщик', name: 'bulkSupplierCompany', value: selectedCompany,
      options: [{ value: '', label: 'Выберите поставщика' },
        ...companies.map(company => ({ value: String(company.id), label: company.name }))],
      searchable: true,
    });
    picker.querySelector('[name="bulkSupplierCompany"]')?.addEventListener('change', event => {
      if (saving) return;
      selectedCompany = String(event.target.value || '');
      void loadPreview();
    });
  };
  const loadPreview = async () => {
    const version = ++requestVersion;
    preview = [];
    showApply(false);
    list.innerHTML = '';
    if (!selectedCompany) {
      status.textContent = '';
      return;
    }
    status.textContent = 'Сопоставляю артикулы…';
    try {
      // A fresh Stock read includes confirmed links, prevents stale duplicates.
      await loadInventory();
      const base = '/counterparties/' + urlPart(selectedCompany) + '/catalog?take=500&skip=';
      const first = await inventoryApi(base + '0');
      const catalog = [...(Array.isArray(first.items) ? first.items : [])];
      const count = Math.max(0, Number(first.count) || 0);
      const step = Math.max(1, Number(first.pageSize) || 500);
      for (let offset = step; offset < count; offset += step * 3) {
        const pages = [];
        for (let at = offset; at < Math.min(count, offset + step * 3); at += step)
          pages.push(inventoryApi(base + at));
        const results = await Promise.all(pages);
        if (!usable() || version !== requestVersion) return;
        results.forEach(page => catalog.push(...(Array.isArray(page.items) ? page.items : [])));
      }
      if (!usable() || version !== requestVersion) return;
      preview = matchSupplierCatalog(getInventoryItems(), catalog, selectedIds, selectedCompany);
      const matches = preview.filter(entry => entry.row);
      list.innerHTML = preview.map(rowMarkup).join('');
      status.textContent = 'Найдено: ' + matches.length + ' из ' + preview.length
        + '. Не найденные и спорные товары не изменяются.';
      showApply(Boolean(matches.length));
      apply.disabled = !matches.length;
    } catch (error) {
      if (!usable() || version !== requestVersion) return;
      status.textContent = error instanceof Error ? error.message : 'Не удалось загрузить прайс.';
    }
  };

  apply.addEventListener('click', async () => {
    if (saving || !usable() || !selectedCompany) return;
    const matches = preview.filter(entry => entry.row);
    if (!matches.length) return;
    saving = true;
    apply.disabled = true;
    picker.querySelector('[name="bulkSupplierCompany"]')?.setAttribute('disabled', '');
    const failures = [];
    const company = selectedCompany;
    // Existing Core routes own supplier links, pricing and primary-offer logic.
    // Perform no blind item-name edits and never touch unrelated products.
    try {
      for (const [index, entry] of matches.entries()) {
        if (!usable()) { failures.push('Сменился аккаунт. Операция остановлена.'); break; }
        const progress = 'Применение · ' + (index + 1) + ' из ' + matches.length;
        apply.textContent = progress;
        status.textContent = progress + ' · ' + entry.item.name;
        const itemPath = '/items/' + urlPart(entry.itemId);
        try {
          const linkedOffer = await inventoryApi(
            '/counterparties/' + urlPart(company) + '/catalog/' + urlPart(entry.row.id) + '/link',
            'POST', { itemId: entry.itemId, unitsPerOffer: entry.unitsPerOffer }, 45000);
          const offerId = String(linkedOffer.offerId || '');
          if (!offerId || String(linkedOffer.itemId || '') !== entry.itemId)
            throw new Error('Сервер не подтвердил связь');
          // The supplier becomes the primary pricing source so its price and
          // discount actually appear in the stock card.
          if (String(getInventoryItem(entry.itemId)?.primaryOfferId || '') !== offerId)
            await inventoryApi(itemPath + '/primary-offer', 'PUT', { offerId }, 60000);
          // Supplier's FULL product name has its own column; do not overwrite
          // the short warehouse name or modify SKU, stock or classification.
          if (String(getInventoryItem(entry.itemId)?.catalogName || '') !== String(entry.row.name || ''))
            await inventoryApi(itemPath, 'PUT', { catalogName: entry.row.name }, 60000);
        } catch (error) {
          failures.push(entry.item.name + ': ' + (error instanceof Error
            ? error.message : 'Не удалось сохранить'));
          if (error?.name === 'AbortError') {
            failures.push('Сервер не ответил вовремя. Проверьте результат перед повтором.');
            break;
          }
        }
      }
      invalidateInventoryNavigationCache();
      await loadInventory();
      const confirmed = matches.filter(entry => {
        const item = getInventoryItem(entry.itemId);
        const offer = item?.supplierOffers?.find(value =>
          String(value.counterpartyId || '') === company
          && String(value.catalogItemId || '') === String(entry.row.id));
        return Boolean(offer && item.primaryOfferId === offer.offerId
          && item.catalogName === entry.row.name);
      });
      const succeeded = confirmed.length;
      status.textContent = 'Подтверждено: ' + succeeded + ' из ' + matches.length
        + (failures.length ? '. Ошибки: ' + failures.slice(0, 2).join('; ') : '')
        + '. Без совпадений: ' + (preview.length - matches.length) + '.';
      if (succeeded) onSaved();
      // Keep the report visible and avoid treating partial saves as complete.
      showApply(false);
    } catch (error) {
      status.textContent = 'Сохранение не подтверждено: ' +
        (error instanceof Error ? error.message : 'Сервер не ответил') +
        '. Проверьте склад перед повтором.';
    } finally {
      saving = false;
      apply.disabled = false;
      apply.textContent = 'Применить';
      picker.querySelector('[name="bulkSupplierCompany"]')?.removeAttribute('disabled');
    }
  });

  status.textContent = 'Загружаю поставщиков…';
  void inventoryApi('/counterparties').then(rows => {
    if (!usable()) return;
    companies = Array.isArray(rows) ? rows.filter(row => row.id && row.name) : [];
    showCompanySelector();
    status.textContent = companies.length ? '' : 'Сначала добавьте поставщика с прайсом.';
  }).catch(error => {
    if (usable()) status.textContent = error instanceof Error
      ? error.message : 'Не удалось загрузить поставщиков.';
  });
  return layer;
}
