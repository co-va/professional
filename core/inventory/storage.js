import { actionBlock, button, emptyState, field, list, modal, mountModal, select } from '../../ui/ui.js';
import { getInventoryItems, getInventoryStorageLocations } from './data.js';
import { createInventoryStorageLocation, updateInventoryStorageLocation } from './service.js';

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
    { title: 'Склады', variant: 'x', xRole: 'action', surface: 'app' },
  ));
  if (!host) return null;
  const display = () => {
    const items = locations().filter(place=>!place.isPrimary);
    const root = host.querySelector('[data-inventory-storage-list]');
    root.innerHTML = items.length ? list({
      className: 'ui-list--dense',
      items: items.map(place => ({
        title: place.name,
        secondary: '',
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
    const initialName = String(current?.name || '').trim();
    const window = mountModal(document.body, modal(
      '<form data-inventory-storage-form>' +
      field({ label: 'Название', name: 'name', value: initialName, required: true }) +
      '<p class="form-error" role="alert" data-inventory-storage-error></p>' +
      actionBlock(button(current ? 'Удалить' : 'Сохранить', {
        variant: current ? 'delete-outline' : 'primary',
        type: 'submit', data: 'data-inventory-storage-action',
      })) +
      '</form>',
      { title: current ? 'Склад' : 'Новый склад', variant: 'x', xRole: 'editor', surface: 'app' },
    ));
    if (!window) return;
    const form = window.querySelector('[data-inventory-storage-form]');
    const status = window.querySelector('[data-inventory-storage-error]');
    const action = window.querySelector('[data-inventory-storage-action]');
    const nameInput = form.elements.namedItem('name');
    let saving = false;
    const isChanged = () => String(nameInput?.value || '').trim() !== initialName;
    const refreshAction = () => {
      const deleteMode = Boolean(current) && !isChanged();
      action.textContent = deleteMode ? 'Удалить' : 'Сохранить';
      action.classList.toggle('ui-button--delete-outline', deleteMode);
      if (!saving) action.disabled = !deleteMode && !String(nameInput?.value || '').trim();
    };
    nameInput?.addEventListener('input', () => {
      status.textContent = '';
      refreshAction();
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (saving || action.disabled) return;
      const name = String(nameInput?.value || '').trim();
      const deleting = Boolean(current) && !isChanged();
      if (!deleting && !name) {
        status.textContent = 'Укажите название.';
        return;
      }
      saving = true;
      action.disabled = true;
      try {
        if (current) await updateInventoryStorageLocation(current.locationId,
          deleting ? { archived: true } : { name });
        else await createInventoryStorageLocation({ name });
        window.v2Close?.();
        display();
        onSaved();
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'Не удалось сохранить склад.';
      } finally {
        saving = false;
        refreshAction();
      }
    });
    refreshAction();
  };
  host.querySelector('[data-inventory-storage-add]')?.addEventListener('click', () => edit());
  display();
  return host;
}

