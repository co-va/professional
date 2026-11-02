import { modal, mountModal } from '../../ui/ui.js';
import { notificationSettings } from '../../ui/settings/index.js';
import { getWorkplaces } from '../profile/workplaces/data.js';

function workplaceId(value = {}) {
  return String(value.workplaceId || value.id || value.key || '');
}

export function openServiceWorkplaceSelection({
  selected = [],
  title = 'Рабочие пространства',
  onChange = () => {},
} = {}) {
  const selectedIds = new Set((Array.isArray(selected) ? selected : []).map(workplaceId).filter(Boolean));
  const workplaces = getWorkplaces();
  const body = notificationSettings(workplaces.map((workplace) => ({
    label: String(workplace.name || 'Рабочее пространство'),
    checked: selectedIds.has(String(workplace.key || workplace.id || '')),
    data: `data-service-workplace="${String(workplace.key || workplace.id || '')}"`,
  })));
  const layer = mountModal(document.body, modal(body, {
    variant: 'x',
    title,
    className: 'modal--profile-settings-sheet modal--service-workplaces',
  }));
  if (!layer) return null;

  const inputs = () => [...layer.querySelectorAll('[data-service-workplace]')];
  const emit = () => {
    const ids = new Set(inputs()
      .filter((input) => input.checked)
      .map((input) => String(input.dataset.serviceWorkplace || ''))
      .filter(Boolean));
    const next = workplaces
      .filter((workplace) => ids.has(String(workplace.key || workplace.id || '')))
      .map((workplace) => ({
        workplaceId: String(workplace.key || workplace.id || ''),
        name: String(workplace.name || ''),
      }));
    onChange(next);
  };

  inputs().forEach((input) => input.addEventListener('change', emit));
  return layer;
}
