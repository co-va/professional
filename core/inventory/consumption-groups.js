import {
  actionBlock, button, compactButton, emptyState, escapeHtml, field,
  list, modal, mountModal, openNotice, page, select, workspaceHeaderContext,
} from '../../ui/ui.js';
import { apiRequest } from '../auth.js';
import { getInventoryItems } from './data.js';
import { loadInventory } from './service.js';
import { inventoryCriterionGroups } from './classification.js';
import { buildStockCatalogGroups, renderStockBrandList, stockGroupedSections } from './stock-catalog.js';

const PATH = '/inventory/consumption-groups';
const UNIT_OPTIONS = [
  { value: 'г', label: 'г' }, { value: 'мл', label: 'мл' },
  { value: 'шт.', label: 'шт.' }, { value: 'уп.', label: 'уп.' },
  { value: 'кг', label: 'кг' }, { value: 'л', label: 'л' },
  { value: 'м', label: 'м' }, { value: 'см', label: 'см' },
  { value: 'м²', label: 'м²' }, { value: 'пара', label: 'пара' },
  { value: 'компл.', label: 'компл.' },
];
const text = value => String(value ?? '').trim();
const quantityText = value => Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
const money = value => Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';

async function request(path = '', method = 'GET', body = null) {
  const response = await apiRequest(PATH + path, {
    method,
    ...(body !== null ? { headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(result.message) ? result.message.join('; ') : text(result.message);
    throw new Error(detail || 'Не удалось сохранить группу расхода.');
  }
  return result;
}

// These are references to physical stock items, not additional physical stock.
// Do not update inventory movements, lots, prices or stock balances here.
export function consumptionGroupDraft(group = null) {
  return {
    groupId: text(group?.groupId),
    name: text(group?.name),
    unit: text(group?.unit) || 'шт.',
    itemIds: [...new Set((Array.isArray(group?.itemIds) ? group.itemIds : [])
      .map(text).filter(Boolean))],
  };
}

function groupSubline(group) {
  const count = (group.itemIds || []).length;
  const countText = count + ' поз.';
  const balance = group.physicalBalance == null ? '' :
    ' · ' + quantityText(group.physicalBalance) + ' ' + group.unit;
  return countText + balance;
}

function openGroupItemPicker(draft, onApply) {
  const panel = [
    '<div data-consumption-group-chooser>',
      '<p class="ui-list__secondary" data-consumption-picker-status></p>',
      '<div data-consumption-picker-brand-list></div>',
      '<div data-consumption-picker-items hidden>',
        '<div class="ui-search-field">' +
          field({ name:'consumptionItemSearch',type:'search',
            placeholder:'Название, артикул, категория…' }) +
        '</div>',
        '<div data-consumption-picker-product-list></div>',
      '</div>',
    '</div>',
    actionBlock(button('Применить', { data:'data-consumption-picker-apply' })),
  ].join('');
  const layer = mountModal(document.body, modal(panel, {
    title:'Складские позиции', variant:'q', surface:'app', className:'inventory-consumption-picker',
  }));
  if (!layer) return null;
  const brandHost = layer.querySelector('[data-consumption-picker-brand-list]');
  const itemSection = layer.querySelector('[data-consumption-picker-items]');
  const itemHost = layer.querySelector('[data-consumption-picker-product-list]');
  const search = layer.querySelector('[name="consumptionItemSearch"]');
  const status = layer.querySelector('[data-consumption-picker-status]');
  const apply = layer.querySelector('[data-consumption-picker-apply]');
  const checked = new Set(draft.itemIds);
  const initial = new Set(draft.itemIds);
  let brand = null;
  let allItems = [];
  let criteria = [];

  const sync = () => {
    const changes = checked.size !== initial.size ||
      [...checked].some(id => !initial.has(id));
    apply.hidden = !changes;
    status.textContent = 'Выбрано: ' + checked.size;
  };
  const renderBrandItems = () => {
    if (!brand) return;
    const phrase = text(search.value).toLocaleLowerCase('ru-RU');
    const rows = (brand.items || []).filter(item => !phrase ||
      [item.name, item.catalogName, item.sku, item.barcode, item.category, item.productType]
        .some(value => text(value).toLocaleLowerCase('ru-RU').includes(phrase)));
    itemHost.innerHTML = rows.length
      ? stockGroupedSections(rows, checked, undefined, criteria)
      : emptyState('Позиции не найдены','Измените поиск.');
    sync();
  };
  itemHost.addEventListener('change', event => {
    const input = event.target.closest('[data-stock-item-check]');
    if (!input) return;
    const id = input.dataset.stockItemCheck;
    if (input.checked) checked.add(id);
    else checked.delete(id);
    sync();
  });
  // An existing stock row keeps its visual form; clicking it toggles the
  // adjacent check without opening an unrelated product card.
  itemHost.addEventListener('click', event => {
    const rowButton = event.target.closest('[data-stock-product]');
    if (!rowButton) return;
    const choice = rowButton.closest('.inventory-counterparty-product-row')
      ?.querySelector('[data-stock-item-check]');
    if (!choice) return;
    choice.checked = !choice.checked;
    choice.dispatchEvent(new Event('change', { bubbles:true }));
  });
  search.addEventListener('input', renderBrandItems);

  // Groups are discovered first, precisely as in Stock Z1.
  const showBrands = () => {
    brand = null;
    itemSection.hidden = true;
    brandHost.hidden = false;
    renderStockBrandList(brandHost, allItems, {
      criteria,
      onBrandOpen: next => {
        brand = next;
        brandHost.hidden = true;
        itemSection.hidden = false;
        search.value = '';
        renderBrandItems();
      },
    });
    sync();
  };

  layer.querySelector('[data-consumption-picker-apply]')?.addEventListener('click', () => {
    if (apply.hidden) return;
    const ordered = allItems.filter(item => checked.has(String(item.itemId))).map(item => String(item.itemId));
    // Retain selections for archived / temporarily unavailable positions.
    const retained = draft.itemIds.filter(id => checked.has(id) && !ordered.includes(id));
    layer.v2Close?.();
    onApply([...ordered, ...retained]);
  });
  const load = async () => {
    try {
      await loadInventory({ preferRecent:true });
      if (!layer.isConnected) return;
      allItems = getInventoryItems().filter(item => item.itemId && item.name);
      criteria = inventoryCriterionGroups();
      showBrands();
      // The shared top-left Q close returns from the picker. Do not create a
      // second navigation component or a replacement for Stock's grouping.
    } catch (error) {
      if (!layer.isConnected) return;
      status.textContent = error instanceof Error ? error.message : 'Склад недоступен.';
    }
  };
  status.textContent = 'Загружаем склад…';
  apply.hidden = true;
  void load();
  return layer;
}

function openGroupEditor(current, onSaved) {
  const draft = consumptionGroupDraft(current);
  const panel = [
    '<div class="compact-form" data-consumption-group-form>',
      field({ label:'Название', name:'consumptionGroupName',value:draft.name,
        placeholder:'Например, Шампунь',required:true }),
      select({ label:'Единица расхода', name:'consumptionGroupUnit', value:draft.unit,
        options:UNIT_OPTIONS }),
      '<div class="inventory-consumption-group-items">',
        '<strong>Складские позиции</strong>',
        '<div data-consumption-group-selected></div>',
      '</div>',
      button('Добавить позиции', { data:'data-consumption-group-pick' }),
      '<div class="form-error" role="alert" data-consumption-group-error></div>',
    '</div>',
    actionBlock(button('Сохранить', { data:'data-consumption-group-save' })),
  ].join('');
  const layer = mountModal(document.body, modal(panel, {
    title:current?.name || 'Новая группа расхода', variant:'q',
    surface:'app', className:'inventory-consumption-editor',
  }));
  if (!layer) return null;
  const name = layer.querySelector('[name="consumptionGroupName"]');
  const unit = layer.querySelector('[name="consumptionGroupUnit"]');
  const selected = layer.querySelector('[data-consumption-group-selected]');
  const save = layer.querySelector('[data-consumption-group-save]');
  const errorNode = layer.querySelector('[data-consumption-group-error]');
  const options = () => new Map(getInventoryItems().map(item => [String(item.itemId), item]));

  const renderSelection = () => {
    const stock = options();
    selected.innerHTML = draft.itemIds.length
      ? '<div class="ui-list ui-list--dense">' + draft.itemIds.map(id => {
        const label = text(stock.get(id)?.name) || 'Недоступная позиция';
        return '<div class="ui-list__item">' +
          '<span class="ui-list__main"><span class="ui-list__title">' +
          escapeHtml(label) + '</span></span>' +
          compactButton({ kind:'remove', data:'data-consumption-group-remove="' +
            escapeHtml(id) + '"', aria:'Убрать ' + label }) +
        '</div>';
      }).join('') + '</div>'
      : emptyState('Позиции не выбраны','Добавьте позиции из склада.');
  };
  selected.addEventListener('click', event => {
    const target = event.target.closest('[data-consumption-group-remove]');
    if (!target) return;
    draft.itemIds = draft.itemIds.filter(id => id !== target.dataset.consumptionGroupRemove);
    renderSelection();
  });
  layer.querySelector('[data-consumption-group-pick]')?.addEventListener('click', () => {
    openGroupItemPicker(draft, ids => {
      draft.itemIds = ids;
      renderSelection();
    });
  });
  // Do not wait for stock refresh just to open the editable group.
  void loadInventory({ preferRecent:true }).then(() => {
    if (layer.isConnected && !selected.contains(document.activeElement)) renderSelection();
  }).catch(() => {});
  save.addEventListener('click', async () => {
    const newName = text(name.value);
    const newUnit = text(unit.value);
    if (!newName) { errorNode.textContent = 'Укажите название группы.'; return; }
    if (!UNIT_OPTIONS.some(option => option.value === newUnit)) {
      errorNode.textContent = 'Выберите единицу расхода.'; return;
    }
    save.disabled = true;
    errorNode.textContent = '';
    try {
      await request(draft.groupId ? '/' + encodeURIComponent(draft.groupId) : '',
        draft.groupId ? 'PUT' : 'POST',
        { name:newName, unit:newUnit, itemIds:draft.itemIds });
      layer.v2Close?.();
      onSaved();
    } catch (error) {
      errorNode.textContent = error instanceof Error ? error.message : 'Не удалось сохранить группу.';
      save.disabled = false;
    }
  });
  renderSelection();
  return layer;
}

export function renderConsumptionGroups(root) {
  let disposed = false;
  root.innerHTML = page([
    workspaceHeaderContext({
      title:'Группы расхода',
      c:{ label:'+',data:'data-consumption-group-add',aria:'Добавить группу расхода' },
    }),
    '<div data-consumption-groups-list></div>',
  ]);
  const host = root.querySelector('[data-consumption-groups-list]');
  const refresh = async () => {
    host.innerHTML = emptyState('Загрузка','Загружаем группы расхода.');
    try {
      const result = await request();
      if (disposed || !root.isConnected) return;
      const groups = Array.isArray(result.groups) ? result.groups : [];
      host.innerHTML = groups.length ? list({ className:'ui-list--dense', items:groups.map(group => ({
        title:group.name,
        secondary:groupSubline(group),
        right:group.averageUnitCost == null ? '' : money(group.averageUnitCost) + '/' + group.unit,
        interactive:true,
        data:'data-consumption-group-open="' + escapeHtml(group.groupId) + '"',
        aria:'Открыть ' + group.name,
      })) }) : emptyState('Групп пока нет','Создайте первую группу расхода кнопкой «+».');
      host.querySelectorAll('[data-consumption-group-open]').forEach(node => {
        node.addEventListener('click', () => {
          const group = groups.find(row => String(row.groupId) === node.dataset.consumptionGroupOpen);
          if (group) openGroupEditor(group, () => { if (!disposed) void refresh(); });
        });
      });
    } catch (error) {
      if (disposed || !root.isConnected) return;
      host.innerHTML = emptyState('Не удалось загрузить группы',
        error instanceof Error ? error.message : 'Проверьте соединение.');
    }
  };
  root.querySelector('[data-consumption-group-add]')?.addEventListener('click',
    () => openGroupEditor(null, () => { if (!disposed) void refresh(); }));
  void refresh();
  return () => { disposed = true; };
}
