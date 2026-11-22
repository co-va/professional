import {
  actionBlock, button, compactAddButton, compactRemoveButton, emptyState, field, initV2ListReorder,
  list, modal, mountModal, openNotice, select, v2ListEntries, v2ListEntry,
} from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { catalogDisclosure } from '../inventory/catalog-ui.js';
import { stockGroupTree, sortedStockChildren } from '../inventory/grouping.js';
import {
  getServiceGroupLevels, commitServiceGroupLevels,
  getServiceGroupEntries, commitServiceGroupOrder,
} from './products/data.js';

const id = () => crypto.randomUUID();
const clean = value => String(value || '').trim();
const kindLabel = kind => kind === 'products' ? 'Группа товаров' : 'Группа услуг';

// A group definition is not an assignment. The owner chooses each group with
// the compact + in the individual Service card, and may leave it unassigned.
// Explicit group-only selection must survive saved and rehydrated data.
export const SERVICE_GROUP_ONLY = '__service_group_only__';

function serviceGroupRow(group, value = SERVICE_GROUP_ONLY) {
  const values = Array.isArray(group.values) ? group.values : [];
  const choice = values.length
    ? select({
      name: 'serviceGroup_' + group.id,
      value: values.some(item => item.id === value) ? value : '',
      options: [{ value: '', label: 'Без значения' },
        ...values.map(item => ({ value: item.id, label: item.name }))],
      data: 'data-service-group-level="' + escapeHtml(group.id) + '"',
    })
    : '<input type="hidden" data-service-group-level="' + escapeHtml(group.id) +
      '" name="serviceGroup_' + escapeHtml(group.id) + '" value="' + SERVICE_GROUP_ONLY + '">';
  return '<div class="inventory-editor-group" data-service-group-row="' + escapeHtml(group.id) + '">' +
    '<div class="field-inline-label"><span>' + escapeHtml(group.name) + '</span>' +
      compactRemoveButton({ data: 'data-service-group-remove="' + escapeHtml(group.id) + '"',
        aria: 'Снять группу ' + group.name }) +
    '</div>' + choice + '</div>';
}

export function serviceGroupFields(kind, selected = {}) {
  const levels = getServiceGroupLevels(kind);
  const rows = levels.filter(group =>
    Object.prototype.hasOwnProperty.call(selected || {}, group.id) && String(selected[group.id] || '').trim())
    .map(group => serviceGroupRow(group, selected[group.id])).join('');
  return '<section data-service-position-groups="' + escapeHtml(kind) + '">' +
    '<div class="field-inline-label"><span>Группа</span>' +
      compactAddButton({ data: 'data-service-group-add', aria: 'Добавить группу' }) +
    '</div>' +
    '<div class="inventory-editor-group" data-service-group-rows>' + rows + '</div>' +
    '<div data-service-group-picker></div>' +
  '</section>';
}

// Returns exactly the user-selected groups, never all configured groups.
// A selected group without a value has a real marker; unselected groups have
// NO entry. This distinction prevents phantom folders and accidental resets.
export function readServiceGroupFields(root) {
  return Object.fromEntries(
    [...(root?.querySelectorAll?.('[data-service-group-row]') || [])].map(row => {
      const key = String(row.dataset.serviceGroupRow || '');
      const value = String(row.querySelector('[data-service-group-level]')?.value || '');
      return [key, value || SERVICE_GROUP_ONLY];
    }).filter(([key]) => key),
  );
}

export function bindServiceGroupFields(root) {
  const sections = [...(root?.querySelectorAll?.('[data-service-position-groups]') || [])];
  const unsubscribers = sections.map(section => {
    const levels = getServiceGroupLevels(section.dataset.servicePositionGroups);
    const rows = section.querySelector('[data-service-group-rows]');
    const picker = section.querySelector('[data-service-group-picker]');
    const plus = section.querySelector('[data-service-group-add]');
    if (!rows || !picker || !plus) return () => {};
    const refreshPlus = () => {
      const assigned = new Set([...rows.querySelectorAll('[data-service-group-row]')]
        .map(row => row.dataset.serviceGroupRow));
      plus.disabled = levels.length > 0 && levels.every(group => assigned.has(group.id));
    };
    const changed = () => section.dispatchEvent(new Event('change', { bubbles: true }));
    const onClick = event => {
      const remove = event.target.closest?.('[data-service-group-remove]');
      if (remove && section.contains(remove)) {
        rows.querySelectorAll('[data-service-group-row]').forEach(row => {
          if (row.dataset.serviceGroupRow === remove.dataset.serviceGroupRemove) row.remove();
        });
        picker.innerHTML = '';
        refreshPlus();
        changed();
        return;
      }
      if (!event.target.closest?.('[data-service-group-add]')) return;
      if (!levels.length) {
        openNotice({ title: 'Группы', message: 'Сначала создайте группу в настройках Сервиса.' });
        return;
      }
      const assigned = new Set([...rows.querySelectorAll('[data-service-group-row]')]
        .map(row => row.dataset.serviceGroupRow));
      const remaining = levels.filter(group => !assigned.has(group.id));
      if (!remaining.length) return;
      picker.innerHTML = select({
        name: 'serviceGroupToAdd', value: '',
        options: [{ value: '', label: 'Выберите группу' },
          ...remaining.map(group => ({ value: group.id, label: group.name }))],
        data: 'data-service-group-pick',
      });
      picker.querySelector('[data-ui-select-trigger]')?.click();
    };
    const onInput = event => {
      const candidate = event.target.closest?.('[data-service-group-pick]');
      if (!candidate) return;
      const group = levels.find(item => item.id === candidate.value);
      if (group && ![...rows.querySelectorAll('[data-service-group-row]')]
        .some(row => row.dataset.serviceGroupRow === group.id)) {
        rows.insertAdjacentHTML('beforeend', serviceGroupRow(group));
        refreshPlus();
        changed();
      }
      picker.innerHTML = '';
    };
    section.addEventListener('click', onClick);
    section.addEventListener('change', onInput);
    refreshPlus();
    return () => {
      section.removeEventListener('click', onClick);
      section.removeEventListener('change', onInput);
    };
  });
  return () => unsubscribers.forEach(dispose => dispose());
}

// Existing Stock disclosure and V2 items, but a named group must fold even if
// it has NO values. With values: "Инструменты" → "Брашинг" → V2 positions.
// Multiple chosen groups are nested in the configured order, never implicit.
export function renderServiceGroupTree(items = [], kind = 'procedures', renderRow = () => '', onReorder = () => {}, onError = () => {}) {
  const levels = getServiceGroupLevels(kind);
  if (!levels.length) return null;
  const criteria = levels.flatMap(group => [
    { id: '__service_group_' + group.id, values: [{ id: 'selected', name: group.name }] },
    { id: group.id, values: group.values || [] },
  ]);
  const decorated = items.map(item => {
    const criteriaValues = {};
    for (const group of levels) {
      const value = String(item.groupValues?.[group.id] || '').trim();
      if (!value) continue;
      criteriaValues['__service_group_' + group.id] = 'selected';
      if (value !== SERVICE_GROUP_ONLY &&
          group.values?.some(option => option.id === value)) criteriaValues[group.id] = value;
    }
    return { ...item, criteriaValues };
  });
  const tree = stockGroupTree(decorated, criteria);
  const directRows = rows => rows.length
    ? v2ListEntries(rows.map(renderRow)) : '';
  const walk = node => sortedStockChildren(node, criteria).map(child => {
    // No auto-expansion: one group is still deliberately collapsible.
    return catalogDisclosure(child.value, walk(child), Boolean(node.key), child.items.length);
  }).join('') + directRows(node.direct);
  const html = '<div data-service-group-catalog>' + walk(tree) + '</div>';
  const attach = host => {
    const disposers = [...host.querySelectorAll('.list-entries')].map(groupList =>
      initV2ListReorder(groupList, {
        onReorder: async ids => {
          const currentOrder = items.map(item => String(item.id));
          const chosen = new Set(ids);
          let offset = 0;
          const merged = currentOrder.map(key => chosen.has(key) ? ids[offset++] : key);
          await onReorder(merged);
        },
        onError,
      }));
    return () => disposers.forEach(dispose => dispose?.());
  };
  return { html, attach };
}

// Shared V → Группы directory. A V2 row has the group name in the main line
// and EXACTLY "Группа товаров" / "Группа услуг" in the small secondary line.
// Groups and all their values share one existing Service auxiliary dataset.
// Only creation/editing uses compact X. There is never a second Q for values.
export function openServiceGroupingQ({ onSaved = () => {} } = {}) {
  const initialEntries = getServiceGroupEntries();
  let layer = null;
  let activeKey = null;
  let disposeDrag = () => {};

  const fail = cause => openNotice({
    title: 'Группы',
    message: cause instanceof Error ? cause.message : 'Не удалось сохранить.',
  });
  const persist = async (kind, next) => {
    await commitServiceGroupLevels(kind, next);
    onSaved();
    if (layer) repaint();
  };
  const groupByKey = key => getServiceGroupEntries().find(item => item.key === key);

  const confirmRemove = (title, action) => {
    const confirm = mountModal(document.body, modal(
      '<p>Позиции останутся на месте, изменится только группировка.</p>' +
        '<div class="form-error" role="alert" data-service-group-confirm-error></div>' +
        actionBlock(button('Удалить', {
          type: 'button', variant: 'danger', data: 'data-service-group-confirm-delete',
        }) + button('Отмена', {
          type: 'button', variant: 'secondary', data: 'data-service-group-confirm-cancel',
        })),
      { title, variant: 'x', xRole: 'action', surface: 'app' },
    ));
    if (!confirm) return;
    confirm.querySelector('[data-service-group-confirm-cancel]')
      ?.addEventListener('click', () => confirm.v2Close?.());
    confirm.querySelector('[data-service-group-confirm-delete]')
      ?.addEventListener('click', async event => {
        const control = event.currentTarget;
        if (control.disabled) return;
        control.disabled = true;
        try {
          await action();
          confirm.v2Close?.();
        } catch (cause) {
          const error = confirm.querySelector('[data-service-group-confirm-error]');
          if (error) error.textContent = cause?.message || 'Не удалось удалить.';
          control.disabled = false;
        }
      });
  };

  const groupEditorX = (previous = null) => {
    const editor = mountModal(document.body, modal(
      '<form class="compact-form" data-service-group-editor-form>' +
        (previous ? '' : select({
          label: 'Раздел', name: 'groupKind', value: 'procedures',
          options: [
            { value: 'procedures', label: 'Услуги' },
            { value: 'products', label: 'Товары' },
          ],
        })) +
        field({ label: 'Наименование группы', name: 'name',
          value: previous?.name || '', required: true, maxlength: 80 }) +
        '<div class="form-error" role="alert" data-service-group-editor-error></div>' +
        actionBlock(
          button('Сохранить', {
            type: 'submit', data: 'data-service-group-editor-save',
          }) +
          (previous ? button('Удалить группу', {
            type: 'button', variant: 'danger', data: 'data-service-group-editor-delete',
          }) : ''),
        ) +
      '</form>',
      { title: previous ? 'Группа' : 'Добавить группу',
        variant: 'x', xRole: 'editor', surface: 'app' },
    ));
    if (!editor) return null;
    const form = editor.querySelector('[data-service-group-editor-form]');
    const saveButton = editor.querySelector('[data-service-group-editor-save]');
    let busy = false;
    const hasChange = () => {
      const name = String(new FormData(form).get('name') || '').trim();
      return Boolean(name) && (!previous || name !== String(previous.name || '').trim());
    };
    const syncSave = () => {
      if (saveButton) saveButton.style.display = hasChange() ? '' : 'none';
    };
    form?.addEventListener('input', syncSave);
    form?.addEventListener('change', syncSave);
    if (form) syncSave();
    form?.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || !hasChange()) return;
      const section = previous?.kind || String(new FormData(form).get('groupKind') || '');
      const title = String(new FormData(form).get('name') || '').trim();
      if (!title || !['procedures', 'products'].includes(section)) return;
      busy = true;
      try {
        const existing = getServiceGroupLevels(section);
        const next = previous
          ? existing.map(group => group.id === previous.id
            ? { ...group, name: title } : group)
          : [...existing, { id: id(), name: title, values: [] }];
        await persist(section, next);
        editor.v2Close?.();
        // With no groups, enter through X only. After the first save, show
        // the same single combined Q instead of opening another blank form.
        if (!layer) openServiceGroupingQ({ onSaved });
      } catch (cause) {
        const error = editor.querySelector('[data-service-group-editor-error]');
        if (error) error.textContent = cause?.message || 'Не удалось сохранить.';
      } finally { busy = false; }
    });
    editor.querySelector('[data-service-group-editor-delete]')
      ?.addEventListener('click', () => {
        if (!previous) return;
        confirmRemove('Удалить группу?', async () => {
          await persist(previous.kind, getServiceGroupLevels(previous.kind)
            .filter(group => group.id !== previous.id));
          editor.v2Close?.();
          activeKey = null;
          repaint();
        });
      });
    return editor;
  };

  const valueEditorX = (groupKey, previous = null) => {
    const current = groupByKey(groupKey);
    if (!current) return null;
    const editor = mountModal(document.body, modal(
      '<form class="compact-form" data-service-value-editor-form>' +
        field({ label: 'Наименование значения', name: 'name',
          value: previous?.name || '', required: true, maxlength: 80 }) +
        '<div class="form-error" role="alert" data-service-value-editor-error></div>' +
        actionBlock(
          button('Сохранить', {
            type: 'submit', data: 'data-service-value-editor-save',
          }) +
          (previous ? button('Удалить значение', {
            type: 'button', variant: 'danger', data: 'data-service-value-editor-delete',
          }) : ''),
        ) +
      '</form>',
      { title: previous ? 'Значение' : 'Добавить значение',
        variant: 'x', xRole: 'editor', surface: 'app' },
    ));
    if (!editor) return null;
    const form = editor.querySelector('[data-service-value-editor-form]');
    const saveButton = editor.querySelector('[data-service-value-editor-save]');
    let busy = false;
    const hasChange = () => {
      const name = String(new FormData(form).get('name') || '').trim();
      return Boolean(name) && (!previous || name !== String(previous.name || '').trim());
    };
    const syncSave = () => {
      if (saveButton) saveButton.style.display = hasChange() ? '' : 'none';
    };
    form?.addEventListener('input', syncSave);
    form?.addEventListener('change', syncSave);
    if (form) syncSave();
    const apply = async remove => {
      if (busy) {
        if (remove) throw new Error('Дождитесь завершения сохранения.');
        return;
      }
      const name = String(new FormData(form).get('name') || '').trim();
      if (!remove && !hasChange()) return;
      busy = true;
      try {
        const next = getServiceGroupLevels(current.kind).map(group => {
          if (group.id !== current.id) return group;
          const values = Array.isArray(group.values) ? group.values : [];
          return { ...group, values: remove
            ? values.filter(value => value.id !== previous.id)
            : previous ? values.map(value => value.id === previous.id
              ? { ...value, name } : value)
              : [...values, { id: id(), name }] };
        });
        await persist(current.kind, next);
        editor.v2Close?.();
      } catch (cause) {
        const error = editor.querySelector('[data-service-value-editor-error]');
        if (error) error.textContent = cause?.message || 'Не удалось сохранить.';
        // The confirming X must not close when deletion was rejected.
        if (remove) throw cause;
      } finally { busy = false; }
    };
    form?.addEventListener('submit', event => {
      event.preventDefault();
      void apply(false);
    });
    editor.querySelector('[data-service-value-editor-delete]')
      ?.addEventListener('click', () => {
        if (previous) confirmRemove('Удалить значение?', () => apply(true));
      });
    return editor;
  };

  // No definitions yet: only a compact X ("Добавить группу").
  if (!initialEntries.length) return groupEditorX();

  layer = mountModal(document.body, modal(
    '<div data-service-group-directory></div>' +
      '<div data-service-group-detail hidden></div>' +
      '<div class="form-error" role="alert" data-service-groups-error></div>' +
      actionBlock(
        button('Изменить группу', {
          type: 'button', variant: 'secondary', data: 'data-service-groups-edit-action',
        }) +
        button('Добавить группу', {
          type: 'button', data: 'data-service-groups-main-action',
        }),
      ),
    { title: 'Группы', variant: 'q', surface: 'app' },
  ));
  if (!layer) return null;

  const directory = layer.querySelector('[data-service-group-directory]');
  const detail = layer.querySelector('[data-service-group-detail]');
  const action = layer.querySelector('[data-service-groups-main-action]');
  const editAction = layer.querySelector('[data-service-groups-edit-action]');
  const error = layer.querySelector('[data-service-groups-error]');

  function repaint() {
    disposeDrag();
    disposeDrag = () => {};
    const entries = getServiceGroupEntries();
    const active = activeKey ? entries.find(item => item.key === activeKey) : null;
    if (activeKey && !active) activeKey = null;
    const inDetail = Boolean(active && activeKey);
    const headerTitle = layer.querySelector('[data-v2-q-header] .v2-q-title');
    if (headerTitle) {
      headerTitle.textContent = inDetail ? active.name : 'Группы';
      // The heading is purely a heading. Editing is a bottom action.
    }
    directory.hidden = inDetail;
    detail.hidden = !inDetail;
    action.textContent = inDetail ? 'Добавить значение' : 'Добавить группу';
    if (editAction) editAction.style.display = inDetail ? '' : 'none';
    if (error) error.textContent = '';
    if (!inDetail) {
      directory.innerHTML = entries.length
        ? v2ListEntries(entries.map(group => v2ListEntry({
          title: group.name,
          subtitle: kindLabel(group.kind),
          initial: '', interactive: true, reorderHandle: true,
          reorderAria: 'Переместить ' + group.name,
          data: 'data-service-group-directory-key="' + escapeHtml(group.key) +
            '" data-reorder-id="' + escapeHtml(group.key) + '"',
          aria: 'Открыть группу ' + group.name,
        })))
        : emptyState('Групп пока нет');
      directory.querySelectorAll('[data-service-group-directory-key]').forEach(node => {
        node.addEventListener('click', event => {
          if (event.target.closest?.('[data-reorder-handle]')) return;
          activeKey = node.dataset.serviceGroupDirectoryKey;
          repaint();
        });
      });
      disposeDrag = initV2ListReorder(directory, {
        onReorder: async keys => {
          await commitServiceGroupOrder(keys);
          onSaved();
        },
        onError: fail,
      });
      return;
    }

    // Use the native Q arrow to return to the group directory. Group edits
    // remain in the Q bottom action area; no buttons above the value rows.
    detail.innerHTML =
      '<div class="inventory-editor-group">' +
        '<div class="inventory-editor-label">' + kindLabel(active.kind) + '</div>' +
        '<div data-service-group-value-list></div>' +
      '</div>';
    const listHost = detail.querySelector('[data-service-group-value-list]');
    const values = Array.isArray(active.values) ? active.values : [];
    listHost.innerHTML = values.length
      ? list({ className: 'ui-list--dense list-entries',
        items: values.map(value => ({
          title: value.name, interactive: true, reorderHandle: true,
          data: 'data-service-value="' + escapeHtml(value.id) +
            '" data-reorder-id="' + escapeHtml(value.id) + '"',
          aria: 'Изменить значение ' + value.name,
        })),
      })
      : emptyState('Значений пока нет');

    listHost.querySelectorAll('[data-service-value]').forEach(node => {
      node.addEventListener('click', event => {
        if (event.target.closest?.('[data-reorder-handle]')) return;
        const fresh = groupByKey(activeKey);
        valueEditorX(activeKey, fresh?.values?.find(value =>
          value.id === node.dataset.serviceValue));
      });
    });
    disposeDrag = initV2ListReorder(listHost, {
      onReorder: async ids => {
        const fresh = groupByKey(activeKey);
        if (!fresh) throw new Error('Группа больше не существует.');
        const byId = new Map((fresh.values || []).map(value => [value.id, value]));
        if (ids.length !== byId.size || ids.some(id => !byId.has(id))) {
          throw new Error('Список значений изменился.');
        }
        const next = getServiceGroupLevels(fresh.kind).map(group =>
          group.id === fresh.id ? {
            ...group, values: ids.map(id => byId.get(id)),
          } : group);
        await commitServiceGroupLevels(fresh.kind, next);
        onSaved();
      },
      onError: fail,
    });
  }

  // The shared Q surface already supports v2Back for its native arrow
  // and swipe. Consume Back only inside a group; otherwise dismiss normally.
  layer.v2Back = () => {
    if (!activeKey) return false;
    activeKey = null;
    repaint();
    return true;
  };
  editAction?.addEventListener('click', () => {
    const active = activeKey ? groupByKey(activeKey) : null;
    if (active) groupEditorX(active);
  });
  action.addEventListener('click', () => {
    if (activeKey) valueEditorX(activeKey);
    else groupEditorX();
  });
  repaint();
  const close = layer.v2Close?.bind(layer);
  if (close) layer.v2Close = () => { disposeDrag(); close(); };
  return layer;
}
