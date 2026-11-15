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
const packSize = row => Math.max(1, Number(row.packageSize || row.packageQuantity) || 1);
const isTube = row => ['г', 'гр', 'гр.', 'грамм', 'граммы'].includes(String(row.unit || '').toLocaleLowerCase('ru-RU'));
const packageLabel = row => isTube(row) ? 'тюб.' : 'шт.';
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

function orderListMarkup() {
  const orders = getInventoryOrders();
  if (!orders.length) return emptyState('Заказов пока нет', 'Нажмите +, чтобы сформировать заказ.');
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
  host.innerHTML = orderListMarkup();
  host.querySelectorAll('[data-inventory-order]').forEach(node => {
    node.addEventListener('click', () => openInventoryOrderZ(root, node.dataset.inventoryOrder));
  });
}

function suggestedPacks(row) {
  const needed = Math.max(0, Number(row.suggestedQuantity) || 0);
  return Math.max(1, Math.ceil(needed / packSize(row)));
}

// The same Q selection pattern is used by Movements/Inventory.
// Selected items survive switching Target/Minimum, manufacturer and full catalog.
function openInventoryOrderSelection(root, existing = null, onSaved = () => {}) {
  const selected = new Map((existing?.lines || []).map(line => [line.itemId, Number(line.packages) || 1]));
  const catalog = getInventoryItems();
  const manufacturers = [...new Set(catalog.map(manufacturer))].sort((a, b) => a.localeCompare(b, 'ru'));
  const markup = `${workspaceHeaderContext({
    title: existing ? 'Добавить товары' : 'Сформировать заказ',
  })}<div class="form-grid" data-inventory-order-selection>
    ${select({ label: 'Расчёт', name: 'orderThreshold', value: 'target', options: [
      { value: 'target', label: 'Цель' },
      { value: 'minimum', label: 'Минимум' },
    ] })}
    ${select({ label: 'Показать', name: 'orderScope', value: 'suggested', options: [
      { value: 'suggested', label: 'Рекомендовано' },
      { value: 'all', label: 'Весь каталог' },
    ] })}
    ${select({ label: 'Производитель', name: 'orderManufacturer', value: '', options: [
      { value: '', label: 'Все производители' },
      ...manufacturers.map(value => ({ value, label: value })),
    ] })}
    ${select({ label: 'Сортировка', name: 'orderSort', value: 'position', options: [
      { value: 'position', label: 'По порядку' },
      { value: 'name', label: 'По названию' },
      { value: 'quantity', label: 'По количеству' },
    ] })}
    <p data-inventory-order-selection-count></p>
    <div data-inventory-order-selection-list></div>
    <p class="form-error" role="status" data-inventory-order-selection-error></p>
    ${actionBlock(button(existing ? 'Сохранить заказ' : 'Сформировать', {
      data: 'data-inventory-order-create',
    }))}
  </div>`;
  const layer = mountModal(root, modal(markup, { variant: 'q' }));
  if (!layer) return null;
  const header = layer.querySelector('[data-v2-q-header-content]');
  if (header) header.innerHTML = headSearch('data-inventory-order-choose-search');
  const search = layer.querySelector('[data-inventory-order-choose-search]');
  const form = layer.querySelector('[data-inventory-order-selection]');
  const list = layer.querySelector('[data-inventory-order-selection-list]');
  const count = layer.querySelector('[data-inventory-order-selection-count]');
  const buttonNode = layer.querySelector('[data-inventory-order-create]');
  const errorHost = layer.querySelector('[data-inventory-order-selection-error]');
  let saving = false;
  let visible = [];
  const value = name => String(layer.querySelector(`[name="${name}"]`)?.value || '');
  const choices = () => {
    const recommendations = inventoryOrderSuggestions(value('orderThreshold'));
    const recommended = new Map(recommendations.map(row => [row.itemId, row]));
    const scope = value('orderScope');
    const company = value('orderManufacturer');
    const needle = String(search?.value || '').trim().toLocaleLowerCase('ru-RU');
    const rows = catalog.filter(row =>
      (scope === 'all' || recommended.has(row.itemId))
      && (!company || manufacturer(row) === company)
      && (!needle || searchText(row).includes(needle))
    ).map(row => ({ ...row, suggestedQuantity: recommended.get(row.itemId)?.suggestedQuantity || 0 }));
    return sortedItems(rows, value('orderSort'));
  };
  const render = () => {
    const rows = choices();
    visible = rows.map(row => row.itemId);
    list.innerHTML = rows.length
      ? rows.map(row => compactCheck({
        label: `${manufacturer(row)} · ${row.name} · ${row.suggestedQuantity > 0
          ? `Купить ${suggestedPacks(row)} ${packageLabel(row)}` : 'Добавить вручную'}`,
        checked: selected.has(row.itemId),
        data: `data-inventory-order-pick="${escapeHtml(row.itemId)}"`,
      })).join('')
      : emptyState('Позиций нет', 'Измените расчёт, фильтр или включите весь каталог.');
    count.textContent = `Выбрано ${selected.size}`;
    buttonNode.disabled = saving || selected.size === 0;
  };
  form.addEventListener('change', event => {
    const check = event.target.closest?.('[data-inventory-order-pick]');
    if (check && !saving) {
      if (check.checked) {
        const item = catalog.find(row => row.itemId === check.dataset.inventoryOrderPick);
        const suggested = inventoryOrderSuggestions(value('orderThreshold')).find(row => row.itemId === item?.itemId);
        selected.set(check.dataset.inventoryOrderPick, suggested ? suggestedPacks(suggested) : 1);
      } else selected.delete(check.dataset.inventoryOrderPick);
      render();
      return;
    }
    if (!saving) render();
  });
  search?.addEventListener('input', render);
  buttonNode.addEventListener('click', async () => {
    if (saving || !selected.size) return;
    saving = true;
    render();
    errorHost.textContent = '';
    try {
      const lines = [...selected].map(([itemId, packages]) => {
        const old = existing?.lines?.find(row => row.itemId === itemId);
        return { itemId, packages, ...(old ? { packPrice: old.packPrice, offerId: old.offerId } : {}) };
      });
      const payload = { supplier: existing?.supplier || '', note: existing?.note || '', lines };
      if (existing) await updateInventoryPurchaseOrder(existing.orderId, payload);
      else await createInventoryPurchaseOrder(payload);
      layer.v2Close?.();
      onSaved();
    } catch (error) {
      errorHost.textContent = error instanceof Error ? error.message : 'Не удалось сохранить заказ.';
    } finally {
      saving = false;
      if (layer.isConnected) render();
    }
  });
  render();
  return layer;
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
  layer.querySelector('[data-inventory-order-z-add]')?.addEventListener('click', () =>
    openInventoryOrderSelection(layer, current(), saveAndRefresh));
  render();
}

export function renderInventoryOrders(root) {
  root.innerHTML = `${workspaceHeaderContext({
    title: 'Заказы',
    c: { label: '+', data: 'data-inventory-add-order', aria: 'Сформировать заказ' },
  })}<div data-inventory-orders-list></div>`;
  root.querySelector('[data-inventory-add-order]')?.addEventListener('click', () =>
    openInventoryOrderSelection(root, null, () => refreshOrderList(root)));
  refreshOrderList(root);
}
