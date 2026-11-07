import { getCurrentAccount, login, logout, requestPasswordReset } from './core/auth.js';
import { field, passwordField, initPasswordFields } from './ui/inputs/index.js';
import { v2Sticker } from './ui/v2/sticker.js';
import { setThemeColor } from './ui/viewport/index.js';

const app = document.querySelector('#app');
let workspaceModule = null;

async function enterWorkspace(account) {
  if (!workspaceModule) {
    workspaceModule = import('./professional/workspace.js').catch((error) => {
      workspaceModule = null;
      throw error;
    });
  }
  const { renderAuthenticated } = await workspaceModule;
  await renderAuthenticated(account);
  // Verification runs after the workspace has appeared. It must never delay login.
  void import('./core/profile/account-controls.js')
    .then(({ offerAccountEmailVerificationReminder }) => offerAccountEmailVerificationReminder(account))
    .catch(() => undefined);
}

function renderWorkspaceUnavailable(account, cause) {
  setThemeColor('#F5F5F3');
  app.classList.remove('app-shell--booking');
  app.classList.add('app-shell--auth');
  app.innerHTML = v2Sticker({
    title: 'Кабинет временно недоступен',
    body: '<p>Вход выполнен или сохранён. Не удалось открыть рабочий экран. Повторно вводить пароль не требуется.</p>'
      + '<p class="auth-error" data-workspace-load-error role="alert"></p>'
      + '<button type="button" class="v2-sticker-link" data-workspace-logout>Выйти из Кабинета</button>',
    action: '<button type="button" class="ui-button" data-workspace-retry>Повторить</button>',
    className: 'v2-sticker-screen--auth',
  });
  app.querySelector('[data-workspace-load-error]').textContent =
    cause instanceof Error ? cause.message : 'Не удалось загрузить рабочий экран';
  app.querySelector('[data-workspace-logout]')?.addEventListener('click', logout);
  app.querySelector('[data-workspace-retry]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const current = account || await getCurrentAccount();
      if (!current) {
        renderLogin();
        return;
      }
      await enterWorkspace(current);
    } catch (error) {
      renderWorkspaceUnavailable(account, error);
    }
  });
}

function renderPasswordResetRequest() {
  setThemeColor('#F5F5F3');
  app.classList.remove('app-shell--booking');
  app.classList.add('app-shell--auth');

  app.innerHTML = v2Sticker({
    title: 'Восстановление пароля',
    body: `<form class="auth-form" id="password-reset-request-form">
      ${field({ label: 'Телефон или email', name: 'identifier', type: 'text', required: true, autocomplete: 'username' })}
      <p>Укажите телефон или email профиля. Если учётная запись существует, на подтверждённый email придёт ссылка для изменения пароля.</p>
      <p class="auth-error" data-password-reset-request-error role="alert"></p>
    </form>`,
    action: '<button class="ui-button" type="submit" form="password-reset-request-form">Отправить ссылку</button>',
    className: 'v2-sticker-screen--auth',
    closeData: 'data-password-reset-request-close',
  });

  app.querySelector('[data-password-reset-request-close]')?.addEventListener('click', () => renderLogin());
  const form = app.querySelector('#password-reset-request-form');
  const error = app.querySelector('[data-password-reset-request-error]');
  const button = app.querySelector('button[type="submit"][form="password-reset-request-form"]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    button.disabled = true;
    button.textContent = 'Отправляем…';
    const data = new FormData(form);
    try {
      await requestPasswordReset(data.get('identifier'));
      app.innerHTML = v2Sticker({
        title: 'Проверьте почту',
        body: '<p>Если профиль с таким email существует, ссылка для изменения пароля отправлена. Ссылка действует 30 минут.</p>',
        action: '<button class="ui-button" type="button" data-password-reset-return>Вернуться ко входу</button>',
        className: 'v2-sticker-screen--auth',
      });
      app.querySelector('[data-password-reset-return]')?.addEventListener('click', () => renderLogin());
    } catch (requestError) {
      error.textContent = requestError instanceof Error ? requestError.message : 'Не удалось отправить ссылку восстановления';
      button.disabled = false;
      button.textContent = 'Отправить ссылку';
    }
  });
}

function renderLogin(message = '') {
  setThemeColor('#F5F5F3');
  app.classList.remove('app-shell--booking');
  app.classList.add('app-shell--auth');

  const body = `
    <form class="auth-form" id="auth-form">
      ${field({ label: 'Телефон или email', name: 'identifier', type: 'text', required: true, autocomplete: 'username' })}
      ${passwordField({ label: 'Пароль', name: 'password', required: true, autocomplete: 'current-password' })}
      <p class="auth-error" id="auth-error" role="alert"></p>
      <button type="button" class="v2-sticker-link" data-specialist-forgot>Забыли пароль?</button>
      <button type="button" class="v2-sticker-link" data-professional-register>Зарегистрироваться</button>
    </form>`;

  app.innerHTML = v2Sticker({
    title: 'Вход в Кабинет',
    body,
    action: '<button class="ui-button" type="submit" form="auth-form">Войти</button>',
    className: 'v2-sticker-screen--auth',
    closeData: 'data-specialist-u-close',
  });

  initPasswordFields(app);
  app.querySelector('[data-specialist-u-close]')?.addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
  });
  app.querySelector('[data-specialist-forgot]')?.addEventListener('click', renderPasswordResetRequest);
  app.querySelector('[data-professional-register]')?.addEventListener('click', () => location.assign('/invite/'));

  const form = app.querySelector('#auth-form');
  const error = app.querySelector('#auth-error');
  error.textContent = message;
  const button = app.querySelector('button[type="submit"][form="auth-form"]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    button.disabled = true;
    button.textContent = 'Входим…';
    const data = new FormData(form);

    let account;
    try {
      account = await login(data.get('identifier'), data.get('password'));
    } catch (loginError) {
      error.textContent = loginError instanceof Error ? loginError.message : 'Не удалось войти';
      button.disabled = false;
      button.textContent = 'Войти';
      return;
    }
    try {
      await enterWorkspace(account);
    } catch (workspaceError) {
      renderWorkspaceUnavailable(account, workspaceError);
    }
  });
}


window.addEventListener('professional:auth-logout', () => renderLogin());
try {
  const account = await getCurrentAccount();
  if (account) {
    try {
      await enterWorkspace(account);
    } catch (error) {
      renderWorkspaceUnavailable(account, error);
    }
  } else renderLogin();
} catch (error) {
  renderWorkspaceUnavailable(null, error);
}
