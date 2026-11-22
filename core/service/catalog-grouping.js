import {
  actionBlock, button, emptyState, field, initV2ListReorder,
  modal, mountModal, openNotice, select, v2ListEntries, v2ListEntry,
} from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { catalogDisclosure } from '../inventory/catalog-ui.js';
import { stockGroupTree, sortedStockChildren } from '../inventory/grouping.js';
import { getServiceGroupLevels, commitServiceGroupLevels } from './products/data.js';

const id = () => crypto.randomUUID();
const clean = value => String(value || '').trim();
const kindName = kind => kind === 'products' ? 'товаров' : 'услуг';

export function serviceGroupFields(kind, selected = {}) {
  return getServiceGroupLevels(kind).map(group => select({
    name: 'serviceGroup_' + group.id,
    label: group.name,
    value: selected?.[group.id] || '',
    options: [
      { value: '', label: 'Без группы' },
      ...(group.values || []).map(value => ({ value: value.id, label: value.name })),
    ],
    data: 'data-service-group-level="' + escapeHtml(group.id) + '"',
  })).join('');
}

export function readServiceGroupFields(root) {
  return Object.fromEntries(
    [...(root?.querySelectorAll?.('input[data-service-group-level]') || [])]
      .filter(input => clean(input.value))
      .map(input => [String(input.dataset.serviceGroupLevel), clean(input.value)]),
  );
}

// Reuse Inventory's ordered-criteria tree and disclosure panels. V2 rows stay
// V2 at ALL catalogue sizes; groups only fold them into named levels.
export function renderServiceGroupTree(items = [], kind = 'procedures', renderRow = () => '', onReorder = () => {}, onError = () => {}) {
  const levels = getServiceGroupLevels(kind);
  if (!levels.length) return null;
  const decorated = items.map(item => ({ ...item, criteriaValues: item.groupValues || {} }));
  const tree = stockGroupTree(decorated, levels);
  const directRows = rows => rows.length
    ? v2ListEntries(rows.map(renderRow)) : '';
  const walk = node => {
    const children = sortedStockChildren(node, levels);
    return children.map(child => {
      const content = walk(child) + directRows(child.direct);
      const markup = catalogDisclosure(child.value, content, Boolean(node.key), child.items.length);
      // With one sole branch there is no navigation choice; reveal its content.
      return children.length === 1 && node.direct.length === 0
        ? markup.replace('<details>', '<details open>') : markup;
    }).join('') + directRows(node.direct);
  };
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
    valueLayer.querySelector('[data-service-value-delete]')?.addEventListener('click', () => void persist(true));
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
    editor.querySelector('[data-service-level-delete]')?.addEventListener('click', () => void persist(true));
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
    const oldOnSaved = onSaved;
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
