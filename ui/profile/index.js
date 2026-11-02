import { button } from '../buttons/index.js';
import { formError, formView } from '../forms/index.js';
import { formValidationMessage, initPasswordFields, passwordField, selectPhotoFile } from '../inputs/index.js';
import { modal, mountModal, openNotice } from '../modals/index.js';
import { settingsPanel } from '../settings/index.js';
import { v2ListEntry, v2ListEntries } from '../lists/list-entry.js';

function actionData(id = '') {
  return `data-shared-profile-action="${String(id || '').trim()}"`;
}

export function openSharedProfileSettingsMenu({
  title = 'Настройки профиля',
  controls = [],
  actions = [],
  data = 'data-shared-profile-settings-menu',
} = {}) {
  const controlItems = (Array.isArray(controls) ? controls : []).filter((item) => item?.id && item?.label);
  const items = (Array.isArray(actions) ? actions : []).filter((item) => item?.id && item?.label);
  const controlsMarkup = controlItems.length
    ? v2ListEntries(controlItems.map((item) => v2ListEntry({
        title: item.label,
        subtitle: item.description || '',
        interactive: false,
        initial: '',
        toggleData: `data-shared-profile-toggle="${String(item.id)}"`,
        toggleAria: item.aria || item.label,
        toggleChecked: Boolean(item.checked),
        toggleDisabled: Boolean(item.disabled),
      })))
    : '';
  const body = `<div ${data}>${controlsMarkup}${settingsPanel(items.map((item) => ({
    label: item.label,
    variant: item.variant || 'outline',
    data: actionData(item.id),
    disabled: Boolean(item.disabled),
  })))}</div>`;
  const layer = mountModal(document.body, modal(body, {
    variant: 'x',
    title,
    className: 'modal--profile-settings-sheet',
    xRole: 'action',
  }));
  if (!layer) return null;

  controlItems.forEach((item) => {
    const control = layer.querySelector(`[data-shared-profile-toggle="${CSS.escape(String(item.id))}"]`);
    control?.addEventListener('click', async () => {
      const current = control.getAttribute('aria-pressed') === 'true';
      control.disabled = true;
      try {
        const result = await item.onToggle?.(!current);
        const checked = typeof result === 'boolean' ? result : !current;
        control.setAttribute('aria-pressed', checked ? 'true' : 'false');
        control.classList.toggle('is-on', checked);
        control.querySelector('.app-setting-toggle__switch')?.classList.toggle('is-on', checked);
      } catch (error) {
        void item.onError?.(error);
      } finally {
        control.disabled = Boolean(item.disabled);
      }
    });
  });

  items.forEach((item) => {
    if (item.disabled) return;
    layer.querySelector(`[data-shared-profile-action="${CSS.escape(String(item.id))}"]`)?.addEventListener('click', () => {
      layer.v2Close?.();
      void item.onSelect?.();
    });
  });
  return layer;
}

export async function openSharedPhotoAction({
  photo = '',
  title = 'Фото',
  onReplace = async () => {},
  onDelete = async () => {},
  onError = () => {},
} = {}) {
  const choose = async () => {
    try {
      const src = await selectPhotoFile();
      if (!src) return false;
      await onReplace(src);
      return true;
    } catch (error) {
      onError(error);
      return false;
    }
  };

  if (!String(photo || '').trim()) return choose();

  const body = `<div class="form-grid">
    ${button('Заменить фото', { variant: 'outline', data: 'data-shared-photo-replace' })}
    ${button('Удалить фото', { variant: 'outline', className: 'ui-button--delete-outline', data: 'data-shared-photo-delete' })}
  </div>`;
  const layer = mountModal(document.body, modal(body, {
    variant: 'x',
    title,
    className: 'modal--photo-sheet',
    xRole: 'action',
  }));
  if (!layer) return null;

  layer.querySelector('[data-shared-photo-replace]')?.addEventListener('click', () => {
    layer.v2Close?.();
    void choose();
  });
  layer.querySelector('[data-shared-photo-delete]')?.addEventListener('click', async () => {
    try {
      await onDelete();
      layer.v2Close?.();
    } catch (error) {
      onError(error);
    }
  });
  return layer;
}

export function openSharedPasswordAction({
  title = 'Изменить пароль',
  onSubmit = async () => {},
  successTitle = 'Пароль изменён',
  successMessage = 'Новый пароль сохранён.',
  errorTitle = 'Пароль не изменён',
  errorMessage = 'Не удалось изменить пароль',
} = {}) {
  const content = formView(`
    ${passwordField({ label: 'Текущий пароль', name: 'currentPassword', required: true, autocomplete: 'current-password' })}
    ${passwordField({ label: 'Новый пароль', name: 'newPassword', required: true, autocomplete: 'new-password' })}
    ${passwordField({ label: 'Повторите новый пароль', name: 'repeatPassword', required: true, autocomplete: 'new-password' })}
    ${formError('', { data: 'data-shared-password-error', keepEmpty: true })}
    ${button('Сохранить пароль', { type: 'submit' })}
  `, { className: 'form-grid', data: 'data-shared-password-form' });
  const layer = mountModal(document.body, modal(content, {
    variant: 'x',
    title,
    className: 'modal--password-sheet',
    xRole: 'editor',
  }));
  if (!layer) return null;

  initPasswordFields(layer);
  const form = layer.querySelector('[data-shared-password-form]');
  const errorNode = layer.querySelector('[data-shared-password-error]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const validationError = formValidationMessage(form);
    if (validationError) {
      if (errorNode) errorNode.textContent = validationError;
      return;
    }

    const data = new FormData(form);
    const currentPassword = String(data.get('currentPassword') || '');
    const newPassword = String(data.get('newPassword') || '');
    const repeatPassword = String(data.get('repeatPassword') || '');
    if (newPassword.length < 8) {
      if (errorNode) errorNode.textContent = 'Новый пароль должен содержать минимум 8 символов.';
      return;
    }
    if (newPassword !== repeatPassword) {
      if (errorNode) errorNode.textContent = 'Новые пароли не совпадают.';
      return;
    }

    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    if (errorNode) errorNode.textContent = '';
    try {
      await onSubmit({ currentPassword, newPassword });
      layer.v2Close?.();
      openNotice({ title: successTitle, message: successMessage, action: 'Закрыть', variant: 'technical' });
    } catch (error) {
      if (submit) submit.disabled = false;
      if (errorNode) errorNode.textContent = error instanceof Error ? error.message : errorMessage;
      openNotice({ title: errorTitle, message: error instanceof Error ? error.message : errorMessage, action: 'Закрыть', variant: 'technical' });
    }
  });
  return layer;
}


export function setSharedProfilePrimary(source, { visible = false, label = 'Сохранить', disabled = false } = {}) {
  if (!source) return;
  source.dataset.v2PrimaryVisible = visible ? 'true' : 'false';
  source.dataset.v2PrimaryLabel = String(label || 'Сохранить');
  source.setAttribute('aria-label', String(label || 'Сохранить'));
  source.disabled = Boolean(disabled);
  window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
}
