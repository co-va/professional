import { compactCheck } from '../../ui/selection/check-list.js';
import { list } from '../../ui/lists/list.js';
import { modal, mountModal } from '../../ui/modals/index.js';
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

function workplaceOptions() {
  return getWorkplaces().map((workplace) => ({
    id: String(workplace.key || workplace.id || ''),
    name: String(workplace.name || 'Рабочее пространство'),
  })).filter((workplace) => workplace.id);
}

// One compact row in Q. The existing X picker shows checkmarks only when tapped.
export function serviceWorkplaceSelector(selected = []) {
  const count = selectedAssignmentMap(selected).size;
  return list({
    className: 'ui-list--dense',
    items: [{
      title: 'Рабочие пространства',
      right: [count ? `Выбрано: ${count}` : 'Не выбрано'],
      interactive: true,
      data: 'data-service-workplace-open',
      aria: 'Выбрать рабочие пространства',
    }],
  });
}

export function bindServiceWorkplaceSelection(root, {
  selected = [],
  onChange = () => {},
} = {}) {
  const assignments = selectedAssignmentMap(selected);
  const selectedIds = new Set(assignments.keys());
  const options = workplaceOptions();
  const trigger = root.querySelector('[data-service-workplace-open]');
  if (!trigger) return { read: () => [] };

  const read = () => options.filter(({ id }) => selectedIds.has(id)).map(({ id, name }) => {
    const original = assignments.get(id) || {};
    const assignment = { ...original, workplaceId: id, name };
    assignments.set(id, assignment); // retain workspace-specific price when unchecked and rechecked
    return assignment;
  });
  const syncSummary = () => {
    const count = read().length;
    const countNode = trigger.querySelector('.ui-list__right-secondary span');
    if (countNode) countNode.textContent = count ? `Выбрано: ${count}` : 'Не выбрано';
  };
  const emit = () => {
    const next = read();
    syncSummary();
    onChange(next); // only the Q draft changes; persistence runs on Q Save
    return next;
  };

  trigger.addEventListener('click', () => {
    const body = options.length
      ? `<div class="ui-check-list" data-service-workplace-options>${options.map(({ id, name }) =>
          compactCheck({
            label: name,
            checked: selectedIds.has(id),
            data: `data-service-workplace="${escapeHtml(id)}"`,
          })
        ).join('')}</div>`
      : '<div class="muted">Рабочих пространств пока нет.</div>';
    const layer = mountModal(document.body, modal(body, {
      variant: 'x',
      xRole: 'picker',
      className: 'modal--form-sheet',
    }));
    layer?.querySelectorAll('[data-service-workplace]').forEach((input) => {
      input.addEventListener('change', () => {
        const id = String(input.dataset.serviceWorkplace || '');
        if (input.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        emit();
      });
    });
  });

  return { read };
}
