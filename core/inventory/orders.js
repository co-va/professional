import {
  actionBlock, button, datePicker, emptyState, field, initDatePickers,
  modal, mountModal, mountV2ZLayer, openNotice, openSharedProfileSettingsMenu,
  select, setV2ZHeaderRows, v2ListEntries, v2ListEntry, v2ZLayer,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import { compactCheck } from '../../ui/selection/check-list.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import {
  getInventoryItem, getInventoryItems, getInventoryOrder, getInventoryOrders,
  inventoryOrderSuggestions,
} from './data.js';
import {
  createInventoryPurchaseOrder, updateInventoryPurchaseOrder,
  deleteInventoryPurchaseOrder, payInventoryPurchaseOrder,
  receiveInventoryPurchaseOrder,
} from './service.js';
import { loadWalletCatalog } from '../runtime/auxiliary-state.js';

// Only existing SHAD UI: shared Q, Z2, header, form fields, V and V2 list.
const amount = n => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replaceAll('\u00a0', ' ');
const rubles = n => `${amount(n)} ₽`;
const manufacturer = row => String(row.manufacturer || '').trim() || 'Без производителя';
const searchText = row => [row.name, manufacturer(row), row.sku, row.barcode, row.productType, row.category].join(' ').toLocaleLowerCase('ru-RU');
const packSize = row => {
  const size = Number(row.packageSize ?? row.packageQuantity);
  return Number.isFinite(size) && size > 0 ? size : 1;
};
const isTube = row => ['г', 'гр', 'гр.', 'грамм', 'граммы'].includes(String(row.unit || '').toLocaleLowerCase('ru-RU'));
const packageLabel = row => isTube(row) ? 'тюб.' : 'шт.';
const ORDER_MODES = [
  { value: 'target', label: 'К заказу' },
  { value: 'minimum', label: 'Минимум' },
  { value: 'all', label: 'Весь каталог' },
];
// Match Stocktake's numbered title and actual balance, not the recommendation.
const orderItemLabel = item => {
  const number = Number(item.position);
  const prefix = Number.isSafeInteger(number) && number > 0 ? `№ ${number}` : 'Без №';
  return `${prefix} · ${item.name}`;
};
const stockQuantity = value => (Number(value) || 0).toLocaleString('ru-RU', {
  maximumFractionDigits: 3,
}).replaceAll('\u00a0', ' ');
const orderItemBalance = item => isTube(item)
  ? `${item.containerCount == null ? '— тюб.' : `${stockQuantity(item.containerCount)} тюб.`} · ${stockQuantity(item.balance)} ${item.unit}`
  : `${stockQuantity(item.balance)} ${item.unit}`;
const dateLabel = value => value ? new Date(value).toLocaleDateString('ru-RU') : '';
const statusLabel = status => ({ formed: 'Сформирован', paid: 'Оплачен', received: 'Получен' }[status] || status);
const headSearch = data => `<div class="ui-search-field">${field({
  name: 'inventoryOrderSearch', type: 'search', autocomplete: 'off',
  placeholder: 'Название, производитель, артикул…', data,
})}</div>`;

function sortedItems(items, mode = 'position') {
  return [...items].sort((a, b) => {
    const aCompany = manufacturer(a), bCompany = manufacturer(b);
    const company = aCompany.localeCompare(bCompany, 'ru', { numeric: true });
    if (company) return company;
    if (mode === 'name') return String(a.name).localeCompare(String(b.name), 'ru', { numeric: true });
    if (mode === 'quantity') return Number(b.packages || b.suggestedQuantity || 0) - Number(a.packages || a.suggestedQuantity || 0);
    const rank = row => Number(row.position) > 0 ? Number(row.position) : Number.MAX_SAFE_INTEGER;
    return rank(a) - rank(b)
      || String(a.name).localeCompare(String(b.name), 'ru', { numeric: true });
  });
}

function orderListMarkup(root) {
  const status = String(root.dataset.inventoryOrdersStatus || '');
  const supplier = String(root.dataset.inventoryOrdersSupplier || '');
  const sorting = String(root.dataset.inventoryOrdersSort || 'recent');
  const orders = getInventoryOrders().filter(order =>
    (!status || order.status === status) && (!supplier || order.supplier === supplier));
  if (!orders.length) return emptyState(
    getInventoryOrders().length ? 'Заказы не найдены' : 'Заказов пока нет',
    getInventoryOrders().length ? 'Измените фильтр.' : 'Нажмите +, чтобы сформировать заказ.',
  );
  if (sorting === 'oldest') orders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  else if (sorting === 'price') orders.sort((a, b) => Number(b.total) - Number(a.total));
  else orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return v2ListEntries(orders.map(order => v2ListEntry({
    title: order.supplier || 'Закупочный заказ',
    subtitle: `${dateLabel(order.createdAt)} · ${(order.lines || []).length} поз.`,
    rightTop: statusLabel(order.status),
    rightBottom: rubles(order.total),
    interactive: true,
    data: `data-inventory-order="${escapeHtml(order.orderId)}"`,
    aria: 'Открыть заказ',
    initial: '',
  })));
}

function refreshOrderList(root) {
  const host = root.querySelector('[data-inventory-orders-list]');
  if (!host) return;
  host.innerHTML = orderListMarkup(root);
  host.querySelectorAll('[data-inventory-order]').forEach(node => {
    node.addEventListener('click', () => openInventoryOrderZ(root, node.dataset.inventoryOrder));
  });
}

function suggestedPacks(row) {
  const needed = Math.max(0, Number(row.suggestedQuantity) || 0);
  return Math.max(1, Math.ceil(needed / packSize(row)));
}

// Q1 owns selection criteria; Q2 owns the ready-to-fill order. The second Q
// uses the same shared compactCheck and included/excluded row pattern as
// Stocktake. A purchase order is persisted only on the Q2 confirmation.
function initialOrderLines(catalog, recommendations, manufacturerFilter = '', existing = null) {
  const suggestionById = new Map(recommendations.map(row => [row.itemId, row]));
  const selected = new Map();
  if (existing) {
    for (const line of existing.lines || []) {
      selected.set(line.itemId, Number(line.packages) || 1);
    }
  } else {
    for (const item of catalog) {
      const suggestion = suggestionById.get(item.itemId);
      if (suggestion && (!manufacturerFilter || manufacturer(item) === manufacturerFilter)) {
        selected.set(item.itemId, suggestedPacks(suggestion));
      }
    }
  }
  return { suggestionById, selected };
}

function openInventoryOrderReview(root, { mode = 'target', supplier = '', manufacturerFilter = '', sorting = 'position' } = {}, existing = null, onSaved = () => {}) {
  const catalog = getInventoryItems();
  let currentMode = mode;
  const recommendations = currentMode === 'all' ? [] : inventoryOrderSuggestions(currentMode);
  const { suggestionById, selected } = initialOrderLines(catalog, recommendations, manufacturerFilter, existing);
  const manuallyChanged = new Set((existing?.lines || []).map(line => line.itemId));
  const rows = sortedItems(catalog.map(item => ({
    ...item,
    suggestedQuantity: suggestionById.get(item.itemId)?.suggestedQuantity || 0,
    urgency: suggestionById.get(item.itemId)?.urgency || '',
  })), sorting);
  const indexByItem = new Map(rows.map((item, index) => [item.itemId, index]));
  const existingByItem = new Map((existing?.lines || []).map(line => [line.itemId, line]));
  const rowMarkup = (item, index) => {
    const included = selected.has(item.itemId);
    const quantity = selected.get(item.itemId) || (item.suggestedQuantity > 0 ? suggestedPacks(item) : 1);
    const label = orderItemLabel(item);
    // The shared data-edit-row already places a compact numeric field beside
    // the product, not under a separate full-width input.
    const quantityField = field({
      label: '', placeholder: '', name: 'orderPackages-' + index,
      type: 'number', min: '1', step: '1', inputmode: 'numeric',
      value: String(quantity), disabled: !included,
    }).replace('<label class="field">',
      '<label class="field" data-inventory-order-fields' + (included ? '' : ' hidden') + '>');
    return '<section data-inventory-order-row="' + index + '">' +
      '<div class="data-edit-row">' +
        '<div class="field-inline-label">' +
          compactCheck({
            label: '', checked: included, data: 'data-inventory-order-include="' + index + '"',
            aria: 'Включить в заказ ' + label,
          }) +
          '<span class="data-edit-row__name">' +
            '<strong title="' + escapeHtml(label) + '">' + escapeHtml(label) + '</strong>' +
            '<small data-inventory-order-balance>' + escapeHtml(orderItemBalance(item)) + '</small>' +
          '</span>' +
        '</div>' +
        quantityField +
      '</div>' +
      '</section>';
  };
  const includedRows = rows.map((item, index) => selected.has(item.itemId) ? rowMarkup(item, index) : '').join('');
  const excludedRows = rows.map((item, index) => !selected.has(item.itemId) ? rowMarkup(item, index) : '').join('');
  const markup = '<div class="form-grid" data-inventory-order-review>' +
    '<p data-inventory-order-selection-count></p>' +
    '<p data-inventory-order-empty' + (selected.size ? ' hidden' : '') + '>Позиций нет. Добавьте из каталога.</p>' +
    '<details data-inventory-order-excluded' + (currentMode === 'all' ? ' open' : '') + '>' +
      '<summary data-inventory-order-excluded-count></summary>' +
      headSearch('data-inventory-order-catalog-search') +
      '<div data-inventory-order-excluded-list>' + excludedRows + '</div>' +
    '</details>' +
    '<div data-inventory-order-active>' + includedRows + '</div>' +
    '<p class="form-error" role="status" data-inventory-order-selection-error></p>' +
    actionBlock(button(existing ? 'Сохранить заказ' : 'Сформировать', {
      data: 'data-inventory-order-create',
    })) +
    '</div>';
  const layer = mountModal(root, modal(markup, { variant: 'q' }));
  if (!layer) return null;
  // Q header owns one existing shared Select: switch category in place,
  // without closing or reopening Q2 or discarding typed quantities.
  const header = layer.querySelector('[data-v2-q-header-content]');
  if (header) header.innerHTML = select({
    label: '', name: 'orderReviewMode', value: currentMode, options: ORDER_MODES,
  });
  const activeList = layer.querySelector('[data-inventory-order-active]');
  const excludedList = layer.querySelector('[data-inventory-order-excluded-list]');
  const excludedGroup = layer.querySelector('[data-inventory-order-excluded]');
  const excludedCount = layer.querySelector('[data-inventory-order-excluded-count]');
  const includedCount = layer.querySelector('[data-inventory-order-selection-count]');
  const empty = layer.querySelector('[data-inventory-order-empty]');
  const search = layer.querySelector('[data-inventory-order-catalog-search]');
  const submit = layer.querySelector('[data-inventory-order-create]');
  const errorHost = layer.querySelector('[data-inventory-order-selection-error]');
  let saving = false;

  // Moving existing nodes preserves any edited quantities and iOS focus.
  // No local row renderer, UI toolkit copy, or extra selection dialog.
  const sync = () => {
    const total = selected.size;
    includedCount.textContent = 'В заказе: ' + total;
    excludedCount.textContent = 'Исключено: ' + (rows.length - total);
    empty.hidden = total !== 0;
    submit.disabled = saving || total === 0;
  };
  const updateSearch = () => {
    const term = String(search?.value || '').trim().toLocaleLowerCase('ru-RU');
    for (const node of excludedList.children) {
      const item = rows[Number(node.dataset.inventoryOrderRow)];
      node.hidden = !!term && (!item || !searchText(item).includes(term));
    }
  };
  const keepOrder = (list) => {
    for (const node of [...list.children].sort((a, b) =>
      Number(a.dataset.inventoryOrderRow) - Number(b.dataset.inventoryOrderRow))) {
      list.append(node);
    }
  };
  layer.querySelector('[data-inventory-order-review]')?.addEventListener('change', event => {
    const check = event.target.closest?.('[data-inventory-order-include]');
    if (!check || saving) return;
    const index = Number(check.dataset.inventoryOrderInclude);
    const item = rows[index];
    const node = layer.querySelector('[data-inventory-order-row="' + index + '"]');
    if (!item || !node) return;
    const quantity = node.querySelector('[name="orderPackages-' + index + '"]');
    if (check.checked) {
      selected.set(item.itemId, Number(quantity?.value) || 1);
    } else {
      selected.delete(item.itemId);
    }
    const fields = node.querySelector('[data-inventory-order-fields]');
    if (fields) {
      fields.hidden = !check.checked;
      fields.querySelectorAll('input').forEach(input => { input.disabled = !check.checked; });
    }
    manuallyChanged.add(item.itemId);
    const destination = check.checked ? activeList : excludedList;
    destination.append(node);
    keepOrder(destination);
    if (check.checked) {
      node.hidden = false;
    } else {
      updateSearch();
    }
    if (!excludedList.children.length) excludedGroup.open = false;
    sync();
  });
  // A changed number belongs to this selected line and survives mode switches.
  layer.querySelector('[data-inventory-order-review]')?.addEventListener('input', event => {
    const match = /^orderPackages-(\\d+)$/.exec(String(event.target?.name || ''));
    if (match && rows[Number(match[1])]) manuallyChanged.add(rows[Number(match[1])].itemId);
  });
  layer.querySelector('[name="orderReviewMode"]')?.addEventListener('change', event => {
    if (saving) return;
    const requested = String(event.target.value || 'target');
    if (!ORDER_MODES.some(option => option.value === requested)) return;
    currentMode = requested;
    const recommended = new Map((requested === 'all' ? [] : inventoryOrderSuggestions(requested))
      .map(item => [item.itemId, item]));
    for (const [index, item] of rows.entries()) {
      if (manuallyChanged.has(item.itemId)) continue;
      const entry = recommended.get(item.itemId);
      const include = Boolean(entry) && (!manufacturerFilter || manufacturer(item) === manufacturerFilter);
      const node = layer.querySelector('[data-inventory-order-row="' + index + '"]');
      if (!node) continue;
      const check = node.querySelector('[data-inventory-order-include]');
      const fields = node.querySelector('[data-inventory-order-fields]');
      if (include) {
        const packages = suggestedPacks(entry);
        selected.set(item.itemId, packages);
        const input = fields?.querySelector('input');
        if (input) input.value = String(packages);
      } else selected.delete(item.itemId);
      if (check) check.checked = include;
      if (fields) {
        fields.hidden = !include;
        fields.querySelectorAll('input').forEach(input => { input.disabled = !include; });
      }
      (include ? activeList : excludedList).append(node);
      if (include) node.hidden = false;
    }
    keepOrder(activeList);
    keepOrder(excludedList);
    excludedGroup.open = requested === 'all';
    updateSearch();
    sync();
  });
  search?.addEventListener('input', updateSearch);
  submit?.addEventListener('click', async () => {
    if (saving || !selected.size) return;
    const lines = [];
    errorHost.textContent = '';
    for (const item of rows) {
      if (!selected.has(item.itemId)) continue;
      const index = indexByItem.get(item.itemId);
      const input = layer.querySelector('[name="orderPackages-' + index + '"]');
      const quantity = Number(String(input?.value || '').replace(',', '.'));
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000) {
        errorHost.textContent = 'Укажите целое число упаковок: ' + item.name;
        return;
      }
      if (isTube(item) && !(Number(item.packageQuantity) > 0)) {
        errorHost.textContent = 'Для покупки тюбиков не указан объём упаковки: ' + item.name;
        return;
      }
      const old = existingByItem.get(item.itemId);
      lines.push({
        itemId: item.itemId, packages: quantity,
        ...(old ? { packPrice: old.packPrice, offerId: old.offerId } : {}),
      });
    }
    saving = true;
    sync();
    try {
      const payload = { supplier, note: existing?.note || '', lines };
      const previousIds = new Set(getInventoryOrders().map(order => order.orderId));
      if (existing) await updateInventoryPurchaseOrder(existing.orderId, payload);
      else await createInventoryPurchaseOrder(payload);
      const created = existing ? null
        : getInventoryOrders().find(order => !previousIds.has(order.orderId));
      layer.v2Close?.();
      onSaved(created?.orderId || '');
    } catch (error) {
      errorHost.textContent = error instanceof Error ? error.message : 'Не удалось сохранить заказ.';
    } finally {
      saving = false;
      if (layer.isConnected) sync();
    }
  });
  sync();
  return layer;
}

function openInventoryOrderSelection(root, existing = null, onSaved = () => {}) {
  const catalog = getInventoryItems();
  const manufacturers = [...new Set(catalog.map(manufacturer))].sort((a, b) => a.localeCompare(b, 'ru'));
  const markup = '<div class="form-grid" data-inventory-order-criteria>' +
    select({
      label: 'Расчёт', name: 'orderThreshold', value: 'target', options: [
        ...ORDER_MODES,
      ],
    }) +
    field({
      label: 'Поставщик / место покупки', name: 'orderSupplier',
      value: existing?.supplier || '', autocomplete: 'off',
    }) +
    select({
      label: 'Производитель', name: 'orderManufacturer', value: '', options: [
        { value: '', label: 'Все производители' },
        ...manufacturers.map(value => ({ value, label: value })),
      ],
    }) +
    select({
      label: 'Сортировка', name: 'orderSort', value: 'position', options: [
        { value: 'position', label: 'По порядку' },
        { value: 'name', label: 'По названию' },
        { value: 'quantity', label: 'По количеству' },
      ],
    }) +
    actionBlock(button('Продолжить', { data: 'data-inventory-order-next' })) +
    '</div>';
  const criteria = mountModal(root, modal(markup, { variant: 'q', title: 'Критерии' }));
  if (!criteria) return null;
  criteria.querySelector('[data-inventory-order-next]')?.addEventListener('click', () => {
    const read = name => String(criteria.querySelector('[name="' + name + '"]')?.value || '');
    openInventoryOrderReview(criteria, {
      mode: read('orderThreshold'),
      supplier: read('orderSupplier').trim(),
      manufacturerFilter: read('orderManufacturer'),
      sorting: read('orderSort'),
    }, existing, createdOrderId => {
      criteria.v2Close?.();
      onSaved(createdOrderId);
    });
  });
  return criteria;
}

function openInventoryOrderZ(root, orderId) {
  let order = getInventoryOrder(orderId);
  if (!order) return;
  let manufacturerFilter = '';
  let sorting = 'position';
  const markup = `${workspaceHeaderContext({
    title: 'Заказ',
    v: { data: 'data-inventory-order-z-menu', aria: 'Фильтр и сортировка заказа' },
    ...(order.status === 'formed'
      ? { c: { label: '+', data: 'data-inventory-order-z-add', aria: 'Добавить позиции' } } : {}),
  })}<div data-inventory-order-z-summary></div>
    <div data-inventory-order-z-lines></div>
    <div data-inventory-order-z-actions></div>`;
  const layer = mountV2ZLayer(root, v2ZLayer(markup), { stack: true });
  if (!layer) return;
  const [row] = setV2ZHeaderRows(layer, [headSearch('data-inventory-order-z-search')]);
  const search = row?.querySelector('[data-inventory-order-z-search]');
  const summary = layer.querySelector('[data-inventory-order-z-summary]');
  const list = layer.querySelector('[data-inventory-order-z-lines]');
  const actions = layer.querySelector('[data-inventory-order-z-actions]');

  const current = () => getInventoryOrder(orderId);
  const saveAndRefresh = () => { order = current(); refreshOrderList(root); render(); };
  const openControlQ = (kind) => {
    const companies = [...new Set((current()?.lines || []).map(manufacturer))]
      .sort((a, b) => a.localeCompare(b, 'ru'));
    const markup = `<div class="form-grid">${
      kind === 'sort'
        ? select({ label: 'Сортировка', name: 'orderZSort', value: sorting, options: [
          { value: 'position', label: 'По порядку' },
          { value: 'name', label: 'По названию' },
          { value: 'quantity', label: 'По количеству' },
        ] })
        : select({ label: 'Производитель', name: 'orderZManufacturer',
          value: manufacturerFilter,
          options: [{ value: '', label: 'Все производители' },
            ...companies.map(value => ({ value, label: value }))] })
    }${actionBlock(button('Применить', { data: 'data-inventory-order-control-apply' }))}</div>`;
    const popup = mountModal(layer, modal(markup, {
      variant: 'q', title: kind === 'sort' ? 'Сортировка' : 'Фильтр',
    }));
    popup?.querySelector('[data-inventory-order-control-apply]')?.addEventListener('click', () => {
      if (kind === 'sort') sorting = popup.querySelector('[name="orderZSort"]')?.value || 'position';
      else manufacturerFilter = popup.querySelector('[name="orderZManufacturer"]')?.value || '';
      popup.v2Close?.();
      render();
    });
  };

  const openLineQ = line => {
    if (current()?.status !== 'formed') return;
    const markup = `<div class="form-grid">
      ${field({ label: 'Количество, ' + packageLabel(line), name: 'orderPackages',
        type: 'number', min: '1', step: '1', inputmode: 'numeric', value: String(line.packages) })}
      ${field({ label: 'Цена за упаковку, ₽', name: 'orderPackPrice',
        type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: String(line.packPrice) })}
      <p class="form-error" role="status" data-inventory-order-line-error></p>
      ${actionBlock([
        button('Сохранить', { data: 'data-inventory-order-line-save' }),
        button('Убрать позицию', { variant: 'critical', data: 'data-inventory-order-line-remove' }),
      ].join(''))}
    </div>`;
    const popup = mountModal(layer, modal(markup, { variant: 'q', title: line.name }));
    if (!popup) return;
    const save = async remove => {
      const fresh = current();
      if (fresh?.status !== 'formed') return;
      const packages = Number(popup.querySelector('[name="orderPackages"]')?.value);
      const price = Number(String(popup.querySelector('[name="orderPackPrice"]')?.value || '0').replace(',', '.'));
      const feedback = popup.querySelector('[data-inventory-order-line-error]');
      if (!remove && (!Number.isSafeInteger(packages) || packages < 1 || !Number.isFinite(price) || price < 0)) {
        feedback.textContent = 'Укажите целое число упаковок и корректную цену.';
        return;
      }
      const updated = fresh.lines.filter(item => !remove || item.itemId !== line.itemId).map(item =>
        item.itemId === line.itemId && !remove ? { ...item, packages, packPrice: price } : item);
      if (!updated.length) { feedback.textContent = 'В заказе должна остаться хотя бы одна позиция.'; return; }
      popup.querySelectorAll('button').forEach(button => { button.disabled = true; });
      try {
        await updateInventoryPurchaseOrder(orderId, {
          supplier: fresh.supplier, note: fresh.note, lines: updated,
        });
        popup.v2Close?.();
        saveAndRefresh();
      } catch (error) {
        feedback.textContent = error instanceof Error ? error.message : 'Не удалось сохранить.';
        popup.querySelectorAll('button').forEach(button => { button.disabled = false; });
      }
    };
    popup.querySelector('[data-inventory-order-line-save]')?.addEventListener('click', () => save(false));
    popup.querySelector('[data-inventory-order-line-remove]')?.addEventListener('click', () => save(true));
  };

  const openPayQ = async () => {
    let wallets = [];
    try { wallets = await loadWalletCatalog(); }
    catch (error) { openNotice({ message: String(error?.message || 'Кошельки недоступны') }); return; }
    if (!wallets.length) return openNotice({ message: 'В кассе нет кошельков для оплаты.' });
    const popup = mountModal(layer, modal(`<div class="form-grid">
      ${select({ label: 'Кошелёк', name: 'inventoryOrderWallet', value: '', options: [
        { value: '', label: 'Выберите кошелёк' },
        ...wallets.map(wallet => ({ value: wallet.id, label: wallet.name })),
      ] })}
      <p class="form-error" role="status" data-inventory-order-pay-error></p>
      ${actionBlock(button('Оплатить', { data: 'data-inventory-order-pay-save' }))}
    </div>`, { variant: 'q', title: 'Оплата заказа' }));
    if (!popup) return;
    const submit = popup.querySelector('[data-inventory-order-pay-save]');
    submit?.addEventListener('click', async () => {
      const id = popup.querySelector('[name="inventoryOrderWallet"]')?.value || '';
      const wallet = wallets.find(row => row.id === id);
      if (!wallet || current()?.status !== 'formed') return;
      submit.disabled = true;
      try {
        await payInventoryPurchaseOrder(orderId, {
          walletId: wallet.id, walletName: wallet.name, paidAt: new Date().toISOString(),
        });
        popup.v2Close?.();
        saveAndRefresh();
      } catch (error) {
        popup.querySelector('[data-inventory-order-pay-error]').textContent = String(error?.message || 'Не удалось оплатить.');
        if (submit.isConnected) submit.disabled = false;
      }
    });
  };

  const openReceiveQ = () => {
    const today = new Date();
    const day = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0')].join('-');
    const popup = mountModal(layer, modal(`<div class="form-grid">
      ${datePicker({ label: 'Дата получения', name: 'inventoryOrderReceivedAt',
        value: day, allowClear: false, showYear: true, modalVariant: 'bottom',
        modalSurface: 'app', modalClassName: 'modal--form-sheet' })}
      <p class="form-error" role="status" data-inventory-order-receive-error></p>
      ${actionBlock(button('Получен', { data: 'data-inventory-order-receive-save' }))}
    </div>`, { variant: 'q', title: 'Поступление заказа' }));
    if (!popup) return;
    initDatePickers(popup);
    const submit = popup.querySelector('[data-inventory-order-receive-save]');
    submit?.addEventListener('click', async () => {
      const date = popup.querySelector('[name="inventoryOrderReceivedAt"]')?.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || current()?.status !== 'paid') return;
      submit.disabled = true;
      try {
        await receiveInventoryPurchaseOrder(orderId, `${date}T12:00:00.000Z`);
        popup.v2Close?.();
        saveAndRefresh();
      } catch (error) {
        popup.querySelector('[data-inventory-order-receive-error]').textContent = String(error?.message || 'Не удалось создать приход.');
        if (submit.isConnected) submit.disabled = false;
      }
    });
  };

  const openDeleteQ = () => {
    const popup = mountModal(layer, modal(`<div class="form-grid">
      <p>Удалить неоплаченный заказ?</p>
      <p class="form-error" role="status" data-inventory-order-delete-error></p>
      ${actionBlock(button('Удалить', { variant: 'critical', data: 'data-inventory-order-delete-confirm' }))}
    </div>`, { variant: 'q', title: 'Удаление заказа' }));
    const submit = popup?.querySelector('[data-inventory-order-delete-confirm]');
    submit?.addEventListener('click', async () => {
      submit.disabled = true;
      try {
        await deleteInventoryPurchaseOrder(orderId);
        popup.v2Close?.();
        layer.v2Close?.();
        refreshOrderList(root);
      } catch (error) {
        popup.querySelector('[data-inventory-order-delete-error]').textContent = String(error?.message || 'Не удалось удалить.');
        submit.disabled = false;
      }
    });
  };

  const render = () => {
    order = current();
    if (!order) return;
    // A draft turns paid without remounting Z2. The inherited + must disappear.
    const addAction = layer.querySelector('[data-inventory-order-z-add]');
    if (addAction) addAction.hidden = order.status !== 'formed';
    const query = String(search?.value || '').trim().toLocaleLowerCase('ru-RU');
    summary.innerHTML = `<div class="form-grid">
      <p>${statusLabel(order.status)} · ${dateLabel(order.createdAt)} · ${order.lines.length} поз.</p>
      <p>Всего: <strong>${rubles(order.total)}</strong></p>
    </div>`;
    const rows = sortedItems(order.lines.filter(item =>
      (!manufacturerFilter || manufacturer(item) === manufacturerFilter)
      && (!query || searchText(item).includes(query))), sorting);
    list.innerHTML = rows.length ? v2ListEntries(rows.map(item => v2ListEntry({
      title: item.name,
      subtitle: `${manufacturer(item)} · ${rubles(item.packPrice)} / ${packageLabel(item)}`,
      rightTop: `${item.packages} ${packageLabel(item)}`,
      rightBottom: rubles(item.packages * item.packPrice),
      interactive: order.status === 'formed',
      data: `data-inventory-order-line="${escapeHtml(item.itemId)}"`,
      aria: 'Изменить количество ' + item.name,
      initial: '',
    }))) : emptyState('Товары не найдены', 'Измените фильтр.');
    if (order.status === 'formed') {
      actions.innerHTML = actionBlock([
        button('Оплатить', { data: 'data-inventory-order-pay' }),
        button('Удалить заказ', { variant: 'critical', data: 'data-inventory-order-delete' }),
      ].join(''));
    } else if (order.status === 'paid') {
      actions.innerHTML = actionBlock(button('Получен', { data: 'data-inventory-order-receive' }));
    } else {
      actions.innerHTML = `<p>${dateLabel(order.receivedAt)} · Поступление проведено</p>`;
    }
    list.querySelectorAll('[data-inventory-order-line]').forEach(node =>
      node.addEventListener('click', () => {
        const line = order.lines.find(item => item.itemId === node.dataset.inventoryOrderLine);
        if (line) openLineQ(line);
      }));
    actions.querySelector('[data-inventory-order-pay]')?.addEventListener('click', openPayQ);
    actions.querySelector('[data-inventory-order-delete]')?.addEventListener('click', openDeleteQ);
    actions.querySelector('[data-inventory-order-receive]')?.addEventListener('click', openReceiveQ);
  };

  search?.addEventListener('input', render);
  layer.querySelector('[data-inventory-order-z-menu]')?.addEventListener('click', () => {
    openSharedProfileSettingsMenu({ title: 'Заказ', actions: [
      { id: 'sort', label: 'Сортировка', onSelect: () => openControlQ('sort') },
      { id: 'filter', label: 'Фильтр', onSelect: () => openControlQ('filter') },
    ] });
  });
  layer.querySelector('[data-inventory-order-z-add]')?.addEventListener('click', () => {
    if (current()?.status === 'formed') openInventoryOrderSelection(layer, current(), saveAndRefresh);
  });
  render();
}

export function renderInventoryOrders(root) {
  root.innerHTML = `${workspaceHeaderContext({
    title: 'Заказы',
    v: { data: 'data-inventory-orders-menu', aria: 'Сортировка и фильтр заказов' },
    c: { label: '+', data: 'data-inventory-add-order', aria: 'Сформировать заказ' },
  })}<div data-inventory-orders-list></div>`;
  const openControls = (kind) => {
    const suppliers = [...new Set(getInventoryOrders().map(order => order.supplier).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ru'));
    const html = `<div class="form-grid">${kind === 'sort'
      ? select({ label: 'Сортировка', name: 'ordersZ1Sort',
        value: root.dataset.inventoryOrdersSort || 'recent',
        options: [{ value: 'recent', label: 'Сначала новые' },
          { value: 'oldest', label: 'Сначала старые' },
          { value: 'price', label: 'По сумме' }] })
      : [
        select({ label: 'Статус', name: 'ordersZ1Status',
          value: root.dataset.inventoryOrdersStatus || '',
          options: [{ value: '', label: 'Все' },
            { value: 'formed', label: 'Сформирован' },
            { value: 'paid', label: 'Оплачен' },
            { value: 'received', label: 'Получен' }] }),
        select({ label: 'Поставщик', name: 'ordersZ1Supplier',
          value: root.dataset.inventoryOrdersSupplier || '',
          options: [{ value: '', label: 'Все' },
            ...suppliers.map(value => ({ value, label: value }))] }),
      ].join('')}
      ${actionBlock(button('Применить', { data: 'data-inventory-orders-apply' }))}</div>`;
    const popup = mountModal(root, modal(html, {
      variant: 'q', title: kind === 'sort' ? 'Сортировка' : 'Фильтр',
    }));
    popup?.querySelector('[data-inventory-orders-apply]')?.addEventListener('click', () => {
      if (kind === 'sort') {
        root.dataset.inventoryOrdersSort = popup.querySelector('[name="ordersZ1Sort"]')?.value || 'recent';
      } else {
        root.dataset.inventoryOrdersStatus = popup.querySelector('[name="ordersZ1Status"]')?.value || '';
        root.dataset.inventoryOrdersSupplier = popup.querySelector('[name="ordersZ1Supplier"]')?.value || '';
      }
      popup.v2Close?.();
      refreshOrderList(root);
    });
  };
  root.querySelector('[data-inventory-orders-menu]')?.addEventListener('click', () =>
    openSharedProfileSettingsMenu({ title: 'Заказы', actions: [
      { id: 'sort', label: 'Сортировка', onSelect: () => openControls('sort') },
      { id: 'filter', label: 'Фильтр', onSelect: () => openControls('filter') },
    ] }));
  root.querySelector('[data-inventory-add-order]')?.addEventListener('click', () =>
    openInventoryOrderSelection(root, null, createdOrderId => {
      refreshOrderList(root);
      if (createdOrderId) openInventoryOrderZ(root, createdOrderId);
    }));
  refreshOrderList(root);
}
