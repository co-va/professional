import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const source = path.join(root, 'source');
const sourceSha = String(process.env.SOURCE_SHA || '').trim();
const norm = (v) => String(v || '').replaceAll('\\', '/').replace(/^\.\//, '');
const src = (rel) => path.join(source, norm(rel));
const dst = (rel) => path.join(root, norm(rel));

const forbiddenExact = new Set([
  'user.html',
  'online-booking/user-entry.js',
  'online-booking/account-runtime.js',
  'online-booking/account-shell.js',
  'online-booking/booking.js',
  'online-booking/personal-account-data.js',
  'online-booking/password-settings.js',
  'core/account-transition-runtime.js',
  'core/chat/messenger-mode.js',
  'ui/header/mode-switch.js',
  'core/note/account-owner.js',
  'core/event/account-owner.js',
  'core/calendar-sync/account.js',
]);
const forbiddenPrefixes = ['admin/', 'landing/', 'core/account/', 'core/app-mode/'];
const clean = [
  'core','css','journal','timetable','settings','chat','ui','invite','online-booking','pwa',
  'index.html','booking.html','reset-password.html','verify-email.html','manifest.webmanifest',
  'service-worker.js','app-icon.svg','icon-192.png','icon-512.png','professional.js',
  '.dockerignore','EXTRACTION_REPORT.md',
];

const overrides = new Map();
const included = new Set();
const visitedJs = new Set();
const visitedCss = new Set();

async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
function assertAllowed(rel) {
  const key = norm(rel);
  if (forbiddenExact.has(key) || forbiddenPrefixes.some((p) => key.startsWith(p))) {
    throw new Error(`Forbidden runtime reached: ${key}`);
  }
}
async function read(rel) { return fs.readFile(src(rel), 'utf8'); }
async function write(rel, content) {
  const key = norm(rel); assertAllowed(key);
  await fs.mkdir(path.dirname(dst(key)), { recursive: true });
  await fs.writeFile(dst(key), content, 'utf8'); included.add(key);
}
async function copyRaw(rel) {
  const key = norm(rel); assertAllowed(key);
  if (!(await exists(src(key)))) return false;
  await fs.mkdir(path.dirname(dst(key)), { recursive: true });
  await fs.copyFile(src(key), dst(key)); included.add(key); return true;
}
function resolveRel(from, spec) {
  const value = String(spec || '').trim();
  if (!value || /^(?:[a-z]+:|\/\/|#|data:)/i.test(value)) return '';
  if (value.startsWith('/')) return norm(value.slice(1));
  if (!value.startsWith('.')) return '';
  return norm(path.posix.normalize(path.posix.join(path.posix.dirname(norm(from)), value)));
}
async function resolveModule(from, spec) {
  const base = resolveRel(from, spec); if (!base) return '';
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, `${base}/index.js`]) {
    if (overrides.has(candidate) || await exists(src(candidate))) return candidate;
  }
  throw new Error(`Missing module ${spec} imported by ${from}`);
}
function importsOf(content) {
  const out = new Set();
  for (const re of [
    /(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) { let m; while ((m = re.exec(content))) out.add(m[1]); }
  return [...out];
}
function metaAssets(content) {
  const out = new Set(); const re = /new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;
  let m; while ((m = re.exec(content))) out.add(m[1]); return [...out];
}
async function copyJs(rel) {
  const key = norm(rel); assertAllowed(key); if (visitedJs.has(key)) return; visitedJs.add(key);
  const content = overrides.has(key) ? overrides.get(key) : await read(key); await write(key, content);
  for (const spec of importsOf(content)) {
    if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
    await copyJs(await resolveModule(key, spec));
  }
  for (const value of metaAssets(content)) {
    const asset = resolveRel(key, value); if (asset && await exists(src(asset))) await copyAsset(asset);
  }
}
async function copyCss(rel) {
  const key = norm(rel); assertAllowed(key); if (visitedCss.has(key)) return; visitedCss.add(key);
  const content = await read(key); await write(key, content);
  let m; const imports = /@import\s+(?:url\()?['"]?([^'"\)\s;]+)['"]?\)?/g;
  while ((m = imports.exec(content))) { const dep = resolveRel(key, m[1]); if (dep && await exists(src(dep))) await copyCss(dep); }
  const urls = /url\(\s*['"]?([^'"\)]+)['"]?\s*\)/g;
  while ((m = urls.exec(content))) {
    const value = String(m[1] || '').trim(); if (!value || /^(?:data:|https?:|#)/i.test(value)) continue;
    const dep = resolveRel(key, value.split(/[?#]/)[0]); if (dep && await exists(src(dep))) await copyAsset(dep);
  }
}
async function copyManifest(rel) {
  const key = norm(rel); const content = await read(key); await write(key, content);
  try { const data = JSON.parse(content); for (const icon of Array.isArray(data.icons) ? data.icons : []) {
    const dep = resolveRel(key, String(icon?.src || '').split(/[?#]/)[0]); if (dep && await exists(src(dep))) await copyAsset(dep);
  }} catch {}
}
async function copyAsset(rel) {
  const key = norm(rel); assertAllowed(key); if (included.has(key)) return;
  if (/\.(?:js|mjs)$/i.test(key)) return copyJs(key);
  if (/\.css$/i.test(key)) return copyCss(key);
  if (/\.webmanifest$/i.test(key)) return copyManifest(key);
  return copyRaw(key);
}
function refsOf(html) { const out=[]; const re=/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/gi; let m; while((m=re.exec(html))) out.push(m[1]); return out; }
async function copyHtml(rel, content = null) {
  const key = norm(rel); const html = content ?? await read(key); await write(key, html);
  const baseRoot = /<base\s+[^>]*href=['"]\/['"]/i.test(html);
  for (const raw of refsOf(html)) {
    const value=String(raw||'').trim().split(/[?#]/)[0];
    if (!value || value==='/' || /^(?:https?:|mailto:|tel:|#|data:)/i.test(value)) continue;
    const dep=value.startsWith('/')?norm(value.slice(1)):baseRoot?norm(value):norm(path.posix.join(path.posix.dirname(key),value));
    if (overrides.has(dep) || await exists(src(dep))) await copyAsset(dep);
  }
}

function replaceRange(content, start, end, replacement='') {
  const a=content.indexOf(start); if(a<0) throw new Error(`Start marker not found: ${start}`);
  const b=content.indexOf(end,a+start.length); if(b<0) throw new Error(`End marker not found after: ${start}`);
  return content.slice(0,a)+replacement+content.slice(b);
}
function transformEnvironment(s) {
  let c=s;
  if(!c.includes("const AMVERA_SUFFIX = '.amvera.tech';")) c=c.replace("const CODESPACES_SUFFIX = '.app.github.dev';","const CODESPACES_SUFFIX = '.app.github.dev';\nconst AMVERA_SUFFIX = '.amvera.tech';");
  c=c.replace("  if (host.endsWith(CODESPACES_SUFFIX)) return CODESPACES_STAGING_API_BASE;","  if (host.endsWith(CODESPACES_SUFFIX)) return CODESPACES_STAGING_API_BASE;\n  if (host.endsWith(AMVERA_SUFFIX)) return PRODUCTION_API_BASE;");
  return c.replaceAll('__BOOK_API_BASE__','__PROFESSIONAL_API_BASE__');
}
function transformBookingLink(s) { return s.replace("  url.pathname = `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;","  url.pathname = `/booking/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;"); }
function transformBookingEntry(s) {
  return s.replace("function pathParts() {\n  return String(location.pathname || '/')\n    .split('/')\n    .filter(Boolean)\n    .map((value) => {\n      try { return decodeURIComponent(value); } catch { return value; }\n    });\n}","function pathParts() {\n  const parts = String(location.pathname || '/')\n    .split('/')\n    .filter(Boolean)\n    .map((value) => {\n      try { return decodeURIComponent(value); } catch { return value; }\n    });\n  if (parts[0] === 'booking') parts.shift();\n  return parts;\n}");
}
function transformBookingAccess(s) { return s.replace("import { API_BASE } from '../core/environment.js';","import { API_BASE, USER_ORIGIN } from '../core/environment.js';").replace("  location.assign('/');","  location.assign(USER_ORIGIN);"); }
function transformOnlineBookingSettings(s) { return s.replace("import { ACCOUNT_APP_ORIGIN } from '../../core/environment.js';\n",'').replace('    origin: ACCOUNT_APP_ORIGIN,',"    origin: globalThis.location?.origin || '',"); }
function transformUiBarrel(s) { return s.replace("import { installAppModeSwitch } from './header/mode-switch.js';\n",'').replace("\ninstallAppModeSwitch();\n",'\n'); }

function transformProfessionalEntry(s) {
  let c=s;
  for(const line of [
    "import { resolveBookingPublicRoute } from './core/account/index.js';\n",
    "import { renderGlobalClient } from './online-booking/booking.js';\n",
    "import { renderAccess as renderOnlineBooking } from './online-booking/access.js';\n",
    "import './online-booking/account-runtime.js';\n",
    "import { USER_ORIGIN } from './core/environment.js';\n",
  ]) c=c.replace(line,'');
  c=c.replace(/const END_USER_APP_HOSTS = new Set\([\s\S]*?\);\n\n(?=const ROOT_SECTIONS)/,'');
  c=c.replace(/function bookingRouteQuery[\s\S]*?(?=function ensureServerBookingSync)/,'');
  c=c.replace("${field({ label: 'Email', name: 'email', type: 'email', required: true, autocomplete: 'email' })}","${field({ label: 'Телефон или email', name: 'identifier', type: 'text', required: true, autocomplete: 'username' })}");
  c=c.replace('Укажите email профиля. Если учётная запись существует, на него придёт ссылка для изменения пароля.','Укажите телефон или email профиля. Если учётная запись существует, на подтверждённый email придёт ссылка для изменения пароля.');
  c=c.replace("requestPasswordReset(data.get('email'))","requestPasswordReset(data.get('identifier'))");
  c=c.replace("${field({ label: 'Email', name: 'email', type: 'email', required: true, autocomplete: 'username' })}","${field({ label: 'Телефон или email', name: 'identifier', type: 'text', required: true, autocomplete: 'username' })}");
  c=c.replace("      <button type=\"button\" class=\"v2-sticker-link\" data-specialist-forgot>Забыли пароль?</button>","      <button type=\"button\" class=\"v2-sticker-link\" data-specialist-forgot>Забыли пароль?</button>\n      <button type=\"button\" class=\"v2-sticker-link\" data-professional-register>Зарегистрироваться</button>");
  c=c.replace("  app.querySelector('[data-specialist-forgot]')?.addEventListener('click', renderPasswordResetRequest);","  app.querySelector('[data-specialist-forgot]')?.addEventListener('click', renderPasswordResetRequest);\n  app.querySelector('[data-professional-register]')?.addEventListener('click', () => location.assign('/invite/'));");
  c=c.replace("login(data.get('email'), data.get('password'))","login(data.get('identifier'), data.get('password'))");
  c=c.replace(/const publicBooking = await bookingRoute\(\);[\s\S]*$/,`try {\n  const currentAccount = await getCurrentAccount();\n  if (currentAccount) {\n    authenticatedAccount = currentAccount;\n    await renderAuthenticated(currentAccount);\n  } else {\n    renderLogin();\n  }\n} catch {\n  renderLogin('Сервер временно недоступен');\n}\n`);
  if(/renderGlobalClient|renderOnlineBooking|isEndUserAppHost|END_USER_APP_HOSTS|account-runtime/.test(c)) throw new Error('Professional entry still contains User runtime');
  return c;
}
function transformIndex(s) {
  let c=s.replace(/\s*<script>\s*\{\s*const endUserApp[\s\S]*?<\/script>\s*/m,'\n');
  c=c.replace(/\s*<link rel="stylesheet" href="ui\/booking\/account-mobile\.css">/g,'').replace(/\s*<link rel="stylesheet" href="ui\/booking\/booking\.css">/g,'');
  c=c.replace(/\s*<script type="module" src="core\/chat\/messenger-mode\.js"><\/script>/g,'').replace(/\s*<script type="module" src="core\/account-transition-runtime\.js"><\/script>/g,'').replace(/\s*<script type="module" src="core\/password-reset-request\.js"><\/script>/g,'');
  return c.replace('src="core.js"','src="professional.js"').replace('<title>Рабочее пространство</title>','<title>Кабинет</title>');
}

function transformJournal(s) {
  let c=s.replace(/function journalContext[\s\S]*?(?=function dateKey)/,'');
  const start="export function renderJournal(root, options = {}) {";
  const end="  root.dataset.journalContext = contextName;";
  const init=`export function renderJournal(root, options = {}) {\n  const availableViews = views.filter((view) => canUseBookCapability(view.capability));\n  let activeView = availableViews.some((view) => view.id === options.initialView)\n    ? options.initialView\n    : (availableViews[0]?.id || 'day');\n  let listMode = 'flow';\n  const workplaces = getWorkplaces();\n  const professionalContext = getWorkplaceContext(workplaces, { scope: JOURNAL_CONTEXT_SCOPE });\n  let selectedWorkplaceId = professionalContext.workplaceId;\n  let selectedDate = professionalContext.date;\n  let disposeActiveView = () => {};\n  let noteFocusTarget = null;\n\n  root.dataset.journalContext = 'professional';`;
  c=replaceRange(c,start,end,init);
  c=c.replaceAll('    if (accountMode) return;\n','').replaceAll('    if (!accountMode) return;\n','');
  c=c.replace("  const activeDayWorkplaces = () => accountMode ? [] : getActiveDayWorkplaces(selectedDate, workplaces);","  const activeDayWorkplaces = () => getActiveDayWorkplaces(selectedDate, workplaces);");
  c=c.replace("    if (accountMode || selectedWorkplaceId === ALL_WORKPLACES_ID) return 'Журнал';","    if (selectedWorkplaceId === ALL_WORKPLACES_ID) return 'Журнал';");
  c=c.replace("    if (accountMode || selectedWorkplaceId === ALL_WORKPLACES_ID) return;","    if (selectedWorkplaceId === ALL_WORKPLACES_ID) return;");
  c=c.replace("    if (!accountMode) headerOptions.v = { data: 'data-journal-settings', aria: 'Настройки журнала' };","    headerOptions.v = { data: 'data-journal-settings', aria: 'Настройки журнала' };");
  c=c.replace("        context: contextName,\n        records: accountMode ? readAccountRecords : null,\n        resolveRecordContext,\n", "        context: 'professional',\n");
  c=c.replace("        focusTarget: accountMode ? null : noteFocusTarget,","        focusTarget: noteFocusTarget,");
  c=c.replace("        context: contextName,\n        records: accountMode ? readAccountRecords : null,\n", "        context: 'professional',\n");
  c=c.replace("          if (!accountMode) setWorkplaceContext({ workplaceId: selectedWorkplaceId, date: selectedDate, scope: JOURNAL_CONTEXT_SCOPE });","          setWorkplaceContext({ workplaceId: selectedWorkplaceId, date: selectedDate, scope: JOURNAL_CONTEXT_SCOPE });");
  c=c.replace(/    } else if \(accountMode\) renderJournalList\([\s\S]*?\n    else renderJournalList\(viewRoot, \{ mode: listMode, workplaceId: selectedWorkplaceId \}\);/,"    } else renderJournalList(viewRoot, { mode: listMode, workplaceId: selectedWorkplaceId });");
  c=c.replace("    if (!accountMode) root.querySelector('[data-journal-settings]')?.addEventListener('click', openJournalSettings);","    root.querySelector('[data-journal-settings]')?.addEventListener('click', openJournalSettings);");
  c=c.replace("  if (!accountMode) window.addEventListener('book:journal-note-focus-request', focusJournalNotes);","  window.addEventListener('book:journal-note-focus-request', focusJournalNotes);");
  c=c.replace("    if (!accountMode) window.removeEventListener('book:journal-note-focus-request', focusJournalNotes);","    window.removeEventListener('book:journal-note-focus-request', focusJournalNotes);");
  if(/accountMode|contextName|readAccountRecords|resolveRecordContext|sourceRecords|journalContext\(/.test(c)) throw new Error('End-user Journal markers remain in journal/journal.js');
  return c;
}
function transformJournalDay(s) {
  let c=s;
  c=c.replace(/import \{\n  accountNoteActions,[\s\S]*?\} from '\.\.\/core\/note\/account-owner\.js';\n/,'');
  c=c.replace(/import \{\n  accountEventActions,[\s\S]*?\} from '\.\.\/core\/event\/account-owner\.js';\n/,'');
  c=c.replace("import { syncAccountCalendars } from '../core/calendar-sync/account.js';\n",'');
  c=c.replace(/function journalContext[\s\S]*?(?=function currentTimeForDay)/,'');
  c=c.replace(/function accountRecordPaid[\s\S]*?(?=function withFinancialState)/,'');
  c=c.replace(/function accountAmountDue[\s\S]*?(?=async function openExistingRecord)/,'');
  c=c.replace(/async function openAccountRecord[\s\S]*?(?=async function openUsage)/,'');
  c=c.replace(/function openAccountDayAction[\s\S]*?(?=export function renderJournalDay)/,'');
  c=c.replace(/export function renderJournalDay\(root, \{[\s\S]*?\n\} = \{\}\) \{\n  const contextName = journalContext\(context\);\n  const accountMode = contextName === 'account';\n  root\.dataset\.journalDayContext = contextName;/,`export function renderJournalDay(root, {\n  date = new Date(),\n  workplaceId = '',\n  onChange = () => {},\n  onWorkplaceFieldClick = () => {},\n  navigationRoot = null,\n  focusTarget = null,\n} = {}) {\n  root.dataset.journalDayContext = 'professional';`);
  c=c.replace("      context: contextName,\n      records,\n      resolveRecordContext,\n",'');
  c=c.replace("      focusTarget: accountMode ? null : focusTarget,","      focusTarget,");
  c=c.replace(/\n  if \(accountMode\) \{[\s\S]*?\n  const workplaces = getWorkplaces\(\);/,"\n  const workplaces = getWorkplaces();");
  if(/accountMode|contextName|resolveRecordContext|accountNote|accountEvent|AccountRecord|AccountEvent|AccountDay|data-account|cova:account/.test(c)) throw new Error('End-user Journal markers remain in journal/день.js');
  return c;
}
function transformJournalMonth(s) {
  let c=s.replace(/function journalContext[\s\S]*?(?=function recordMinutes)/,'');
  c=c.replace(/function accountDayRecordData[\s\S]*?(?=function usageGradient)/,'');
  c=c.replace("  context = 'professional',\n  records = null,\n",'');
  c=c.replace("  const contextName = journalContext(context);\n  const accountMode = contextName === 'account';\n  root.dataset.journalMonthContext = contextName;","  root.dataset.journalMonthContext = 'professional';");
  c=c.replace(/\n  if \(accountMode\) \{[\s\S]*?\n  const workingDays = getWorkingDays\(\);/,"\n  const workingDays = getWorkingDays();");
  c=c.replace("  const recordIndex = recordsByDate(readRecords(records, contextName), workplaceId, allMode);","  const recordIndex = recordsByDate(getRecords(), workplaceId, allMode);");
  if(/accountMode|contextName|readRecords\(|accountRecord|accountDay/.test(c)) throw new Error('End-user Journal markers remain in journal/месяц.js');
  return c;
}
function transformJournalList(s) {
  let c=s.replace(/function journalContext[\s\S]*?(?=function formatMoney)/,'');
  c=c.replace(/function recordPresentation[\s\S]*?(?=function paymentFor)/,`function recordPresentation(record, workplaces) {\n  return { workplace: workplaceName(workplaces, record?.workplaceId), person: record?.person || {} };\n}\n\n`);
  c=c.replace(/function paymentFor[\s\S]*?(?=function displayAmountDue)/,`function paymentFor(record) {\n  const state = getRecordPaymentState(record);\n  return { paid: Boolean(state.fullyPaid), activity: state.fullyPaid ? state.latestPayment : null };\n}\n\n`);
  c=c.replace(/function displayAmountDue[\s\S]*?(?=function recordStatusClass)/,`function displayAmountDue(record = null) { return recordAmountDue(record); }\n\n`);
  c=c.replace(/function recordEntry[\s\S]*?(?=function anchorEntry)/,`function recordEntry(record, workplaces, { focus = false, paid = false } = {}) {\n  const presentation = recordPresentation(record, workplaces);\n  const name = personName(presentation.person, 'Человек');\n  const classes = [recordStatusClass(record, paid), focus ? 'journal-list-focus' : ''].filter(Boolean).join(' ');\n  const id = recordId(record);\n  return v2ListEntry({\n    overline: presentation.workplace,\n    title: name,\n    subtitle: record?.person?.phone || '',\n    rightTop: [shortDate(record?.date), String(record?.from || '')].filter(Boolean).join(' · '),\n    rightBottom: formatMoney(displayAmountDue(record)),\n    interactive: Boolean(id),\n    data: id ? \`data-journal-list-record="\${escapeHtml(id)}"\` : '',\n    aria: id ? \`Открыть запись \${name}\` : '',\n    className: classes,\n    initial: (name || '?').slice(0, 1).toUpperCase(),\n  });\n}\n\n`);
  c=c.replace(/function bindRecordClicks[\s\S]*?(?=function renderTimeMode)/,`function bindRecordClicks(root, records) {\n  if (typeof root?.querySelectorAll !== 'function') return;\n  const byId = new Map(records.map((record) => [recordId(record), record]).filter(([id]) => Boolean(id)));\n  root.querySelectorAll('[data-journal-list-record]').forEach((node) => node.addEventListener('click', async () => {\n    const record = byId.get(String(node.dataset.journalListRecord || ''));\n    if (!record) return;\n    const { openRecordView } = await loadRecordViewModule();\n    openRecordView(record);\n  }));\n}\n\n`);
  c=c.replace(/function renderTimeMode[\s\S]*?(?=function renderFlowMode)/,`function renderTimeMode(root, records, workplaces) {\n  const now = Date.now();\n  const ordered = [...records].sort((a, b) => recordAppointmentTime(a, 'from') - recordAppointmentTime(b, 'from'));\n  const focusIndex = ordered.findIndex((record) => recordAppointmentTime(record, 'to') > now);\n  const splitIndex = focusIndex >= 0 ? focusIndex : ordered.length;\n  const entries = ordered.flatMap((record, index) => {\n    const payment = paymentFor(record);\n    const row = recordEntry(record, workplaces, { focus: index === splitIndex, paid: payment.paid });\n    return index === splitIndex ? [anchorEntry(), row] : [row];\n  });\n  if (splitIndex === ordered.length) entries.push(anchorEntry());\n  root.innerHTML = v2ListEntries(entries);\n  bindRecordClicks(root, ordered);\n  scrollToFocus(root, '[data-journal-list-anchor]');\n}\n\n`);
  c=c.replace(/function renderFlowMode[\s\S]*?(?=export function renderJournalList)/,`function renderFlowMode(root, records, workplaces) {\n  const now = Date.now();\n  const prepared = records.map((record) => {\n    const payment = paymentFor(record);\n    return { record, payment, completed: isRecordCompletedSide(record, { paid: payment.paid, now }) };\n  });\n  const completed = prepared.filter((item) => item.completed).sort((a, b) => recordActivityTime(a.record, a.payment.activity, { completed: true }) - recordActivityTime(b.record, b.payment.activity, { completed: true }));\n  const pending = prepared.filter((item) => !item.completed).sort((a, b) => recordActivityTime(b.record, b.payment.activity) - recordActivityTime(a.record, a.payment.activity));\n  const entries = [\n    ...completed.map(({ record, payment }) => recordEntry(record, workplaces, { paid: payment.paid })),\n    anchorEntry(),\n    ...pending.map(({ record, payment }) => recordEntry(record, workplaces, { paid: payment.paid })),\n  ];\n  root.innerHTML = v2ListEntries(entries);\n  bindRecordClicks(root, records);\n  scrollToFocus(root, '[data-journal-list-anchor]');\n}\n\n`);
  c=c.replace(/export function renderJournalList[\s\S]*$/,`export function renderJournalList(root, { mode = 'flow', workplaceId = ALL_WORKPLACES_ID } = {}) {\n  root.dataset.journalListContext = 'professional';\n  const workplaces = getWorkplaces();\n  const allRecords = getRecords();\n  const visibleRecords = workplaceId === ALL_WORKPLACES_ID\n    ? allRecords\n    : allRecords.filter((record) => String(record?.workplaceId || '') === String(workplaceId || ''));\n  if (!visibleRecords.length) {\n    root.innerHTML = emptyState('Список', 'Записей пока нет.');\n    return;\n  }\n  if (mode === 'time') renderTimeMode(root, visibleRecords, workplaces);\n  else renderFlowMode(root, visibleRecords, workplaces);\n}\n`);
  if(/contextName|accountMode|resolveRecordContext|context:\s*['"]account|Профессионал/.test(c)) throw new Error('End-user Journal markers remain in journal/список.js');
  return c;
}

function nginx() { return `server {\n  listen 3000;\n  server_name _;\n  root /usr/share/nginx/html;\n  index index.html;\n\n  location = /booking { try_files /booking.html =404; add_header Cache-Control "no-cache"; }\n  location ^~ /booking/ { try_files /booking.html =404; add_header Cache-Control "no-cache"; }\n  location ~* \\.(?:js|mjs|css|json|webmanifest|svg|png|jpg|jpeg|webp|woff2?)$ { try_files $uri =404; add_header Cache-Control "no-cache"; }\n  location = /service-worker.js { add_header Cache-Control "no-cache"; try_files $uri =404; }\n  location / { try_files $uri $uri/ /index.html; }\n}\n`; }

async function dockerfile() {
  const entries=await fs.readdir(root,{withFileTypes:true}); const lines=['FROM nginx:1.27-alpine','','COPY nginx.conf /etc/nginx/conf.d/default.conf',''];
  const dirs=new Set(['core','css','journal','timetable','settings','chat','ui','invite','online-booking','pwa']);
  const files=new Set(['index.html','booking.html','reset-password.html','verify-email.html','manifest.webmanifest','service-worker.js','app-icon.svg','icon-192.png','icon-512.png','professional.js']);
  for(const e of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
    if(e.isDirectory()&&dirs.has(e.name)) lines.push(`COPY ${e.name} /usr/share/nginx/html/${e.name}`);
    if(e.isFile()&&files.has(e.name)) lines.push(`COPY ${e.name} /usr/share/nginx/html/${e.name}`);
  }
  lines.push('','EXPOSE 3000',''); await fs.writeFile(dst('Dockerfile'),lines.join('\n'),'utf8');
}
async function walk(dir) { const out=[]; for(const e of await fs.readdir(dir,{withFileTypes:true})) { const p=path.join(dir,e.name); if(e.isDirectory()) out.push(...await walk(p)); else out.push(p); } return out; }
async function validate() {
  for(const rel of visitedJs) {
    const content=await fs.readFile(dst(rel),'utf8');
    for(const spec of importsOf(content)) {
      if(!spec.startsWith('.')&&!spec.startsWith('/')) continue;
      const base=resolveRel(rel,spec); let found=false;
      for(const candidate of [base,`${base}.js`,`${base}.mjs`,`${base}/index.js`].filter(Boolean)) if(await exists(dst(candidate))) {found=true;break;}
      if(!found) throw new Error(`Missing extracted import: ${rel} -> ${spec}`);
    }
  }
  for(const rel of forbiddenExact) if(await exists(dst(rel))) throw new Error(`Forbidden file present: ${rel}`);
  for(const prefix of forbiddenPrefixes) if(await exists(dst(prefix))) throw new Error(`Forbidden directory present: ${prefix}`);
  const journalRoot=dst('journal');
  if(await exists(journalRoot)) for(const file of await walk(journalRoot)) if(/\.js$/i.test(file)) {
    const text=await fs.readFile(file,'utf8');
    if(/data-account|cova:account|accountMode|context:\s*['"]account['"]|core\/(?:note|event)\/account-owner|calendar-sync\/account/.test(text)) throw new Error(`End-user Journal marker remains: ${path.relative(root,file)}`);
  }
}

for(const rel of clean) await fs.rm(dst(rel),{recursive:true,force:true});

overrides.set('professional.js',transformProfessionalEntry(await read('core.js')));
overrides.set('core/environment.js',transformEnvironment(await read('core/environment.js')));
overrides.set('core/booking-link/index.js',transformBookingLink(await read('core/booking-link/index.js')));
overrides.set('online-booking/booking-entry.js',transformBookingEntry(await read('online-booking/booking-entry.js')));
overrides.set('online-booking/access.js',transformBookingAccess(await read('online-booking/access.js')));
overrides.set('settings/online-booking/online-booking.js',transformOnlineBookingSettings(await read('settings/online-booking/online-booking.js')));
overrides.set('ui/ui.js',transformUiBarrel(await read('ui/ui.js')));
overrides.set('journal/journal.js',transformJournal(await read('journal/journal.js')));
overrides.set('journal/день.js',transformJournalDay(await read('journal/день.js')));
overrides.set('journal/месяц.js',transformJournalMonth(await read('journal/месяц.js')));
overrides.set('journal/список.js',transformJournalList(await read('journal/список.js')));

await copyHtml('index.html',transformIndex(await read('index.html')));
await copyHtml('booking.html');
await copyHtml('invite/index.html');
await copyHtml('reset-password.html');
await copyHtml('verify-email.html');
await copyAsset('service-worker.js');
await write('nginx.conf',nginx());
await write('.dockerignore','.git\n.github\nscripts\nsource\nnode_modules\n*.md\npackage-lock.json\n');
await write('package.json',JSON.stringify({name:'@co-va/professional',private:true,type:'module'},null,2)+'\n');
await validate();
await dockerfile();

const sorted=[...included].sort();
await fs.writeFile(dst('EXTRACTION_REPORT.md'),[
  '# Professional extraction report','',`Source: co-va/core:main${sourceSha?` @ ${sourceSha}`:''}`,`Files copied/generated: ${sorted.length}`,'',
  'Excluded: User Journal runtime/markers; User/Account runtime; Admin; Landing; unreachable legacy modules.','',
  ...sorted.map((f)=>`- ${f}`),'',
].join('\n'),'utf8');
console.log(`Professional extraction complete: ${sorted.length} files`);
