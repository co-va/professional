import { collectCost, costField, durationPicker, field, initCostFields, initDurationPickers, setSharedProfilePrimary, textareaField, v2ListEntries, v2ListEntry } from '../../../ui/ui.js';
import { pushProcedureHistory, saveProcedure as saveProcedureData } from './data.js';

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
    workplaces: defaultWorkplace ? [{ ...defaultWorkplace }] : [],
  };
}

export function procedureEditorForm(existing = null) {
  const procedure = initialProcedure(existing);
  return `<form class="compact-form" data-procedure-editor-form>
    ${field({ label: 'Название', name: 'procedureName', value: procedure.name || '', placeholder: 'Название процедуры', required: true })}
    ${costField({ value: procedure.cost || {}, name: 'procedureCost' })}
    <div class="work-time-row__fields">
      ${durationPicker({ label: 'Длительность', name: 'procedureDuration', value: procedure.duration || 0 })}
      ${durationPicker({ label: 'Перерыв', name: 'procedureBreak', value: procedure.breakDuration || 0 })}
    </div>
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
    ${textareaField({ label: 'Описание', name: 'procedureDescription', value: procedure.description || '', placeholder: 'Описание процедуры' })}
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
  });
  syncGroupBooking();

  const save = async () => {
    const data = new FormData(form);
    const name = String(data.get('procedureName') || '').trim();
    const error = root.querySelector('[data-procedure-editor-error]');
    if (!name) {
      if (error) error.textContent = 'Укажите название процедуры.';
      return null;
    }
    const groupEnabled = draft.groupBooking?.enabled === true;
    const groupCapacity = Math.floor(Number(data.get('procedureGroupCapacity')) || Number(draft.groupBooking?.capacity) || 0);
    if (groupEnabled && groupCapacity < 2) {
      if (error) error.textContent = 'Для групповой записи укажите минимум 2 человека.';
      return null;
    }
    setSharedProfilePrimary(primary, { visible: true, label: 'Сохранить', disabled: true });
    const item = {
      ...(existing || {}),
      id: existing?.id || crypto.randomUUID(),
      photo: String(draft.photo || existing?.photo || ''),
      name,
      description: String(data.get('procedureDescription') || '').trim(),
      duration: Number(data.get('procedureDuration') || 0),
      breakDuration: Number(data.get('procedureBreak') || 0),
      cost: collectCost(root, 'procedureCost'),
      groupBooking: {
        enabled: groupEnabled,
        capacity: groupEnabled ? Math.min(999, groupCapacity) : Math.max(2, Math.floor(Number(draft.groupBooking?.capacity) || 2)),
      },
      workplaces: Array.isArray(draft.workplaces) ? draft.workplaces.map((item) => ({ ...item })) : [],
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (existing) pushProcedureHistory(existing, 'updated');
    saveProcedureData(item);
    if (error) error.textContent = '';
    onSaved(item);
    return item;
  };

  primary.addEventListener('click', save);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });
  setSharedProfilePrimary(primary, { visible: true, label: 'Сохранить' });
  return { save };
}
