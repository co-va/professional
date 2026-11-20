import {
  actionBlock, button, compactButton, emptyState, escapeHtml, field,
  modal, mountModal, openNotice, v2ListEntry, v2ListEntries,
} from '../../../ui/ui.js';
import { setSharedActionVisible } from '../../../ui/page/page.js';
import { getInventoryItems } from '../../inventory/data.js';
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

// Value per chosen consumption unit only when its conversion is documented.
// A supplier's pack price must never be guessed to be a per-gram price.
export function procedureConsumableCost(item = {}, unit = '') {
  const stock = String(item.unit || '').trim();
  const usage = String(unit || stock).trim();
  if (!stock || !usage) return null;
  let price = number(item.baseUnitPrice);
  if (price == null && (stock === 'шт.' || stock === 'уп.'))
    price = number(item.basePrice);
  if (price == null || !(price >= 0)) return null;
  const metric = { 'кг>г': 0.001, 'г>кг': 1000, 'л>мл': 0.001, 'мл>л': 1000 };
  let factor = stock === usage ? 1 : metric[stock + '>' + usage] ?? null;
  if (factor == null) {
    const rule = (Array.isArray(item.conversionRules) ? item.conversionRules : [])
      .find(value => value.unit === usage && number(value.stockPerUnit) > 0);
    factor = rule ? number(rule.stockPerUnit) : null;
  }
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

function costSummaryText(rows, inventory) {
  if (!rows.length) return 'Расходники не выбраны.';
  const result = procedureConsumableSummary(rows, inventory);
  if (!result.calculated) return 'Себестоимость: не рассчитана';
  return result.complete ? 'Себестоимость: ' + money(result.total)
    : 'Рассчитано: ' + money(result.total) + ' · не все расходы указаны';
}

function openConsumablePicker(selected, onPick) {
  const panel = field({ label: 'Поиск', name: 'consumableSearch',
    type: 'search', placeholder: 'Товар, производитель или артикул' }) +
    '<div data-consumable-choices></div>';
  const layer = mountModal(document.body, modal(panel, {
    title: 'Выбрать товар', variant: 'x',
  }));
  if (!layer) return null;
  const search = layer.querySelector('[name="consumableSearch"]');
  const host = layer.querySelector('[data-consumable-choices]');
  const render = () => {
    const needle = String(search?.value || '').trim().toLocaleLowerCase('ru-RU');
    const items = getInventoryItems().filter(item => !selected.has(String(item.itemId))
      && [item.name, item.manufacturer, item.sku].some(value =>
        String(value || '').toLocaleLowerCase('ru-RU').includes(needle)));
    host.innerHTML = items.length ? v2ListEntries(items.map(item => v2ListEntry({
      title: item.name || 'Товар',
      subtitle: item.manufacturer || '',
      rightTop: item.sku || '',
      interactive: true,
      data: 'data-consumable-pick="' + escapeHtml(item.itemId) + '"',
      aria: 'Добавить ' + (item.name || 'товар'),
    }))) : emptyState('Товары не найдены', 'Измените поиск или добавьте товар на склад.');
    host.querySelectorAll('[data-consumable-pick]').forEach(node =>
      node.addEventListener('click', () => {
        const itemId = node.dataset.consumablePick;
        const item = getInventoryItems().find(value => String(value.itemId) === itemId);
        if (!item) return;
        layer.v2Close?.();
        onPick({ itemId, quantity: null, unit: procedureConsumableUnit(item) });
      }));
  };
  search?.addEventListener('input', render);
  render();
  return layer;
}

export async function openProcedureConsumables(procedureId, onSaved = () => {}) {
  try { await loadInventory({ preferRecent: true }); }
  catch (error) {
    openNotice({ title: 'Расходник',
      message: error instanceof Error ? error.message : 'Не удалось открыть склад.' });
    return null;
  }
  const current = getProcedures().find(item => String(item.id) === String(procedureId));
  if (!current) return openNotice({ title: 'Расходник', message: 'Услуга не найдена.' });
  let rows = normalizeProcedureConsumables(current.consumables);
  const initial = JSON.stringify(rows);
  const panel = '<div data-procedure-consumable-items></div>' +
    '<p class="ui-list__secondary" data-procedure-consumable-cost></p>' +
    '<div class="app-settings-panel">' +
      button('+ Товар', { variant: 'secondary', data: 'data-procedure-consumable-add' }) +
    '</div>' +
    '<div class="form-error" role="alert" data-procedure-consumable-error></div>' +
    actionBlock(button('Применить', { data: 'data-procedure-consumable-save' }));
  const layer = mountModal(document.body, modal(panel, {
    title: 'Расходник', variant: 'q', surface: 'app',
  }));
  if (!layer) return null;
  const host = layer.querySelector('[data-procedure-consumable-items]');
  const costNode = layer.querySelector('[data-procedure-consumable-cost]');
  const errorNode = layer.querySelector('[data-procedure-consumable-error]');
  const save = layer.querySelector('[data-procedure-consumable-save]');
  const actions = save?.closest('.modal-actions');
  let saving = false;
  const sync = () => {
    if (costNode) costNode.textContent = costSummaryText(rows, getInventoryItems());
    setSharedActionVisible(actions, JSON.stringify(rows) !== initial);
    if (save) save.disabled = saving;
  };
  const render = () => {
    const inventory = new Map(getInventoryItems().map(item => [String(item.itemId), item]));
    host.innerHTML = rows.length ? rows.map((row, index) => {
      const item = inventory.get(String(row.itemId));
      const title = item?.name || 'Товар недоступен';
      const unit = row.unit || (item ? procedureConsumableUnit(item) : '');
      return '<div class="inventory-editor-row" data-consumable-row="' + index + '">' +
        '<div class="inventory-editor-group">' +
          v2ListEntries([v2ListEntry({
            title,
            subtitle: item?.manufacturer || '',
            interactive: false,
          })]) +
        '</div>' +
        field({ label: 'Расход', name: 'consumableQuantity' + index,
          type: 'number', min: '0.000001', step: 'any', inputmode: 'decimal',
          placeholder: 'Не указано', value: row.quantity ?? '', data: 'data-consumable-quantity' }) +
        '<span class="ui-list__secondary">' + escapeHtml(unit) + '</span>' +
        compactButton({ kind: 'remove', data: 'data-consumable-remove="' + index + '"',
          aria: 'Убрать ' + title }) +
      '</div>';
    }).join('') : emptyState('Расходников пока нет', 'Выберите товары, используемые в услуге.');
    sync();
  };
  host.addEventListener('input', event => {
    if (!event.target.matches?.('[data-consumable-quantity]')) return;
    const index = Number(event.target.closest('[data-consumable-row]')?.dataset.consumableRow);
    if (!rows[index]) return;
    rows[index] = { ...rows[index], quantity: event.target.value };
    if (errorNode) errorNode.textContent = '';
    sync();
  });
  host.addEventListener('click', event => {
    const control = event.target.closest?.('[data-consumable-remove]');
    if (!control) return;
    const index = Number(control.dataset.consumableRemove);
    if (!rows[index]) return;
    rows.splice(index, 1);
    render();
  });
  layer.querySelector('[data-procedure-consumable-add]')?.addEventListener('click', () => {
    openConsumablePicker(new Set(rows.map(row => String(row.itemId))), item => {
      rows.push(item);
      render();
    });
  });
  save?.addEventListener('click', async () => {
    if (saving) return;
    let value;
    try { value = normalizeProcedureConsumables(rows); }
    catch (error) {
      if (errorNode) errorNode.textContent = error.message;
      return;
    }
    saving = true;
    sync();
    try {
      await commitProcedureConsumables(procedureId, value);
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
  return layer;
}
