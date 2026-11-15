import {
  actionBlock, button, datePicker, emptyState, field, initDatePickers,
  modal, mountModal, mountV2ZLayer, openNotice, openSharedProfileSettingsMenu,
  select, list, v2ListEntries, v2ListEntry, v2ZLayer,
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
import { openInventoryOrderExport } from './order-export.js';

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
const orderNumber = id => String(id || '').replaceAll('-', '').slice(0, 12).toUpperCase();
// Order lines retain their name in Core. Use available catalog article/barcode
// only as secondary supplier information: never show internal warehouse rank.
// Canonical dense List rows for a supplier document, not V2 entity cards.
const supplierOrderLine = line => {
  const catalog = getInventoryItem(line.itemId);
  const name = String(line.name || catalog?.name || '').trim();
  const sku = String(catalog?.sku || '').trim();
  const barcode = String(catalog?.barcode || '').trim();
  const article = sku ? 'Арт. ' + sku : barcode ? 'Штрихкод ' + barcode : '';
  return {
    title: article || name || 'Без названия',
    secondary: article && name ? name : '',
    right: [String(line.packages) + ' шт.'],
    interactive: false,
  };
};
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
    title: 'Заказ № ' + orderNumber(order.orderId),
    subtitle: [dateLabel(order.createdAt), order.supplier].filter(Boolean).join(' · '),
    rightTop: statusLabel(order.status),
    rightBottom: (order.lines || []).length + ' поз.',
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
    const match = /^orderPackages-(\d+)$/.exec(String(event.target?.name || ''));
    if (match && rows[Number(match[1])]) manuallyChanged.add(rows[Number(match[1])].itemId);
  });
  layer.querySelector('[name="orderReviewMode"]')?.addEventListener('change', event => {
    if (saving) return;
    const requested = String(event.target.value || 'target');
    if (!ORDER_MODES.some(option => option.value === requested)) return;
    currentMode = requested;
    const recommended = new Map((requested === 'all' ? [] : inventoryOrderSuggestions(requested))
      .map(item => [item.itemId, item]));
    // A mode selector is a VIEW of the current order, not permission to
    // delete checked lines or overwrite package counts already shown to the
    // professional. It may add new recommendations, but never removes
    // existing selections or modifies a previously entered number.
    for (const [index, item] of rows.entries()) {
      if (selected.has(item.itemId) || manuallyChanged.has(item.itemId)) continue;
      const entry = recommended.get(item.itemId);
      if (!entry || (manufacturerFilter && manufacturer(item) !== manufacturerFilter)) continue;
      const node = layer.querySelector('[data-inventory-order-row="' + index + '"]');
      if (!node) continue;
      const packages = suggestedPacks(entry);
      selected.set(item.itemId, packages);
      const check = node.querySelector('[data-inventory-order-include]');
      if (check) check.checked = true;
      const fields = node.querySelector('[data-inventory-order-fields]');
      if (fields) {
        fields.hidden = false;
        fields.querySelectorAll('input').forEach(input => { input.disabled = false; });
        const input = fields.querySelector('input');
        if (input) input.value = String(packages);
      }
      activeList.append(node);
      node.hidden = false;
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
      // Orders are counted in whole packages; no tare/net weight at order time.
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
  const markup = `${workspaceHeaderContext({
    title: 'Заказ № ' + orderNumber(orderId),
    v: { data: 'data-inventory-order-z-menu', aria: 'Действия заказа' },
  })}<div data-inventory-order-z-summary></div>
    <div data-inventory-order-z-lines></div>`;
  const layer = mountV2ZLayer(root, v2ZLayer(markup), { stack: true });
  if (!layer) return;
  const summary = layer.querySelector('[data-inventory-order-z-summary]');
  const itemsList = layer.querySelector('[data-inventory-order-z-lines]');
  const current = () => getInventoryOrder(orderId);
  const saveAndRefresh = () => { order = current(); refreshOrderList(root); render(); };

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
      <p>Удалить сформированный заказ? Позиции исчезнут из заказов, складские остатки не изменятся.</p>
      <p class="form-error" role="status" data-inventory-order-delete-error></p>
      ${actionBlock(button('Удалить', { variant: 'danger', data: 'data-inventory-order-delete-confirm' }))}
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
    // An order document includes ALL saved lines in canonical purchase order.
    // Filtering them would make a supplier screenshot incomplete.
    const units = order.lines.reduce((total, line) => total + Number(line.packages || 0), 0);
    summary.innerHTML = '<p>' + escapeHtml(dateLabel(order.createdAt))
      + ' · Всего ' + escapeHtml(String(units)) + ' шт.</p>';
    itemsList.innerHTML = list({
      className: 'ui-list--dense',
      items: order.lines.map(supplierOrderLine),
    });
    // Supplier exports remain available after payment or receipt.
  };

  layer.querySelector('[data-inventory-order-z-menu]')?.addEventListener('click', () => {
    const fresh = current();
    if (!fresh) return;
    const exportAction = { id: 'export', label: 'Выгрузить / поделиться',
      onSelect: () => openInventoryOrderExport(layer, orderId, orderNumber(orderId)) };
    const actions = fresh.status === 'formed'
      ? [
          { id: 'edit', label: 'Корректировать заказ', onSelect: () =>
            openInventoryOrderReview(layer, {
              mode: 'target', supplier: fresh.supplier || '', sorting: 'position',
            }, fresh, saveAndRefresh) },
          { id: 'pay', label: 'Оплатить', onSelect: openPayQ },
          exportAction,
          { id: 'delete', label: 'Удалить заказ', variant: 'danger', onSelect: openDeleteQ },
        ]
      : fresh.status === 'paid'
        ? [{ id: 'receive', label: 'Получен', onSelect: openReceiveQ }, exportAction]
        : [exportAction];
    openSharedProfileSettingsMenu({
      title: 'Заказ № ' + orderNumber(orderId),
      actions,
    });
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
