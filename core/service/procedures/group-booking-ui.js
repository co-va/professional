import { v2ListEntry, v2ListEntries } from '../../../ui/lists/list-entry.js';
import { field } from '../../../ui/inputs/index.js';
import { isV2DesktopWorkspace } from '../../../ui/v2/geometry.js';

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
// One Desktop layout for the main Procedure and assigned Workplace.
export function adaptDesktopGroupBooking(container, { toggleSelector, capacitySelector, onlineSelector } = {}) {
  if (!container || !isV2DesktopWorkspace(container.closest('[data-v2-app]'))) return false;
  const toggle = container.querySelector(toggleSelector);
  const group = toggle?.closest('.list-entries');
  const capacity = container.querySelector(capacitySelector);
  const input = capacity?.querySelector('input[type="number"]');
  const online = onlineSelector ? container.querySelector(onlineSelector)?.closest('.ui-compact-check') : null;
  if (!group || group.parentElement !== container || capacity?.parentElement !== container || (onlineSelector && online?.parentElement !== container) || !input) return false;
  const row = group.querySelector('.list-entry__content');
  if (!row || toggle.parentElement !== row) return false;
  group.classList.add('desktop-inline-group-booking');
  capacity.classList.add('desktop-inline-capacity');
  input.setAttribute('aria-label', 'Максимум людей');
  input.title = 'Максимум людей';
  // Keep one white row: original title, numeric input, original toggle.
  row.insertBefore(capacity, toggle);
  if (online) container.prepend(group, online);
  else container.prepend(group);
  return true;
}

export function bindProcedureGroupBooking(root, {
  toggleSelector, capacitySelector, isEnabled, toggle, onChange = () => {},
} = {}) {
  const control = root.querySelector(toggleSelector);
  const capacity = root.querySelector(capacitySelector);
  const inlineInput = capacity?.classList.contains('desktop-inline-capacity')
    ? capacity.querySelector('input[type="number"]') : null;
  let priorEnabled = null;
  let enabledCapacity = inlineInput?.value || '2';
  const sync = () => {
    const enabled = Boolean(isEnabled());
    control?.setAttribute('aria-pressed', String(enabled));
    control?.classList.toggle('is-on', enabled);
    control?.querySelector('.app-setting-toggle__switch')?.classList.toggle('is-on', enabled);
    if (inlineInput) {
      // A disabled single-person service is displayed as 1, not saved as
      // a one-person group. Retain the draft group capacity across toggles.
      if (enabled !== priorEnabled) {
        if (enabled) inlineInput.value = enabledCapacity;
        else {
          if (priorEnabled === true) enabledCapacity = inlineInput.value;
          inlineInput.value = '1';
        }
        inlineInput.dataset.enabledCapacity = enabledCapacity;
        inlineInput.min = enabled ? '2' : '1';
        inlineInput.disabled = !enabled;
        priorEnabled = enabled;
      }
      capacity.hidden = false;
    } else if (capacity) capacity.hidden = !enabled;
  };
  control?.addEventListener('click', () => {
    toggle();
    sync();
    onChange();
  });
  sync();
  return { sync };
}
