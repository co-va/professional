import {
  actionBlock,
  button,
  collectCost,
  validateCostDefinition,
  costField,
  costListParts,
  emptyState,
  entityVisualCard,
  escapeHtml,
  field,
  initCostFields,
  initV2ListReorder,
  miniCard,
  miniCardRail,
  modal,
  mountModal,
  openNotice,
  mountV2ZLayer,
  page,
  setSharedProfilePrimary,
  textareaField,
  v2ListEntries,
  v2ListEntry,
  v2ZLayer,
  workplaceCountText,
} from '../../../ui/ui.js';
import { getWorkplaces } from '../../profile/workplaces/data.js';
import { serviceHeaderContext, notifyServiceContext } from '../context.js';
import { bindServiceWorkplaceAssignments, serviceWorkplaceAssignmentList, serviceWorkplaceAddButton } from '../workplace-selection.js';
import { setSharedActionVisible } from '../../../ui/page/page.js';
import { compactCheck } from '../../../ui/selection/check-list.js';
import { productEditorSignature, rebaseWorkplaceAssignmentSignature } from '../editor-signature.js';
import { scheduleServiceStatistics, serviceItemStatistics } from '../statistics.js';
import { renderServiceGroupTree, serviceGroupFields, readServiceGroupFields } from '../catalog-grouping.js';
import { productCardAppearance, productCardFields, productCardPhoto } from '../card-presentation.js';
import { commitDeleteProduct, getProducts, commitReorderProducts, commitProduct, commitProductWorkplace, commitInventoryRetailPrice, commitInventoryProductPresentation, commitInventoryProductWorkplace } from './data.js';

const money = (value) => `${new Intl.NumberFormat('ru-RU').format(Number(value || 0))} ₽`;

function initialProduct(existing = null) {
  if (existing) return {
    ...existing,
    workplaces: Array.isArray(existing.workplaces) ? existing.workplaces.map((item) => ({ ...item })) : [],
  };
  return {
    id: '',
    photo: '',
    name: '',
    cost: { mode: 'amount', amount: '', free: false },
    about: '',
    workplaces: [],
  };
}

function productRow(product) {
  const price = costListParts(product.cost);
  return v2ListEntry({
    title: product.name || '',
    subtitle: workplaceCountText((product.workplaces || []).length),
    image: productCardPhoto(product),
    initial: (product.name || '?').slice(0, 1).toUpperCase(),
    rightTop: price.rightTop || '',
    rightBottom: price.rightBottom || '',
    interactive: true,
    reorderHandle: true,
    reorderAria: 'Изменить порядок',
    data: `data-product="${escapeHtml(product.id)}" data-reorder-id="${escapeHtml(product.id)}"`,
    aria: `Открыть товар ${product.name || ''}`,
  });
}

export function renderProductCatalog(host, { root = host, onChanged = () => {} } = {}) {
  const items = getProducts();
  const grouped = items.length
    ? renderServiceGroupTree(items, 'products', productRow,
      ids => commitReorderProducts(ids),
      error => openNotice({
        title: 'Порядок',
        message: error instanceof Error ? error.message : 'Не удалось сохранить порядок.',
      }))
    : null;
  host.innerHTML = items.length
    ? grouped?.html || v2ListEntries(items.map(productRow))
    : emptyState('Товаров пока нет', 'Добавьте первый товар кнопкой «+».');

  host.querySelectorAll('[data-product]').forEach((node) => {
    node.addEventListener('click', async () => {
      const id = node.dataset.product;
      // Sale catalog owns only the retail presentation. Editing here must
      // never redirect to Inventory or change its calculated/stock prices.
      openProductOverview(root, id, { onChanged });
    });
  });

  // Manual order belongs to Service, including stock-backed products.
  // The reorder gesture and handles are the same as Service → Услуги.
  // Persisted order never writes into Inventory or changes stock positions.
  if (grouped) return grouped.attach(host);
  return initV2ListReorder(host, {
    onReorder: (ids) => commitReorderProducts(ids),
    onError: (error) => openNotice({
      title: 'Порядок',
      message: error instanceof Error ? error.message : 'Не удалось сохранить порядок товаров.',
    }),
  });
}

function productOverviewCard(product, statistics = null) {
  return entityVisualCard({
    appearance: productCardAppearance(product),
    fields: productCardFields(product, statistics ? {
      saleCount: statistics.count,
      revenue: statistics.revenue,
    } : null),
    image: productCardPhoto(product),
    className: 'entity-visual-card--service',
    interactive: true,
    data: 'data-product-open-editor',
    aria: `Редактировать товар ${product.name || ''}`,
  });
}

function productWorkplaceCards(product, statistics = null) {
  const byId = new Map(getWorkplaces().map((workplace) => [String(workplace.key || workplace.id || ''), workplace]));
  const cards = (product.workplaces || []).map((selection) => {
    const id = String(selection.workplaceId || selection.id || selection.key || '');
    const workplace = byId.get(id) || selection;
    const group = statistics?.byWorkplace.get(id) || null;
    return miniCard({
      title: workplace.name || selection.name || 'Рабочее пространство',
      rows: [
        { label: 'Кол-во', value: statistics ? String(group?.count || 0) : '—' },
        { label: 'Сумма', value: statistics ? money(group?.revenue || 0) : '—' },
      ],
    });
  });
  return cards.length ? miniCardRail(cards) : '';
}

function confirmDeleteProduct(product, onDeleted) {
  const stockBacked = Boolean(product.inventoryItemId);
  const actionLabel = stockBacked ? 'Снять с продажи' : 'Удалить товар';
  const question = stockBacked ? 'Снять с продажи?' : 'Удалить товар?';
  const explanation = stockBacked
    ? ' исчезнет из Сервиса. На Складе товар и остатки сохранятся. История продаж не изменится.'
    : ' исчезнет из Сервиса. История продаж сохранится.';
  const layer = mountModal(document.body, modal(`<div class="modal-title"><h2>${question}</h2><p>${escapeHtml(product.name || 'Товар')}${explanation}</p></div><div class="form-error" role="alert" data-product-delete-error></div><div class="modal-actions">${button(actionLabel, { variant: 'danger', data: 'data-confirm-delete-product' })}${button('Отмена', { variant: 'secondary', data: 'data-cancel-delete-product' })}</div>`, {
    variant: 'x',
    title: stockBacked ? 'Снятие с продажи' : 'Удаление товара',
  }));
  if (!layer) return null;
  layer.querySelector('[data-cancel-delete-product]')?.addEventListener('click', () => layer.v2Close?.());
  const confirm = layer.querySelector('[data-confirm-delete-product]');
  confirm?.addEventListener('click', async () => {
    if (confirm.disabled) return;
    confirm.disabled = true;
    try {
      // A stock-backed product is removed from the Service sale catalogue
      // by unchecking the canonical Stock sale flag. Its stock, history and
      // Service-specific retail settings remain intact for later reactivation.
      if (product.inventoryItemId) {
        const { updateInventoryItem } = await import('../../inventory/service.js');
        const { getInventoryItem } = await import('../../inventory/data.js');
        // The owner is Inventory: unpublish the item from Service, never
        // delete/archive its warehouse row, balance, movements or history.
        // Older Core versions can acknowledge an update without applying all
        // fields, so do not close Q until the returned warehouse snapshot
        // actually confirms canSell=false.
        await updateInventoryItem(product.inventoryItemId, { canSell: false });
        if (getInventoryItem(product.inventoryItemId)?.canSell !== false) {
          throw new Error('Склад не подтвердил снятие товара с продажи.');
        }
      } else {
        await commitDeleteProduct(product.id);
      }
      layer.v2Close?.();
      onDeleted?.();
    } catch (error) {
      const message = layer.querySelector('[data-product-delete-error]');
      if (message) message.textContent = error instanceof Error ? error.message : 'Не удалось удалить товар.';
      confirm.disabled = false;
    }
  });
  return layer;
}

// The stock is the only product entity. Service stores a final retail price
// overlay through its existing products dataset; no changes to Inventory.
// The main product card stays in Z. A compact X edits only the retail
// price and the same workplace assignments used by Service → Услуги.
// A stocked product is edited in the standard Q, like a Procedure.
// Stock still owns its identity/cost/stock. Service owns the final retail price,
// future-facing promotional description and custom group selection.
function openInventoryRetailEditorQ(itemId, {
  onSaved = () => {}, onChanged = () => {}, onDeleted = () => {},
} = {}) {
  const product = getProducts().find(item => item.inventoryOwned
    && String(item.inventoryItemId) === String(itemId));
  if (!product) return openNotice({
    title: 'Товары', message: 'Товар больше не находится в продаже.',
  });

  const value = Number(product.cost?.amount || 0);
  // These are read-only Stock facts, displayed with the SAME field geometry
  // as Service → Услуги, not a second set of price editors.
  const purchase = product.stockPurchasePrice == null
    ? '—' : money(product.stockPurchasePrice);
  const markup = product.stockMarkupValue == null
    || !Number.isFinite(Number(product.stockMarkupValue))
    ? '—' : product.stockMarkupMode === 'amount'
      ? money(product.stockMarkupValue)
      : String(product.stockMarkupValue) + ' %';
  const estimated = product.calculatedSalePrice == null
    ? '—' : money(product.calculatedSalePrice);

  const content = [
    '<form class="compact-form" data-service-retail-price-form>',
    field({ label: 'Наименование товара', name: 'serviceRetailName',
      value: product.name || '', readonly: true }),
    '<div class="cost-field" data-service-price-section>',
    '<span class="cost-field__label">Стоимость</span>',
    '<div class="inventory-editor-row inventory-editor-row--three">',
    field({ label: 'Закупочная цена', value: purchase, readonly: true }),
    field({ label: 'Наценка', value: markup, readonly: true }),
    field({ label: 'Расчётная цена', value: estimated, readonly: true }),
    '</div>',
    field({ label: 'Цена продажи, ₽', name: 'serviceRetailPrice',
      type: 'number', min: '0', step: '0.01', inputmode: 'decimal',
      value: String(value) }),
    '</div>',
    textareaField({ label: 'Описание', name: 'serviceRetailAbout',
      value: product.about || '', rows: 5, maxlength: 5000,
      placeholder: 'Описание товара для будущего публичного показа' }),
    serviceGroupFields('products', product.groupValues || {}),
    '<div class="app-settings-panel">',
    compactCheck({ label: 'Для онлайн-записи', checked: false, disabled: true }),
    '</div>',
    serviceWorkplaceAssignmentList(),
    '<div class="form-error" data-service-retail-price-error role="alert"></div>',
    '</form>',
    actionBlock(button('Сохранить', {
      type: 'button', data: 'data-service-retail-price-apply',
    })),
    '<div class="app-settings-panel service-workplace-add-panel">',
    serviceWorkplaceAddButton(),
    '</div>',
    '<div class="app-settings-panel">',
    button('Снять с продажи', {
      type: 'button', variant: 'danger', data: 'data-service-retail-product-delete',
    }),
    '</div>',
  ].join('');

  const layer = mountModal(document.body, modal(content, {
    title: product.name || 'Товар',
    variant: 'q', surface: 'app', className: 'service-product-editor-layer',
  }));
  if (!layer) return null;
  const form = layer.querySelector('[data-service-retail-price-form]');
  const input = form?.querySelector('[name="serviceRetailPrice"]');
  const about = form?.querySelector('[name="serviceRetailAbout"]');
  const primary = layer.querySelector('[data-service-retail-price-apply]');
  const actions = primary?.closest('.modal-actions');
  const error = layer.querySelector('[data-service-retail-price-error]');
  if (!form || !input || !about || !primary) return layer;

  const selectedGroups = () => form.querySelector('[data-service-group-level]')
    ? readServiceGroupFields(form) : product.groupValues || {};
  const signature = () => JSON.stringify({
    price: input.value.trim().replace(',', '.'),
    about: about.value.trim(),
    groups: selectedGroups(),
  });
  const initial = signature();
  let saving = false;
  let visible = null;
  const sync = () => {
    const changed = signature() !== initial;
    if (visible !== changed) setSharedActionVisible(actions, changed);
    visible = changed;
    setSharedProfilePrimary(primary, {
      visible: changed, label: 'Сохранить', disabled: saving,
    });
  };
  const publish = () => {
    const saved = getProducts().find(item => item.inventoryOwned
      && String(item.inventoryItemId) === String(itemId));
    if (saved) onSaved(saved);
    onChanged();
  };

  bindServiceWorkplaceAssignments(layer, {
    kind: 'product',
    selected: product.workplaces,
    getBase: () => ({
      cost: getProducts().find(item => item.inventoryOwned
        && String(item.inventoryItemId) === String(itemId))?.cost || product.cost,
      description: about.value,
    }),
    onPersistAssignment: async (workplaceId, assignment) => {
      await commitInventoryProductWorkplace(itemId, workplaceId, assignment);
      publish();
    },
  });

  form.addEventListener('input', sync);
  form.addEventListener('change', sync);
  const save = async () => {
    if (saving || signature() === initial) return;
    saving = true;
    sync();
    if (error) error.textContent = '';
    try {
      await commitInventoryProductPresentation(itemId, {
        price: input.value, about: about.value, groupValues: selectedGroups(),
      });
      layer.v2Close?.();
      publish();
    } catch (cause) {
      if (error) error.textContent = cause instanceof Error
        ? cause.message : 'Не удалось сохранить товар.';
    } finally {
      saving = false;
      if (layer.isConnected) sync();
    }
  };
  primary.addEventListener('click', () => { void save(); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    void save();
  });
  layer.querySelector('[data-service-retail-product-delete]')?.addEventListener(
    'click', () => {
      confirmDeleteProduct(product, () => {
        layer.v2Close?.();
        onDeleted(product);
        onChanged();
      });
    },
  );
  sync();
  return layer;
}

function productEditorForm(product) {
  return `<form class="compact-form" data-product-editor-form>
    ${field({ label: 'Название', name: 'productName', value: product.name || '', placeholder: 'Название товара', required: true })}
    ${costField({ value: product.cost || {}, name: 'productCost' })}
    ${textareaField({ label: 'Описание', name: 'productAbout', value: product.about || '', rows: 7, maxlength: 5000, placeholder: 'Описание товара' })}
    ${serviceGroupFields('products', product.groupValues || {})}
    ${serviceWorkplaceAssignmentList()}
    <div class="form-error" role="alert" data-product-editor-error></div>
  </form>`;
}

// Stock catalog owns new products. A Service product must never create a
// second inventory entity or overwrite inventory data through auxiliary-state.
// Both entry points create ONE stock position. From Service → Товары the
// existing Inventory Q opens directly with «Продажа» checked; there is no
// second Service product form and no second item identity.
export async function openStockSaleCreate(root, { onChanged = () => {} } = {}) {
  const { loadInventory } = await import('../../inventory/service.js');
  try { await loadInventory(); }
  catch (error) {
    openNotice({ title: 'Остатки', message: error instanceof Error
      ? error.message : 'Не удалось загрузить склад.' });
    return null;
  }
  const { openItemEditor } = await import('../../inventory/inventory.js');
  return openItemEditor(root, '', { usage: 'sale' }, () => onChanged());
}

// One editor for legacy Service data; stocked items always open Inventory.
// The service card opens Q directly; there is no V button menu or Z editor.
export function openProductEditor(root, existing = null, {
  onChanged = () => {},
  onSaved = () => {},
  onDeleted = () => {},
} = {}) {
  if (existing?.inventoryItemId) {
    return openInventoryRetailEditorQ(existing.inventoryItemId, { onSaved, onChanged, onDeleted });
  }
  const draft = initialProduct(existing);
  const body = [
    productEditorForm(draft),
    actionBlock(button('Сохранить', { type: 'button', data: 'data-product-editor-primary', aria: 'Сохранить товар' })),
    `<div class="app-settings-panel service-workplace-add-panel">${serviceWorkplaceAddButton()}</div>`,
    existing ? `<div class="app-settings-panel">${button('Удалить товар', {
      type: 'button',
      variant: 'danger',
      data: 'data-product-editor-delete',
    })}</div>` : '',
  ].join('');
  const layer = mountModal(document.body, modal(body, {
    title: existing?.name || 'Новый товар',
    variant: 'q',
    surface: 'app',
    className: 'service-product-editor-layer',
  }));
  if (!layer) return null;

  initCostFields(layer);
  const form = layer.querySelector('[data-product-editor-form]');
  const primary = layer.querySelector('[data-product-editor-primary]');
  if (!form || !primary) return layer;

  const signature = () => {
    const data = new FormData(form);
    return productEditorSignature({
      name: data.get('productName'),
      cost: collectCost(layer, 'productCost'),
      description: data.get('productAbout'),
      workplaces: draft.workplaces,
    }) + JSON.stringify(readServiceGroupFields(form));
  };
  let initialSignature = signature();
  const actions = primary.closest('.modal-actions');
  let visible = null;
  let wasBusy = null;
  let saving = false;
  let assignmentSaving = false;
  const syncDirty = () => {
    const changed = signature() !== initialSignature;
    const busy = saving || assignmentSaving;
    if (visible === changed && wasBusy === busy) return changed;
    if (visible !== changed) setSharedActionVisible(actions, changed);
    visible = changed;
    wasBusy = busy;
    setSharedProfilePrimary(primary, { visible: changed, label: 'Сохранить', disabled: busy });
    return changed;
  };

  bindServiceWorkplaceAssignments(layer, {
    kind: 'product',
    selected: draft.workplaces,
    getBase: () => {
      const stored = existing?.id ? getProducts().find((item) => item.id === existing.id) || existing : null;
      return {
        cost: stored?.cost || collectCost(layer, 'productCost'),
        description: stored?.about ?? form.querySelector('[name="productAbout"]')?.value ?? '',
      };
    },
    onChange: (workplaces) => {
      draft.workplaces = workplaces;
      syncDirty();
    },
    onPersistAssignment: async (workplaceId, assignment) => {
      if (!existing?.id) return;
      if (saving || assignmentSaving) throw new Error('Дождитесь завершения сохранения.');
      assignmentSaving = true;
      syncDirty();
      try {
        await commitProductWorkplace(existing.id, workplaceId, assignment);
        initialSignature = rebaseWorkplaceAssignmentSignature(initialSignature, workplaceId, assignment);
      } finally {
        assignmentSaving = false;
        syncDirty();
      }
    },
  });

  form.addEventListener('input', syncDirty);
  form.addEventListener('change', syncDirty);

  const save = async () => {
    if (saving || assignmentSaving || !syncDirty()) return null;
    const data = new FormData(form);
    const name = String(data.get('productName') || '').trim();
    const error = layer.querySelector('[data-product-editor-error]');
    if (!name) {
      if (error) error.textContent = 'Укажите название товара.';
      return null;
    }
    const price = collectCost(layer, 'productCost');
    const priceError = validateCostDefinition(price);
    if (priceError) {
      if (error) error.textContent = priceError;
      return null;
    }
    saving = true;
    setSharedProfilePrimary(primary, { visible: true, label: 'Сохранить', disabled: true });
    const item = {
      ...(existing || {}),
      id: existing?.id || crypto.randomUUID(),
      photo: String(draft.photo || existing?.photo || ''),
      name,
      cost: price,
      about: String(data.get('productAbout') || '').trim(),
      groupValues: form.querySelector('[data-service-group-level]')
        ? readServiceGroupFields(form) : draft.groupValues || {},
      workplaces: Array.isArray(draft.workplaces) ? draft.workplaces.map((value) => ({ ...value })) : [],
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await commitProduct(item);
    } catch (failure) {
      if (error) error.textContent = failure instanceof Error ? failure.message : 'Не удалось сохранить товар.';
      return null;
    } finally {
      saving = false;
      setSharedProfilePrimary(primary, { visible, label: 'Сохранить' });
    }
    if (error) error.textContent = '';
    layer.v2Close?.();
    onSaved(item);
    onChanged();
    return item;
  };
  primary?.addEventListener('click', () => { void save(); });
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });
  if (existing) {
    layer.querySelector('[data-product-editor-delete]')?.addEventListener('click', () => {
      confirmDeleteProduct(existing, () => {
        layer.v2Close?.();
        onDeleted(existing);
        onChanged();
      });
    });
  }
  syncDirty();
  notifyServiceContext();
  return layer;
}

function renderProductOverview(layer, baseRoot, id, { onChanged = () => {}, statistics = null } = {}) {
  const product = getProducts().find((item) => String(item.id) === String(id));
  if (!product) {
    layer.v2Close?.();
    onChanged();
    return;
  }
  layer.dataset.serviceOverview = 'product:' + id;
  layer.innerHTML = page([
    serviceHeaderContext({ title: product.name || 'Товар' }),
    productOverviewCard(product, statistics),
    productWorkplaceCards(product, statistics),
  ]);
  layer.querySelector('[data-product-open-editor]')?.addEventListener('click', () => {
    openProductEditor(baseRoot, product, {
      onSaved: (saved) => {
        if (layer.isConnected) renderProductOverview(layer, baseRoot, saved.id, { onChanged });
      },
      onDeleted: () => layer.v2Close?.(),
      onChanged,
    });
  });
  notifyServiceContext();
  if (!statistics) {
    scheduleServiceStatistics(layer, 'product', id, () => {
      const latest = getProducts().find((item) => String(item.id) === String(id));
      if (latest) renderProductOverview(layer, baseRoot, id, {
        onChanged,
        statistics: serviceItemStatistics('product', latest),
      });
    });
  }
}

export function openProductOverview(root, id, { onChanged = () => {} } = {}) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'service-product-overview-layer' }), { stack: true });
  if (!layer) return null;
  renderProductOverview(layer, root, id, { onChanged });
  return layer;
}
