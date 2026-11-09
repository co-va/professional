import { button, emptyState, modal, mountModal, openNotice, select } from '../../ui/ui.js';
import { loyaltyNavigationItems } from './index.js';

// Use the canonical Loyalty E list, but only programs that require manual
// assignment. Personal Account is automatic and stays accessible from the
// Person card and Loyalty E, never from the issue-program selector.
export function personProgramActionTypes() {
  return loyaltyNavigationItems().filter((item) => item.assignableToPerson);
}

// Each Loyalty module provides these exports when its person-scoped workflow
// is operational. A future E-card is automatically listed, and its own catalog
// becomes selectable as soon as that module implements the shared contract.
async function loadPersonProgramWorkflow(kind, person) {
  const module = await import(`./${kind}/index.js`);
  if (typeof module.getPersonProgramChoices !== 'function'
    || typeof module.openPersonProgramChoice !== 'function') return null;
  const settings = await module.getPersonProgramChoices(person);
  if (!settings || typeof settings !== 'object') return null;
  return { module, settings };
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
  let workflow = null;
  let sequence = 0;
  let loading = false;

  const updateAction = () => {
    const ready = Boolean(workflow
      && (workflow.settings.direct === true || choices.has(selectedChoice)));
    actionHost.hidden = !ready;
    action.disabled = loading || !ready;
    action.textContent = workflow?.settings.actionLabel || 'Оформить';
  };

  layer.addEventListener('change', (event) => {
    if (event.target?.name === 'personProgramChoice') {
      selectedChoice = String(event.target.value || '');
      updateAction();
      return;
    }
    if (event.target?.name !== 'personProgramKind') return;
    const requestedKind = String(event.target.value || '');
    const request = ++sequence;
    kind = personProgramActionTypes().some((item) => item.id === requestedKind) ? requestedKind : '';
    selectedChoice = '';
    choices = new Set();
    workflow = null;
    errorHost.textContent = '';
    optionsHost.innerHTML = '';
    updateAction();
    if (!kind) return;

    optionsHost.textContent = 'Загружаем программы…';
    loading = true;
    updateAction();
    void loadPersonProgramWorkflow(kind, person).then((result) => {
      if (!layer.isConnected || request !== sequence) return;
      loading = false;
      optionsHost.textContent = '';
      if (!result) {
        optionsHost.textContent = 'Действия с клиентом для этой программы пока недоступны.';
        updateAction();
        return;
      }
      workflow = result;
      if (result.settings.direct === true) {
        optionsHost.innerHTML = '';
      } else {
        const options = Array.isArray(result.settings.options) ? result.settings.options
          .filter((item) => item?.value && item?.label) : [];
        choices = new Set(options.map((item) => String(item.value)));
        optionsHost.innerHTML = options.length
          ? select({
            label: result.settings.label || 'Вариант программы',
            name: 'personProgramChoice', value: '',
            options: [{
              value: '', label: result.settings.placeholder || 'Выберите вариант',
            }, ...options],
          })
          : emptyState(result.settings.emptyTitle || 'Нет доступных вариантов',
            result.settings.emptyDescription || 'Создайте программу в разделе «Лояльность».');
      }
      updateAction();
    }).catch((error) => {
      if (!layer.isConnected || request !== sequence) return;
      loading = false;
      workflow = null;
      optionsHost.textContent = '';
      errorHost.textContent = error instanceof Error ? error.message : 'Не удалось загрузить программы';
      updateAction();
    });
  });

  action.addEventListener('click', async () => {
    if (action.disabled || !workflow
      || !personProgramActionTypes().some((item) => item.id === kind)) return;
    if (workflow.settings.direct !== true && !choices.has(selectedChoice)) return;
    loading = true;
    updateAction();
    errorHost.textContent = '';
    try {
      const opened = await workflow.module.openPersonProgramChoice(
        root, person, workflow.settings.direct === true ? '' : selectedChoice, onChanged,
      );
      if (!opened) throw new Error('Не удалось открыть программу');
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
