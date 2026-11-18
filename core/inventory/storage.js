import { actionBlock, button, checkList, emptyState, field, initCheckList, list, modal, mountModal, select } from '../../ui/ui.js';
import { getInventoryItem, getInventoryItems, getInventoryStorageLocations } from './data.js';
import { createInventoryStorageLocation, loadInventory, updateInventoryStorageLocation, transferInventoryStock } from './service.js';

const locations = () => getInventoryStorageLocations().filter(item => item && !item.archivedAt);
const options = () => locations().map(location => ({
  value: location.locationId, label: location.isPrimary ? 'Не распределено' : location.name,
}));

// Earlier inventories stored a human-entered warehouse letter in item.location.
// The newer location registry did not import those labels, and old movement
// lines were migrated to the technical 'primary' location. This read-only
// diagnostic works from the current account's server snapshot, never guesses
// missing labels or modifies inventory on modal open.
export function legacyInventoryLocations(items = getInventoryItems()) {
  const grouped = new Map();
  for (const item of items) {
    const name = String(item?.location || '').trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase('ru-RU');
    if (!grouped.has(key)) grouped.set(key,{name,items:[]});
    grouped.get(key).items.push(item);
  }
  return [...grouped.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru',{numeric:true}));
}

const stockAt = (item, id) => Number(
  (item?.locationBalances || []).find(row=>row.locationId===id)?.balance || 0);
const legacyFingerprint = items => items.map(item =>
  [item.itemId, item.location,stockAt(item,'primary')].join('|')).sort().join('\n');

export function openInventoryLegacyStorageRecovery(onSaved = () => {}) {
  const groups=legacyInventoryLocations();
  if (!groups.length) return null;
  const activeLocations=locations().filter(place=>!place.isPrimary);
  const missing=groups.filter(group=>!activeLocations.some(place=>
    place.name.toLocaleLowerCase('ru-RU')===group.name.toLocaleLowerCase('ru-RU')));
  const candidates=groups.filter(group=>missing.includes(group)
    || group.items.some(item=>stockAt(item,'primary')>0.000001));
  if (!candidates.length) return null;

  const original=legacyFingerprint(getInventoryItems());
  const markup = '<p>В старых карточках сохранились обозначения мест хранения. ' +
    'Выберите, какие восстановить. Остатки будут перенесены из прежнего учёта; ' +
    'общее количество товаров не изменится.</p>' +
    '<div data-legacy-storage-list>' + checkList(candidates.map(group=>({
      value:group.name,label:group.name,checked:true,
      secondary:group.items.length+' поз. · '+group.items.filter(
        item=>stockAt(item,'primary')>0.000001).length+' с остатками',
    }))) + '</div>' +
    '<p class="form-error" role="alert" data-legacy-storage-error></p>' +
    '<p class="ui-list__secondary" data-legacy-storage-progress></p>' +
    actionBlock(button('Восстановить выбранные',{data:'data-legacy-storage-run'}));
  const host=mountModal(document.body,modal(markup,{
    title:'Восстановление складов',variant:'q',surface:'app',
  }));
  if(!host)return null;
  initCheckList(host);
  const submit=host.querySelector('[data-legacy-storage-run]');
  const status=host.querySelector('[data-legacy-storage-error]');
  const progress=host.querySelector('[data-legacy-storage-progress]');
  const confirmed=async selected=>{
    submit.disabled=true;
    try {
      progress.textContent='Проверяем актуальные остатки…';
      await loadInventory();
      if (legacyFingerprint(getInventoryItems())!==original)
        throw new Error('Остатки изменились с момента просмотра. Закройте окно и откройте проверку заново.');
      let moved=0,created=0;
      for(const name of selected) {
        const group=legacyInventoryLocations().find(entry=>entry.name===name);
        if(!group)throw new Error('Не найден прежний склад: '+name);
        let location=locations().find(place=>!place.isPrimary
          && place.name.toLocaleLowerCase('ru-RU')===name.toLocaleLowerCase('ru-RU'));
        if(!location) {
          progress.textContent='Восстанавливаем «'+name+'»…';
          await createInventoryStorageLocation({name});
          created++;
          location=locations().find(place=>!place.isPrimary
            && place.name.toLocaleLowerCase('ru-RU')===name.toLocaleLowerCase('ru-RU'));
        }
        if(!location)throw new Error('Не удалось найти созданный склад '+name);
        const ids=group.items.map(item=>item.itemId);
        for(let from=0;from<ids.length;from+=100) {
          const chunk=ids.slice(from,from+100).map(id=>getInventoryItem(id)).filter(Boolean)
            .map(item=>({itemId:item.itemId,quantity:stockAt(item,'primary'),unit:item.unit}))
            .filter(line=>line.quantity>0.000001);
          if(!chunk.length)continue;
          progress.textContent='Переносим остатки в «'+name+'»: '+(from+chunk.length)+' из '+ids.length;
          await transferInventoryStock({
            fromLocationId:'primary',toLocationId:location.locationId,lines:chunk,
            note:'Восстановление из старого поля склада: '+name,
          });
          moved+=chunk.length;
        }
      }
      await loadInventory();
      const left=selected.flatMap(name=>legacyInventoryLocations().find(entry=>entry.name===name)?.items || [])
        .map(item=>getInventoryItem(item.itemId)).filter(item=>item&&stockAt(item,'primary')>0.000001);
      if(left.length)throw new Error('Часть остатков осталась без распределения ('+left.length+'). Проверьте и повторите.');
      host.v2Close?.();
      onSaved();
      // Completion is only reported after refetch and verifying no stock
      // remained under the legacy technical location for selected products.
      // Zero-balance products keep their old location label for visibility.
    } catch(error) {
      status.textContent=error instanceof Error?error.message:'Не удалось восстановить склады.';
      progress.textContent='Ранее успешно перенесённые остатки сохранены. Повторная проверка не создаст их ещё раз.';
      submit.disabled=false;
    }
  };
  submit.addEventListener('click',()=>{
    const selected=[...host.querySelectorAll('[data-legacy-storage-list] input[type="checkbox"]')]
      .filter(input=>input.checked).map(input=>input.value);
    if(!selected.length){status.textContent='Выберите хотя бы один склад.';return;}
    status.textContent='';
    const check=mountModal(document.body,modal(
      '<div class="modal-title"><h2>Восстановить склады?</h2><p>' +
      selected.join(', ').replace(/&/g,'&amp;').replace(/</g,'&lt;') +
      '. Будут созданы недостающие места и перенесены только доступные остатки. ' +
      'История операций и общий остаток сохраняются.</p></div>' +
      actionBlock(button('Подтвердить',{data:'data-legacy-storage-confirm'}) +
        button('Отмена',{variant:'secondary',data:'data-legacy-storage-cancel'})),
      {title:'Подтверждение',variant:'x',xRole:'action'},
    ));
    check?.querySelector('[data-legacy-storage-cancel]')?.addEventListener('click',()=>check.v2Close?.());
    check?.querySelector('[data-legacy-storage-confirm]')?.addEventListener('click',()=>{
      check.v2Close?.();void confirmed(selected);
    });
  });
  return host;
}

// Places and transfers already belong to Core; this is their E «Остатки» interface.
export function openInventoryStorageLocations(onSaved = () => {}) {
  const host = mountModal(document.body, modal(
    '<div data-inventory-storage-list></div>' +
    '<div data-inventory-legacy-action></div>' +
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
    const restore=host.querySelector('[data-inventory-legacy-action]');
    const groups=legacyInventoryLocations();
    const unmatched=groups.some(group=>!locations().some(place=>!place.isPrimary &&
      place.name.toLocaleLowerCase('ru-RU')===group.name.toLocaleLowerCase('ru-RU'))
      || group.items.some(item=>stockAt(item,'primary')>0.000001));
    if(restore) {
      restore.innerHTML=unmatched ? actionBlock(button('Восстановить прежние склады',{
        variant:'secondary',data:'data-inventory-legacy-restore',
      })) : '';
      restore.querySelector('[data-inventory-legacy-restore]')?.addEventListener('click',()=>{
        openInventoryLegacyStorageRecovery(()=>{display();onSaved();});
      });
    }
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
