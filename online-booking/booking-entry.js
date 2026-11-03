import { API_BASE, USER_ORIGIN } from '../core/environment.js';

const root = document.querySelector('#app-content');
const RUNTIME_STYLES = [
  'ui/page/page.css',
  'ui/inputs/inputs.css',
  'ui/selectors/selectors.css',
  'ui/calendar/calendar.css',
  'ui/lists/list-entry.css',
  'ui/time/time.css',
  'ui/record/record.css',
  'ui/states/state-view.css',
  'ui/modals/modal.css',
  'ui/documents/document.css',
  'ui/v2/v2.css',
];

function syncViewport() {
  const vv = window.visualViewport;
  const height = vv?.height || window.innerHeight;
  const width = vv?.width || window.innerWidth;
  document.documentElement.style.setProperty('--visual-vh', `${height}px`);
  document.documentElement.style.setProperty('--visual-vw', `${width}px`);
  document.documentElement.style.setProperty('--app-stable-vh', `${window.innerHeight}px`);
  document.documentElement.classList.toggle('keyboard-open', vv ? height < window.innerHeight * 0.78 : false);
}

function routeQuery(params) {
  return {
    procedureIds: String(params.get('procedures') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function pathParts() {
  const parts = String(location.pathname || '/')
    .split('/')
    .filter(Boolean)
    .map((value) => {
      try { return decodeURIComponent(value); } catch { return value; }
    });
  if (parts[0] === 'booking') parts.shift();
  return parts;
}

async function resolveRoute() {
  const params = new URLSearchParams(location.search);
  const queryTenantId = String(params.get('booking') || '').trim();
  if (queryTenantId) {
    return {
      tenantId: queryTenantId,
      workplaceKey: String(params.get('workplace') || '').trim(),
      ...routeQuery(params),
    };
  }

  const parts = pathParts();
  if (!parts.length || parts.length > 2) return { tenantId: '', workplaceKey: '', ...routeQuery(params) };
  const profileSlug = String(parts[0] || '').trim();
  const workplaceSlug = String(parts[1] || '').trim();
  if (!profileSlug) return { tenantId: '', workplaceKey: '', ...routeQuery(params) };

  const query = new URLSearchParams();
  if (workplaceSlug) query.set('workplace', workplaceSlug);
  const suffix = query.toString() ? `?${query}` : '';
  const response = await fetch(`${API_BASE}/online-booking/route/${encodeURIComponent(profileSlug)}${suffix}`);
  if (!response.ok) return { tenantId: '', workplaceKey: '', ...routeQuery(params) };
  const resolved = await response.json().catch(() => ({}));
  return {
    tenantId: String(resolved?.tenantId || ''),
    workplaceKey: String(resolved?.workplaceKey || ''),
    ...routeQuery(params),
  };
}

function renderEntry(message = '') {
  root.innerHTML = `<section class="booking-entry" aria-labelledby="booking-entry-title">
    <div class="booking-entry__card">
      <h1 id="booking-entry-title">Запись</h1>
      ${message ? `<p class="booking-entry__error" role="alert">${message}</p>` : ''}
      <div class="booking-entry__actions">
        <button type="button" class="ui-button" data-booking-start>Записаться</button>
        <button type="button" class="ui-button ui-button--secondary" data-booking-open-app>Открыть приложение</button>
      </div>
    </div>
  </section>`;

  root.querySelector('[data-booking-open-app]')?.addEventListener('click', () => {
    location.assign(USER_ORIGIN);
  });
  root.querySelector('[data-booking-start]')?.addEventListener('click', (event) => {
    void startBooking(event.currentTarget);
  });
}

function ensureRuntimeStyles() {
  const pending = RUNTIME_STYLES.map((href) => {
    if (document.querySelector(`link[href="${href}"]`)) return Promise.resolve();
    return new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.bookingRuntimeStyle = '';
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', resolve, { once: true });
      document.head.appendChild(link);
    });
  });
  return Promise.all(pending);
}

async function startBooking(action) {
  if (!action || action.dataset.bookingBusy === 'true') return;
  action.dataset.bookingBusy = 'true';
  action.disabled = true;
  action.textContent = 'Открываем…';

  try {
    const route = await resolveRoute();
    if (!route.tenantId) {
      renderEntry('Ссылка записи недействительна.');
      return;
    }
    await ensureRuntimeStyles();
    const { renderAccess } = await import('./access.js');
    root.innerHTML = '';
    await renderAccess(root, route);
  } catch {
    renderEntry('Не удалось открыть запись. Попробуйте ещё раз.');
  }
}

window.addEventListener('resize', syncViewport, { passive: true });
window.visualViewport?.addEventListener('resize', syncViewport, { passive: true });
window.visualViewport?.addEventListener('scroll', syncViewport, { passive: true });
syncViewport();
renderEntry();
