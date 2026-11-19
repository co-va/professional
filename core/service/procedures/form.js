import { collectCost, validateCostDefinition, costField, durationPicker, field, initCostFields, initDurationPickers, setSharedProfilePrimary, textareaField } from '../../../ui/ui.js';
import { getProcedures, commitProcedure, commitProcedureWorkplace } from './data.js';
import { setSharedActionVisible } from '../../../ui/page/page.js';
import { procedureEditorSignature, rebaseWorkplaceAssignmentSignature } from '../editor-signature.js';
import { bindServiceWorkplaceAssignments, serviceWorkplaceAssignmentList } from '../workplace-selection.js';
import { compactCheck } from '../../../ui/selection/check-list.js';
import { procedureGroupBookingFields, bindProcedureGroupBooking } from './group-booking-ui.js';

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
  return `<form class="compact-form" data-procedure-editor-form>
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
    ${compactCheck({ label: 'Для онлайн-записи', checked: procedure.visibleInPublicBooking !== false, data: 'data-procedure-online-check' })}
    ${serviceWorkplaceAssignmentList()}
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

  initCostFields(root);
  initDurationPickers(root);

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
      visibleInPublicBooking: onlineCheck?.checked !== false,
      workplaces: draft.workplaces,
    });
  };
  const onlineCheck = root.querySelector('[data-procedure-online-check]');
  let initialSignature = signature();
  const actions = primary.closest('.modal-actions');
  let visible = null;
  let wasBusy = null;
  let saving = false;
  let assignmentSaving = false;
  const syncDirty = () => {
    const changed = signature() !== initialSignature;
    const busy = saving || assignmentSaving;
    if (visible === changed && wasBusy === busy) return changed;
    if (visible !== changed) setSharedActionVisible(actions, changed);
    visible = changed;
    wasBusy = busy;
    setSharedProfilePrimary(primary, { visible: changed, label: 'Сохранить', disabled: busy });
    return changed;
  };

  bindServiceWorkplaceAssignments(root, {
    kind: 'procedure',
    selected: draft.workplaces,
    getBase: () => {
      const stored = existing?.id ? getProcedures().find((item) => item.id === existing.id) || existing : null;
      return {
        cost: stored?.cost || collectCost(root, 'procedureCost'),
        duration: stored?.duration ?? Number(form.querySelector('[name="procedureDuration"]')?.value || 0),
        breakDuration: stored?.breakDuration ?? Number(form.querySelector('[name="procedureBreak"]')?.value || 0),
        description: stored?.description ?? form.querySelector('[name="procedureDescription"]')?.value ?? '',
        visibleInPublicBooking: stored?.visibleInPublicBooking ?? (onlineCheck?.checked !== false),
        groupBooking: stored?.groupBooking || draft.groupBooking,
      };
    },
    onChange: (workplaces) => {
      draft.workplaces = workplaces;
      syncDirty();
    },
    onPersistAssignment: async (workplaceId, assignment) => {
      if (!existing?.id) return; // First Q Save creates a new Procedure.
      if (saving || assignmentSaving) throw new Error('Дождитесь завершения сохранения.');
      assignmentSaving = true;
      syncDirty();
      try {
        await commitProcedureWorkplace(existing.id, workplaceId, assignment);
        initialSignature = rebaseWorkplaceAssignmentSignature(initialSignature, workplaceId, assignment);
      } finally {
        assignmentSaving = false;
        syncDirty();
      }
    },
  });

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
  onlineCheck?.addEventListener('change', syncDirty);

  form.addEventListener('input', syncDirty);
  form.addEventListener('change', syncDirty);
  form.addEventListener('click', (event) => {
    if (event.target.closest('[data-cost-mode]')) syncDirty();
  });

  const save = async () => {
    if (saving || assignmentSaving || !syncDirty()) return null;
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
    const item = {
      ...(existing || {}),
      id: existing?.id || crypto.randomUUID(),
      photo: String(draft.photo || existing?.photo || ''),
      name,
      description: String(data.get('procedureDescription') || '').trim(),
      duration: Number(data.get('procedureDuration') || 0),
      breakDuration: Number(data.get('procedureBreak') || 0),
      cost: price,
      visibleInPublicBooking: onlineCheck?.checked !== false,
      groupBooking: {
        enabled: groupEnabled,
        capacity: groupEnabled ? Math.min(999, groupCapacity) : Math.max(2, Math.floor(Number(draft.groupBooking?.capacity) || 2)),
      },
      workplaces: Array.isArray(draft.workplaces) ? draft.workplaces.map((item) => ({ ...item })) : [],
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
      setSharedProfilePrimary(primary, { visible, label: 'Сохранить' });
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
