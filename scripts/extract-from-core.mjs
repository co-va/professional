import fs from 'node:fs/promises';
import path from 'node:path';

const targetRoot = process.cwd();
const sourceRoot = path.join(targetRoot, 'source');
const sourceSha = String(process.env.SOURCE_SHA || '').trim();

const cleanPaths = [
  'core', 'css', 'journal', 'timetable', 'settings', 'chat', 'ui', 'invite',
  'online-booking', 'pwa',
  'index.html', 'booking.html', 'reset-password.html', 'verify-email.html',
  'manifest.webmanifest', 'service-worker.js', 'app-icon.svg', 'icon-192.png', 'icon-512.png',
  'professional.js', '.dockerignore', 'EXTRACTION_REPORT.md',
];

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
]);
const forbiddenPrefixes = [
  'admin/',
  'landing/',
  'core/account/',
  'core/app-mode/',
];

const overrides = new Map();
const included = new Set();
const jsVisited = new Set();
const cssVisited = new Set();

const norm = (value) => String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
const sourcePath = (rel) => path.join(sourceRoot, norm(rel));
const targetPath = (rel) => path.join(targetRoot, norm(rel));

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

function assertAllowed(rel) {
  const key = norm(rel);
  if (forbiddenExact.has(key) || forbiddenPrefixes.some((prefix) => key.startsWith(prefix))) {
    throw new Error(`Forbidden User/Admin runtime reached: ${key}`);
  }
}

async function readSource(rel) {
  return fs.readFile(sourcePath(rel), 'utf8');
}

async function writeText(rel, content) {
  const key = norm(rel);
  assertAllowed(key);
  await fs.mkdir(path.dirname(targetPath(key)), { recursive: true });
  await fs.writeFile(targetPath(key), content, 'utf8');
  included.add(key);
}

async function copyBinary(rel) {
  const key = norm(rel);
  assertAllowed(key);
  if (!(await exists(sourcePath(key)))) return false;
  await fs.mkdir(path.dirname(targetPath(key)), { recursive: true });
  await fs.copyFile(sourcePath(key), targetPath(key));
  included.add(key);
  return true;
}

function resolveRelative(fromRel, specifier) {
  const spec = String(specifier || '').trim();
  if (!spec || /^(?:[a-z]+:|\/\/|#|data:)/i.test(spec)) return '';
  if (spec.startsWith('/')) return norm(spec.slice(1));
  if (!spec.startsWith('.')) return '';
  return norm(path.posix.normalize(path.posix.join(path.posix.dirname(norm(fromRel)), spec)));
}

async function resolveModule(fromRel, specifier) {
  const base = resolveRelative(fromRel, specifier);
  if (!base) return '';
  const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}/index.js`];
  for (const candidate of candidates) {
    if (overrides.has(candidate) || await exists(sourcePath(candidate))) return candidate;
  }
  throw new Error(`Missing module: ${specifier} imported by ${fromRel}`);
}

function moduleSpecifiers(content) {
  const out = new Set();
  const patterns = [
    /(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content))) out.add(match[1]);
  }
  return [...out];
}

function metaUrlAssets(content) {
  const out = new Set();
  const re = /new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;
  let match;
  while ((match = re.exec(content))) out.add(match[1]);
  return [...out];
}

async function copyJs(rel) {
  const key = norm(rel);
  assertAllowed(key);
  if (jsVisited.has(key)) return;
  jsVisited.add(key);
  const content = overrides.has(key) ? overrides.get(key) : await readSource(key);
  await writeText(key, content);

  for (const specifier of moduleSpecifiers(content)) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue;
    const dependency = await resolveModule(key, specifier);
    await copyJs(dependency);
  }
  for (const asset of metaUrlAssets(content)) {
    const dependency = resolveRelative(key, asset);
    if (dependency && await exists(sourcePath(dependency))) await copyAsset(dependency);
  }
}

async function copyCss(rel) {
  const key = norm(rel);
  assertAllowed(key);
  if (cssVisited.has(key)) return;
  cssVisited.add(key);
  const content = await readSource(key);
  await writeText(key, content);

  const imports = /@import\s+(?:url\()?['"]?([^'"\)\s;]+)['"]?\)?/g;
  let match;
  while ((match = imports.exec(content))) {
    const dependency = resolveRelative(key, match[1]);
    if (dependency && await exists(sourcePath(dependency))) await copyCss(dependency);
  }
  const urls = /url\(\s*['"]?([^'"\)]+)['"]?\s*\)/g;
  while ((match = urls.exec(content))) {
    const value = String(match[1] || '').trim();
    if (!value || /^(?:data:|https?:|#)/i.test(value)) continue;
    const dependency = resolveRelative(key, value.split(/[?#]/)[0]);
    if (dependency && await exists(sourcePath(dependency))) await copyAsset(dependency);
  }
}

async function copyManifest(rel) {
  const key = norm(rel);
  const content = await readSource(key);
  await writeText(key, content);
  try {
    const manifest = JSON.parse(content);
    for (const icon of Array.isArray(manifest.icons) ? manifest.icons : []) {
      const dependency = resolveRelative(key, String(icon?.src || '').split(/[?#]/)[0]);
      if (dependency && await exists(sourcePath(dependency))) await copyAsset(dependency);
    }
  } catch {}
}

async function copyAsset(rel) {
  const key = norm(rel);
  assertAllowed(key);
  if (included.has(key)) return;
  if (/\.(?:js|mjs)$/i.test(key)) return copyJs(key);
  if (/\.css$/i.test(key)) return copyCss(key);
  if (/\.webmanifest$/i.test(key)) return copyManifest(key);
  await copyBinary(key);
}

function htmlRefs(content) {
  const out = [];
  const re = /\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/gi;
  let match;
  while ((match = re.exec(content))) out.push(match[1]);
  return out;
}

async function copyHtml(rel, content = null) {
  const key = norm(rel);
  const html = content ?? await readSource(key);
  await writeText(key, html);
  const baseRoot = /<base\s+[^>]*href=['"]\/['"]/i.test(html);
  for (const raw of htmlRefs(html)) {
    const value = String(raw || '').trim().split(/[?#]/)[0];
    if (!value || /^(?:https?:|mailto:|tel:|#|data:)/i.test(value) || value === '/') continue;
    const dependency = value.startsWith('/')
      ? norm(value.slice(1))
      : baseRoot
        ? norm(value)
        : norm(path.posix.join(path.posix.dirname(key), value));
    if (!dependency || !(await exists(sourcePath(dependency))) && !overrides.has(dependency)) continue;
    await copyAsset(dependency);
  }
}

function transformEnvironment(source) {
  let content = source;
  if (!content.includes("const AMVERA_SUFFIX = '.amvera.tech';")) {
    content = content.replace(
      "const CODESPACES_SUFFIX = '.app.github.dev';",
      "const CODESPACES_SUFFIX = '.app.github.dev';\nconst AMVERA_SUFFIX = '.amvera.tech';",
    );
  }
  content = content.replace(
    "  if (host.endsWith(CODESPACES_SUFFIX)) return CODESPACES_STAGING_API_BASE;",
    "  if (host.endsWith(CODESPACES_SUFFIX)) return CODESPACES_STAGING_API_BASE;\n  if (host.endsWith(AMVERA_SUFFIX)) return PRODUCTION_API_BASE;",
  );
  content = content.replaceAll('__BOOK_API_BASE__', '__PROFESSIONAL_API_BASE__');
  return content;
}

function transformBookingLink(source) {
  return source.replace(
    "  url.pathname = `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;",
    "  url.pathname = `/booking/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;",
  );
}

function transformBookingEntry(source) {
  return source.replace(
    "function pathParts() {\n  return String(location.pathname || '/')\n    .split('/')\n    .filter(Boolean)\n    .map((value) => {\n      try { return decodeURIComponent(value); } catch { return value; }\n    });\n}",
    "function pathParts() {\n  const parts = String(location.pathname || '/')\n    .split('/')\n    .filter(Boolean)\n    .map((value) => {\n      try { return decodeURIComponent(value); } catch { return value; }\n    });\n  if (parts[0] === 'booking') parts.shift();\n  return parts;\n}",
  );
}

function transformBookingAccess(source) {
  let content = source.replace(
    "import { API_BASE } from '../core/environment.js';",
    "import { API_BASE, USER_ORIGIN } from '../core/environment.js';",
  );
  content = content.replace("  location.assign('/');", "  location.assign(USER_ORIGIN);");
  return content;
}

function transformOnlineBookingSettings(source) {
  let content = source.replace("import { ACCOUNT_APP_ORIGIN } from '../../core/environment.js';\n", '');
  content = content.replace('    origin: ACCOUNT_APP_ORIGIN,', "    origin: globalThis.location?.origin || '',");
  return content;
}

function transformProfessionalEntry(source) {
  let content = source;
  const removeLines = [
    "import { resolveBookingPublicRoute } from './core/account/index.js';\n",
    "import { renderGlobalClient } from './online-booking/booking.js';\n",
    "import { renderAccess as renderOnlineBooking } from './online-booking/access.js';\n",
    "import './online-booking/account-runtime.js';\n",
    "import { USER_ORIGIN } from './core/environment.js';\n",
  ];
  for (const line of removeLines) content = content.replace(line, '');

  content = content.replace(/const END_USER_APP_HOSTS = new Set\([\s\S]*?\);\n\n(?=const ROOT_SECTIONS)/, '');
  content = content.replace(/function bookingRouteQuery[\s\S]*?(?=function ensureServerBookingSync)/, '');

  content = content.replace(
    "${field({ label: 'Email', name: 'email', type: 'email', required: true, autocomplete: 'email' })}",
    "${field({ label: 'Телефон или email', name: 'identifier', type: 'text', required: true, autocomplete: 'username' })}",
  );
  content = content.replace(
    'Укажите email профиля. Если учётная запись существует, на него придёт ссылка для изменения пароля.',
    'Укажите телефон или email профиля. Если учётная запись существует, на подтверждённый email придёт ссылка для изменения пароля.',
  );
  content = content.replace("requestPasswordReset(data.get('email'))", "requestPasswordReset(data.get('identifier'))");

  content = content.replace(
    "${field({ label: 'Email', name: 'email', type: 'email', required: true, autocomplete: 'username' })}",
    "${field({ label: 'Телефон или email', name: 'identifier', type: 'text', required: true, autocomplete: 'username' })}",
  );
  content = content.replace(
    "      <button type=\"button\" class=\"v2-sticker-link\" data-specialist-forgot>Забыли пароль?</button>",
    "      <button type=\"button\" class=\"v2-sticker-link\" data-specialist-forgot>Забыли пароль?</button>\n      <button type=\"button\" class=\"v2-sticker-link\" data-professional-register>Зарегистрироваться</button>",
  );
  content = content.replace(
    "  app.querySelector('[data-specialist-forgot]')?.addEventListener('click', renderPasswordResetRequest);",
    "  app.querySelector('[data-specialist-forgot]')?.addEventListener('click', renderPasswordResetRequest);\n  app.querySelector('[data-professional-register]')?.addEventListener('click', () => location.assign('/invite/'));",
  );
  content = content.replace("login(data.get('email'), data.get('password'))", "login(data.get('identifier'), data.get('password'))");

  content = content.replace(
    /const publicBooking = await bookingRoute\(\);[\s\S]*$/,
    `try {\n  const currentAccount = await getCurrentAccount();\n  if (currentAccount) {\n    authenticatedAccount = currentAccount;\n    await renderAuthenticated(currentAccount);\n  } else {\n    renderLogin();\n  }\n} catch {\n  renderLogin('Сервер временно недоступен');\n}\n`,
  );

  if (/renderGlobalClient|renderOnlineBooking|isEndUserAppHost|END_USER_APP_HOSTS|account-runtime/.test(content)) {
    throw new Error('Professional entry still contains User/Public mixed runtime');
  }
  return content;
}

function transformIndex(source) {
  let content = source;
  content = content.replace(/\s*<script>\s*\{\s*const endUserApp[\s\S]*?<\/script>\s*/m, '\n');
  content = content.replace(/\s*<link rel="stylesheet" href="ui\/booking\/account-mobile\.css">/g, '');
  content = content.replace(/\s*<link rel="stylesheet" href="ui\/booking\/booking\.css">/g, '');
  content = content.replace(/\s*<script type="module" src="core\/chat\/messenger-mode\.js"><\/script>/g, '');
  content = content.replace(/\s*<script type="module" src="core\/account-transition-runtime\.js"><\/script>/g, '');
  content = content.replace(/\s*<script type="module" src="core\/password-reset-request\.js"><\/script>/g, '');
  content = content.replace('src="core.js"', 'src="professional.js"');
  content = content.replace('<title>Рабочее пространство</title>', '<title>Кабинет</title>');
  return content;
}

function nginxConfig() {
  return `server {\n  listen 3000;\n  server_name _;\n  root /usr/share/nginx/html;\n  index index.html;\n\n  location = /booking {\n    try_files /booking.html =404;\n    add_header Cache-Control "no-cache";\n  }\n\n  location ^~ /booking/ {\n    try_files /booking.html =404;\n    add_header Cache-Control "no-cache";\n  }\n\n  location ~* \\.(?:js|mjs|css|json|webmanifest|svg|png|jpg|jpeg|webp|woff2?)$ {\n    try_files $uri =404;\n    add_header Cache-Control "no-cache";\n  }\n\n  location = /service-worker.js {\n    add_header Cache-Control "no-cache";\n    try_files $uri =404;\n  }\n\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n`;
}

async function generateDockerfile() {
  const entries = await fs.readdir(targetRoot, { withFileTypes: true });
  const skip = new Set(['.git', '.github', 'scripts', 'source', 'node_modules']);
  const runtimeFiles = new Set([
    'index.html', 'booking.html', 'reset-password.html', 'verify-email.html',
    'manifest.webmanifest', 'service-worker.js', 'app-icon.svg', 'icon-192.png', 'icon-512.png',
    'professional.js',
  ]);
  const lines = ['FROM nginx:1.27-alpine', '', 'COPY nginx.conf /etc/nginx/conf.d/default.conf', ''];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (skip.has(entry.name)) continue;
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      if (['core','css','journal','timetable','settings','chat','ui','invite','online-booking','pwa'].includes(entry.name)) {
        lines.push(`COPY ${entry.name} /usr/share/nginx/html/${entry.name}`);
      }
    } else if (runtimeFiles.has(entry.name)) {
      lines.push(`COPY ${entry.name} /usr/share/nginx/html/${entry.name}`);
    }
  }
  lines.push('', 'EXPOSE 3000', '');
  await fs.writeFile(targetPath('Dockerfile'), lines.join('\n'), 'utf8');
}

async function validateTarget() {
  const missing = [];
  for (const rel of jsVisited) {
    const content = await fs.readFile(targetPath(rel), 'utf8');
    for (const specifier of moduleSpecifiers(content)) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue;
      const base = resolveRelative(rel, specifier);
      const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}/index.js`].filter(Boolean);
      let found = false;
      for (const candidate of candidates) {
        if (await exists(targetPath(candidate))) { found = true; break; }
      }
      if (!found) missing.push(`${rel} -> ${specifier}`);
    }
  }
  if (missing.length) throw new Error(`Missing extracted imports:\n${missing.join('\n')}`);

  for (const key of included) assertAllowed(key);
  const forbiddenPresent = [...forbiddenExact].filter(async () => await exists(targetPath(async)));
  if (forbiddenPresent.length) throw new Error(`Forbidden files present: ${forbiddenPresent.join(', ')}`);

  const professionalEntry = await fs.readFile(targetPath('professional.js'), 'utf8');
  const forbiddenEntryMarkers = ['renderGlobalClient', 'isEndUserAppHost', 'END_USER_APP_HOSTS', "./online-booking/account-runtime.js"];
  const foundMarkers = forbiddenEntryMarkers.filter((marker) => professionalEntry.includes(marker));
  if (foundMarkers.length) throw new Error(`User runtime markers remain in professional.js: ${foundMarkers.join(', ')}`);
}

for (const rel of cleanPaths) await fs.rm(targetPath(rel), { recursive: true, force: true });

const sourceIndex = await readSource('index.html');
const sourceProfessionalEntry = await readSource('core.js');
overrides.set('professional.js', transformProfessionalEntry(sourceProfessionalEntry));
overrides.set('core/environment.js', transformEnvironment(await readSource('core/environment.js')));
overrides.set('core/booking-link/index.js', transformBookingLink(await readSource('core/booking-link/index.js')));
overrides.set('online-booking/booking-entry.js', transformBookingEntry(await readSource('online-booking/booking-entry.js')));
overrides.set('online-booking/access.js', transformBookingAccess(await readSource('online-booking/access.js')));
overrides.set('settings/online-booking/online-booking.js', transformOnlineBookingSettings(await readSource('settings/online-booking/online-booking.js')));

await copyHtml('index.html', transformIndex(sourceIndex));
await copyHtml('booking.html');
await copyHtml('invite/index.html');
await copyHtml('reset-password.html');
await copyHtml('verify-email.html');
await copyAsset('service-worker.js');

await writeText('nginx.conf', nginxConfig());
await writeText('.dockerignore', ['.git', '.github', 'scripts', 'source', 'node_modules', '*.md', 'package-lock.json', ''].join('\n'));
await writeText('package.json', JSON.stringify({
  name: '@co-va/professional',
  private: true,
  type: 'module',
}, null, 2) + '\n');

await validateTarget();
await generateDockerfile();

const sorted = [...included].sort();
const report = [
  '# Professional extraction report',
  '',
  `Source: co-va/core:main${sourceSha ? ` @ ${sourceSha}` : ''}`,
  `Files copied/generated: ${sorted.length}`,
  '',
  '## Explicitly excluded',
  '- User/end-user Journal runtime and markers',
  '- User/Account application runtime',
  '- Admin UI',
  '- Landing UI',
  '- Unreachable legacy modules',
  '',
  '## Included files',
  ...sorted.map((file) => `- ${file}`),
  '',
].join('\n');
await fs.writeFile(targetPath('EXTRACTION_REPORT.md'), report, 'utf8');

console.log(`Professional extraction complete: ${sorted.length} files from ${sourceSha || 'core:main'}`);
