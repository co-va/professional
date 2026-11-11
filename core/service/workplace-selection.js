import { compactCheck } from '../../ui/selection/check-list.js';
import { selectionTrigger } from '../../ui/selectors/index.js';
import { modal, mountModal } from '../../ui/modals/index.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { button } from '../../ui/buttons/index.js';
import { collectCost, costField, initCostFields, validateCostDefinition, costListParts } from '../../ui/cost/index.js';
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

function hasOwnCost(cost) {
  return Boolean(cost && typeof cost === 'object' && (cost.free === true
    || (cost.amount != null && cost.amount !== '')
    || (cost.from != null && cost.from !== '')
    || (cost.to != null && cost.to !== '')));
}
function priceLabel(cost) {
  const { rightTop, rightBottom } = costListParts(cost || {});
  return [rightTop, rightBottom].filter(Boolean).join(' ') || 'Не указана';
}

// Shared selection owner: the checklist controls membership; selected
// workplaces immediately expose their own price, or the common price.
export function serviceWorkplaceSelector(selected = []) {
  const count = selectedAssignmentMap(selected).size;
  return selectionTrigger({
    value: 'Рабочие пространства',
    meta: count ? `Выбрано: ${count}` : 'Не выбрано',
    data: 'data-service-workplace-open',
    aria: 'Выбрать рабочие пространства',
  }) + '<div class="service-workplace-price-list" data-service-workplace-prices></div>';
}

export function bindServiceWorkplaceSelection(root, {
  selected = [],
  getBaseCost = () => ({}),
  onChange = () => {},
} = {}) {
  const assignments = selectedAssignmentMap(selected);
  const selectedIds = new Set(assignments.keys());
  const options = workplaceOptions();
  const trigger = root.querySelector('[data-service-workplace-open]');
  const pricesHost = root.querySelector('[data-service-workplace-prices]');
  if (!trigger || !pricesHost) return { read: () => [] };

  const read = () => options.filter(({ id }) => selectedIds.has(id)).map(({ id, name }) => {
    const original = assignments.get(id) || {};
    const assignment = { ...original, workplaceId: id, name };
    assignments.set(id, assignment); // retain workspace-specific price when unchecked and rechecked
    return assignment;
  });
  const renderPrices = () => {
    const baseCost = getBaseCost();
    pricesHost.innerHTML = read().map(({ workplaceId: id, name, cost }) => {
      const override = hasOwnCost(cost);
      return `<button type="button" class="service-workplace-price-row" data-service-workplace-price="${escapeHtml(id)}" aria-label="Цена для ${escapeHtml(name)}">
        <span class="service-workplace-price-row__name">${escapeHtml(name)}</span>
        <span class="service-workplace-price-row__price"><small>${override ? 'Своя цена' : 'Общая цена'}</small><strong>${escapeHtml(priceLabel(override ? cost : baseCost))}</strong></span>
        <span class="service-workplace-price-row__chevron" aria-hidden="true">›</span>
      </button>`;
    }).join('');
  };

  const editPrice = (id) => {
    if (!selectedIds.has(id)) return;
    const entry = options.find((item) => item.id === id);
    if (!entry) return;
    const current = assignments.get(id) || {};
    const override = hasOwnCost(current.cost);
    const body = `<div class="service-workplace-price-editor">
      <strong class="service-workplace-price-editor__title">${escapeHtml(entry.name)}</strong>
      ${costField({ name: 'workplaceCost', value: override ? current.cost : getBaseCost() })}
      <div class="form-error" role="alert" data-service-workplace-cost-error></div>
      <div class="service-workplace-price-editor__actions">
        ${button('Применить', { data: 'data-service-workplace-cost-apply' })}
        ${override ? button('Общая цена', { variant: 'secondary', data: 'data-service-workplace-cost-reset' }) : ''}
        ${button('Отмена', { variant: 'secondary', data: 'data-service-workplace-cost-cancel' })}
      </div>
    </div>`;
    const layer = mountModal(document.body, modal(body, { variant: 'x', title: `Цена · ${entry.name}`, xRole: 'editor' }));
    if (!layer) return;
    initCostFields(layer);
    layer.querySelector('[data-service-workplace-cost-apply]')?.addEventListener('click', () => {
      const value = collectCost(layer, 'workplaceCost');
      const error = validateCostDefinition(value);
      if (error || !hasOwnCost(value)) {
        const label = layer.querySelector('[data-service-workplace-cost-error]');
        if (label) label.textContent = error || 'Укажите цену или используйте общую стоимость.';
        return;
      }
      assignments.set(id, { ...assignments.get(id), workplaceId: id, cost: value });
      emit();
      layer.v2Close?.();
    });
    layer.querySelector('[data-service-workplace-cost-reset]')?.addEventListener('click', () => {
      const { cost: _removed, ...rest } = assignments.get(id) || {};
      assignments.set(id, rest);
      emit();
      layer.v2Close?.();
    });
    layer.querySelector('[data-service-workplace-cost-cancel]')?.addEventListener('click', () => layer.v2Close?.());
  };

  pricesHost.addEventListener('click', (event) => {
    const row = event.target.closest('[data-service-workplace-price]');
    if (row && pricesHost.contains(row)) editPrice(row.dataset.serviceWorkplacePrice);
  });
  const form = root.querySelector('[data-procedure-editor-form], [data-product-editor-form]');
  const onBasePriceChange = (event) => {
    if (event.target.closest('[data-cost-field]')) renderPrices();
  };
  form?.addEventListener('input', onBasePriceChange);
  form?.addEventListener('change', onBasePriceChange);
  const syncSummary = () => {
    const count = read().length;
    const countNode = trigger.querySelector('.ui-select__meta');
    if (countNode) countNode.textContent = count ? `Выбрано: ${count}` : 'Не выбрано';
  };
  const emit = () => {
    const next = read();
    syncSummary();
    renderPrices();
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

  renderPrices();
  return { read };
}
