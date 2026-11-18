import { actionBlock, button, emptyState, field, list, modal, mountModal, select } from '../../ui/ui.js';
import { getInventoryClassificationGroups, getInventoryItems } from './data.js';
import { createInventoryClassificationGroup, updateInventoryClassificationGroup } from './service.js';

// E «Остатки» owns this UI. Names, nesting and assignment are stored in Core.
function groups() {
  return getInventoryClassificationGroups().filter(group => group && group.groupId);
}

function groupPath(id, source = groups()) {
  const byId = new Map(source.map(group => [group.groupId, group]));
  const names = [], seen = new Set();
  while (id && !seen.has(id) && names.length < 64) {
    seen.add(id);
    const entry = byId.get(id);
    if (!entry) break;
    names.unshift(entry.name);
    id = entry.parentGroupId;
  }
  return names;
}

export function classificationOptions(value = '') {
  const source = groups();
  const byParent = new Map();
  source.forEach(group => {
    const rows = byParent.get(group.parentGroupId || '') || [];
    rows.push(group);
    byParent.set(group.parentGroupId || '', rows);
  });
  const result = [{ value: '', label: 'Без группы' }], visited = new Set();
  const walk = (parent, depth = 0) => {
    if (depth > 64) return;
    const rows = (byParent.get(parent) || []).sort((a,b) =>
      (Number(a.position) || 0) - (Number(b.position) || 0)
      || String(a.name).localeCompare(String(b.name),'ru'));
    for (const group of rows) {
      if (visited.has(group.groupId)) continue;
      visited.add(group.groupId);
      result.push({ value: group.groupId, label: '— '.repeat(Math.min(depth, 8)) + group.name });
      walk(group.groupId, depth + 1);
    }
  };
  walk('');
  // If a stale parent exists, still show the orphaned group and do not lose membership.
  source.filter(group => !visited.has(group.groupId))
    .forEach(group => result.push({ value: group.groupId, label: group.name }));
  if (value && !result.some(row => row.value === value)) {
    result.push({ value, label: 'Группа недоступна' });
  }
  return result;
}

export function openInventoryClassificationGroups(onSaved = () => {}) {
  const host = mountModal(document.body, modal(
    '<div data-inventory-classification-list></div>' +
    '<p class="form-error" role="alert" data-inventory-classification-list-error></p>' +
    actionBlock(button('Добавить', { data: 'data-inventory-classification-add' })),
    { title: 'Группы', variant: 'q', surface: 'app' },
  ));
  if (!host) return null;
  const listHost = host.querySelector('[data-inventory-classification-list]');
  const status = host.querySelector('[data-inventory-classification-list-error]');
  const refresh = () => {
    const all = groups();
    listHost.innerHTML = all.length ? list({
      className: 'ui-list--dense',
      items: all.map(group => ({
        title: group.name,
        secondary: groupPath(group.parentGroupId, all).join(' / ') || 'Основной уровень',
        interactive: true,
        aria: 'Изменить группу ' + group.name,
        data: 'data-inventory-classification-edit="' + group.groupId + '"',
      })),
    }) : emptyState('Групп пока нет');
    listHost.querySelectorAll('[data-inventory-classification-edit]').forEach(node => {
      node.addEventListener('click', () =>
        openEditor(node.dataset.inventoryClassificationEdit));
    });
  };
  const openEditor = (id = '') => {
    const all = groups();
    const current = all.find(group => group.groupId === id);
    const disabled = new Set(id ? [id] : []);
    // Compare stable IDs, not names: two branches may contain the same label.
    const byId = new Map(all.map(group => [group.groupId, group]));
    for (const entry of all) {
      let parentId = entry.parentGroupId;
      const visited = new Set();
      while (id && parentId && !visited.has(parentId)) {
        if (parentId === id) { disabled.add(entry.groupId); break; }
        visited.add(parentId);
        parentId = byId.get(parentId)?.parentGroupId;
      }
    }
    const options = [{ value: '', label: 'Основной уровень' },
      ...all.filter(group => !disabled.has(group.groupId)).map(group => ({
        value: group.groupId, label: groupPath(group.groupId, all).join(' / '),
      }))];
    const form = mountModal(document.body, modal(
      '<form data-inventory-classification-form>' +
      field({ label: 'Название', name: 'name', value: current?.name || '', required: true }) +
      select({ label: 'Родительская группа', name: 'parentGroupId',
        value: current?.parentGroupId || '', options, searchable: true }) +
      field({ label: 'Порядок', name: 'position', value: current?.position || 0,
        type: 'number', min: '0', step: '1' }) +
      '<p class="form-error" role="alert" data-inventory-classification-error></p>' +
      actionBlock(button('Сохранить', { type: 'submit' }) +
        (current ? button('Удалить', {
          variant: 'delete-outline', type: 'button',
          data: 'data-inventory-classification-archive',
        }) : '')) +
      '</form>',
      { title: current ? 'Группа' : 'Новая группа', variant: 'q', surface: 'app' },
    ));
    if (!form) return;
    const editor = form.querySelector('[data-inventory-classification-form]');
    const message = form.querySelector('[data-inventory-classification-error]');
    const run = async (isArchive = false) => {
      const save = editor.querySelector('[type="submit"]');
      const remove = editor.querySelector('[data-inventory-classification-archive]');
      save.disabled = true;
      if (remove) remove.disabled = true;
      try {
        const values = new FormData(editor);
        const payload = isArchive ? { archived: true } : {
          name: String(values.get('name') || '').trim(),
          parentGroupId: String(values.get('parentGroupId') || ''),
          position: Number(values.get('position') || 0),
        };
        if (!isArchive && !payload.name) throw new Error('Укажите название группы.');
        if (current) await updateInventoryClassificationGroup(current.groupId, payload);
        else await createInventoryClassificationGroup(payload);
        form.v2Close?.();
        refresh();
        onSaved();
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : 'Не удалось сохранить группу.';
        save.disabled = false;
        if (remove) remove.disabled = false;
      }
    };
    editor.addEventListener('submit', event => { event.preventDefault(); void run(); });
    editor.querySelector('[data-inventory-classification-archive]')
      ?.addEventListener('click', () => { void run(true); });
  };
  host.querySelector('[data-inventory-classification-add]')
    ?.addEventListener('click', () => openEditor());
  refresh();
  return host;
}
