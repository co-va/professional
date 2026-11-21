import { actionBlock, button, compactButton, escapeHtml, field, list, modal, mountModal, openNotice, select, segmentControl, initSegmentControls, initV2ListReorder } from '../../ui/ui.js';
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
const personKeys = record => [record?.person?.key, record?.person?.id].map(text).filter(Boolean);
const samePerson = (left, right) => {
  const ids = new Set(personKeys(left));
  return ids.size > 0 && personKeys(right).some(id => ids.has(id));
};
const visitMoment = record => text(record?.date).slice(0,10) + 'T' + (text(record?.from) || '00:00');
function previousTemplates(record, procedureId, records) {
  return records.filter(previous =>
    text(previous.id) !== text(record.id) && samePerson(previous, record) &&
    visitMoment(previous) < visitMoment(record) &&
    previous.status !== 'cancelled' && previous.attendance !== 'no-show' &&
    actualGroups(previous, procedureId).some(group => group.items?.length)
  ).sort((left, right) => visitMoment(right).localeCompare(visitMoment(left)));
}

function actualGroups(record, procedureId) {
  const template = (Array.isArray(record?.consumableTemplates) ? record.consumableTemplates : [])
    .find(row => text(row.procedureId) === procedureId);
  return Array.isArray(template?.groups) ? clone(template.groups) : [];
}

export function openRecordConsumptionEditor(record, services = [], { onSaved = () => {} } = {}) {
  const data = services.map(service => ({
    ...service, groups: actualGroups(record, service.id), expanded: false, templateChoice: '',
  }));
  let editing = false;
  let grouping = 'service';
  let disposeReorders = [];
  let posted = record.consumablesPosted === true;
  const signature = () => JSON.stringify(data.map(({ id, groups }) => ({
    procedureId: id,
    groups: groups.filter(group => group.items?.length).map(group => ({
      name: text(group.name), items: group.items.map(row => ({
        itemId: text(row.itemId), quantity: row.quantity == null || row.quantity === '' ? null : Number(String(row.quantity).replace(',', '.')), unit: text(row.unit),
      })),
    })),
  })));
  let initial = signature();
  // A stored empty array is an explicit saved choice, not an invitation to
  // restore a previous individual expense. Only new/unset records get a copy.
  const history = getRecords();
  const datesFor = service => previousTemplates(record, service.id, history);
  if (!posted && !Array.isArray(record.consumableTemplates)) {
    for (const service of data) {
      const latest = datesFor(service)[0];
      if (service.groups.length || !latest) continue;
      service.groups = actualGroups(latest, service.id);
      service.templateChoice = 'record:' + text(latest.id);
      service.expanded = true;
    }
  }
  const panel = '<div class="form-grid" data-record-consumption-services></div>' +
    '<div class="form-error" role="alert" data-record-consumption-error></div>' +
    actionBlock(
      button('Редактировать', { variant: 'outline', data: 'data-record-consumption-edit' }) +
      button('Применить', { data: 'data-record-consumption-apply' }),
    );
  const layer = mountModal(document.body, modal(panel, { title: 'Расходники', variant: 'q', surface: 'app' }));
  if (!layer) return null;
  const host = layer.querySelector('[data-record-consumption-services]');
  const save = layer.querySelector('[data-record-consumption-apply]');
  const edit = layer.querySelector('[data-record-consumption-edit]');
  const error = layer.querySelector('[data-record-consumption-error]');
  const actions = save?.closest('.modal-actions');
  let busy = false;
  let loaded = false;
  const stock = () => new Map(getInventoryItems().map(item => [text(item.itemId), item]));
  const draft = () => data.map(({ id, groups }) => ({ procedureId: id, groups }));
  const sync = () => {
    const changed = signature() !== initial;
    const hasOpen = posted || data.some(service => service.expanded || service.groups.length);
    setSharedActionVisible(actions, hasOpen || editing || changed);
    edit.hidden = editing || !hasOpen;
    save.hidden = !editing && !changed;
    edit.disabled = busy;
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
  const addGroup = (service, name = '') => {
    const group = { name, items: [] };
    service.groups.push(group);
    if (service.templateChoice === 'standard') service.templateChoice = '';
    service.expanded = true;
    return group;
  };
  const pick = async (si, gi, ri = null) => {
    const service = data[si];
    if (!service || busy || !editing) return;
    const group = service.groups[gi];
    if (!group) return;
    try { await inventoryLoad; }
    catch (e) { openNotice({ title: 'Расходники', message: text(e?.message) || 'Не удалось загрузить склад.' }); return; }
    if (!layer.isConnected) return;
    const excluded = new Set(group.items.filter((_, index) => index !== ri).map(row => text(row.itemId)));
    openConsumablePicker(excluded, selected => {
      if (!layer.isConnected || !editing || !service.groups.includes(group)) return;
      if (ri !== null) {
        const current = group.items[ri];
        if (!current) return;
        // Keep the quantity only if the stock consumption unit is unchanged.
        group.items[ri] = {
          ...selected, quantity: text(current.unit) === text(selected.unit) ? current.quantity : null,
        };
      } else group.items.push(selected);
      error.textContent = '';
      render();
    });
  };

  function render() {
    for (const dispose of disposeReorders) dispose();
    disposeReorders = [];
    const items = stock();
    const byService = data.map((service, si) => {
      const dates = datesFor(service);
      const factualRead = posted && !editing;
      const norm = service.rows.filter(row => row?.itemId);
      const hasGroups = service.groups.some(group => group.items?.length);
      if (factualRead && !hasGroups && !norm.length) return '';
      const normMarkup = norm.length ? list({
        className: 'ui-list--dense', items: norm.map(row => ({
          title: items.get(text(row.itemId))?.name || (loaded ? 'Товар недоступен' : '…'),
          right: [row.quantity == null ? '—' : row.quantity, row.unit || (items.has(text(row.itemId)) ? procedureConsumableUnit(items.get(text(row.itemId))) : '')].filter(Boolean).join(' '),
        })),
      }) : '';
      const groups = service.groups.map((group, gi) => {
        if (!editing) {
          const rows = (group.items || []).map(row => {
            const item = items.get(text(row.itemId));
            return { title: item?.name || 'Товар недоступен',
              right: [row.quantity ?? '—', row.unit || (item ? procedureConsumableUnit(item) : '')].filter(Boolean).join('\u00a0') };
          });
          return '<section class="record-consumption-group">' +
            (text(group.name) ? '<div class="record-consumption-read-title">' + escapeHtml(group.name) + '</div>' : '') +
            list({ className: 'ui-list--dense record-consumption-read-list', items: rows }) + '</section>';
        }
        const products = (group.items || []).map((row, ri) => {
          const product = items.get(text(row.itemId));
          const k = si + ':' + gi + ':' + ri;
          const title = product?.name || 'Товар недоступен';
          const unit = row.unit || (product ? procedureConsumableUnit(product) : '');
          return '<div class="list-entry data-edit-row record-consumption-product" data-record-consumption-row data-reorder-id="' + ri + '">' +
            '<span class="list-entry__reorder-handle" data-reorder-handle role="button" tabindex="0" aria-label="' + escapeHtml('Переместить ' + title) + '"><span aria-hidden="true">⋮⋮</span></span>' +
            '<button type="button" class="data-edit-row__name record-consumption-product-name" data-record-consumption-replace="' + k + '" title="' + escapeHtml(title) + '" aria-label="' + escapeHtml('Заменить ' + title) + '">' + escapeHtml(title) + '</button>' +
            '<div class="inventory-editor-number">' +
            field({ label: '', name: 'recordConsumptionQuantity' + k, type: 'number', min: '0.000001', step: 'any',
              inputmode: 'decimal', placeholder: '—', value: row.quantity ?? '', data: 'aria-label="' + escapeHtml('Расход: ' + title) + '" data-record-consumption-quantity="' + k + '"' }) +
            '<span class="inventory-editor-number__suffix">' + escapeHtml(unit) + '</span></div>' +
            compactButton({ kind: 'remove', data: 'data-record-consumption-remove="' + k + '"', aria: 'Убрать товар' }) +
            '</div>';
        }).join('');
        return '<section class="record-consumption-group">' +
          '<div class="data-edit-row record-consumption-group-header">' +
          field({ label: '', name: 'recordConsumptionName' + si + ':' + gi, value: group.name,
            placeholder: 'Название группы', data: 'aria-label="Название группы" data-record-consumption-name="' + si + ':' + gi + '"' }) +
          compactButton({ kind: 'add', data: 'data-record-consumption-pick="' + si + ':' + gi + '"', aria: 'Добавить товар' }) +
          compactButton({ kind: 'remove', data: 'data-record-consumption-remove-group="' + si + ':' + gi + '"', aria: 'Удалить группу' }) +
          '</div><div class="list-entries record-consumption-reorder-list" data-record-consumption-reorder="' + si + ':' + gi + '">' + products + '</div></section>';
      }).join('');
      const expanded = service.expanded || service.groups.length > 0;
      const serviceTitle = '<strong class="ui-list__title record-consumption-service-title">' + escapeHtml(service.name) + '</strong>';
      if (factualRead) {
        return '<section class="record-consumption-service record-consumption-service--posted">' + serviceTitle +
          (normMarkup ? '<p class="ui-list__secondary">Расчётный расход</p>' + normMarkup : '') +
          groups + '<p class="ui-list__secondary" data-record-consumption-cost="' + si + '"></p></section>';
      }
      return '<section class="record-consumption-service">' + serviceTitle +
        normMarkup +
        (!expanded ? list({ className: 'ui-list--dense', items: [{
          title: 'Расход не задан',
          interactive: true, right: '+',
          data: 'data-record-consumption-open="' + si + '"',
          aria: 'Открыть расход: ' + service.name,
        }] }) :
          select({ label: '', name: 'recordConsumptionHistory' + si, value: service.templateChoice,
            options: [{ value: '', label: 'Шаблон' }, { value: 'standard', label: 'Стандартный шаблон' },
              ...dates.map(previous => ({ value: 'record:' + text(previous.id), label: dateText(previous.date) + (previous.from ? ' · ' + text(previous.from) : '') }))],
            data: 'data-record-consumption-history="' + si + '"', aria: 'Выбрать шаблон: ' + service.name }) +
          groups + (editing ? '<div class="field-inline-label record-consumption-add-group"><span>Добавить группу</span>' +
          compactButton({ kind: 'add', data: 'data-record-consumption-add="' + si + '"', aria: 'Добавить группу' }) + '</div>' : '') +
          '<p class="ui-list__secondary" data-record-consumption-cost="' + si + '"></p>'
        ) + '</section>';
    }).join('');
    const hasRows = data.some(service => service.groups.some(group => group.items?.length));
    const groupMarkup = () => {
      const buckets = new Map();
      const append = (name, serviceName, rows, calculated = false) => {
        const heading = text(name) || 'Без группы';
        const id = (calculated ? 'norm:' : 'actual:') + heading.toLocaleLowerCase('ru-RU');
        if (!buckets.has(id)) buckets.set(id, { heading, sections: [] });
        buckets.get(id).sections.push({ serviceName, rows, calculated });
      };
      for (const service of data) {
        for (const group of service.groups) {
          if (group.items?.length) append(group.name, service.name, group.items);
        }
        const norm = service.rows.filter(row => row?.itemId);
        if (norm.length) append('Расчётный расход', service.name, norm, true);
      }
      return [...buckets.values()].map(bucket =>
        '<section class="record-consumption-group record-consumption-group--pivot">' +
          '<div class="record-consumption-read-title">' + escapeHtml(bucket.heading) + '</div>' +
          bucket.sections.map(section => {
            const rows = section.rows.map(row => {
              const item = items.get(text(row.itemId));
              return {
                title: item?.name || (loaded ? 'Товар недоступен' : '…'),
                right: [row.quantity ?? '—', row.unit || (item ? procedureConsumableUnit(item) : '')].filter(Boolean).join('\u00a0'),
              };
            });
            return '<div class="record-consumption-group-source">' + escapeHtml(section.serviceName) + '</div>' +
              list({ className: 'ui-list--dense record-consumption-read-list' +
                (section.calculated ? ' record-consumption-read-list--calculated' : ''), items: rows });
          }).join('') + '</section>'
      ).join('');
    };
    // Grouping is a read-only presentation. It is never shown in editing.
    host.innerHTML = (!editing && hasRows
      ? segmentControl([{ value: 'service', label: 'По услуге' }, { value: 'group', label: 'По группе' }],
          { value: grouping, name: 'recordConsumptionGrouping', aria: 'Группирование расхода' }) +
        (grouping === 'group' ? groupMarkup() : byService)
      : byService);
    if (!editing && hasRows) initSegmentControls(host);
    if (editing) {
      host.querySelectorAll('[data-record-consumption-reorder]').forEach(reorderHost => {
        const [si, gi] = reorderHost.dataset.recordConsumptionReorder.split(':').map(Number);
        const group = data[si]?.groups[gi];
        if (!group) return;
        disposeReorders.push(initV2ListReorder(reorderHost, {
          selector: '[data-record-consumption-row][data-reorder-id]',
          onReorder: ids => {
            const original = group.items.slice();
            const indices = ids.map(Number);
            if (indices.length !== original.length || new Set(indices).size !== original.length ||
                indices.some(i => !Number.isInteger(i) || i < 0 || i >= original.length)) return false;
            group.items = indices.map(i => original[i]);
            error.textContent = '';
            sync();
            return true;
          },
          onError: e => { error.textContent = text(e?.message) || 'Не удалось переместить товар.'; },
        }));
      });
    }
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
      editing = true;
      if (!service.groups.length) addGroup(service);
      render();
    } else if (!editing) return;
    else if (d.recordConsumptionAdd !== undefined) {
      addGroup(data[Number(d.recordConsumptionAdd)]);
      render();
    } else if (d.recordConsumptionPick !== undefined) {
      void pick(...d.recordConsumptionPick.split(':').map(Number));
    } else if (d.recordConsumptionReplace !== undefined) {
      void pick(...d.recordConsumptionReplace.split(':').map(Number));
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
    if (!editing || busy) return;
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
    if (name === 'recordConsumptionGrouping' && !editing && !busy) {
      const next = text(event.target.value);
      if (next === 'service' || next === 'group') {
        grouping = next;
        render();
      }
      return;
    }
    if (!name.startsWith('recordConsumptionHistory') || busy) return;
    const service = data[Number(name.slice('recordConsumptionHistory'.length))];
    if (!service) return;
    const choice = text(event.target.value);
    if (!choice) return;
    if (choice === 'standard') {
      service.groups = [];
    } else {
      const previous = datesFor(service).find(row => 'record:' + text(row.id) === choice);
      if (!previous) return;
      service.groups = actualGroups(previous, service.id);
    }
    service.templateChoice = choice;
    service.expanded = true;
    editing = false;
    error.textContent = '';
    render();
  });
  edit.addEventListener('click', () => {
    if (busy) return;
    editing = true;
    for (const service of data) {
      if (service.expanded && !service.groups.length) addGroup(service);
    }
    render();
  });
  save.addEventListener('click', async () => {
    if (busy) return;
    if (signature() === initial) {
      editing = false;
      for (const service of data) service.groups = service.groups.filter(group => group.items?.length);
      error.textContent = '';
      render();
      return;
    }
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
      const response = await apiRequest('/business-state/records/' + encodeURIComponent(record.id) + '/consumables', {
        method: 'PUT', body: JSON.stringify({ templates }), timeoutMs: 60000,
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 404) throw new Error('Сервер ещё не обновлён до версии сохранения расхода.');
      if (!response.ok) throw new Error(Array.isArray(payload.message) ? payload.message.join('; ') : text(payload.message) || 'Не удалось сохранить расход.');
      if (text(payload.recordId) !== text(record.id) || !Array.isArray(payload.templates))
        throw new Error('Сервер не подтвердил сохранение шаблона.');
      // The server is the owner of the saved template. Switch immediately
      // to plain reading mode only after the acknowledgement.
      for (const service of data) {
        service.groups = actualGroups({ consumableTemplates: payload.templates }, service.id);
      }
      initial = signature();
      posted = payload.posted === true;
      editing = false;
      if (layer.isConnected) render();
      if (payload.posted === true) await loadInventory().catch(() => null);
      await Promise.resolve().then(onSaved).catch(() => null);
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
