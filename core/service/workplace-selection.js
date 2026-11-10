import { notificationSettings } from '../../ui/settings/index.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { getWorkplaces } from '../profile/workplaces/data.js';

function workplaceId(value = {}) {
  return String(value.workplaceId || value.id || value.key || '');
}

function selectedAssignmentMap(selected = []) {
  return new Map((Array.isArray(selected) ? selected : [])
    .map((assignment) => [workplaceId(assignment), assignment])
    .filter(([id]) => Boolean(id)));
}

// Existing Shared checkbox list, consumed directly in the Service Q editors.
// Selections are draft data and persist only with the editor's Save action.
export function serviceWorkplaceChecklist(selected = [], { showStatus = false } = {}) {
  const chosen = selectedAssignmentMap(selected);
  const workplaces = getWorkplaces();
  if (!workplaces.length) return '<div class="muted">Рабочих пространств пока нет.</div>';
  return notificationSettings(workplaces.map((workplace) => ({
    label: String(workplace.name || 'Рабочее пространство'),
    checked: chosen.has(String(workplace.key || workplace.id || '')),
    data: `data-service-workplace="${escapeHtml(String(workplace.key || workplace.id || ''))}"`,
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
