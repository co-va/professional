import { button, field, mountModal, modal, phoneField } from '../../ui/ui.js';
import { createPerson, findPeopleByPhone, commitNewPerson } from './data.js';

export function personCreateForm(preset = {}) {
  return `<form class="form-grid" data-person-create-form>
    ${field({ label: 'Имя', name: 'name', value: preset.name || '', required: true })}
    ${field({ label: 'Фамилия', name: 'surname', value: preset.surname || '' })}
    ${phoneField({ label: 'Телефон', name: 'phone', value: preset.phone || '' })}
    <div class="form-error" data-error></div>
    ${button('Сохранить', { type: 'submit' })}
  </form>`;
}

export function bindPersonCreateForm(root, { onCreated = () => {} } = {}) {
  const form = root?.querySelector?.('[data-person-create-form]');
  if (!form || form.dataset.personCreateReady === 'true') return;
  form.dataset.personCreateReady = 'true';
  let submitting = false;
  let draft = null;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const button = form.querySelector('[type="submit"]');
    const errorNode = form.querySelector('[data-error]');
    if (errorNode) errorNode.textContent = '';
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const surname = String(data.get('surname') || '').trim();
    const phone = String(data.get('phone') || '').trim();
    try {
      if (!name) throw Error('Имя обязательно.');
      const phoneMatches = phone ? findPeopleByPhone(phone) : [];
      if (phoneMatches.length > 1) {
        throw Error('Телефон уже связан с несколькими людьми. Выберите существующего человека.');
      }
      if (phoneMatches.length === 1) {
        onCreated(phoneMatches[0]);
        return;
      }
      // Reuse the same key if the server committed but the response was lost.
      const next = createPerson(name, surname, phone);
      draft = draft ? { ...next, key: draft.key, createdAt: draft.createdAt } : next;
      submitting = true;
      if (button) button.disabled = true;
      const saved = await commitNewPerson(draft);
      draft = null;
      if (form.isConnected) onCreated(saved);
    } catch (error) {
      if (errorNode) errorNode.textContent = error instanceof Error ? error.message : 'Не удалось создать';
    } finally {
      submitting = false;
      if (button) button.disabled = false;
    }
  });
}

export function openPersonCreate({
  root = document.body,
  preset = {},
  variant = 'medium',
  surface = '',
  className = '',
  onCreated = () => {},
} = {}) {
  const m = mountModal(root, modal(personCreateForm(preset), { variant, surface, className, title: 'Создать' }));
  if (!m) return null;
  bindPersonCreateForm(m, {
    onCreated: (person) => {
      m.remove();
      onCreated(person);
    },
  });
  return m;
}
