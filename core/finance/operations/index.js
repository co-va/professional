import {
  actionBlock,
  button,
  modal,
  mountModal,
  mountV2ZLayer,
  v2Section,
  v2ZLayer,
} from '../../../ui/ui.js';
import { canUseBookCapability } from '../../access.js';
import { renderIncomeExpenseOperation } from '../dds/income-expense.js';
import {
  SPECIAL_FINANCE_ACTIONS,
  renderFinanceEntityOperation,
  renderSpecialFinanceOperation,
} from '../dds/special-operations.js';

export function financeOperationGroups({ groups = null } = {}) {
  const allowed = Array.isArray(groups) ? new Set(groups) : null;
  const groupsOut = [];
  if (canUseBookCapability('finance.income_expense.access')) {
    groupsOut.push({
      key: 'income-expense',
      title: 'Доход / Расход',
      items: [
        { id: 'manual-income', label: 'Доход' },
        { id: 'manual-expense', label: 'Расход' },
      ],
    });
  }
  if (canUseBookCapability('finance.special.access')) {
    groupsOut.push({
      key: 'loan',
      title: 'Займы',
      items: SPECIAL_FINANCE_ACTIONS.filter((item) => item.group === 'loan'),
    });
    groupsOut.push({
      key: 'investment',
      title: 'Инвестиции',
      items: SPECIAL_FINANCE_ACTIONS.filter((item) => item.group === 'investment'),
    });
    groupsOut.push({
      key: 'transfer',
      title: 'Переводы',
      items: SPECIAL_FINANCE_ACTIONS.filter((item) => item.group === 'transfer'),
    });
  }
  return groupsOut
    .filter((group) => group.items.length)
    .filter((group) => !allowed || allowed.has(group.key));
}

export function openFinanceOperation(root, actionId, { onSaved = null, financeEntity = null } = {}) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'finance-operation-z' }), { stack: true });
  if (!layer) return null;

  const saved = () => {
    layer.v2Close?.();
    onSaved?.();
  };

  let rendered = false;
  if (actionId === 'manual-income') rendered = renderIncomeExpenseOperation(layer, 'IN', { onSaved: saved });
  else if (actionId === 'manual-expense') rendered = renderIncomeExpenseOperation(layer, 'OUT', { onSaved: saved });
  else rendered = renderSpecialFinanceOperation(layer, actionId, { onSaved: saved, financeEntity });

  if (!rendered) {
    layer.v2Close?.();
    return null;
  }
  return layer;
}

export function openFinanceEntityOperation(root, type, {
  onSaved = null,
  financeEntity = null,
  onInvestmentEventSaved = null,
} = {}) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'finance-operation-z' }), { stack: true });
  if (!layer) return null;
  const saved = () => {
    layer.v2Close?.();
    onSaved?.();
  };
  const rendered = renderFinanceEntityOperation(layer, type, {
    onSaved: saved,
    financeEntity,
    onInvestmentEventSaved,
  });
  if (!rendered) {
    layer.v2Close?.();
    return null;
  }
  return layer;
}

export function openFinanceOperations(root, {
  onSaved = null,
  groups: requestedGroups = null,
  financeEntity = null,
  title = 'Финансовые операции',
} = {}) {
  const groups = financeOperationGroups({ groups: requestedGroups });
  if (!groups.length) return null;

  const content = groups.map((group) => v2Section(
    group.title,
    actionBlock(group.items.map((item) => button(item.label, {
      variant: 'secondary',
      data: `data-finance-operation-action="${item.id}"`,
    })).join('')),
  )).join('');

  const picker = mountModal(root, modal(content, {
    title,
    variant: 'x',
    surface: 'app',
  }));
  if (!picker) return null;

  picker.querySelectorAll('[data-finance-operation-action]').forEach((element) => {
    element.addEventListener('click', () => {
      const actionId = String(element.dataset.financeOperationAction || '');
      picker.v2Close?.();
      openFinanceOperation(root, actionId, { onSaved, financeEntity });
    });
  });
  return picker;
}
