from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 exact match, got {count}')
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    result, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 regex match, got {count}')
    return result


# 1. The public URL starts as a tiny chooser. Route resolution and Booking runtime
# are loaded only after the person explicitly chooses “Записаться”.
entry = ROOT / 'online-booking/booking-entry.js'
entry.write_text("""import { API_BASE, USER_ORIGIN } from '../core/environment.js';

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
""", encoding='utf-8')

# 2. Keep the first surface light. Runtime styles are attached only after “Записаться”.
booking_html = ROOT / 'booking.html'
booking_html.write_text("""<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#2F3338">
  <title>Запись</title>
  <link rel="stylesheet" href="css/style.css">
  <link rel="stylesheet" href="ui/buttons/buttons.css">
  <link rel="stylesheet" href="ui/booking/booking.css">
</head>
<body>
  <div id="app" class="app-shell app-shell--booking">
    <main class="booking-content" id="app-content" aria-live="polite"></main>
  </div>
  <script type="module" src="online-booking/booking-entry.js"></script>
</body>
</html>
""", encoding='utf-8')

css_path = ROOT / 'ui/booking/booking.css'
css = css_path.read_text(encoding='utf-8')
if '.booking-entry{' not in css:
    css += "\n.booking-entry{min-height:var(--visual-vh,100dvh);display:grid;place-items:center;padding:24px}.booking-entry__card{width:min(100%,420px);display:grid;gap:20px;padding:28px 22px;background:#fff;color:var(--v2-ink,#111);border-radius:24px}.booking-entry__card h1{margin:0;font-size:28px;line-height:1.1}.booking-entry__actions{display:grid;gap:10px}.booking-entry__error{margin:0;line-height:1.4}.booking-entry .ui-button{width:100%}\n"
css_path.write_text(css, encoding='utf-8')

# 3. Replace the old client-side consent inspection with one PDN marker.
access_path = ROOT / 'online-booking/access.js'
access = access_path.read_text(encoding='utf-8')
access = replace_once(access, '  getBookingWorkingDates,\n  requiredBookingDocuments,\n', '  getBookingWorkingDates,\n', 'remove requiredBookingDocuments import')
access = replace_once(access, 'const DRAFT_VERSION = 1;', 'const DRAFT_VERSION = 2;', 'draft version')

access = regex_once(
    access,
    r"function legalPhoneKey\(value\) \{.*?\n\}\n\nfunction activeConsentIds\(state\) \{.*?\n\}\n",
    """function statusPhoneKey(value) {
  return text(value).replace(/\\D/g, '');
}

async function loadPersonStatus(state, { force = false } = {}) {
  const phone = text(state.booker.phone);
  const phoneKey = statusPhoneKey(phone);
  if (!phoneKey) throw new Error('Введите телефон полностью');

  if (!force && state.statusResolved && state.statusPhone === phoneKey) return state.personStatus;
  if (state.statusPhone && state.statusPhone !== phoneKey) state.consents = {};
  state.statusPhone = phoneKey;
  state.statusResolved = false;
  state.statusError = '';

  try {
    const result = await jsonRequest(
      `/online-booking/${encodeURIComponent(state.tenantId)}/booking-state`,
      {
        method: 'POST',
        body: JSON.stringify({ name: state.booker.name, phone, email: state.booker.email }),
      },
      'Не удалось проверить доступность записи',
    );
    state.personStatus = {
      pdnActive: result?.legalState?.pdnActive === true,
    };
    state.statusResolved = true;
    return state.personStatus;
  } catch (error) {
    state.personStatus = { pdnActive: false };
    state.statusError = text(error?.message) || 'Не удалось проверить доступность записи.';
    throw error;
  }
}

function stepNeedsContext(step = {}) {
  return ['workplace', 'services', 'date', 'time', 'consents', 'preview'].includes(text(step?.kind));
}

function nextStepAfterData(state) {
  const workplaces = Array.isArray(state.context?.workplaces) ? state.context.workplaces : [];
  if (!workplaces.length) throw new Error('Рабочие пространства не настроены.');
  if (state.lockedWorkplaceKey) {
    state.workplaceKey = state.lockedWorkplaceKey;
    return { kind: 'services', index: 0 };
  }
  if (workplaces.length === 1) {
    state.workplaceKey = text(workplaces[0]?.key);
    return { kind: 'services', index: 0 };
  }
  state.workplaceKey = '';
  return { kind: 'workplace', index: 0 };
}

async function prepareBooking(state, { forceStatus = false } = {}) {
  await loadPersonStatus(state, { force: forceStatus });
  await refreshContext(state);
  return nextStepAfterData(state);
}
""",
    'replace old legal lookup',
)

access = replace_once(
    access,
    """  host?.querySelectorAll('[data-booking-workplace]').forEach((node) => node.addEventListener('click', () => {
    state.workplaceKey = text(node.dataset.bookingWorkplace);
    resetAfterServices(state);
    persistDraft(state);
    go(state, { kind: 'mode' });
  }));
""",
    """  host?.querySelectorAll('[data-booking-workplace]').forEach((node) => node.addEventListener('click', () => {
    state.workplaceKey = text(node.dataset.bookingWorkplace);
    resetAfterServices(state);
    persistDraft(state);
    go(state, { kind: 'services', index: 0 });
  }));
""",
    'workplace goes to services',
)

access = replace_once(
    access,
    """  host?.querySelector('[data-booking-data-next]')?.addEventListener('click', () => {
    const validationError = syncDataForm(state, form, { validate: true });
    const missingParticipantName = state.mode !== MODE_SELF && state.participants.some((participant) => !participant.name);
    if (validationError || missingParticipantName) {
      renderData(state, validationError || 'Укажите имя каждого участника.');
      return;
    }
    startLegalLookup(state);
    resetAfterServices(state);
    persistDraft(state);
    go(state, { kind: 'services', index: 0 });
  });
""",
    """  const nextAction = host?.querySelector('[data-booking-data-next]');
  nextAction?.addEventListener('click', async () => {
    if (nextAction.dataset.bookingBusy === 'true') return;
    const validationError = syncDataForm(state, form, { validate: true });
    const missingParticipantName = state.mode !== MODE_SELF && state.participants.some((participant) => !participant.name);
    if (validationError || missingParticipantName) {
      renderData(state, validationError || 'Укажите имя каждого участника.');
      return;
    }

    nextAction.dataset.bookingBusy = 'true';
    nextAction.disabled = true;
    nextAction.setAttribute('aria-busy', 'true');
    nextAction.textContent = 'Продолжаем…';
    resetAfterServices(state);
    persistDraft(state);
    try {
      const next = await prepareBooking(state);
      go(state, next);
    } catch (error) {
      renderData(state, text(error?.message) || state.statusError || 'Не удалось продолжить запись.');
    }
  });
""",
    'data next prepares marker and context',
)

access = replace_once(
    access,
    """  host?.querySelector('[data-booking-time-next]')?.addEventListener('click', () => {
    if (state.from) go(state, { kind: 'consents' });
  });
}

function consentDocuments(state) {
  const active = activeConsentIds(state);
  return requiredBookingDocuments(state.context).filter((document) => !active.has(text(document?.id)));
}
""",
    """  host?.querySelector('[data-booking-time-next]')?.addEventListener('click', () => {
    if (!state.from) return;
    go(state, { kind: state.personStatus.pdnActive ? 'preview' : 'consents' });
  });
}

function consentDocuments(state) {
  if (state.personStatus.pdnActive) return [];
  return (Array.isArray(state.context?.documents) ? state.context.documents : [])
    .filter((document) => Boolean(document?.personConsent));
}
""",
    'skip consent step by marker',
)

access = regex_once(
    access,
    r"function renderConsents\(state\) \{\n  if \(!state\.legalResolved\) \{.*?\n  \}\n\n  const documents = consentDocuments\(state\);",
    """function renderConsents(state) {
  if (state.personStatus.pdnActive) {
    go(state, { kind: 'preview' }, { push: false });
    return;
  }

  const documents = consentDocuments(state);""",
    'remove consent lookup UI',
)

access = replace_once(
    access,
    """function consentFacts(state) {
  const documents = requiredBookingDocuments(state.context);
  return documents.map((document) => ({
    documentId: text(document?.id),
    documentVersion: Math.max(1, Number(document?.version || 1)),
    accepted: Boolean(state.consents[text(document?.id)]),
  }));
}
""",
    """function consentFacts(state) {
  if (state.personStatus.pdnActive) return [];
  return consentDocuments(state).map((document) => ({
    documentId: text(document?.id),
    documentVersion: Math.max(1, Number(document?.version || 1)),
    accepted: Boolean(state.consents[text(document?.id)]),
  }));
}
""",
    'consent facts only when required',
)

access = replace_once(
    access,
    """    if (Number(error?.status) === 409 && /соглас/i.test(message)) {
      await startLegalLookup(state, { force: true });
      state.current = { kind: 'consents', index: 0 };
      state.history = state.history.filter((step) => step.kind !== 'preview');
      state.exited = false;
      persistDraft(state, false);
      openNotice({ title: 'Нужно согласие', message: message || 'Подтвердите актуальное согласие.' });
      renderCurrent(state);
      return;
    }
""",
    """    if (Number(error?.status) === 409 && /соглас/i.test(message)) {
      const status = await loadPersonStatus(state, { force: true }).catch(() => ({ pdnActive: false }));
      if (status?.pdnActive) {
        openNotice({ title: 'Не удалось подтвердить запись', message: message || 'Состояние согласия изменилось. Попробуйте ещё раз.' });
        return;
      }
      state.current = { kind: 'consents', index: 0 };
      state.history = state.history.filter((step) => step.kind !== 'preview');
      state.exited = false;
      persistDraft(state, false);
      openNotice({ title: 'Нужно согласие', message: message || 'Подтвердите актуальное согласие.' });
      renderCurrent(state);
      return;
    }
""",
    'confirm consent conflict uses marker',
)

access = replace_once(
    access,
    """function openApplication(state) {
  if (typeof state.onExitToAccount === 'function') {
    state.onExitToAccount({ tab: 'journal' });
    return;
  }
  location.assign(USER_ORIGIN);
}
""",
    """function openApplication() {
  location.assign(USER_ORIGIN);
}
""",
    'plain app redirect',
)
access = access.replace('openApplication(state)', 'openApplication()')
access = replace_once(access, "state.resumeStep || { kind: 'workplace' }", "state.resumeStep || { kind: 'mode' }", 'exit resume default')

access = regex_once(
    access,
    r"function initialStep\(state\) \{.*?\n\}\n\nexport async function renderAccess\(root, \{\n  tenantId = '',\n  workplaceKey = '',\n  procedureIds = \[\],\n  onExitToAccount = null,\n\} = \{\}\) \{",
    """function initialStep() {
  return { kind: 'mode', index: 0 };
}

export async function renderAccess(root, {
  tenantId = '',
  workplaceKey = '',
  procedureIds = [],
} = {}) {""",
    'initial mode and renderAccess signature',
)

access = replace_once(
    access,
    """    consents: {},
    legalState: {},
    legalResolved: false,
    legalLookup: null,
    legalLookupToken: 0,
    legalPhone: '',
    legalError: '',
    current: { kind: 'workplace', index: 0 },
    resumeStep: { kind: 'workplace', index: 0 },
""",
    """    consents: {},
    personStatus: { pdnActive: false },
    statusResolved: false,
    statusPhone: '',
    statusError: '',
    current: { kind: 'mode', index: 0 },
    resumeStep: { kind: 'mode', index: 0 },
""",
    'state marker fields',
)
access = replace_once(
    access,
    """    layer: null,
    hardClose: null,
    onExitToAccount: typeof onExitToAccount === 'function' ? onExitToAccount : null,
""",
    """    layer: null,
    hardClose: null,
""",
    'remove account callback state',
)

access = regex_once(
    access,
    r"\n  root\.innerHTML = '';\n  try \{\n    await refreshContext\(state\);\n  \} catch \(error\) \{.*?\n  \}\n\n  const workplaces = Array\.isArray\(state\.context\?\.workplaces\) \? state\.context\.workplaces : \[\];\n  if \(!workplaces\.length\) \{.*?\n  \}\n\n  const restored = restoreDraft\(state\);",
    """
  root.innerHTML = '';
  const restored = restoreDraft(state);""",
    'remove eager context load',
)

access = replace_once(
    access,
    """  if (!restored) {
    state.current = initialStep(state);
    state.resumeStep = cloneStep(state.current);
    setMode(state, MODE_SELF);
    state.mode = '';
  } else if (state.booker.phone) {
    startLegalLookup(state);
  }
""",
    """  if (!restored) {
    state.current = initialStep();
    state.resumeStep = cloneStep(state.current);
    setMode(state, MODE_SELF);
    state.mode = '';
  } else {
    const resumeTarget = state.exited ? state.resumeStep : state.current;
    if (state.booker.phone && stepNeedsContext(resumeTarget)) {
      try {
        await prepareBooking(state);
      } catch (error) {
        root.innerHTML = emptyState('Запись недоступна', text(error?.message) || 'Не удалось продолжить запись.');
        return () => {};
      }
    }
  }
""",
    'restore without eager load',
)

for retired in ['startLegalLookup', 'activeConsentIds', 'legalState', 'legalResolved', 'legalLookup', 'legalLookupToken', 'legalPhone', 'legalError', 'onExitToAccount', 'requiredBookingDocuments']:
    if retired in access:
        raise SystemExit(f'retired client consent/runtime marker remains: {retired}')

access_path.write_text(access, encoding='utf-8')

# 4. Record the exact remaining server boundary instead of hiding it behind a client fallback.
state_path = ROOT / 'PROJECT_STATE.md'
state_text = state_path.read_text(encoding='utf-8')
anchor = "### Этап 8 — dead code / duplicate / retired cleanup — DONE"
if 'Public Booking lightweight replacement' not in state_text:
    block = """### Public Booking lightweight replacement

- Публичная ссылка сначала показывает только два действия: `Записаться` / `Открыть приложение`; route API, Booking runtime и тяжёлые UI-модули до `Записаться` не загружаются.
- Booking начинается с `Кого записать?`, затем собирает данные оформляющего; только после имени/телефона выполняется проверка PDN-маркера и загрузка операционного контекста.
- Клиент больше не разбирает список consent/documentId как состояние человека: используется только boolean `legalState.pdnActive` существующего server endpoint; при `true` шага согласий нет.
- Переход в User после выхода/успеха — только обычная навигация на `USER_ORIGIN`; User runtime внутрь Booking не загружается.
- CORE HANDOFF: заменить guest `booking-state` на status-only контракт (`personExists`, `pdnActive`, `bookingAllowed`) и разделить текущий тяжёлый `/context`: операционные данные отдельно, актуальные PDN/marketing документы только по требованию при `pdnActive=false`, занятость — по нужному диапазону/дате. До этого handoff серверный `/context` после ввода данных всё ещё возвращает documents и широкую occupancy; клиентского fallback/второго consent-owner не добавлять.

"""
    if anchor not in state_text:
        raise SystemExit('PROJECT_STATE anchor not found')
    state_text = state_text.replace(anchor, block + anchor, 1)
state_path.write_text(state_text, encoding='utf-8')

print('Public Booking replacement prepared')
