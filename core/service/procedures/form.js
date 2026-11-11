import { collectCost, validateCostDefinition, costField, durationPicker, field, initCostFields, initDurationPickers, setSharedProfilePrimary, textareaField, v2ListEntries, v2ListEntry } from '../../../ui/ui.js';
import { getProcedures, saveProcedure as saveProcedureData } from './data.js';
import { flushBusinessPersistence } from '../../../core/business-persistence.js';
import { setSharedActionVisible } from '../../../ui/page/page.js';
import { procedureEditorSignature, rebaseWorkplaceAssignmentSignature } from '../editor-signature.js';
import { persistServiceWorkplaceAssignment } from '../workplace-assignment.js';
import { bindServiceWorkplaceAssignments, serviceWorkplaceAssignmentList } from '../workplace-selection.js';
import { compactCheck } from '../../../ui/selection/check-list.js';

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
    ${v2ListEntries([v2ListEntry({
      title: 'Групповая запись',
      subtitle: 'Разрешить запись нескольких людей',
      interactive: false,
      toggleData: 'data-procedure-group-toggle',
      toggleAria: 'Групповая запись',
      toggleChecked: procedure.groupBooking.enabled,
    })])}
    <div data-procedure-group-capacity${procedure.groupBooking.enabled ? '' : ' hidden'}>
      ${field({
        label: 'Максимум людей',
        name: 'procedureGroupCapacity',
        type: 'number',
        value: String(procedure.groupBooking.capacity),
        min: '2',
        max: '999',
        step: '1',
        inputmode: 'numeric',
      })}
    </div>
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
  let saving = false;
  let assignmentSaving = false;
  const syncDirty = () => {
    const changed = signature() !== initialSignature;
    if (visible === changed) return changed;
    visible = changed;
    setSharedActionVisible(actions, changed);
    setSharedProfilePrimary(primary, { visible: changed, label: 'Сохранить', disabled: saving || assignmentSaving });
    return changed;
  };

  bindServiceWorkplaceAssignments(root, {
    kind: 'procedure',
    selected: draft.workplaces,
    getBase: () => ({
      cost: collectCost(root, 'procedureCost'),
      duration: Number(form.querySelector('[name="procedureDuration"]')?.value || 0),
      breakDuration: Number(form.querySelector('[name="procedureBreak"]')?.value || 0),
      description: form.querySelector('[name="procedureDescription"]')?.value || '',
      visibleInPublicBooking: onlineCheck?.checked !== false,
      groupBooking: draft.groupBooking,
    }),
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
        await persistServiceWorkplaceAssignment({
          entityId: existing.id,
          workplaceId,
          assignment,
          readEntity: (id) => getProcedures().find((item) => String(item.id) === id),
          writeEntity: saveProcedureData,
        });
        initialSignature = rebaseWorkplaceAssignmentSignature(initialSignature, workplaceId, assignment);
      } finally {
        assignmentSaving = false;
        syncDirty();
      }
    },
  });

  const groupToggle = root.querySelector('[data-procedure-group-toggle]');
  const groupCapacityHost = root.querySelector('[data-procedure-group-capacity]');
  const syncGroupBooking = () => {
    const enabled = draft.groupBooking?.enabled === true;
    groupToggle?.setAttribute('aria-pressed', String(enabled));
    groupToggle?.classList.toggle('is-on', enabled);
    groupToggle?.querySelector('.app-setting-toggle__switch')?.classList.toggle('is-on', enabled);
    if (groupCapacityHost) groupCapacityHost.hidden = !enabled;
  };
  groupToggle?.addEventListener('click', () => {
    draft.groupBooking = {
      enabled: draft.groupBooking?.enabled !== true,
      capacity: Math.max(2, Math.floor(Number(draft.groupBooking?.capacity) || 2)),
    };
    syncGroupBooking();
    syncDirty();
  });
  syncGroupBooking();
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
      saveProcedureData(item);
      // The editor must not report success until the canonical API queue is acknowledged.
      await flushBusinessPersistence();
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
