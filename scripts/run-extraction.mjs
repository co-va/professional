import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const sourceFile = path.resolve('scripts/extract-professional.mjs');
let source = await fs.readFile(sourceFile, 'utf8');

const patches = [
  [
    "return content.slice(0,a)+replacement+content.slice(b);",
    "return content.slice(0,a)+replacement+content.slice(b+end.length);",
  ],
  [
    "await copyJs(await resolveModule(key, spec));",
    "const dependency = await resolveModule(key, spec);\n    try { await copyJs(dependency); } catch (error) { throw new Error(`${key} -> ${dependency}: ${error.message}`); }",
  ],
  [
    "overrides.set('ui/ui.js',transformUiBarrel(await read('ui/ui.js')));",
    "overrides.set('core/chat/unread-runtime.js', (await read('core/chat/unread-runtime.js'))\n  .replace(\"import { getGlobalAccountUnreadSummary } from '../account/index.js';\\n\", '')\n  .replace(\"import { USER_ORIGIN } from '../environment.js';\\n\", '')\n  .replace(\"const USER_HOST = new URL(USER_ORIGIN).hostname;\\n\", '')\n  .replace(/function isEndUserRuntime\\(\\) \\{[\\s\\S]*?\\n\\}\\n\\n/, '')\n  .replace(/async function loadTotal\\(\\) \\{[\\s\\S]*?\\n\\}/, \"async function loadTotal() {\\n  const conversations = await getProfessionalMessengerConversations();\\n  return professionalUnread(conversations);\\n}\"));\noverrides.set('core/notifications/service-unseen.js', await fs.readFile(dst('scripts/overrides/service-unseen.js'), 'utf8'));\noverrides.set('core/chat/messenger-api.js', await fs.readFile(dst('scripts/overrides/messenger-api.js'), 'utf8'));\noverrides.set('core/password-reset-page.js', await fs.readFile(dst('scripts/overrides/password-reset-page.js'), 'utf8'));\noverrides.set('ui/ui.js',transformUiBarrel(await read('ui/ui.js')));",
  ],
];

for (const [before, after] of patches) {
  if (!source.includes(before)) throw new Error(`Extractor patch target not found: ${before}`);
  source = source.replace(before, after);
}

const runtimeFile = path.join(os.tmpdir(), `extract-professional-${process.pid}.mjs`);
await fs.writeFile(runtimeFile, source, 'utf8');

const result = spawnSync(process.execPath, [runtimeFile], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

await fs.rm(runtimeFile, { force: true });
if (result.error) throw result.error;
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

async function preserveProfessionalPreviewRuntime() {
  const environmentFile = path.resolve('core/environment.js');
  let environment = await fs.readFile(environmentFile, 'utf8');

  if (!environment.includes("export const AMVERA_PREVIEW_API_BASE = '/api';")) {
    environment = environment.replace(
      "export const CODESPACES_STAGING_API_BASE = '/api';",
      "export const CODESPACES_STAGING_API_BASE = '/api';\nexport const AMVERA_PREVIEW_API_BASE = '/api';",
    );
  }

  environment = environment.replace(
    "if (host.endsWith(AMVERA_SUFFIX)) return PRODUCTION_API_BASE;",
    "if (host.endsWith(AMVERA_SUFFIX)) return AMVERA_PREVIEW_API_BASE;",
  );

  const simpleRuntime = `export function resolveRuntimeEnvironment({ hostname = '', override = '' } = {}) {\n  const base = resolveApiBase({ hostname, override });\n  return base === PRODUCTION_API_BASE ? 'production' : 'staging';\n}`;
  const previewRuntime = `export function resolveRuntimeEnvironment({ hostname = '', override = '' } = {}) {\n  const explicit = normalizedBase(override);\n  const host = String(hostname || '').trim().toLowerCase();\n  if (!explicit && host.endsWith(AMVERA_SUFFIX)) return 'production';\n\n  const base = resolveApiBase({ hostname, override });\n  return base === PRODUCTION_API_BASE ? 'production' : 'staging';\n}`;
  environment = environment.replace(simpleRuntime, previewRuntime);

  if (!environment.includes("if (host.endsWith(AMVERA_SUFFIX)) return AMVERA_PREVIEW_API_BASE;")) {
    throw new Error('Professional Amvera API mapping was not preserved');
  }
  await fs.writeFile(environmentFile, environment, 'utf8');

  const nginx = `server {\n  listen 3000;\n  server_name _;\n  root /usr/share/nginx/html;\n  index index.html;\n\n  location ^~ /api/ {\n    proxy_pass https://api.va-tools.ru/;\n    proxy_set_header Host api.va-tools.ru;\n    proxy_http_version 1.1;\n    proxy_set_header Connection \"\";\n    proxy_ssl_server_name on;\n    proxy_ssl_name api.va-tools.ru;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto https;\n  }\n\n  location = /booking { try_files /booking.html =404; add_header Cache-Control \"no-cache\"; }\n  location ^~ /booking/ { try_files /booking.html =404; add_header Cache-Control \"no-cache\"; }\n  location ~* \\.(?:js|mjs|css|json|webmanifest|svg|png|jpg|jpeg|webp|woff2?)$ { try_files $uri =404; add_header Cache-Control \"no-cache\"; }\n  location = /service-worker.js { add_header Cache-Control \"no-cache\"; try_files $uri =404; }\n  location / { try_files $uri $uri/ /index.html; }\n}\n`;
  await fs.writeFile(path.resolve('nginx.conf'), nginx, 'utf8');

  const authFile = path.resolve('ui/auth/auth.css');
  let auth = await fs.readFile(authFile, 'utf8');
  auth = auth.replace(
    '.shared-login-screen{width:min(100%,var(--app-max-width));min-height:100dvh;background:',
    '.shared-login-screen{width:min(100%,var(--app-max-width));min-height:100dvh;margin:0 auto;background:',
  );
  if (!auth.includes('.app-shell.app-shell--auth{')) {
    auth += '\n.app-shell.app-shell--auth{width:100%;max-width:none;min-height:100dvh;margin:0;padding-top:0;background:var(--surface-dark);box-shadow:none}\n.app-shell.app-shell--auth>.v2-sticker-screen{width:min(100%,var(--app-max-width));margin-left:auto;margin-right:auto}\n';
  }
  await fs.writeFile(authFile, auth, 'utf8');

  const entryFile = path.resolve('professional.js');
  let entry = await fs.readFile(entryFile, 'utf8');
  const loginMarker = "function renderLogin(message = '') {\n  setThemeColor('#F5F5F3');\n  app.classList.remove('app-shell--booking');";
  if (!entry.includes("app.classList.add('app-shell--auth');")) {
    entry = entry.replace(loginMarker, `${loginMarker}\n  app.classList.add('app-shell--auth');`);
  }
  const resetMarker = "function renderPasswordResetRequest() {\n  setThemeColor('#F5F5F3');\n  app.classList.remove('app-shell--booking');";
  if (!entry.includes(`${resetMarker}\n  app.classList.add('app-shell--auth');`)) {
    entry = entry.replace(resetMarker, `${resetMarker}\n  app.classList.add('app-shell--auth');`);
  }
  const workspaceMarker = "function renderWorkspace() {\n  setThemeColor('#2F3338');\n  app.classList.remove('app-shell--booking');";
  if (!entry.includes(`${workspaceMarker}\n  app.classList.remove('app-shell--auth');`)) {
    entry = entry.replace(workspaceMarker, `${workspaceMarker}\n  app.classList.remove('app-shell--auth');`);
  }
  if (!entry.includes("app.classList.add('app-shell--auth');")) {
    throw new Error('Professional auth host class was not preserved');
  }
  await fs.writeFile(entryFile, entry, 'utf8');
}

await preserveProfessionalPreviewRuntime();
process.exit(0);
