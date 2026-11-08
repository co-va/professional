import { button, emptyState, modal, mountModal, openNotice, select } from '../../ui/ui.js';
import { loyaltyNavigationItems } from './index.js';
import { getDepositPrograms, listPersonDeposits, loadDepositPrograms } from './deposit/data.js';

// Exactly the same E-card collection as the existing Loyalty navigation.
// No local list of program types and no second readiness gate.
export function personProgramActionTypes() {
  return loyaltyNavigationItems();
}

async function depositChoices(personKey) {
  const programs = await loadDepositPrograms();
  const deposits = await listPersonDeposits(personKey);
  const available = programs.filter((item) => item?.id && !item.archivedAt
    && (!item.status || item.status === 'active'));
  return [
    ...available.map((item) => ({
      value: `issue:${item.id}`,
      label: `Оформить · ${item.name || 'Депозит'}`,
    })),
    ...deposits.filter((item) => item?.depositId || item?.id).map((item) => ({
      value: `existing:${item.depositId || item.id}`,
      label: `Открыть · ${item.programName || 'Депозит'}`,
    })),
  ];
}

export function openPersonProgramActions(root, person, { onChanged = () => {} } = {}) {
  if (!person?.key) return null;
  const kinds = personProgramActionTypes();
  const layer = mountModal(root, modal(`<div class="form-grid">
    ${kinds.length ? select({
      label: 'Программа', name: 'personProgramKind', value: '',
      options: [{ value: '', label: 'Выберите программу' }, ...kinds.map((item) => ({
        value: item.id, label: item.label,
      }))],
    }) : emptyState('Нет доступных программ', 'Доступные программы появятся здесь.')}
    <div data-person-program-options></div>
    <div class="form-error" data-person-program-error role="alert"></div>
    <div class="modal-actions" data-person-program-actions hidden>
      ${button('Продолжить', { data: 'data-person-program-open' })}
    </div>
  </div>`, { title: 'Программы', variant: 'x', surface: 'app' }));
  if (!layer || !kinds.length) return layer;

  const optionsHost = layer.querySelector('[data-person-program-options]');
  const errorHost = layer.querySelector('[data-person-program-error]');
  const actionHost = layer.querySelector('[data-person-program-actions]');
  const action = layer.querySelector('[data-person-program-open]');
  let kind = '';
  let selectedChoice = '';
  let choices = new Set();
  let sequence = 0;
  let loading = false;

  const updateAction = () => {
    const available = kind === 'personal-account' || (kind === 'deposit' && choices.has(selectedChoice));
    actionHost.hidden = !available;
    action.disabled = loading || !available;
    action.textContent = kind === 'personal-account' || selectedChoice.startsWith('existing:') ? 'Открыть' : 'Оформить';
  };

  layer.addEventListener('change', (event) => {
    if (event.target?.name === 'personProgramChoice') {
      selectedChoice = String(event.target.value || '');
      updateAction();
      return;
    }
    if (event.target?.name !== 'personProgramKind') return;
    const nextKind = String(event.target.value || '');
    const request = ++sequence;
    kind = personProgramActionTypes().some((item) => item.id === nextKind) ? nextKind : '';
    selectedChoice = '';
    choices = new Set();
    errorHost.textContent = '';
    optionsHost.innerHTML = '';
    updateAction();
    if (kind !== 'deposit') {
      // A newly exposed E-card is listed immediately. Incomplete program
      // modules never silently perform local/demo assignments from Person.
      if (kind && kind !== 'personal-account') {
        optionsHost.textContent = 'Действия с клиентом для этой программы пока недоступны.';
      }
      return;
    }
    optionsHost.textContent = 'Загружаем программы…';
    loading = true;
    updateAction();
    void depositChoices(person.key).then((available) => {
      if (!layer.isConnected || request !== sequence) return;
      optionsHost.innerHTML = available.length
        ? select({
          label: 'Депозит', name: 'personProgramChoice', value: '',
          options: [{ value: '', label: 'Выберите депозит' }, ...available],
        })
        : emptyState('Депозиты не найдены', 'Для этого клиента пока нет доступных депозитов.');
      choices = new Set(available.map((item) => item.value));
      loading = false;
      updateAction();
    }).catch((error) => {
      if (!layer.isConnected || request !== sequence) return;
      loading = false;
      optionsHost.textContent = '';
      errorHost.textContent = error instanceof Error ? error.message : 'Не удалось загрузить депозиты';
      updateAction();
    });
  });

  action.addEventListener('click', async () => {
    if (action.disabled || !personProgramActionTypes().some((item) => item.id === kind)) return;
    const selectedKind = kind;
    const choice = selectedChoice;
    if (selectedKind === 'deposit' && !choices.has(choice)) return;
    loading = true;
    updateAction();
    errorHost.textContent = '';
    try {
      if (selectedKind === 'deposit') {
        const { issueDepositForPerson, openAssignedDepositForPerson } = await import('./deposit/index.js');
        if (!layer.isConnected) return;
        if (choice.startsWith('issue:')) {
          await issueDepositForPerson(root, person, choice.slice('issue:'.length), onChanged);
        } else if (choice.startsWith('existing:')) {
          await openAssignedDepositForPerson(root, person, choice.slice('existing:'.length), onChanged);
        }
      } else if (selectedKind === 'personal-account') {
        const { openPersonalAccountForPerson } = await import('./personal-account/index.js');
        if (!layer.isConnected) return;
        await openPersonalAccountForPerson(root, person);
      }
      layer.v2Close?.();
    } catch (error) {
      if (layer.isConnected) {
        errorHost.textContent = error instanceof Error ? error.message : 'Не удалось открыть программу';
      } else {
        openNotice({ title: 'Программы', message: error instanceof Error ? error.message : 'Операция недоступна' });
      }
    } finally {
      loading = false;
      if (layer.isConnected) updateAction();
    }
  });
  updateAction();
  return layer;
}
