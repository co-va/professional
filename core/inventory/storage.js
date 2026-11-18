import { actionBlock, button, emptyState, field, list, modal, mountModal, select } from '../../ui/ui.js';
import { getInventoryItem, getInventoryItems, getInventoryStorageLocations } from './data.js';
import { createInventoryStorageLocation, loadInventory, updateInventoryStorageLocation, transferInventoryStock } from './service.js';

const locations = () => getInventoryStorageLocations().filter(item => item && !item.archivedAt);
const options = () => locations().map(location => ({
  value: location.locationId, label: location.isPrimary ? 'Не распределено' : location.name,
}));

// Legacy Excel inventories already had a warehouse for every position in
// InventoryItem.location. The new location table was introduced without
// importing those names. Reconcile them once via the existing Core storage
// endpoints; never make the user reassign their own saved A/B labels.
export function legacyInventoryLocations(items = getInventoryItems()) {
  const grouped = new Map();
  for (const item of items) {
    const name = String(item?.location || '').trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase('ru-RU');
    if (!grouped.has(key)) grouped.set(key, {name, items:[]});
    grouped.get(key).items.push(item);
  }
  return [...grouped.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru',{numeric:true}));
}

const stockAt = (item, id) => Number(
  (item?.locationBalances || []).find(row=>row.locationId===id)?.balance || 0);
const existingSite = name => locations().find(place => !place.isPrimary &&
  place.name.toLocaleLowerCase('ru-RU')===name.toLocaleLowerCase('ru-RU'));

// Prevent two Stock renders in the same session from migrating twice.
// A failed run can be retried safely on the next navigation; each request
// recalculates the remaining technical balance from the latest Core snapshot.
let reconciliation = null;

/**
 * Existing Core APIs handle atomic 100-position transfer batches and update
 * the snapshot. Zero-balance positions keep their original A/B assignment.
 * The physical movement history is appended, never rewritten or deleted.
 */
export function reconcileLegacyInventoryStorage() {
  if (reconciliation) return reconciliation;
  reconciliation = (async () => {
    const groups = legacyInventoryLocations();
    let created=0, moved=0;
    for (const {name,items} of groups) {
      let site=existingSite(name);
      if (!site) {
        await createInventoryStorageLocation({name});
        site=existingSite(name);
        if(!site)throw new Error('Не удалось восстановить склад «'+name+'».');
        created++;
      }
      // Recalculate the remaining primary quantity immediately before each
      // transfer. Never pull back amounts the user already placed elsewhere.
      for(let offset=0;offset<items.length;offset+=100) {
        const lines=items.slice(offset,offset+100)
          .map(item=>getInventoryItem(item.itemId)).filter(Boolean)
          .filter(item=>(item.locationBalances||[]).every(row=>
            row.locationId==='primary' || Number(row.balance)<=0.000001))
          .map(item=>({
            itemId:item.itemId,quantity:stockAt(item,'primary'),unit:item.unit,
          })).filter(line=>Number.isFinite(line.quantity) && line.quantity>0.000001);
        if (!lines.length) continue;
        await transferInventoryStock({
          fromLocationId:'primary',toLocationId:site.locationId,lines,
          note:'Восстановление исходного склада «'+name+'» из карточек товаров',
        });
        moved+=lines.length;
      }
    }
    return {created,moved};
  })().finally(()=>{reconciliation=null;});
  return reconciliation;
}

// Places and transfers already belong to Core; this is their E «Остатки» interface.
export function openInventoryStorageLocations(onSaved = () => {}) {
  const host = mountModal(document.body, modal(
    '<div data-inventory-storage-list></div>' +
    actionBlock(button('Добавить', { data: 'data-inventory-storage-add' })),
    { title: 'Места хранения', variant: 'q', surface: 'app' },
  ));
  if (!host) return null;
  const display = () => {
    const items = locations().filter(place=>!place.isPrimary);
    const root = host.querySelector('[data-inventory-storage-list]');
    root.innerHTML = items.length ? list({
      className: 'ui-list--dense',
      items: items.map(place => ({
        title: place.name,
        secondary: place.isPrimary ? 'Основное' : '',
        interactive: !place.isPrimary,
        aria: 'Место хранения ' + place.name,
        data: place.isPrimary ? '' : 'data-inventory-storage-edit="' + place.locationId + '"',
      })),
    }) : emptyState('Мест хранения нет');
    root.querySelectorAll('[data-inventory-storage-edit]').forEach(node =>
      node.addEventListener('click', () => edit(node.dataset.inventoryStorageEdit)));

  };
  const edit = (locationId = '') => {
    const current = locations().find(place => place.locationId === locationId);
    const window = mountModal(document.body, modal(
      '<form data-inventory-storage-form>' +
      field({ label: 'Название', name: 'name', value: current?.name || '', required: true }) +
      '<p class="form-error" role="alert" data-inventory-storage-error></p>' +
      actionBlock(button('Сохранить', { type: 'submit' }) +
        (current ? button('Удалить', { variant: 'delete-outline', type: 'button',
          data: 'data-inventory-storage-archive' }) : '')) +
      '</form>',
      { title: current ? 'Место хранения' : 'Новое место хранения', variant: 'q', surface: 'app' },
    ));
    if (!window) return;
    const form = window.querySelector('[data-inventory-storage-form]');
    const status = window.querySelector('[data-inventory-storage-error]');
    const save = form.querySelector('[type="submit"]');
    const archive = form.querySelector('[data-inventory-storage-archive]');
    const run = async (archived = false) => {
      save.disabled = true;
      if (archive) archive.disabled = true;
      try {
        const name = String(new FormData(form).get('name') || '').trim();
        if (!archived && !name) throw new Error('Укажите название.');
        if (current) await updateInventoryStorageLocation(current.locationId,
          archived ? { archived: true } : { name });
        else await createInventoryStorageLocation({ name });
        window.v2Close?.();
        display();
        onSaved();
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'Не удалось сохранить место хранения.';
        save.disabled = false;
        if (archive) archive.disabled = false;
      }
    };
    form.addEventListener('submit', event => { event.preventDefault(); void run(); });
    archive?.addEventListener('click', () => { void run(true); });
  };
  host.querySelector('[data-inventory-storage-add]')?.addEventListener('click', () => edit());
  display();
  return host;
}

export function openInventoryTransfer(onSaved = () => {}) {
  const stock = getInventoryItems();
  const places = options();
  const fromDefault = places.find(place => place.value === 'primary')?.value || places[0]?.value || '';
  const toDefault = places.find(place => place.value !== fromDefault)?.value || '';
  // Do not preselect an arbitrary product for a stock-changing operation.
  const host = mountModal(document.body, modal(
    '<form data-inventory-transfer-form>' +
    select({ label: 'Из места', name: 'fromLocationId', value: fromDefault, options: places }) +
    select({ label: 'В место', name: 'toLocationId', value: toDefault, options: places }) +
    select({ label: 'Товар', name: 'itemId', value: '',
      options: [{ value: '', label: 'Выбрать товар' },
        ...stock.map(item => ({
          value: item.itemId, label: [item.manufacturer, item.name].filter(Boolean).join(' · '),
        }))], searchable: true }) +
    field({ label: 'Количество', name: 'quantity', value: '', type: 'number',
      min: '0.001', step: 'any', required: true }) +
    '<p class="ui-list__secondary" data-inventory-transfer-unit></p>' +
    '<p class="form-error" role="alert" data-inventory-transfer-error></p>' +
    actionBlock(button('Переместить', { type: 'submit' })) +
    '</form>',
    { title: 'Перемещение', variant: 'q', surface: 'app' },
  ));
  if (!host) return;
  const form = host.querySelector('[data-inventory-transfer-form]');
  const unit = host.querySelector('[data-inventory-transfer-unit]');
  const updateUnit = () => {
    const item = getInventoryItem(form.querySelector('[name="itemId"]')?.value);
    const from = form.querySelector('[name="fromLocationId"]')?.value;
    const balance = item?.locationBalances?.find(loc => loc.locationId === from)?.balance ?? 0;
    unit.textContent = item ? 'Единица: ' + item.unit + ' · В этом месте: '
      + Number(balance).toLocaleString('ru-RU', { maximumFractionDigits: 3 }) : '';
  };
  form.addEventListener('change', updateUnit);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    const from = String(data.get('fromLocationId') || '');
    const to = String(data.get('toLocationId') || '');
    const itemId = String(data.get('itemId') || '');
    const quantity = Number(data.get('quantity'));
    const error = host.querySelector('[data-inventory-transfer-error]');
    if (!from || !to || from === to) { error.textContent = 'Выберите два разных места.'; return; }
    if (!getInventoryItem(itemId) || !(quantity > 0) || !Number.isFinite(quantity)) {
      error.textContent = 'Выберите товар и положительное количество.'; return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await transferInventoryStock({ fromLocationId: from, toLocationId: to,
        lines: [{ itemId, quantity, unit: getInventoryItem(itemId).unit }] });
      host.v2Close?.();
      onSaved();
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : 'Не удалось переместить товар.';
      submit.disabled = false;
    }
  });
  updateUnit();
}
