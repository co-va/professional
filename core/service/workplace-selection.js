import { modal, mountModal } from '../../ui/modals/index.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { button } from '../../ui/buttons/index.js';
import { collectCost, costField, initCostFields, validateCostDefinition, costListParts } from '../../ui/cost/index.js';
import { durationPicker, durationText, initDurationPickers } from '../../ui/duration/index.js';
import { field, textareaField } from '../../ui/inputs/index.js';
import { compactCheck } from '../../ui/selection/check-list.js';
import { costSnapshot } from './editor-signature.js';
import { getWorkplaces } from '../profile/workplaces/data.js';

const key = (value) => String(value ?? '');
const idOf = (item = {}) => key(item.workplaceId || item.key || item.id);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const minutes = (value) => Math.max(0, Number(value) || 0);

function options() {
  return getWorkplaces().map((space) => ({
    id: key(space.key || space.id),
    name: String(space.name || 'Рабочее пространство'),
  })).filter((space) => space.id);
}
function hasPrice(cost) {
  return Boolean(cost && typeof cost === 'object' && (
    cost.free === true || cost.amount !== '' && cost.amount != null
    || cost.from !== '' && cost.from != null || cost.to !== '' && cost.to != null
  ));
}
function costText(cost) {
  const value = costListParts(cost || {});
  return [value.rightTop, value.rightBottom].filter(Boolean).join(' ') || 'Не указана';
}

export function serviceWorkplaceAssignmentList() {
  return '<div class="service-workplace-price-list" data-service-workplace-prices></div>';
}

export function serviceWorkplaceAddButton() {
  return button('Добавить рабочее пространство', {
    variant: 'secondary', data: 'data-service-workplace-add',
  });
}

export function bindServiceWorkplaceAssignments(root, {
  selected = [],
  kind = 'procedure',
  getBase = () => ({}),
  onChange = () => {},
  onPersistAssignment = async () => {},
} = {}) {
  const assignments = new Map((Array.isArray(selected) ? selected : [])
    .map((item) => [idOf(item), { ...item }]).filter(([id]) => id));
  const catalog = options();
  const list = root.querySelector('[data-service-workplace-prices]');
  const addButton = root.querySelector('[data-service-workplace-add]');
  if (!list || !addButton) return { read: () => [] };
  const isProcedure = kind === 'procedure';
  // Preserve legacy assignments even if a workplace was archived or is
  // temporarily missing from the current list. Never erase them on Q Save.
  const read = () => [...assignments].map(([id, assignment]) => ({
    ...assignment,
    workplaceId: id,
    name: catalog.find((space) => space.id === id)?.name || assignment.name || 'Рабочее пространство',
  }));
  const render = () => {
    const base = getBase();
    list.innerHTML = read().filter((item) => catalog.some((space) => space.id === item.workplaceId)).map((item) => {
      const cost = hasPrice(item.cost) ? item.cost : base.cost;
      const duration = minutes(item.duration ?? base.duration);
      const summary = isProcedure ? `${durationText(duration)} · ${costText(cost)}` : costText(cost);
      return `<button type="button" class="service-workplace-price-row" data-service-workplace-open="${escapeHtml(item.workplaceId)}"
        aria-label="Настройки ${escapeHtml(item.name)}">
        <span class="service-workplace-price-row__name">${escapeHtml(item.name)}</span>
        <span class="service-workplace-price-row__price"><strong>${escapeHtml(summary)}</strong></span>
        <span class="service-workplace-price-row__chevron" aria-hidden="true">›</span>
      </button>`;
    }).join('');
  };
  const publish = () => { render(); onChange(read()); };

  const edit = (id, { isNew = false } = {}) => {
    const space = catalog.find((item) => item.id === id);
    if (!space) return;
    const current = assignments.get(id) || { workplaceId: id, name: space.name };
    const base = getBase();
    const currentCost = hasPrice(current.cost) ? current.cost : base.cost;
    const values = {
      cost: currentCost || {},
      duration: minutes(current.duration ?? base.duration),
      breakDuration: minutes(current.breakDuration ?? base.breakDuration),
      description: String(current.description ?? base.description ?? ''),
      visibleInPublicBooking: current.visibleInPublicBooking ?? base.visibleInPublicBooking ?? true,
      groupBooking: current.groupBooking || base.groupBooking || { enabled: false, capacity: 2 },
    };
    const signature = (value) => JSON.stringify({
      cost: costSnapshot(value.cost),
      duration: isProcedure ? minutes(value.duration) : null,
      breakDuration: isProcedure ? minutes(value.breakDuration) : null,
      description: String(value.description),
      visibleInPublicBooking: isProcedure ? value.visibleInPublicBooking !== false : null,
      groupBooking: isProcedure ? {
        enabled: value.groupBooking?.enabled === true,
        capacity: value.groupBooking?.enabled === true
          ? Math.max(2, Math.floor(Number(value.groupBooking?.capacity) || 2)) : null,
      } : null,
    });
    const originalSignature = signature(values);
    const content = `<div class="service-workplace-price-editor" data-service-workplace-editor>
      <strong class="service-workplace-price-editor__title">${escapeHtml(space.name)}</strong>
      ${isProcedure ? `<div class="work-time-row__fields">
        ${durationPicker({ name: 'localDuration', label: 'Длительность', value: values.duration })}
        ${durationPicker({ name: 'localBreak', label: 'Перерыв', value: values.breakDuration })}
      </div>` : ''}
      ${costField({ name: 'workplaceCost', value: values.cost })}
      ${textareaField({ label: 'Описание', name: 'localDescription', value: values.description, rows: 3 })}
      ${isProcedure ? `<div class="service-workplace-extra">
        ${compactCheck({ label: 'Для онлайн-записи', checked: values.visibleInPublicBooking !== false, data: 'data-local-online' })}
        ${compactCheck({ label: 'Групповая запись', checked: values.groupBooking.enabled === true, data: 'data-local-group' })}
        <div data-local-group-count${values.groupBooking.enabled === true ? '' : ' hidden'}>
          ${field({ label: 'Максимум людей', name: 'localCapacity', type: 'number',
            value: String(values.groupBooking.capacity || 2), min: '2', max: '999', step: '1', inputmode: 'numeric' })}
        </div>
      </div>` : ''}
      <div class="form-error" role="alert" data-service-workplace-error></div>
      <div class="service-workplace-price-editor__actions">
        <div data-service-workplace-apply-host${isNew ? '' : ' hidden'}>
          ${button('Применить', { data: 'data-service-workplace-apply' })}
        </div>
        ${!isNew && hasPrice(current.cost) ? button('Отменить', {
          variant: 'secondary', data: 'data-service-workplace-cancel-price',
          aria: 'Отменить индивидуальную цену',
        }) : ''}
        ${!isNew ? button('Убрать из услуги', {
          variant: 'secondary', className: 'service-workplace-remove-link', data: 'data-service-workplace-remove',
        }) : ''}
      </div>
    </div>`;
    const layer = mountModal(document.body, modal(content, { variant: 'x', xRole: 'editor', title: space.name }));
    if (!layer) return;
    initCostFields(layer);
    if (isProcedure) initDurationPickers(layer);
    let saving = false;
    const readValues = () => {
      const groupEnabled = layer.querySelector('[data-local-group]')?.checked ?? false;
      return {
        cost: collectCost(layer, 'workplaceCost'),
        duration: isProcedure ? Number(layer.querySelector('[name="localDuration"]')?.value || 0) : 0,
        breakDuration: isProcedure ? Number(layer.querySelector('[name="localBreak"]')?.value || 0) : 0,
        description: layer.querySelector('[name="localDescription"]')?.value || '',
        visibleInPublicBooking: !isProcedure || Boolean(layer.querySelector('[data-local-online]')?.checked),
        groupBooking: { enabled: groupEnabled, capacity: Number(layer.querySelector('[name="localCapacity"]')?.value || 2) },
      };
    };
    const actions = layer.querySelector('[data-service-workplace-apply]');
    const applyHost = layer.querySelector('[data-service-workplace-apply-host]');
    const errorNode = layer.querySelector('[data-service-workplace-error]');
    const sync = () => {
      const changed = isNew || signature(readValues()) !== originalSignature;
      if (applyHost) applyHost.hidden = !changed;
      if (actions) actions.disabled = saving;
      layer.querySelectorAll('[data-service-workplace-remove],[data-service-workplace-cancel-price]')
        .forEach((node) => { node.disabled = saving; });
      return changed;
    };
    const groupCheck = layer.querySelector('[data-local-group]');
    groupCheck?.addEventListener('change', () => {
      const capacity = layer.querySelector('[data-local-group-count]');
      if (capacity) capacity.hidden = !groupCheck.checked;
    });
    layer.addEventListener('input', sync);
    layer.addEventListener('change', sync);
    sync();

    const apply = async (nextAssignment) => {
      if (saving) return;
      saving = true;
      sync();
      if (errorNode) errorNode.textContent = '';
      try {
        await onPersistAssignment(id, nextAssignment);
        if (nextAssignment === null) assignments.delete(id);
        else assignments.set(id, nextAssignment);
        publish();
        layer.v2Close?.();
      } catch (error) {
        if (errorNode) errorNode.textContent = error instanceof Error ? error.message : 'Не удалось сохранить.';
      } finally {
        saving = false;
        if (layer.isConnected) sync();
      }
    };

    layer.querySelector('[data-service-workplace-apply]')?.addEventListener('click', () => {
      if (!sync()) return;
      const draft = readValues();
      const error = validateCostDefinition(draft.cost);
      if (error) { if (errorNode) errorNode.textContent = error; return; }
      if (isProcedure && draft.duration <= 0) {
        if (errorNode) errorNode.textContent = 'Укажите длительность услуги.';
        return;
      }
      const assignment = { ...current, workplaceId: id, name: space.name };
      // Store only values different from the main Procedure/Product. Inherited
      // values remain inherited when the main catalog is updated later.
      const assign = (property, value, inherited, equals = eq) => {
        if (equals(value, inherited)) delete assignment[property];
        else assignment[property] = value;
      };
      assign('cost', draft.cost, base.cost || {}, (a, b) => eq(costSnapshot(a), costSnapshot(b)));
      assign('description', draft.description, String(base.description ?? ''));
      if (isProcedure) {
        assign('duration', minutes(draft.duration), minutes(base.duration));
        assign('breakDuration', minutes(draft.breakDuration), minutes(base.breakDuration));
        assign('visibleInPublicBooking', draft.visibleInPublicBooking, base.visibleInPublicBooking !== false);
        assign('groupBooking', draft.groupBooking, base.groupBooking || { enabled: false, capacity: 2 },
          (a, b) => eq(Boolean(a?.enabled), Boolean(b?.enabled))
            && (!a?.enabled || Number(a.capacity) === Number(b.capacity)));
      }
      void apply(assignment);
    });

    // Only the price override is cancelled. All other local variations remain.
    layer.querySelector('[data-service-workplace-cancel-price]')?.addEventListener('click', () => {
      const next = { ...current };
      delete next.cost;
      void apply(next);
    });
    layer.querySelector('[data-service-workplace-remove]')?.addEventListener('click', () => {
      void apply(null);
    });
  };

  list.addEventListener('click', (event) => {
    const row = event.target.closest('[data-service-workplace-open]');
    if (row && list.contains(row)) edit(row.dataset.serviceWorkplaceOpen);
  });
  addButton.addEventListener('click', () => {
    const available = catalog.filter((space) => !assignments.has(space.id));
    if (!available.length) {
      const layer = mountModal(document.body, modal('<div class="muted">Все рабочие пространства уже добавлены.</div>',
        { variant: 'x', xRole: 'picker' }));
      return layer;
    }
    const content = available.map((space) => `<button type="button" class="service-workplace-add-option"
      data-service-workplace-choose="${escapeHtml(space.id)}">${escapeHtml(space.name)}</button>`).join('');
    const picker = mountModal(document.body, modal(content, { variant: 'x', xRole: 'picker', title: 'Рабочее пространство' }));
    picker?.querySelectorAll('[data-service-workplace-choose]').forEach((choice) => {
      choice.addEventListener('click', () => {
        const id = choice.dataset.serviceWorkplaceChoose;
        picker.v2Close?.();
        edit(id, { isNew: true });
      });
    });
  });

  // Price and other inherited values update their labels immediately on Q
  // edits; no additional fetch or full Record/Finance recalculation.
  const form = root.querySelector('[data-procedure-editor-form], [data-product-editor-form]');
  form?.addEventListener('input', (event) => {
    if (event.target.closest('[data-cost-field], [data-duration-picker], textarea')) render();
  });
  form?.addEventListener('change', render);
  render();
  return { read };
}
