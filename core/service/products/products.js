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
import { productEditorSignature, rebaseWorkplaceAssignmentSignature } from '../editor-signature.js';
import { scheduleServiceStatistics, serviceItemStatistics } from '../statistics.js';
import { productCardAppearance, productCardFields, productCardPhoto } from '../card-presentation.js';
import { commitDeleteProduct, getProducts, commitReorderProducts, commitProduct, commitProductWorkplace, commitInventoryRetailPrice, commitInventoryProductWorkplace } from './data.js';

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
    reorderHandle: !product.inventoryOwned,
    reorderAria: 'Изменить порядок',
    data: `data-product="${escapeHtml(product.id)}" data-reorder-id="${escapeHtml(product.id)}"`,
    aria: `Открыть товар ${product.name || ''}`,
  });
}

export function renderProductCatalog(host, { root = host, onChanged = () => {} } = {}) {
  const items = getProducts();
  host.innerHTML = items.length
    ? v2ListEntries(items.map(productRow))
    : emptyState('Товаров пока нет', 'Добавьте первый товар кнопкой «+».');

  host.querySelectorAll('[data-product]').forEach((node) => {
    node.addEventListener('click', async () => {
      const id = node.dataset.product;
      // Sale catalog owns only the retail presentation. Editing here must
      // never redirect to Inventory or change its calculated/stock prices.
      openProductOverview(root, id, { onChanged });
    });
  });

  // Stock items follow Inventory ordering; the auxiliary Service ordering
  // cannot reorder a combined catalog without dropping inventory identities.
  if (items.some(item => item.inventoryOwned)) return () => {};
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
  const layer = mountModal(document.body, modal(`<div class="modal-title"><h2>Удалить товар?</h2><p>${escapeHtml(product.name || 'Товар')} будет исключён из прайса. История сохранится.</p></div><div class="form-error" role="alert" data-product-delete-error></div><div class="modal-actions">${button('Удалить', { variant: 'danger', data: 'data-confirm-delete-product' })}${button('Отмена', { variant: 'secondary', data: 'data-cancel-delete-product' })}</div>`, {
    variant: 'x',
    title: 'Удаление товара',
  }));
  if (!layer) return null;
  layer.querySelector('[data-cancel-delete-product]')?.addEventListener('click', () => layer.v2Close?.());
  const confirm = layer.querySelector('[data-confirm-delete-product]');
  confirm?.addEventListener('click', async () => {
    if (confirm.disabled) return;
    confirm.disabled = true;
    try {
      await commitDeleteProduct(product.id);
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
function openInventoryRetailEditorX(itemId, { onSaved = () => {}, onChanged = () => {} } = {}) {
  const product = getProducts().find(item => item.inventoryOwned
    && String(item.inventoryItemId) === String(itemId));
  if (!product) return openNotice({ title: 'Товары', message: 'Товар больше не находится в продаже.' });
  const calculated = product.calculatedSalePrice;
  const value = Number(product.cost?.amount || 0);
  const content = '<form data-service-retail-price-form>' +
    '<div class="inventory-editor-row">' +
      '<span class="inventory-editor-label">Расчётная цена (Склад)</span>' +
      '<strong>' + escapeHtml(calculated == null ? '—' : money(calculated)) + '</strong>' +
    '</div>' +
    field({ label: 'Цена продажи, ₽', name: 'serviceRetailPrice',
      type: 'number', min: '0', step: '0.01', inputmode: 'decimal',
      value: String(value) }) +
    serviceWorkplaceAssignmentList() +
    '<div class="app-settings-panel service-workplace-add-panel">' +
      serviceWorkplaceAddButton() + '</div>' +
    '<div class="form-error" data-service-retail-price-error role="alert"></div>' +
    actionBlock(button('Применить', { type: 'submit', data: 'data-service-retail-price-apply' })) +
  '</form>';
  const layer = mountModal(document.body, modal(content, {
    title: product.name || 'Цена продажи', variant: 'x', xRole: 'editor', surface: 'app',
  }));
  if (!layer) return null;
  const form = layer.querySelector('[data-service-retail-price-form]');
  const input = form?.querySelector('[name="serviceRetailPrice"]');
  const apply = layer.querySelector('[data-service-retail-price-apply]');
  const actions = apply?.closest('.modal-actions');
  const error = layer.querySelector('[data-service-retail-price-error]');
  if (!form || !input || !apply) return layer;

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
      description: '',
    }),
    onPersistAssignment: async (workplaceId, assignment) => {
      await commitInventoryProductWorkplace(itemId, workplaceId, assignment);
      publish();
    },
  });

  let saving = false;
  const initial = String(value);
  const sync = () => setSharedActionVisible(actions, saving || input.value.trim() !== initial);
  input.addEventListener('input', sync);
  sync();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    apply.disabled = true;
    if (error) error.textContent = '';
    try {
      await commitInventoryRetailPrice(itemId, input.value);
      layer.v2Close?.();
      publish();
    } catch (cause) {
      if (error) error.textContent = cause instanceof Error
        ? cause.message : 'Не удалось сохранить цену продажи.';
      saving = false;
      apply.disabled = false;
      sync();
    }
  });
  return layer;
}

function productEditorForm(product) {
  return `<form class="compact-form" data-product-editor-form>
    ${field({ label: 'Название', name: 'productName', value: product.name || '', placeholder: 'Название товара', required: true })}
    ${costField({ value: product.cost || {}, name: 'productCost' })}
    ${textareaField({ label: 'Описание', name: 'productAbout', value: product.about || '', rows: 7, maxlength: 5000, placeholder: 'Описание товара' })}
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
    return openInventoryRetailEditorX(existing.inventoryItemId, { onSaved, onChanged });
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
    });
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
