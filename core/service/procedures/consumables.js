import {
  actionBlock, button, compactButton, dataTable, emptyState, escapeHtml, field,
  list, modal, mountModal, openNotice, select,
} from '../../../ui/ui.js';
import { setSharedActionVisible } from '../../../ui/page/page.js';
import { moveDesktopQTool } from '../../../ui/v2/z-layout.js';
import { isV2DesktopWorkspace } from '../../../ui/v2/geometry.js';
import { getInventoryItems } from '../../inventory/data.js';
import { loadConsumptionGroups } from '../../inventory/consumption-groups.js';
import { checkControl } from '../../../ui/selection/check-list.js';
import { loadInventory } from '../../inventory/service.js';
import { commitProcedureConsumables, getProcedures } from './data.js';

const number = value => {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const money = value => new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
}).format(Math.round(value * 100) / 100) + ' ₽';

// Product identity alone is a valid consumable. Quantity is never mandatory.
export function normalizeProcedureConsumables(value = []) {
  const seen = new Set();
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const itemId = String(entry?.itemId || '').trim();
    if (!itemId || seen.has(itemId)) continue;
    const quantity = number(entry.quantity);
    if (quantity != null && !(quantity > 0))
      throw new Error('Расход должен быть больше нуля либо оставлен пустым.');
    seen.add(itemId);
    result.push({
      itemId,
      quantity,
      unit: String(entry.unit || '').trim(),
    });
  }
  return result;
}

export function procedureConsumableUnit(item = {}) {
  return String(item.consumeUnit || item.unit || '').trim();
}

// Match the existing Core stock conversion contract, independently of price.
// A sale/receipt unit is not automatically a consumption unit.
export function procedureConsumableFactor(item = {}, unit = '') {
  const stock = String(item.unit || '').trim();
  const usage = String(unit || '').trim();
  if (!stock || !usage) return null;
  if (stock === usage) return 1;
  const metric = { 'кг>г': 0.001, 'г>кг': 1000, 'л>мл': 0.001, 'мл>л': 1000,
    'м>см': 0.01, 'см>м': 100 };
  if (metric[stock + '>' + usage]) return metric[stock + '>' + usage];
  const rule = (Array.isArray(item.conversionRules) ? item.conversionRules : [])
    .find(value => String(value?.unit || '').trim() === usage);
  if (rule) {
    const factor = number(rule.stockPerUnit);
    return Number.isFinite(factor) && factor > 0 ? factor : null;
  }
  const nominal = number(item.nominalQuantity), pack = number(item.packageQuantity);
  if (String(item.nominalUnit || '').trim() === usage && nominal > 0 && pack > 0)
    return pack / nominal;
  if (usage === 'уп.' || (usage === 'шт.' && ['г','мл'].includes(stock))) {
    const net = number(item.netPackageWeight);
    return pack > 0 ? pack : stock === 'г' && net > 0 ? net : null;
  }
  return null;
}

export function procedureConsumableUnits(item = {}) {
  const candidates = [procedureConsumableUnit(item), item.unit,
    ...(Array.isArray(item.conversionRules) ? item.conversionRules.map(rule => rule?.unit) : []),
    item.nominalUnit, item.receiptUnit];
  // Offer only actual documented options, not every theoretical metric alias.
  return [...new Set(candidates.map(unit => String(unit || '').trim()).filter(Boolean))]
    .filter(unit => procedureConsumableFactor(item, unit) != null);
}

// Value per chosen consumption unit only when its conversion is documented.
// A supplier's pack price must never be guessed to be a per-gram price.
export function procedureConsumableCost(item = {}, unit = '') {
  const stock = String(item.unit || '').trim();
  const usage = String(unit || stock).trim();
  if (!stock || !usage) return null;
  let price = number(item.baseUnitPrice);
  // An unconverted pack price is not the price of one glove or one gram.
  // A direct per-piece/pack quote is usable only when receipt and stock units
  // are explicitly the same physical unit.
  if (price == null && (stock === 'шт.' || stock === 'уп.')
    && String(item.receiptUnit || '').trim() === stock)
    price = number(item.basePrice);
  if (price == null || !(price >= 0)) return null;
  const factor = procedureConsumableFactor(item, usage);
  return factor == null ? null : price * factor;
}

export function procedureConsumableSummary(rows = [], items = []) {
  const byId = new Map(items.map(item => [String(item.itemId), item]));
  let total = 0;
  let calculated = 0;
  let missing = 0;
  for (const row of rows) {
    const item = byId.get(String(row.itemId));
    const quantity = number(row.quantity);
    const unitPrice = item && quantity > 0
      ? procedureConsumableCost(item, row.unit || procedureConsumableUnit(item))
      : null;
    if (unitPrice == null) { missing++; continue; }
    total += quantity * unitPrice;
    calculated++;
  }
  return { total, calculated, missing, complete: rows.length > 0 && missing === 0 };
}

// Group norms and concrete stock items have separate identities. A norm is
// never converted into an arbitrary physical item or a stock movement.
export function normalizeProcedureGroupNorms(value = []) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).map(row => {
    const groupId = String(row?.groupId || '').trim();
    const quantity = number(row?.quantity);
    const unit = String(row?.unit || '').trim();
    if (!groupId || seen.has(groupId) || !unit || !(quantity > 0))
      throw new Error('Укажите количество расхода для каждой группы.');
    seen.add(groupId);
    return { groupId, name: String(row.name || '').trim(), quantity, unit };
  });
}

export function openConsumablePicker(selected, onPick, { anchor = null, multiple = false, groupRows = null } = {}) {
  const groupMode = Array.isArray(groupRows);
  const desktop = isV2DesktopWorkspace(anchor?.closest('[data-v2-app]') || document.querySelector('.v2-app--workspace'));
  if (desktop && anchor) anchor.dataset.v2AnchorWidth = '520';
  const title = groupMode ? 'Группы' : 'Позиции';
  const searchField = field({ label: '', name: 'consumableSearch', type: 'search',
    data: 'aria-label="Поиск"',
    placeholder: groupMode ? 'Название группы' : 'Название, производитель или артикул' });
  const panel = (desktop
    ? '<div class="desktop-table-picker-tools">' + searchField + '</div>'
    : searchField) +
    '<div data-consumable-choices></div>' +
    (multiple ? actionBlock(button('Применить', { data: 'data-consumable-picker-apply' }), { className: 'consumable-picker-apply' }) : '');
  const layer = mountModal(desktop && anchor ? anchor : document.body, modal(panel, {
    title, variant: 'x',
    ...(desktop ? { className: 'desktop-table-popup service-consumable-picker', surface: 'app', xRole: 'picker' } : {}),
  }));
  if (!layer) return null;
  const search = layer.querySelector('[name="consumableSearch"]');
  const host = layer.querySelector('[data-consumable-choices]');
  const apply = layer.querySelector('[data-consumable-picker-apply]');
  const chosen = new Map();
  const sync = () => {
    if (apply) {
      const action = apply.closest('.modal-actions');
      if (action) action.hidden = !chosen.size;
      apply.disabled = !chosen.size;
    }
  };
  const choices = () => groupMode ? groupRows.map(group => ({
    id: String(group.groupId), title: group.name, secondary: group.unit,
    payload: { groupId: String(group.groupId), name: group.name, unit: group.unit, quantity: null },
    search: [group.name],
  })) : getInventoryItems().map(item => ({
    id: String(item.itemId), title: item.name || 'Позиция',
    secondary: [item.manufacturer, item.sku].filter(Boolean).join(' · '),
    payload: { itemId: String(item.itemId), quantity: null, unit: procedureConsumableUnit(item) },
    search: [item.name, item.manufacturer, item.sku],
  }));
  const choose = (id, checked = true) => {
    const row = choices().find(item => item.id === id);
    if (!row || selected.has(id)) return;
    if (multiple) {
      if (checked) chosen.set(id, row.payload);
      else chosen.delete(id);
      sync();
    } else {
      layer.v2Close?.();
      onPick(row.payload);
    }
  };
  apply?.addEventListener('click', () => {
    if (!chosen.size) return;
    const result = [...chosen.values()];
    layer.v2Close?.();
    onPick(result);
  });
  const render = () => {
    const needle = String(search?.value || '').trim().toLocaleLowerCase('ru-RU');
    const items = choices().filter(item => !selected.has(item.id) &&
      item.search.some(value => String(value || '').toLocaleLowerCase('ru-RU').includes(needle)));
    const visible = items.slice(0, 80);
    const rowMarkup = row => {
      const text = '<span class="desktop-table-picker-copy"><strong>' + escapeHtml(row.title) + '</strong>' +
        (row.secondary ? '<small>' + escapeHtml(row.secondary) + '</small>' : '') + '</span>';
      if (multiple) return '<label class="desktop-table-picker-item desktop-table-picker-check">' +
        checkControl({ checked: chosen.has(row.id), data: 'data-consumable-check="' + escapeHtml(row.id) + '"',
          aria: row.title }) + text + '</label>';
      return '<button type="button" class="desktop-table-picker-item" data-consumable-pick="' +
        escapeHtml(row.id) + '" aria-label="Добавить ' + escapeHtml(row.title) + '">' + text + '</button>';
    };
    if (desktop) host.innerHTML = dataTable({
      compact: true, caption: title,
      columns: [{ key: 'title', label: groupMode ? 'Группа' : 'Позиция', sortable: false,
        render: row => row.id ? rowMarkup(row) : escapeHtml(row.title) }],
      rows: visible.length ? visible : [{ title: groupMode ? 'Группы не найдены' : 'Позиции не найдены' }],
    });
    else if (multiple) host.innerHTML = visible.length
      ? '<div class="ui-check-list">' + visible.map(row => rowMarkup(row).replace('desktop-table-picker-item desktop-table-picker-check','ui-check-list__item')).join('') + '</div>'
      : emptyState(groupMode ? 'Группы не найдены' : 'Позиции не найдены');
    else host.innerHTML = visible.length ? list({
      className: 'ui-list--dense',
      items: visible.map(row => ({ title: row.title, secondary: row.secondary, interactive: true,
        data: 'data-consumable-pick="' + escapeHtml(row.id) + '"', aria: 'Добавить ' + row.title })),
    }) : emptyState(groupMode ? 'Группы не найдены' : 'Позиции не найдены');
    if (items.length > visible.length) host.insertAdjacentHTML('beforeend',
      '<p class="ui-list__secondary">Показано ' + visible.length + ' из ' + items.length + '</p>');
    host.querySelectorAll('[data-consumable-pick]').forEach(node =>
      node.addEventListener('click', () => choose(node.dataset.consumablePick)));
    host.querySelectorAll('[data-consumable-check]').forEach(input =>
      input.addEventListener('change', () => choose(input.dataset.consumableCheck, input.checked)));
    sync();
  };
  search?.addEventListener('input', render);
  render();
  return layer;
}

export async function openProcedureConsumables(procedureId, onSaved = () => {}) {
  // Open Q before refreshing stock. Existing consumables remain editable.
  const current = getProcedures().find(item => String(item.id) === String(procedureId));
  if (!current) return openNotice({ title: 'Расходник', message: 'Услуга не найдена.' });
  let rows = normalizeProcedureConsumables(current.consumables);
  let norms = (Array.isArray(current.consumableGroupNorms) ? current.consumableGroupNorms : [])
    .map(row => ({ ...row }));
  let stockGroups = [];
  let groupsLoaded = false;
  const signature = () => {
    try { return JSON.stringify([normalizeProcedureConsumables(rows), normalizeProcedureGroupNorms(norms)]); }
    catch { return JSON.stringify([rows, norms]); }
  };
  const initial = signature();
  const panel = '<div data-procedure-consumable-items></div>' +
    '<p class="ui-list__secondary" data-procedure-consumable-cost></p>' +
    '<div class="app-settings-panel">' +
      compactButton({ kind: 'add', className: 'v2-desktop-tool-primary', data: 'data-procedure-consumable-add', aria: 'Добавить расходник' }) +
    '</div>' +
    '<div class="form-error" role="alert" data-procedure-consumable-error></div>' +
    actionBlock(button('Применить', { data: 'data-procedure-consumable-save' }));
  const layer = mountModal(document.body, modal(panel, {
    title: 'Расходник', variant: 'q', surface: 'app', className: 'service-consumables-q',
  }));
  if (!layer) return null;
  const host = layer.querySelector('[data-procedure-consumable-items]');
  const costNode = layer.querySelector('[data-procedure-consumable-cost]');
  const errorNode = layer.querySelector('[data-procedure-consumable-error]');
  const save = layer.querySelector('[data-procedure-consumable-save]');
  const actions = save?.closest('.modal-actions');
  const add = layer.querySelector('[data-procedure-consumable-add]');
  const desktop = moveDesktopQTool(add);
  if (desktop) moveDesktopQTool(save, { desktopLabel: 'Сохранить' });
  let saving = false;
  const sync = () => {
    if (costNode) {
      costNode.hidden = !rows.length && !norms.length;
      const exact = procedureConsumableSummary(rows, getInventoryItems());
      const byGroup = new Map(stockGroups.map(group => [String(group.groupId), group]));
      let total = exact.total, calculated = exact.calculated, missing = exact.missing;
      for (const norm of norms) {
        const group = byGroup.get(String(norm.groupId));
        const price = group?.unit === norm.unit ? number(group.averageUnitCost) : null;
        const quantity = number(norm.quantity);
        if (price == null || !(price >= 0) || !(quantity > 0)) { missing++; continue; }
        total += price * quantity;
        calculated++;
      }
      costNode.textContent = !calculated ? 'Себестоимость: не рассчитана'
        : (missing ? 'Рассчитано: ' : 'Себестоимость: ') + money(total) +
          (missing ? ' · не все расходы указаны' : '');
    }
    setSharedActionVisible(actions, signature() !== initial);
    if (save) save.disabled = saving;
    if (add) add.disabled = saving;
  };
  const render = () => {
    const inventory = new Map(getInventoryItems().map(item => [String(item.itemId), item]));
    const groupMap = new Map(stockGroups.map(group => [String(group.groupId), group]));
    if (desktop) {
      const entries = [
        ...norms.map((row, index) => {
          const group = groupMap.get(String(row.groupId));
          return { ...row, index, kind: 'group', title: group?.name || row.name || 'Группа недоступна',
            subtitle: groupsLoaded && !group ? 'Группа недоступна' : 'Группа' };
        }),
        ...rows.map((row, index) => {
          const item = inventory.get(String(row.itemId));
          return { ...row, index, kind: 'position', title: item?.name || 'Позиция недоступна',
            subtitle: item?.manufacturer || '', unit: row.unit || procedureConsumableUnit(item),
            units: item ? procedureConsumableUnits(item) : [] };
        }),
      ];
      const quantityCell = row => row.kind ? '<div class="desktop-inline-capacity">' +
        field({ name: 'consumableQuantity-' + row.kind + '-' + row.index, type: 'number',
          min: '0.000001', step: 'any', inputmode: 'decimal', placeholder: '—',
          value: row.quantity ?? '', data: (row.kind === 'group'
            ? 'data-consumable-norm-quantity' : 'data-consumable-quantity') +
            ' data-consumable-index="' + row.index + '" aria-label="Расход ' + escapeHtml(row.title) + '"' }) +
        '</div>' : '';
      const unitCell = row => {
        if (!row.kind) return '';
        const units = row.kind === 'position' ? row.units : [];
        // Retain a historical unit even when the current stock settings changed.
        // It is never used as a fabricated conversion.
        if (units.length > 1 || (units.length === 1 && row.unit && !units.includes(row.unit))) {
          const options = units.includes(row.unit) || !row.unit ? units : [row.unit, ...units];
          return select({ name: 'consumableUnit-' + row.index, value: row.unit,
            aria: 'Единица расхода ' + row.title, options,
            data: 'data-consumable-unit="' + row.index + '"' });
        }
        return escapeHtml(row.unit || units[0] || '—');
      };
      host.innerHTML = dataTable({ compact: true, caption: 'Расходники',
        columns: [
          { key: 'title', label: 'Наименование', sortable: false, render: row =>
            '<span class="service-consumable-title">' + escapeHtml(row.title) + '</span>' +
            (row.subtitle ? '<small class="service-consumable-subtitle">' + escapeHtml(row.subtitle) + '</small>' : '') },
          { key: 'quantity', label: 'Расход', sortable: false, narrow: true, render: quantityCell },
          { key: 'unit', label: 'Ед.', sortable: false, narrow: true, render: unitCell },
          { key: 'remove', label: '', sortable: false, narrow: true, render: row => row.kind
            ? compactButton({ kind: 'remove', aria: 'Убрать ' + row.title,
              data: (row.kind === 'group' ? 'data-consumable-norm-remove' : 'data-consumable-remove') +
                '="' + row.index + '"' }) : '' },
        ],
        rows: entries.length ? entries : [{ title: 'Расходников пока нет' }],
      });
      sync();
      return;
    }
    const normMarkup = norms.map((row, index) => {
      const group = groupMap.get(String(row.groupId));
      const title = group?.name || row.name || 'Группа недоступна';
      return '<div class="ui-list__item service-consumable-norm" data-consumable-norm-row="' + index + '">' +
        '<span class="ui-list__main"><span class="ui-list__title">' + escapeHtml(title) + '</span>' +
        '<span class="ui-list__secondary">' + escapeHtml(groupsLoaded && !group ? 'Группа недоступна' : 'Группа расхода') + '</span></span>' +
        '<span class="service-consumable-inline-quantity">' +
        field({ name: 'normQuantity' + index, type: 'number', min: '0.000001', step: 'any', inputmode: 'decimal',
          placeholder: '—', value: row.quantity ?? '', data: 'data-consumable-norm-quantity aria-label="Количество расхода"' }) +
        '<span>' + escapeHtml(row.unit) + '</span></span>' +
        compactButton({ kind: 'remove', data: 'data-consumable-norm-remove="' + index + '"', aria: 'Убрать ' + title }) +
        '</div>';
    }).join('');
    host.innerHTML = rows.length || norms.length ? '<div class="ui-list ui-list--dense">' + normMarkup +
      rows.map((row, index) => {
        const item = inventory.get(String(row.itemId));
        const title = item?.name || 'Позиция недоступна';
        const unit = row.unit || (item ? procedureConsumableUnit(item) : '');
        return '<div class="ui-list__item" data-consumable-row="' + index + '">' +
          '<span class="ui-list__main">' +
            '<span class="ui-list__title">' + escapeHtml(title) + '</span>' +
            (item?.manufacturer ? '<span class="ui-list__secondary">' +
              escapeHtml(item.manufacturer) + '</span>' : '') +
          '</span>' +
          '<span class="ui-list__right-secondary service-consumable-quantity">' +
            field({ label: 'Расход', name: 'consumableQuantity' + index,
              type: 'number', min: '0.000001', step: 'any', inputmode: 'decimal',
              placeholder: '—', value: row.quantity ?? '', data: 'data-consumable-quantity' }) +
            '<span>' + escapeHtml(unit) + '</span>' +
          '</span>' +
          compactButton({ kind: 'remove', data: 'data-consumable-remove="' + index + '"',
            aria: 'Убрать ' + title }) +
        '</div>';
      }).join('') + '</div>'
      : desktop
        ? list({ className: 'ui-list--dense', items: [{ title: 'Расходников пока нет', className: 'service-consumable-empty-row' }] })
        : emptyState('Расходников пока нет');
    sync();
  };
  host.addEventListener('input', event => {
    if (event.target.matches?.('[data-consumable-norm-quantity]')) {
      const index = Number(event.target.dataset.consumableIndex ??
        event.target.closest('[data-consumable-norm-row]')?.dataset.consumableNormRow);
      if (!norms[index]) return;
      norms[index] = { ...norms[index], quantity: event.target.value };
      if (errorNode) errorNode.textContent = '';
      sync();
      return;
    }
    if (!event.target.matches?.('[data-consumable-quantity]')) return;
    const index = Number(event.target.dataset.consumableIndex ??
      event.target.closest('[data-consumable-row]')?.dataset.consumableRow);
    if (!rows[index]) return;
    rows[index] = { ...rows[index], quantity: event.target.value };
    if (errorNode) errorNode.textContent = '';
    sync();
  });
  host.addEventListener('change', event => {
    if (!event.target.matches?.('input[data-consumable-unit]')) return;
    const index = Number(event.target.dataset.consumableUnit);
    const row = rows[index];
    if (!row) return;
    const item = getInventoryItems().find(item => String(item.itemId) === String(row.itemId));
    if (!item || !procedureConsumableUnits(item).includes(event.target.value)) {
      render();
      return;
    }
    rows[index] = { ...row, unit: event.target.value };
    if (errorNode) errorNode.textContent = '';
    sync();
  });
  host.addEventListener('click', event => {
    const normControl = event.target.closest?.('[data-consumable-norm-remove]');
    if (normControl) {
      const index = Number(normControl.dataset.consumableNormRemove);
      if (norms[index]) norms.splice(index, 1);
      render();
      return;
    }
    const control = event.target.closest?.('[data-consumable-remove]');
    if (!control) return;
    const index = Number(control.dataset.consumableRemove);
    if (!rows[index]) return;
    rows.splice(index, 1);
    render();
  });
  const chooseGroup = async () => {
    if (saving) return;
    try { await groupLoad; }
    catch (error) {
      openNotice({ title: 'Группы расхода', message: error?.message || 'Не удалось загрузить группы.' });
      return;
    }
    if (!layer.isConnected) return;
    openConsumablePicker(new Set(norms.map(row => String(row.groupId))), picked => {
      norms.push(...picked);
      render();
    }, { anchor: add, multiple: true, groupRows: stockGroups });
  };
  const choosePosition = async () => {
    if (saving) return;
    try { await inventoryLoad; }
    catch (error) {
      openNotice({ title: 'Расходник',
        message: error instanceof Error ? error.message : 'Не удалось открыть склад.' });
      return;
    }
    if (!layer.isConnected) return;
    openConsumablePicker(new Set(rows.map(row => String(row.itemId))), item => {
      rows.push(...item);
      render();
    }, { anchor: add, multiple: true });
  };
  add?.addEventListener('click', () => {
    if (saving) return;
    if (desktop) add.dataset.v2AnchorWidth = '240';
    const menu = mountModal(desktop ? add : layer, modal(
      '<div class="' + (desktop ? 'desktop-q-action-menu' : 'modal-actions') + '">' +
        button('+ Группа', { variant: 'secondary', data: 'data-consumable-choice-group' }) +
        button('+ Позиция', { variant: 'secondary', data: 'data-consumable-choice-position' }) +
      '</div>', {
        title: 'Добавить расходник', variant: 'x', surface: 'app', xRole: 'action',
        className: desktop ? 'desktop-q-action-popup' : '',
      }));
    if (!menu) return;
    menu.querySelector('[data-consumable-choice-group]')?.addEventListener('click', () => {
      menu.v2Close?.();
      if (layer.isConnected) void chooseGroup();
    });
    menu.querySelector('[data-consumable-choice-position]')?.addEventListener('click', () => {
      menu.v2Close?.();
      if (layer.isConnected) void choosePosition();
    });
  });
  save?.addEventListener('click', async () => {
    if (saving) return;
    let value, groupValue;
    try {
      value = normalizeProcedureConsumables(rows);
      groupValue = normalizeProcedureGroupNorms(norms);
    }
    catch (error) {
      if (errorNode) errorNode.textContent = error.message;
      return;
    }
    saving = true;
    sync();
    try {
      await commitProcedureConsumables(procedureId, value, groupValue);
      layer.v2Close?.();
      onSaved();
    } catch (error) {
      saving = false;
      sync();
      if (errorNode) errorNode.textContent = error instanceof Error
        ? error.message : 'Не удалось сохранить расходники.';
    }
  });
  render();
  const groupLoad = loadConsumptionGroups().then(groups => {
    stockGroups = groups;
    groupsLoaded = true;
    if (layer.isConnected) {
      if (host.contains(document.activeElement)) sync();
      else render();
    }
  });
  void groupLoad.catch(() => {});
  const inventoryLoad = loadInventory({ preferRecent: true }).then(() => {
    if (!layer.isConnected) return;
    // Preserve focus when a stock snapshot arrives while quantity is edited.
    if (host.contains(document.activeElement)) sync();
    else render();
  });
  // Only opening the product picker requires a successful stock refresh.
  void inventoryLoad.catch(() => {});
  return layer;
}
