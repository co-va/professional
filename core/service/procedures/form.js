import { createServiceSaveController } from '../editor-actions.js';
import { collectCost, validateCostDefinition, costField, durationPicker, field, initCostFields, initDurationPickers, setSharedProfilePrimary, textareaField } from '../../../ui/ui.js';
import { getProcedures, commitProcedure } from './data.js';
import { procedureEditorSignature } from '../editor-signature.js';
import { moveDesktopQTool, pinDesktopQDanger } from '../../../ui/v2/z-layout.js';
import { procedureGroupBookingFields, bindProcedureGroupBooking, adaptDesktopGroupBooking } from './group-booking-ui.js';
import { serviceGroupFields, readServiceGroupFields, bindServiceGroupFields } from '../catalog-grouping.js';

export function initialProcedure(existing = null, defaultWorkplace = null) {
  if (existing) return {
    ...existing,
    workplaces: Array.isArray(existing.workplaces) ? existing.workplaces.map((item) => ({ ...item })) : [],
    groupBooking: {
      enabled: existing?.groupBooking?.enabled === true,
      capacity: Math.max(2, Math.floor(Number(existing?.groupBooking?.capacity) || 2)),
    },
  };
  return {
    id: '',
    photo: '',
    name: '',
    description: '',
    duration: 0,
    breakDuration: 0,
    cost: { mode: 'amount', amount: '', free: false },
    groupBooking: { enabled: false, capacity: 2 },
    visibleInPublicBooking: true,
    workplaces: defaultWorkplace ? [{ ...defaultWorkplace }] : [],
  };
}

export function procedureEditorForm(procedure = initialProcedure()) {
  return `<form class="form-grid" data-procedure-editor-form>
    ${field({ label: 'Название', name: 'procedureName', value: procedure.name || '', placeholder: 'Название услуги', required: true })}
    <div class="work-time-row__fields">
      ${durationPicker({ label: 'Длительность', name: 'procedureDuration', value: procedure.duration || 0 })}
      ${durationPicker({ label: 'Перерыв', name: 'procedureBreak', value: procedure.breakDuration || 0 })}
    </div>
    ${costField({ value: procedure.cost || {}, name: 'procedureCost' })}
    ${textareaField({ label: 'Описание', name: 'procedureDescription', value: procedure.description || '', placeholder: 'Описание услуги' })}
    ${procedureGroupBookingFields({
      enabled: procedure.groupBooking.enabled,
      capacity: procedure.groupBooking.capacity,
      toggleData: 'data-procedure-group-toggle',
      capacityData: 'data-procedure-group-capacity',
      capacityName: 'procedureGroupCapacity',
    })}
    ${serviceGroupFields('procedures', procedure.groupValues || {})}
    <div class="form-error" data-procedure-editor-error></div>
  </form>`;
}

export function bindProcedureEditor(root, {
  existing = null,
  draft = initialProcedure(existing),
  onSaved = () => {},
} = {}) {
  const form = root.querySelector('[data-procedure-editor-form]');
  const primary = root.querySelector('[data-procedure-editor-primary]');
  if (!form || !primary) return { save: async () => null };

  if (root.closest('[data-v2-q="true"]')) {
    adaptDesktopGroupBooking(form, {
      toggleSelector: '[data-procedure-group-toggle]',
      capacitySelector: '[data-procedure-group-capacity]',
    });
  }

  initCostFields(root);
  initDurationPickers(root);
  bindServiceGroupFields(form);

  const signature = () => {
    const data = new FormData(form);
    return procedureEditorSignature({
      name: data.get('procedureName'),
      duration: data.get('procedureDuration'),
      breakDuration: data.get('procedureBreak'),
      cost: collectCost(root, 'procedureCost'),
      description: data.get('procedureDescription'),
      groupEnabled: draft.groupBooking?.enabled === true,
      groupCapacity: data.get('procedureGroupCapacity'),
      visibleInPublicBooking: draft.visibleInPublicBooking !== false,
      workplaces: draft.workplaces,
      groupValues: readServiceGroupFields(form),
    });
  };
  let initialSignature = signature();
  let saving = false;
  const { syncDirty, currentVisibility } = createServiceSaveController(primary, {
    signature,
    baseline: () => initialSignature,
    busy: () => saving,
  });

  moveDesktopQTool(primary);
  const deleteButton = root.querySelector('[data-procedure-editor-delete]');
  if (deleteButton) pinDesktopQDanger(deleteButton);

  // The relocated capacity remains associated with the same form.
  const groupTools = form.querySelector('.desktop-inline-group-booking');
  const header = root.querySelector('[data-v2-q-header-content]');
  const toolbar = header?.querySelector(':scope > .desktop-q-toolbar');
  const capacityInput = groupTools?.querySelector('[name="procedureGroupCapacity"]');
  if (groupTools && toolbar && capacityInput) {
    form.id ||= 'procedure-editor-' + crypto.randomUUID();
    capacityInput.setAttribute('form', form.id);
    groupTools.setAttribute('data-desktop-q-secondary-tools', '');
    groupTools.setAttribute('data-v2-layer-gesture-ignore', '');
    header.append(groupTools);
    // Outside the form, input/change no longer bubble to its listeners.
    capacityInput.addEventListener('input', syncDirty);
    capacityInput.addEventListener('change', syncDirty);
  }

  bindProcedureGroupBooking(root, {
    toggleSelector: '[data-procedure-group-toggle]',
    capacitySelector: '[data-procedure-group-capacity]',
    isEnabled: () => draft.groupBooking?.enabled === true,
    toggle: () => {
      draft.groupBooking = {
        enabled: draft.groupBooking?.enabled !== true,
        capacity: Math.max(2, Math.floor(Number(draft.groupBooking?.capacity) || 2)),
      };
    },
    onChange: syncDirty,
  });

  form.addEventListener('input', syncDirty);
  form.addEventListener('change', syncDirty);
  form.addEventListener('click', (event) => {
    if (event.target.closest('[data-cost-mode]')) syncDirty();
  });

  const save = async () => {
    if (saving || !syncDirty()) return null;
    const data = new FormData(form);
    const name = String(data.get('procedureName') || '').trim();
    const error = root.querySelector('[data-procedure-editor-error]');
    if (!name) {
      if (error) error.textContent = 'Укажите название услуги.';
      return null;
    }
    const price = collectCost(root, 'procedureCost');
    const priceError = validateCostDefinition(price);
    if (priceError) {
      if (error) error.textContent = priceError;
      return null;
    }
    const groupEnabled = draft.groupBooking?.enabled === true;
    const groupCapacity = Math.floor(Number(data.get('procedureGroupCapacity')) || Number(draft.groupBooking?.capacity) || 0);
    if (groupEnabled && groupCapacity < 2) {
      if (error) error.textContent = 'Для групповой записи укажите минимум 2 человека.';
      return null;
    }
    saving = true;
    setSharedProfilePrimary(primary, { visible: true, label: 'Сохранить', disabled: true });
    const latest = existing?.id ? getProcedures().find(item => item.id === existing.id) || existing : null;
    const item = {
      ...(latest || {}),
      id: existing?.id || crypto.randomUUID(),
      photo: String(draft.photo || existing?.photo || ''),
      name,
      description: String(data.get('procedureDescription') || '').trim(),
      duration: Number(data.get('procedureDuration') || 0),
      breakDuration: Number(data.get('procedureBreak') || 0),
      cost: price,
      visibleInPublicBooking: (latest ?? draft).visibleInPublicBooking !== false,
      groupBooking: {
        enabled: groupEnabled,
        capacity: groupEnabled ? Math.min(999, groupCapacity) : Math.max(2, Math.floor(Number(draft.groupBooking?.capacity) || 2)),
      },
      workplaces: Array.isArray((latest ?? draft).workplaces) ? (latest ?? draft).workplaces.map((item) => ({ ...item })) : [],
      groupValues: readServiceGroupFields(form),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await commitProcedure(item);
    } catch (failure) {
      if (error) error.textContent = failure instanceof Error ? failure.message : 'Не удалось сохранить услугу.';
      return null;
    } finally {
      saving = false;
      setSharedProfilePrimary(primary, { visible: currentVisibility(), label: 'Сохранить' });
    }
    if (error) error.textContent = '';
    onSaved(item);
    return item;
  };

  primary.addEventListener('click', save);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });
  syncDirty();
  return { save };
}
