import {
  actionBlock, button, compactAddButton, compactRemoveButton, emptyState, field, initV2ListReorder,
  modal, mountModal, openNotice, select, v2ListEntries, v2ListEntry,
} from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { catalogDisclosure } from '../inventory/catalog-ui.js';
import { stockGroupTree, sortedStockChildren } from '../inventory/grouping.js';
import { getServiceGroupLevels, commitServiceGroupLevels } from './products/data.js';

const id = () => crypto.randomUUID();
const clean = value => String(value || '').trim();
const kindName = kind => kind === 'products' ? 'товаров' : 'услуг';

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
      if (group && !rows.querySelector('[data-service-group-row="' + CSS.escape(group.id) + '"]')) {
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

export function openServiceGroupingQ(kind, { onSaved = () => {} } = {}) {
  if (!['procedures', 'products'].includes(kind)) return null;
  const layer = mountModal(document.body, modal(
    '<div data-service-group-levels></div>' +
      '<div class="form-error" role="alert" data-service-group-error></div>' +
      actionBlock(button('Добавить группу', { data: 'data-service-add-level' })),
    { title: 'Группы ' + kindName(kind), variant: 'q', surface: 'app' },
  ));
  if (!layer) return null;
  let levels = getServiceGroupLevels(kind);
  const error = layer.querySelector('[data-service-group-error]');
  let dispose = () => {};
  const fail = cause => {
    const message = cause instanceof Error ? cause.message : 'Не удалось сохранить группировку.';
    if (error) error.textContent = message;
    openNotice({ title: 'Группы', message });
  };
  const save = async next => {
    levels = await commitServiceGroupLevels(kind, next);
    onSaved();
    repaint();
  };
  // Removing a group or option detaches its classification only; source
  // Services, Products, Stock and historical Records are never deleted.
  const confirmRemove = (title, action) => {
    const layerConfirm = mountModal(document.body, modal(
      '<p>Позиции останутся в каталоге, изменится только группировка.</p>' +
      '<div class="form-error" role="alert" data-service-group-remove-error></div>' +
      actionBlock(button('Удалить', { type: 'button', variant: 'delete-outline',
        data: 'data-service-group-remove-confirm' }) +
        button('Отмена', { type: 'button', variant: 'secondary',
          data: 'data-service-group-remove-cancel' })),
      { title, variant: 'q', surface: 'app' },
    ));
    if (!layerConfirm) return;
    layerConfirm.querySelector('[data-service-group-remove-cancel]')
      ?.addEventListener('click', () => layerConfirm.v2Close?.());
    layerConfirm.querySelector('[data-service-group-remove-confirm]')
      ?.addEventListener('click', async event => {
        const btn = event.currentTarget;
        if (btn.disabled) return;
        btn.disabled = true;
        try {
          await action();
          layerConfirm.v2Close?.();
        } catch (cause) {
          const node = layerConfirm.querySelector('[data-service-group-remove-error]');
          if (node) node.textContent = cause.message || 'Не удалось удалить.';
          btn.disabled = false;
        }
      });
  };

  const valueEditor = (group, previous = null) => {
    const valueLayer = mountModal(document.body, modal(
      '<form data-service-value-form>' +
        field({ label: 'Название значения', name: 'name', value: previous?.name || '', required: true }) +
        '<div class="form-error" role="alert" data-service-value-error></div>' +
        actionBlock(button('Сохранить', { type: 'submit' }) +
          (previous ? button('Удалить', { type: 'button', variant: 'delete-outline', data: 'data-service-value-delete' }) : '')) +
      '</form>',
      { title: previous ? 'Значение' : 'Новое значение', variant: 'q', surface: 'app' },
    ));
    if (!valueLayer) return;
    const form = valueLayer.querySelector('[data-service-value-form]');
    let busy = false;
    const persist = async remove => {
      if (busy) return;
      const name = clean(form.elements.namedItem('name')?.value);
      if (!remove && !name) return;
      busy = true;
      try {
        const changed = levels.map(level => level.id !== group.id ? level : {
          ...level, values: remove
            ? level.values.filter(value => value.id !== previous.id)
            : previous
              ? level.values.map(value => value.id === previous.id ? { ...value, name } : value)
              : [...level.values, { id: id(), name }],
        });
        await save(changed);
        valueLayer.v2Close?.();
      } catch (cause) {
        const output = valueLayer.querySelector('[data-service-value-error]');
        if (output) output.textContent = cause.message || 'Не удалось сохранить.';
      } finally { busy = false; }
    };
    form.addEventListener('submit', event => { event.preventDefault(); void persist(false); });
    valueLayer.querySelector('[data-service-value-delete]')?.addEventListener('click', () =>
      confirmRemove('Удалить значение?', () => persist(true)));
  };
  const levelEditor = (previous = null) => {
    const editor = mountModal(document.body, modal(
      '<form data-service-level-form>' +
        field({ label: 'Название группы', name: 'name', value: previous?.name || '', required: true }) +
        '<div class="form-error" role="alert" data-service-level-error></div>' +
        actionBlock(button('Сохранить', { type: 'submit' }) +
          (previous ? button('Удалить группу', { type: 'button', variant: 'delete-outline', data: 'data-service-level-delete' }) : '')) +
      '</form>',
      { title: previous ? 'Группа' : 'Новая группа', variant: 'q', surface: 'app' },
    ));
    if (!editor) return;
    const form = editor.querySelector('[data-service-level-form]');
    let busy = false;
    const persist = async remove => {
      if (busy) return;
      const name = clean(form.elements.namedItem('name')?.value);
      if (!remove && !name) return;
      busy = true;
      try {
        const changed = remove ? levels.filter(level => level.id !== previous.id)
          : previous ? levels.map(level => level.id === previous.id ? { ...level, name } : level)
            : [...levels, { id: id(), name, values: [] }];
        await save(changed);
        editor.v2Close?.();
      } catch (cause) {
        const output = editor.querySelector('[data-service-level-error]');
        if (output) output.textContent = cause.message || 'Не удалось сохранить.';
      } finally { busy = false; }
    };
    form.addEventListener('submit', event => { event.preventDefault(); void persist(false); });
    editor.querySelector('[data-service-level-delete]')?.addEventListener('click', () =>
      confirmRemove('Удалить группу?', () => persist(true)));
  };
  const openValues = key => {
    const group = levels.find(row => row.id === key);
    if (!group) return;
    const valuesLayer = mountModal(document.body, modal(
      '<div data-service-group-values></div>' +
        actionBlock(button('Добавить значение', { data: 'data-service-add-value' }) +
          button('Изменить группу', { variant: 'secondary', data: 'data-service-edit-level' })),
      { title: group.name, variant: 'q', surface: 'app' },
    ));
    if (!valuesLayer) return;
    let release = () => {};
    const repaintValues = () => {
      release();
      const now = levels.find(level => level.id === key);
      if (!now) { valuesLayer.v2Close?.(); return; }
      const host = valuesLayer.querySelector('[data-service-group-values]');
      host.innerHTML = now.values.length
        ? v2ListEntries(now.values.map(value => v2ListEntry({
          title: value.name, initial: '', interactive: true, omitEmptySubtitle: true,
          data: 'data-service-value="' + escapeHtml(value.id) + '" data-reorder-id="' + escapeHtml(value.id) + '"',
          reorderHandle: true, aria: 'Изменить значение ' + value.name,
        })))
        : emptyState('Значений пока нет');
      host.querySelectorAll('[data-service-value]').forEach(node => {
        node.addEventListener('click', event => {
          if (event.target.closest('[data-reorder-handle]')) return;
          const active = levels.find(level => level.id === key);
          valueEditor(active, active?.values.find(value => value.id === node.dataset.serviceValue));
        });
      });
      release = initV2ListReorder(host, {
        onReorder: ids => save(levels.map(level => level.id !== key ? level : {
          ...level, values: ids.map(id => level.values.find(value => value.id === id)),
        })),
        onError: fail,
      });
    };
    // Values are re-read after each Q closes; the source remains the shared
    // tenant-scoped config and not a duplicated local option list.
    valuesLayer.querySelector('[data-service-add-value]')?.addEventListener('click', () => {
      valueEditor(levels.find(level => level.id === key));
    });
    valuesLayer.querySelector('[data-service-edit-level]')?.addEventListener('click', () => {
      levelEditor(levels.find(level => level.id === key));
    });
    repaintValues();
    const listen = () => repaintValues();
    layer.addEventListener('service-group-levels-changed', listen);
    const close = valuesLayer.v2Close?.bind(valuesLayer);
    if (close) valuesLayer.v2Close = () => {
      release();
      layer.removeEventListener('service-group-levels-changed', listen);
      close();
    };
  };
  const repaint = () => {
    dispose();
    const host = layer.querySelector('[data-service-group-levels]');
    if (!host) return;
    host.innerHTML = levels.length
      ? v2ListEntries(levels.map(group => v2ListEntry({
        title: group.name, rightTop: group.values.length + ' знач.',
        interactive: true, initial: '', omitEmptySubtitle: true,
        data: 'data-service-level="' + escapeHtml(group.id) + '" data-reorder-id="' + escapeHtml(group.id) + '"',
        reorderHandle: true, aria: 'Открыть группу ' + group.name,
      })))
      : emptyState('Групп пока нет', 'Добавьте свой первый уровень.');
    host.querySelectorAll('[data-service-level]').forEach(node =>
      node.addEventListener('click', event => {
        if (!event.target.closest('[data-reorder-handle]')) openValues(node.dataset.serviceLevel);
      }));
    dispose = initV2ListReorder(host, {
      onReorder: ids => save(ids.map(id => levels.find(level => level.id === id))),
      onError: fail,
    });
    layer.dispatchEvent(new Event('service-group-levels-changed'));
  };
  layer.querySelector('[data-service-add-level]')?.addEventListener('click', () => levelEditor());
  repaint();
  const close = layer.v2Close?.bind(layer);
  if (close) layer.v2Close = () => { dispose(); close(); };
  return layer;
}
