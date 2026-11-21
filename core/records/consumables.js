import { actionBlock, button, compactButton, escapeHtml, field, list, modal, mountModal, openNotice, select } from '../../ui/ui.js';
import { setSharedActionVisible } from '../../ui/page/page.js';
import { apiRequest } from '../auth.js';
import { getInventoryItems } from '../inventory/data.js';
import { loadInventory } from '../inventory/service.js';
import { getRecords } from '../record/index.js';
import { openConsumablePicker, procedureConsumableSummary, procedureConsumableUnit } from '../service/procedures/consumables.js';

const clone = value => JSON.parse(JSON.stringify(value));
const text = value => String(value ?? '').trim();
const dateText = value => text(value).slice(0,10).split('-').reverse().join(' ');
const money = value => Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
const key = record => text(record?.person?.key || record?.person?.id);

function actualGroups(record, procedureId) {
  const template = (Array.isArray(record?.consumableTemplates) ? record.consumableTemplates : [])
    .find(row => text(row.procedureId) === procedureId);
  return Array.isArray(template?.groups) ? clone(template.groups) : [];
}

export function openRecordConsumptionEditor(record, services = [], { onSaved = () => {} } = {}) {
  const data = services.map(service => ({
    ...service, groups: actualGroups(record, service.id), expanded: false,
  }));
  const initial = JSON.stringify(data.map(({ id, groups }) => ({ procedureId: id, groups })));
  const panel = '<div class="form-grid" data-record-consumption-services></div>' +
    '<div class="form-error" role="alert" data-record-consumption-error></div>' +
    actionBlock(button('Применить', { data: 'data-record-consumption-apply' }));
  const layer = mountModal(document.body, modal(panel, { title: 'Расходники', variant: 'q', surface: 'app' }));
  if (!layer) return null;
  const host = layer.querySelector('[data-record-consumption-services]');
  const save = layer.querySelector('[data-record-consumption-apply]');
  const error = layer.querySelector('[data-record-consumption-error]');
  const actions = save?.closest('.modal-actions');
  let busy = false;
  let loaded = false;
  const stock = () => new Map(getInventoryItems().map(item => [text(item.itemId), item]));
  const draft = () => data.map(({ id, groups }) => ({ procedureId: id, groups }));
  const sync = () => {
    setSharedActionVisible(actions, JSON.stringify(draft()) !== initial);
    save.disabled = busy;
    host.querySelectorAll('[data-record-consumption-cost]').forEach(node => {
      const service = data[Number(node.dataset.recordConsumptionCost)];
      if (!service) return;
      const rows = service.groups.flatMap(group => group.items || []);
      const result = procedureConsumableSummary(rows, getInventoryItems());
      node.textContent = result.calculated ? 'Себестоимость: ' + money(result.total) +
        (result.complete ? '' : ' · неполная') : '';
    });
  };
  const datesFor = service => key(record) ? getRecords().filter(previous =>
    text(previous.id) !== text(record.id) && key(previous) === key(record) &&
    text(previous.date) <= text(record.date) && actualGroups(previous, service.id).length &&
    (previous.completed || previous.payment?.state === 'paid'))
    .sort((a,b) => (text(b.date) + text(b.from)).localeCompare(text(a.date) + text(a.from))) : [];
  const addGroup = (service, name = '') => {
    const group = { name, items: [] };
    service.groups.push(group);
    service.expanded = true;
    return group;
  };
  const pick = async (si, gi) => {
    const service = data[si];
    if (!service || busy) return;
    const group = service.groups[gi];
    if (!group) return;
    try { await inventoryLoad; }
    catch (e) { openNotice({ title: 'Расходники', message: text(e?.message) || 'Не удалось загрузить склад.' }); return; }
    if (!layer.isConnected) return;
    openConsumablePicker(new Set(group.items.map(row => text(row.itemId))), row => {
      if (!layer.isConnected || !service.groups.includes(group)) return;
      group.items.push(row);
      render();
    });
  };

  function render() {
    const items = stock();
    host.innerHTML = data.map((service, si) => {
      const dates = datesFor(service);
      const norm = service.rows.filter(row => row?.itemId);
      const normMarkup = norm.length ? list({
        className: 'ui-list--dense', items: norm.map(row => ({
          title: items.get(text(row.itemId))?.name || (loaded ? 'Товар недоступен' : '…'),
          right: [row.quantity == null ? '—' : row.quantity, row.unit || procedureConsumableUnit(items.get(text(row.itemId)))].filter(Boolean).join(' '),
        })),
      }) : '';
      const groups = service.groups.map((group, gi) => {
        const products = (group.items || []).map((row, ri) => {
          const product = items.get(text(row.itemId));
          const k = si + ':' + gi + ':' + ri;
          return '<div class="ui-list__item">' +
            '<span class="ui-list__main"><span class="ui-list__title">' + escapeHtml(product?.name || 'Товар недоступен') + '</span></span>' +
            '<span class="ui-list__right-secondary service-consumable-quantity">' +
            field({ label: '', name: 'recordConsumptionQuantity' + k, type: 'number', min: '0.000001', step: 'any',
              inputmode: 'decimal', placeholder: '—', value: row.quantity ?? '', data: 'data-record-consumption-quantity="' + k + '"' }) +
            '<span>' + escapeHtml(row.unit || procedureConsumableUnit(product)) + '</span></span>' +
            compactButton({ kind: 'remove', data: 'data-record-consumption-remove="' + k + '"', aria: 'Убрать товар' }) +
            '</div>';
        }).join('');
        return '<section class="form-grid">' +
          '<div class="ui-list__item"><div class="ui-list__main">' +
          field({ label: '', name: 'recordConsumptionName' + si + ':' + gi, value: group.name,
            placeholder: 'Название группы', data: 'data-record-consumption-name="' + si + ':' + gi + '"' }) +
          '</div>' + compactButton({ kind: 'add', data: 'data-record-consumption-pick="' + si + ':' + gi + '"', aria: 'Добавить товар' }) +
          compactButton({ kind: 'remove', data: 'data-record-consumption-remove-group="' + si + ':' + gi + '"', aria: 'Удалить группу' }) +
          '</div><div class="ui-list ui-list--dense">' + products + '</div></section>';
      }).join('');
      return '<section class="form-grid"><strong class="ui-list__title">' + escapeHtml(service.name) + '</strong>' +
        normMarkup +
        list({ className: 'ui-list--dense', items: [{
          title: service.groups.length ? 'Шаблон' : 'Расход не задан',
          interactive: true, right: service.groups.length ? String(service.groups.length) + ' гр.' : '+',
          data: 'data-record-consumption-open="' + si + '"',
          aria: 'Добавить расход: ' + service.name,
        }] }) +
        (service.expanded || service.groups.length ? (
          (dates.length ? select({ label: '', name: 'recordConsumptionHistory' + si, value: '',
            options: [{ value: '', label: 'Выбрать шаблон' }, ...dates.map(previous => ({ value: text(previous.id), label: dateText(previous.date) }))],
            data: 'data-record-consumption-history="' + si + '"' }) : '') +
          groups + '<div class="ui-list__item"><span class="ui-list__main">Добавить группу</span>' +
          compactButton({ kind: 'add', data: 'data-record-consumption-add="' + si + '"', aria: 'Добавить группу' }) + '</div>' +
          '<p class="ui-list__secondary" data-record-consumption-cost="' + si + '"></p>'
        ) : '') + '</section>';
    }).join('');
    sync();
  }
  host.addEventListener('click', event => {
    const n = event.target.closest('button');
    if (!n || busy) return;
    const d = n.dataset;
    if (d.recordConsumptionOpen !== undefined) {
      const i = Number(d.recordConsumptionOpen), service = data[i];
      if (!service) return;
      service.expanded = true;
      if (!service.groups.length) { addGroup(service); render(); void pick(i, 0); }
      else render();
    } else if (d.recordConsumptionAdd !== undefined) {
      addGroup(data[Number(d.recordConsumptionAdd)]);
      render();
    } else if (d.recordConsumptionPick !== undefined) {
      void pick(...d.recordConsumptionPick.split(':').map(Number));
    } else if (d.recordConsumptionRemove !== undefined) {
      const [si,gi,ri] = d.recordConsumptionRemove.split(':').map(Number);
      data[si]?.groups[gi]?.items.splice(ri,1);
      render();
    } else if (d.recordConsumptionRemoveGroup !== undefined) {
      const [si,gi] = d.recordConsumptionRemoveGroup.split(':').map(Number);
      data[si]?.groups.splice(gi,1);
      render();
    }
  });
  host.addEventListener('input', event => {
    const d = event.target.dataset;
    if (d.recordConsumptionQuantity !== undefined) {
      const [si,gi,ri] = d.recordConsumptionQuantity.split(':').map(Number);
      const row = data[si]?.groups[gi]?.items[ri];
      if (row) row.quantity = event.target.value;
    } else if (d.recordConsumptionName !== undefined) {
      const [si,gi] = d.recordConsumptionName.split(':').map(Number);
      if (data[si]?.groups[gi]) data[si].groups[gi].name = event.target.value;
    } else return;
    error.textContent = ''; sync();
  });
  host.addEventListener('change', event => {
    const name = String(event.target.name || '');
    if (!name.startsWith('recordConsumptionHistory') || busy) return;
    const service = data[Number(name.slice('recordConsumptionHistory'.length))];
    const previous = service && datesFor(service).find(row => text(row.id) === text(event.target.value));
    if (!previous) return;
    service.groups = actualGroups(previous, service.id);
    service.expanded = true;
    render();
  });
  save.addEventListener('click', async () => {
    if (busy) return;
    let templates;
    try {
      templates = draft().map(template => ({
        procedureId: template.procedureId,
        groups: template.groups.filter(group => group.items.length).map(group => ({
          name: text(group.name),
          items: group.items.map(row => {
            const quantity = Number(String(row.quantity ?? '').replace(',', '.'));
            if (!text(row.itemId) || !text(row.unit) || !Number.isFinite(quantity) || quantity <= 0)
              throw new Error('Укажите количество каждого товара.');
            return { itemId: text(row.itemId), quantity, unit: text(row.unit) };
          }),
        })),
      })).filter(template => template.groups.length);
    } catch(e) { error.textContent = text(e.message); return; }
    busy = true; sync(); error.textContent = '';
    try {
      // Dedicated Core contract. Never send these as product sales, write
      // local-only facts, or issue manual movements from the frontend.
      const response = await apiRequest('/inventory/records/' + encodeURIComponent(record.id) + '/consumables', {
        method: 'PUT', body: JSON.stringify({ templates }), timeoutMs: 60000,
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 404) throw new Error('Сохранение расхода ещё не подключено на сервере.');
      if (!response.ok) throw new Error(Array.isArray(payload.message) ? payload.message.join('; ') : text(payload.message) || 'Не удалось сохранить расход.');
      if (text(payload.recordId) !== text(record.id) || !Array.isArray(payload.templates))
        throw new Error('Сервер не подтвердил сохранение шаблона.');
      await onSaved();
      layer.v2Close?.();
    } catch(e) {
      if (layer.isConnected) error.textContent = text(e.message) || 'Расход не сохранён.';
    } finally { busy = false; if (layer.isConnected) sync(); }
  });
  const inventoryLoad = loadInventory({ preferRecent: true }).then(() => {
    loaded = true;
    if (layer.isConnected && !host.contains(document.activeElement)) render();
  });
  void inventoryLoad.catch(e => { if (layer.isConnected) error.textContent = text(e.message) || 'Склад недоступен.'; });
  render();
  return layer;
}
