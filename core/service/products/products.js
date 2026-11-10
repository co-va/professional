import {
  actionBlock,
  button,
  collectCost,
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
  mountV2ZLayer,
  page,
  setSharedProfilePrimary,
  textareaField,
  v2ListEntries,
  v2ListEntry,
  v2ZLayer,
  workplaceCountText,
} from '../../../ui/ui.js';
import { getSettlementItemTotals, getSettlementItemTotalsForRecords } from '../../../core/finance/index.js';
import { getRecords } from '../../../core/record/index.js';
import { getWorkplaces } from '../../profile/workplaces/data.js';
import { serviceHeaderContext, notifyServiceContext } from '../context.js';
import { bindServiceWorkplaceSelection, serviceWorkplaceChecklist } from '../workplace-selection.js';
import { flushBusinessPersistence } from '../../../core/business-persistence.js';
import { productCardAppearance, productCardFields, productCardPhoto } from '../card-presentation.js';
import { deleteProduct as deleteProductData, getProducts, pushProductHistory, reorderProducts, saveProduct as saveProductData } from './data.js';

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

function activeProductRecords(productId, workplaceId = '') {
  const id = String(productId || '');
  const workspace = String(workplaceId || '');
  return getRecords().filter((record) => record?.status !== 'cancelled'
    && (!workspace || String(record?.workplaceId || '') === workspace)
    && (record?.products || []).some((item) => String(item?.id || '') === id));
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
  host.innerHTML = items.length
    ? v2ListEntries(items.map(productRow))
    : emptyState('Товаров пока нет', 'Добавьте первый товар кнопкой «+».');

  host.querySelectorAll('[data-product]').forEach((node) => {
    node.addEventListener('click', () => openProductOverview(root, node.dataset.product, { onChanged }));
  });

  return initV2ListReorder(host, {
    onReorder: (ids) => {
      if (reorderProducts(ids)) onChanged();
    },
  });
}

function productOverviewCard(product) {
  const records = activeProductRecords(product.id);
  const fact = getSettlementItemTotals('product', product.id);
  return entityVisualCard({
    appearance: productCardAppearance(product),
    fields: productCardFields(product, {
      saleCount: records.length,
      revenue: fact.factTotal,
    }),
    image: productCardPhoto(product),
    className: 'entity-visual-card--service',
    interactive: true,
    data: 'data-product-open-editor',
    aria: `Редактировать товар ${product.name || ''}`,
  });
}

function productWorkplaceCards(product) {
  const byId = new Map(getWorkplaces().map((workplace) => [String(workplace.key || workplace.id || ''), workplace]));
  const cards = (product.workplaces || []).map((selection) => {
    const id = String(selection.workplaceId || selection.id || selection.key || '');
    const workplace = byId.get(id) || selection;
    const records = activeProductRecords(product.id, id);
    const fact = getSettlementItemTotalsForRecords('product', product.id, records.map((record) => record.id));
    return miniCard({
      title: workplace.name || selection.name || 'Рабочее пространство',
      rows: [
        { label: 'Кол-во', value: String(records.length) },
        { label: 'Сумма', value: money(fact.factTotal) },
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
      if (!deleteProductData(product.id)) throw new Error('Товар уже удалён.');
      await flushBusinessPersistence();
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

function productEditorForm(product) {
  return `<form class="compact-form" data-product-editor-form>
    ${field({ label: 'Название', name: 'productName', value: product.name || '', placeholder: 'Название товара', required: true })}
    ${costField({ value: product.cost || {}, name: 'productCost' })}
    ${textareaField({ label: 'Описание', name: 'productAbout', value: product.about || '', rows: 7, maxlength: 5000, placeholder: 'Описание товара' })}
    <div class="field">
      <span>Рабочие пространства</span>
      ${serviceWorkplaceChecklist(product.workplaces)}
    </div>
    <div class="form-error" role="alert" data-product-editor-error></div>
  </form>`;
}

// One editor for create, update, workplace assignments, and delete.
// The service card opens Q directly; there is no V button menu or Z editor.
export function openProductEditor(root, existing = null, {
  onChanged = () => {},
  onSaved = () => {},
  onDeleted = () => {},
} = {}) {
  const draft = initialProduct(existing);
  const body = [
    productEditorForm(draft),
    actionBlock(button('Сохранить', { type: 'button', data: 'data-product-editor-primary', aria: 'Сохранить товар' })),
    existing ? `<div class="app-settings-panel">${button('Удалить товар', {
      type: 'button',
      variant: 'outline',
      className: 'ui-button--delete-outline',
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
  bindServiceWorkplaceSelection(layer, {
    selected: draft.workplaces,
    onChange: (workplaces) => { draft.workplaces = workplaces; },
  });

  const form = layer.querySelector('[data-product-editor-form]');
  const primary = layer.querySelector('[data-product-editor-primary]');
  let saving = false;
  const save = async () => {
    if (saving || !form) return null;
    const data = new FormData(form);
    const name = String(data.get('productName') || '').trim();
    const error = layer.querySelector('[data-product-editor-error]');
    if (!name) {
      if (error) error.textContent = 'Укажите название товара.';
      return null;
    }
    saving = true;
    setSharedProfilePrimary(primary, { visible: true, label: 'Сохранить', disabled: true });
    const item = {
      ...(existing || {}),
      id: existing?.id || crypto.randomUUID(),
      photo: String(draft.photo || existing?.photo || ''),
      name,
      cost: collectCost(layer, 'productCost'),
      about: String(data.get('productAbout') || '').trim(),
      workplaces: Array.isArray(draft.workplaces) ? draft.workplaces.map((value) => ({ ...value })) : [],
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      if (existing) pushProductHistory(existing, 'updated');
      saveProductData(item);
      await flushBusinessPersistence();
    } catch (failure) {
      if (error) error.textContent = failure instanceof Error ? failure.message : 'Не удалось сохранить товар.';
      return null;
    } finally {
      saving = false;
      setSharedProfilePrimary(primary, { visible: true, label: 'Сохранить' });
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
  setSharedProfilePrimary(primary, { visible: true, label: 'Сохранить' });
  notifyServiceContext();
  return layer;
}

function renderProductOverview(layer, baseRoot, id, { onChanged = () => {} } = {}) {
  const product = getProducts().find((item) => String(item.id) === String(id));
  if (!product) {
    layer.v2Close?.();
    onChanged();
    return;
  }
  layer.innerHTML = page([
    serviceHeaderContext({ title: product.name || 'Товар' }),
    productOverviewCard(product),
    productWorkplaceCards(product),
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
}

export function openProductOverview(root, id, { onChanged = () => {} } = {}) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'service-product-overview-layer' }), { stack: true });
  if (!layer) return null;
  renderProductOverview(layer, root, id, { onChanged });
  return layer;
}
