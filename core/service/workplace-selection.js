import {
  collectWorkplaceSelections,
  initWorkplaceSelectors,
  workplaceSelector,
} from '../../ui/workplaces/index.js';
import { getWorkplaces } from '../profile/workplaces/data.js';

function workplaceId(value = {}) {
  return String(value.workplaceId || value.id || value.key || '');
}

function selectedAssignmentMap(selected = []) {
  return new Map((Array.isArray(selected) ? selected : [])
    .map((assignment) => [workplaceId(assignment), assignment])
    .filter(([id]) => Boolean(id)));
}

// Use the existing Shared compact workplace picker inside Q.
// The selection edits only the local draft, never the stored catalog.
export function serviceWorkplaceSelector(selected = []) {
  return workplaceSelector({
    name: 'serviceWorkplaces',
    selected,
    workplaces: getWorkplaces(),
    rowLabel: '',
    placeholder: 'Выберите рабочее пространство',
    addLabel: '+ Рабочее пространство',
  });
}

export function bindServiceWorkplaceSelection(root, {
  selected = [],
  onChange = () => {},
} = {}) {
  const assignments = selectedAssignmentMap(selected);
  const host = root.querySelector('[data-workplace-selector="serviceWorkplaces"]');
  if (!host) return { read: () => [] };
  initWorkplaceSelectors(root);

  const emit = () => {
    const next = collectWorkplaceSelections(root, 'serviceWorkplaces')
      .map(({ workplaceId: id, name }) => {
        const original = assignments.get(id) || {};
        const assignment = { ...original, workplaceId: id, name };
        assignments.set(id, assignment); // preserve per-workplace pricing across a temporary removal
        return assignment;
      });
    onChange(next);
    return next;
  };

  host.addEventListener('change', emit);
  host.addEventListener('click', (event) => {
    if (event.target.closest('[data-add-workplace], [data-remove-workplace]')) emit();
  });
  return { read: emit };
}
