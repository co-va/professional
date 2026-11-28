import { modal, mountModal } from '../../ui/modals/index.js';
import { moveDesktopQTool, pinDesktopQDanger } from '../../ui/v2/z-layout.js';
import { isV2DesktopWorkspace } from '../../ui/v2/geometry.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { button, WORKPLACE_ADD_ICON } from '../../ui/buttons/index.js';
import { collectCost, costField, initCostFields, validateCostDefinition, costListParts } from '../../ui/cost/index.js';
import { durationPicker, durationText, initDurationPickers } from '../../ui/duration/index.js';
import { textareaField } from '../../ui/inputs/index.js';
import { compactCheck } from '../../ui/selection/check-list.js';
import { list as sharedList } from '../../ui/lists/list.js';
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
export function serviceWorkplaceControls() {
  const catalog = options();
  const sole = catalog.length === 1 ? catalog[0] : null;
  return {
    showAdd: catalog.length > 1,
    sole: sole ? { workplaceId: sole.id, name: sole.name } : null,
  };
}

// An existing unassigned item must remain editable without an Add button.
// Do not persist or count this provisional card as an assignment.
export function serviceOverviewWorkplaces(selected = []) {
  const rows = Array.isArray(selected) ? selected : [];
  const { sole } = serviceWorkplaceControls();
  return sole && !rows.some(row => idOf(row) === sole.workplaceId)
    ? [...rows, { ...sole, unassigned: true }]
    : rows;
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
  return button(WORKPLACE_ADD_ICON, {
    variant: 'secondary', className: 'v2-desktop-tool-primary',
    data: 'data-service-workplace-add title="Добавить рабочее пространство"', aria: 'Добавить рабочее пространство',
  });
}

export function bindServiceWorkplaceAssignments(root, {
  selected = [],
  overview = false,
  kind = 'procedure',
  getBase = () => ({}),
  onChange = () => {},
  onPersistAssignment = async () => {},
} = {}) {
  const assignments = new Map((Array.isArray(selected) ? selected : [])
    .map((item) => [idOf(item), { ...item }]).filter(([id]) => id));
  const catalog = options();
  const list = overview ? root : root.querySelector('[data-service-workplace-prices]');
  const addButton = root.querySelector('[data-service-workplace-add]');
  if (!list || (!overview && !addButton)) return { read: () => [] };
  const desktopTool = overview ? isV2DesktopWorkspace(root.closest('[data-v2-app]')) : moveDesktopQTool(addButton);
  if (desktopTool && !overview) {
    // Only page-level actions, not local price/assignment editor controls.
    const remove = root.querySelector('[data-procedure-editor-delete], [data-product-editor-delete], [data-service-retail-product-delete]');
    const primary = root.querySelector('[data-procedure-editor-primary], [data-product-editor-primary], [data-service-retail-price-apply]');
    if (remove) pinDesktopQDanger(remove);
    if (primary) moveDesktopQTool(primary);
  }
  const isProcedure = kind === 'procedure';
  // Preserve legacy assignments even if a workplace was archived or is
  // temporarily missing from the current list. Never erase them on Q Save.
  const read = () => [...assignments].map(([id, assignment]) => ({
    ...assignment,
    workplaceId: id,
    name: catalog.find((space) => space.id === id)?.name || assignment.name || 'Рабочее пространство',
  }));
  const render = () => {
    if (overview) return;
    const base = getBase();
    list.innerHTML = sharedList({ className: 'ui-list--dense', items: read()
      .filter((item) => catalog.some((space) => space.id === item.workplaceId))
      .map((item) => {
        const cost = hasPrice(item.cost) ? item.cost : base.cost;
        const duration = minutes(item.duration ?? base.duration);
        const summary = isProcedure ? `${durationText(duration)} · ${costText(cost)}` : costText(cost);
        return {
          title: item.name,
          secondary: summary,
          interactive: true,
          data: `data-service-workplace-open="${escapeHtml(item.workplaceId)}"`,
          aria: `Настройки ${item.name}`,
        };
      }) });
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
      visibleInPublicBooking: !isProcedure
        ? current.visibleInPublicBooking === true
        : overview
          ? base.visibleInPublicBooking !== false && current.visibleInPublicBooking !== false
          : current.visibleInPublicBooking ?? base.visibleInPublicBooking ?? true,
    };
    const signature = (value) => JSON.stringify({
      cost: costSnapshot(value.cost),
      duration: isProcedure ? minutes(value.duration) : null,
      breakDuration: isProcedure ? minutes(value.breakDuration) : null,
      description: String(value.description),
      visibleInPublicBooking: value.visibleInPublicBooking === true,
    });
    const originalSignature = signature(values);
    const content = `<div class="compact-form service-workplace-price-editor" data-service-workplace-editor>
      ${overview ? '' : `<strong class="service-workplace-price-editor__title">${escapeHtml(space.name)}</strong>`}
      ${isProcedure ? `<div class="work-time-row__fields">
        ${durationPicker({ name: 'localDuration', label: 'Длительность', value: values.duration })}
        ${durationPicker({ name: 'localBreak', label: 'Перерыв', value: values.breakDuration })}
      </div>` : ''}
      ${costField({ name: 'workplaceCost', value: values.cost })}
      ${textareaField({ label: 'Описание', name: 'localDescription', value: values.description, rows: 3 })}
      <div class="service-workplace-extra">
        ${compactCheck({ label: 'Онлайн-запись', checked: values.visibleInPublicBooking === true, data: 'data-local-online' })}
      </div>
      <div class="form-error" role="alert" data-service-workplace-error></div>
      ${overview ? '</div>' : ''}
      <div class="modal-actions">
        <div data-service-workplace-apply-host${overview && desktopTool ? ' class="modal-actions"' : ''}${isNew ? '' : ' hidden'}>
          ${button('Применить', { data: 'data-service-workplace-apply' })}
        </div>
        ${!isNew && hasPrice(current.cost) ? button('Отменить', {
          variant: 'secondary', data: 'data-service-workplace-cancel-price',
          aria: 'Отменить индивидуальную цену',
        }) : ''}
        ${!isNew ? button(isProcedure ? 'Убрать из услуги' : 'Убрать из пространства', {
          variant: 'danger', data: 'data-service-workplace-remove',
        }) : ''}
      </div>
    ${overview ? '' : '</div>'}`;
    const layer = mountModal(document.body, modal(content, {
      variant: overview ? 'q' : 'x', xRole: overview ? '' : 'editor', title: space.name, surface: overview ? 'app' : '',
    }));
    if (!layer) return;
    if (overview && desktopTool) {
      const primary = layer.querySelector('[data-service-workplace-apply]');
      const cancel = layer.querySelector('[data-service-workplace-cancel-price]');
      const remove = layer.querySelector('[data-service-workplace-remove]');
      const actions = primary?.closest('[data-service-workplace-apply-host]')?.parentElement;
      // Move only individual actions; the visibility wrapper travels with Save.
      if (cancel) moveDesktopQTool(cancel);
      if (primary) moveDesktopQTool(primary);
      if (remove && actions) {
        const danger = actions.ownerDocument.createElement('div');
        danger.className = 'app-settings-panel';
        actions.before(danger);
        danger.append(remove);
        pinDesktopQDanger(remove);
      }
      if (actions && !actions.children.length) actions.remove();
      const header = layer.querySelector('[data-v2-q-header-content]');
      const toolbar = header?.querySelector(':scope > .desktop-q-toolbar');
      const extra = layer.querySelector('.service-workplace-extra');
      const online = extra?.querySelector('.ui-compact-check');
      if (toolbar && online) {
        online.classList.add('desktop-q-online-booking');
        toolbar.prepend(online);
        if (!extra.children.length) extra.remove();
      }
    } else if (desktopTool) {
      const editor = layer.querySelector('[data-service-workplace-editor]');
      const title = editor?.querySelector('.service-workplace-price-editor__title');
      const footer = editor?.querySelector('.modal-actions');
      if (editor && title && footer) {
        const header = editor.ownerDocument.createElement('div');
        header.className = 'desktop-workplace-heading';
        title.replaceWith(header);
        header.append(title);
        const close = editor.ownerDocument.createElement('button');
        close.type = 'button';
        close.className = 'v2-layer__close desktop-workplace-close';
        close.setAttribute('aria-label', 'Закрыть');
        close.setAttribute('data-modal-close', '');
        close.textContent = '×';
        header.append(close);
        const tools = editor.ownerDocument.createElement('div');
        tools.className = 'desktop-workplace-tools';
        for (const action of footer.querySelectorAll('[data-service-workplace-apply-host], [data-service-workplace-cancel-price]')) tools.append(action);
        header.after(tools);
        footer.classList.add('desktop-workplace-danger-footer');
        if (!footer.children.length) footer.hidden = true;
        editor.classList.add('desktop-workplace-editor');
      }
    }
    initCostFields(layer);
    if (isProcedure) initDurationPickers(layer);
    let saving = false;
    const readValues = () => {
      return {
        cost: collectCost(layer, 'workplaceCost'),
        duration: isProcedure ? Number(layer.querySelector('[name="localDuration"]')?.value || 0) : 0,
        breakDuration: isProcedure ? Number(layer.querySelector('[name="localBreak"]')?.value || 0) : 0,
        description: layer.querySelector('[name="localDescription"]')?.value || '',
        visibleInPublicBooking: Boolean(layer.querySelector('[data-local-online]')?.checked),
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
        if (overview) assignment.visibleInPublicBooking = draft.visibleInPublicBooking;
        else assign('visibleInPublicBooking', draft.visibleInPublicBooking, base.visibleInPublicBooking !== false);
        delete assignment.groupBooking;
      } else {
        assignment.visibleInPublicBooking = draft.visibleInPublicBooking === true;
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

  if (overview) {
    list.querySelectorAll('[data-service-workplace-open]').forEach(card => {
      card.addEventListener('click', () => edit(card.dataset.serviceWorkplaceOpen, {
        isNew: !assignments.has(card.dataset.serviceWorkplaceOpen),
      }));
    });
  } else {
    list.addEventListener('click', (event) => {
      const row = event.target.closest('[data-service-workplace-open]');
      if (row && list.contains(row)) edit(row.dataset.serviceWorkplaceOpen);
    });
  }
  addButton?.addEventListener('click', () => {
    const available = catalog.filter((space) => !assignments.has(space.id));
    if (!available.length) {
      const layer = mountModal(desktopTool ? addButton : document.body, modal('<div class="muted">Все рабочие пространства уже добавлены.</div>',
        { variant: 'x', xRole: 'picker', className: desktopTool ? 'desktop-q-action-popup service-workplace-picker' : '' }));
      return layer;
    }
    const content = sharedList({ className: 'ui-list--dense', items: available.map((space) => ({
      title: space.name,
      interactive: true,
      data: `data-service-workplace-choose="${escapeHtml(space.id)}"`,
      aria: `Выбрать ${space.name}`,
    })) });
    const picker = mountModal(desktopTool ? addButton : document.body, modal(content, { variant: 'x', xRole: 'picker', title: 'Рабочее пространство', className: desktopTool ? 'desktop-q-action-popup service-workplace-picker' : '' }));
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
