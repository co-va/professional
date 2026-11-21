import { actionBlock, button, list, modal, mountModal, select } from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { apiRequest, getAuthToken } from '../auth.js';
import { getInventoryItem, getInventoryItems } from './data.js';
import { invalidateInventoryNavigationCache, loadInventory } from './service.js';

const urlPart = value => encodeURIComponent(String(value || ''));
const skuKey = value => String(value || '').trim().toLocaleUpperCase('ru-RU');
const unitKey = value => String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/\.$/, '');

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
    // Catalog identity is the exact SKU; missing units never prevent linking.
    const supplierUnit = unitKey(row.unit);
    const stockUnit = unitKey(item.unit);
    const supplierSize = row.packageQuantity == null ? null : Number(row.packageQuantity);
    const unitsPerOffer = supplierUnit && supplierUnit === stockUnit
      && Number.isFinite(supplierSize) && supplierSize > 0 ? supplierSize : null;
    return { itemId, item, row, unitsPerOffer, reason: '' };
  });
}

// One shared compact List row per selected stock item. The original short
// stock name stays primary; the matched supplier's full catalog name stays
// directly underneath in the standard secondary style. Neither is editable
// from this linking action.
function previewMarkup(matches) {
  return list({
    className: 'ui-list--dense',
    items: matches.map(entry => ({
      title: entry.item?.name || 'Позиция',
      secondary: entry.row?.name || 'Не найдено в прайсе поставщика',
    })),
  });
}

export function openInventoryBulkSupplierLink(
  selectedItems = [], onSaved = () => {}, initialCompanyId = '', initialCompanyName = '',
  existingLayer = null,
) {
  const selectedIds = [...new Set(selectedItems.map(item => String(item.itemId || '')).filter(Boolean))];
  if (!selectedIds.length) return null;

  // Choosing one supplier is a short X action. Only the actual per-item
  // matching report needs the full Q work surface.
  if (!initialCompanyId) {
    const chooser = mountModal(document.body, modal(
      '<div class="modal-title"><h2>Привязать поставщика</h2></div>' +
      '<div data-bulk-supplier-select></div>' +
      '<p class="ui-list__secondary">Выбрано позиций: ' + selectedIds.length + '</p>' +
      '<p class="ui-list__secondary" role="status" data-bulk-supplier-status>Загружаю поставщиков…</p>',
      { title: 'Привязать поставщика', variant: 'x', xRole: 'picker', surface: 'app' },
    ));
    if (!chooser) return null;
    const picker = chooser.querySelector('[data-bulk-supplier-select]');
    const status = chooser.querySelector('[data-bulk-supplier-status]');
    const startToken = getAuthToken();
    const usable = () => chooser.isConnected && startToken === getAuthToken();
    void inventoryApi('/counterparties').then(rows => {
      if (!usable()) return;
      const companies = Array.isArray(rows) ? rows.filter(row => row.id && row.name) : [];
      picker.innerHTML = select({
        label: 'Поставщик', name: 'bulkSupplierCompany', value: '',
        options: [{ value: '', label: 'Выберите поставщика' },
          ...companies.map(company => ({ value: String(company.id), label: company.name }))],
        searchable: companies.length > 10,
      });
      picker.querySelector('[name="bulkSupplierCompany"]')?.addEventListener('change', event => {
        if (!usable()) return;
        const companyId = String(event.target.value || '');
        if (!companyId) return;
        const companyName = companies.find(company => String(company.id) === companyId)?.name || '';
        chooser.v2Close?.();
        openInventoryBulkSupplierLink(selectedItems, onSaved, companyId, companyName, existingLayer);
      });
      status.textContent = companies.length ? '' : 'Сначала добавьте поставщика с прайсом.';
    }).catch(error => {
      if (usable()) status.textContent = error instanceof Error
        ? error.message : 'Не удалось загрузить поставщиков.';
    });
    return chooser;
  }

  const markup = (initialCompanyName
    ? '<p class="ui-list__secondary">' + escapeHtml(initialCompanyName) + '</p>'
    : '') +
    '<p class="ui-list__secondary" role="status" data-bulk-supplier-status></p>' +
    '<div data-bulk-supplier-list></div>' +
    actionBlock(button('Применить', { data: 'data-bulk-supplier-apply' }));
  const layer = existingLayer?.isConnected ? existingLayer
    : mountModal(document.body, modal(markup, {
      title: 'Привязать поставщика', variant: 'q', surface: 'app',
    }));
  if (!layer) return null;
  if (existingLayer) {
    const body = layer.querySelector('[data-v2-q-body]');
    if (!body) return null;
    body.innerHTML = markup;
  }
  const status = layer.querySelector('[data-bulk-supplier-status]');
  const list = layer.querySelector('[data-bulk-supplier-list]');
  const apply = layer.querySelector('[data-bulk-supplier-apply]');
  // Never make the confirmation disappear. No SKU matches means a visible
  // but disabled action and an explicit reason, not an empty modal footer.
  const showApply = enabled => {
    if (apply) apply.disabled = !enabled;
  };
  const startToken = getAuthToken();
  const selectedCompany = String(initialCompanyId);
  let preview = [];
  let requestVersion = 0;
  let saving = false;
  showApply(false);
  // A parent Q can be reused for a new action while requests are pending.
  // Ignore stale preview/save callbacks after this report leaves its body.
  const usable = () => layer.isConnected && list.isConnected
    && startToken === getAuthToken();

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
      const found = preview.filter(entry => entry.row);
      list.innerHTML = previewMarkup(preview);
      status.textContent = 'Совпало: ' + found.length + ' из ' + preview.length;
      showApply(Boolean(found.length));
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
            'POST', { itemId: entry.itemId,
              ...(entry.unitsPerOffer == null ? {} : { unitsPerOffer: entry.unitsPerOffer }) }, 45000);
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
        + '. Без совпадений: ' + preview.filter(entry => !entry.row).length + '.';
      if (succeeded) onSaved();
      // Keep the report visible and avoid treating partial saves as complete.
      showApply(false);
    } catch (error) {
      status.textContent = 'Сохранение не подтверждено: ' +
        (error instanceof Error ? error.message : 'Сервер не ответил') +
        '. Проверьте склад перед повтором.';
    } finally {
      saving = false;
      // Once a save was attempted, require a fresh preview before any retry.
      apply.disabled = true;
      apply.textContent = 'Применить';
    }
  });

  void loadPreview();
  return layer;
}
