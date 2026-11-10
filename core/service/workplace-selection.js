import { modal, mountModal } from '../../ui/ui.js';
import { notificationSettings } from '../../ui/settings/index.js';
import { getWorkplaces } from '../profile/workplaces/data.js';

function workplaceId(value = {}) {
  return String(value.workplaceId || value.id || value.key || '');
}

function selectedAssignmentMap(selected = []) {
  return new Map((Array.isArray(selected) ? selected : [])
    .map((assignment) => [workplaceId(assignment), assignment])
    .filter(([id]) => Boolean(id)));
}

// The same existing Shared checkbox list is used inside Q editors and the
// standalone X picker. Selection does not persist until its owner saves.
export function serviceWorkplaceChecklist(selected = [], { showStatus = false } = {}) {
  const chosen = selectedAssignmentMap(selected);
  const workplaces = getWorkplaces();
  if (!workplaces.length) return '<div class="muted">Рабочих пространств пока нет.</div>';
  return notificationSettings(workplaces.map((workplace) => ({
    label: String(workplace.name || 'Рабочее пространство'),
    checked: chosen.has(String(workplace.key || workplace.id || '')),
    data: `data-service-workplace="${String(workplace.key || workplace.id || '')}"`,
  })), { showStatus });
}

export function bindServiceWorkplaceSelection(root, {
  selected = [],
  onChange = () => {},
} = {}) {
  const selectedAssignments = selectedAssignmentMap(selected);
  const workplaces = getWorkplaces();
  const inputs = [...root.querySelectorAll('[data-service-workplace]')];

  const emit = () => {
    const ids = new Set(inputs
      .filter((input) => input.checked)
      .map((input) => String(input.dataset.serviceWorkplace || ''))
      .filter(Boolean));
    const next = workplaces
      .filter((workplace) => ids.has(String(workplace.key || workplace.id || '')))
      .map((workplace) => {
        const id = String(workplace.key || workplace.id || '');
        return {
          ...(selectedAssignments.get(id) || {}),
          workplaceId: id,
          name: String(workplace.name || ''),
        };
      });
    onChange(next);
  };

  inputs.forEach((input) => input.addEventListener('change', emit));
  return { read: emit };
}

export function openServiceWorkplaceSelection({
  selected = [],
  title = 'Рабочие пространства',
  onChange = () => {},
} = {}) {
  const layer = mountModal(document.body, modal(
    serviceWorkplaceChecklist(selected, { showStatus: true }), {
      variant: 'x',
      title,
      className: 'modal--profile-settings-sheet modal--service-workplaces',
    },
  ));
  if (!layer) return null;
  bindServiceWorkplaceSelection(layer, { selected, onChange });
  return layer;
}
