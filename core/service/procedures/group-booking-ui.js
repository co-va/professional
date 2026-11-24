import { v2ListEntry, v2ListEntries } from '../../../ui/lists/list-entry.js';
import { field } from '../../../ui/inputs/index.js';

// Shared Group Booking UI for the Procedure and each assigned Workplace.
export function procedureGroupBookingFields({
  enabled = false, capacity = 2, toggleData = '', capacityData = '', capacityName = '',
} = {}) {
  return `${v2ListEntries([v2ListEntry({
    title: 'Групповая запись',
    subtitle: 'Разрешить запись нескольких людей',
    interactive: false,
    toggleData, toggleAria: 'Групповая запись', toggleChecked: enabled,
  })])}
    <div ${capacityData}${enabled ? '' : ' hidden'}>
      ${field({
        label: 'Максимум людей', name: capacityName, type: 'number',
        value: String(Math.max(2, Math.floor(Number(capacity) || 2))),
        min: '2', max: '999', step: '1', inputmode: 'numeric',
      })}
    </div>`;
}
export function bindProcedureGroupBooking(root, {
  toggleSelector, capacitySelector, isEnabled, toggle, onChange = () => {},
} = {}) {
  const control = root.querySelector(toggleSelector);
  const capacity = root.querySelector(capacitySelector);
  const sync = () => {
    const enabled = Boolean(isEnabled());
    control?.setAttribute('aria-pressed', String(enabled));
    control?.classList.toggle('is-on', enabled);
    control?.querySelector('.app-setting-toggle__switch')?.classList.toggle('is-on', enabled);
    if (capacity) capacity.hidden = !enabled;
  };
  control?.addEventListener('click', () => {
    toggle();
    sync();
    onChange();
  });
  sync();
  return { sync };
}
