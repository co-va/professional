import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const norm = (value) => String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
const abs = (rel) => path.join(root, norm(rel));

const ENTRY_ROOTS = [
  'index.html',
  'booking.html',
  'invite/index.html',
  'reset-password.html',
  'verify-email.html',
  'service-worker.js',
];

const RUNTIME_DIRS = [
  'core', 'css', 'journal', 'timetable', 'settings', 'chat', 'ui', 'invite', 'online-booking', 'pwa',
];

const FORBIDDEN_EXACT = new Set([
  'user.html',
  'online-booking/user-entry.js',
  'online-booking/account-runtime.js',
  'online-booking/account-shell.js',
  'online-booking/booking.js',
  'online-booking/personal-account-data.js',
  'online-booking/password-settings.js',
  'online-booking/consent-settings.js',
  'online-booking/server-sync.js',
  'core/account-transition-runtime.js',
  'core/chat/messenger-mode.js',
  'ui/header/mode-switch.js',
  'core/note/account-owner.js',
  'core/event/account-owner.js',
  'core/calendar-sync/account.js',
]);

const FORBIDDEN_PREFIXES = [
  'admin/',
  'landing/',
  'user/',
  'server/',
  'tests/',
  'core/account/',
  'core/app-mode/',
];

const ALLOWED_ONLINE_BOOKING_FILES = new Set([
  'online-booking/access.js',
  'online-booking/booking-entry.js',
  'online-booking/model.js',
]);

const RETIRED_RUNTIME_MARKERS = new Map([
  ["from './online-booking/server-sync.js'", 'Professional entry imports guest-contour server sync'],
  ["from '../online-booking/server-sync.js'", 'Professional runtime imports guest-contour server sync'],
]);

const reachable = new Set();
const visiting = new Set();
const problems = [];

async function exists(rel) {
  try { await fs.access(abs(rel)); return true; } catch { return false; }
}

async function walk(rel) {
  if (!(await exists(rel))) return [];
  const out = [];
  const stack = [norm(rel)];
  while (stack.length) {
    const current = stack.pop();
    const stat = await fs.stat(abs(current));
    if (stat.isFile()) {
      out.push(current);
      continue;
    }
    for (const entry of await fs.readdir(abs(current), { withFileTypes: true })) {
      stack.push(norm(path.posix.join(current, entry.name)));
    }
  }
  return out.sort();
}

function localSpec(spec) {
  const value = String(spec || '').trim();
  return value.startsWith('.') || value.startsWith('/');
}

function resolveRelative(from, spec) {
  const value = String(spec || '').trim().split(/[?#]/)[0];
  if (!value || /^(?:[a-z]+:|\/\/|#|data:)/i.test(value)) return '';
  if (value.startsWith('/')) return norm(value.slice(1));
  if (!value.startsWith('.')) return '';
  return norm(path.posix.normalize(path.posix.join(path.posix.dirname(norm(from)), value)));
}

async function resolveModule(from, spec) {
  const base = resolveRelative(from, spec);
  if (!base) return '';
  const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}/index.js`];
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  problems.push(`Missing local module: ${from} -> ${spec}`);
  return '';
}

function jsImports(text) {
  const out = new Set();
  const patterns = [
    /(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let match;
    while ((match = re.exec(text))) out.add(match[1]);
  }
  return [...out];
}

function htmlRefs(text) {
  const out = [];
  const re = /\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/gi;
  let match;
  while ((match = re.exec(text))) out.push(match[1]);
  return out;
}

async function visit(rel) {
  const key = norm(rel);
  if (!key || reachable.has(key) || visiting.has(key) || !(await exists(key))) return;
  visiting.add(key);
  reachable.add(key);

  const ext = path.extname(key).toLowerCase();
  const textExt = new Set(['.js', '.mjs', '.css', '.html', '.webmanifest', '.json']);
  if (!textExt.has(ext)) {
    visiting.delete(key);
    return;
  }

  const text = await fs.readFile(abs(key), 'utf8');

  if (ext === '.js' || ext === '.mjs') {
    for (const spec of jsImports(text)) {
      if (!localSpec(spec)) continue;
      const dep = await resolveModule(key, spec);
      if (dep) await visit(dep);
    }
    const assetRe = /new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;
    let match;
    while ((match = assetRe.exec(text))) {
      const dep = resolveRelative(key, match[1]);
      if (dep && await exists(dep)) await visit(dep);
    }
  } else if (ext === '.html') {
    const baseRoot = /<base\s+[^>]*href=['"]\/['"]/i.test(text);
    for (const raw of htmlRefs(text)) {
      const value = String(raw || '').trim().split(/[?#]/)[0];
      if (!value || value === '/' || /^(?:https?:|mailto:|tel:|#|data:)/i.test(value)) continue;
      const dep = value.startsWith('/')
        ? norm(value.slice(1))
        : baseRoot
          ? norm(value)
          : norm(path.posix.join(path.posix.dirname(key), value));
      if (await exists(dep)) await visit(dep);
    }
  } else if (ext === '.css') {
    const importRe = /@import\s+(?:url\()?['"]?([^'"\)\s;]+)['"]?\)?/g;
    let match;
    while ((match = importRe.exec(text))) {
      const dep = resolveRelative(key, match[1]);
      if (dep && await exists(dep)) await visit(dep);
    }
  } else if (ext === '.webmanifest' || ext === '.json') {
    try {
      const data = JSON.parse(text);
      for (const icon of Array.isArray(data?.icons) ? data.icons : []) {
        const value = String(icon?.src || '').trim();
        const dep = value.startsWith('/') ? norm(value.slice(1)) : resolveRelative(key, value);
        if (dep && await exists(dep)) await visit(dep);
      }
    } catch {
      // Not every JSON-like runtime file is a manifest. Reachability is enough.
    }
  }

  visiting.delete(key);
}

for (const entry of ENTRY_ROOTS) {
  if (!(await exists(entry))) problems.push(`Missing runtime entry: ${entry}`);
  else await visit(entry);
}

const runtimeFiles = [];
for (const dir of RUNTIME_DIRS) runtimeFiles.push(...await walk(dir));
for (const rootFile of ['professional.js', 'service-worker.js']) if (await exists(rootFile)) runtimeFiles.push(rootFile);

const runtimeCode = [...new Set(runtimeFiles)]
  .filter((file) => /\.(?:js|mjs|css)$/i.test(file))
  .sort();

for (const file of runtimeCode) {
  if (!reachable.has(file)) problems.push(`Dead runtime file: ${file}`);
}

const allFiles = [
  ...await walk('core'), ...await walk('journal'), ...await walk('timetable'), ...await walk('settings'),
  ...await walk('chat'), ...await walk('ui'), ...await walk('invite'), ...await walk('online-booking'),
  ...await walk('css'), ...await walk('pwa'),
];

for (const file of allFiles) {
  if (FORBIDDEN_EXACT.has(file)) problems.push(`Forbidden file present: ${file}`);
  if (FORBIDDEN_PREFIXES.some((prefix) => file.startsWith(prefix))) problems.push(`Forbidden contour present: ${file}`);
  if (/(^|\/)(?:legacy|compat|bridge)(?:[._\/-]|$)/i.test(file)) problems.push(`Legacy/compat/bridge path present: ${file}`);

  if (/\.(?:js|mjs|css|html|json|webmanifest)$/i.test(file)) {
    const source = await fs.readFile(abs(file), 'utf8');
    for (const [marker, message] of RETIRED_RUNTIME_MARKERS) {
      if (source.includes(marker)) problems.push(`${message}: ${file}`);
    }
  }
}

for (const exact of FORBIDDEN_EXACT) if (await exists(exact)) problems.push(`Forbidden file present: ${exact}`);
for (const prefix of FORBIDDEN_PREFIXES) if (await exists(prefix)) problems.push(`Forbidden directory present: ${prefix}`);

const bookingFiles = (await walk('online-booking')).filter((file) => /\.(?:js|mjs)$/i.test(file));
for (const file of bookingFiles) {
  if (!ALLOWED_ONLINE_BOOKING_FILES.has(file)) problems.push(`Unexpected Online Booking runtime: ${file}`);
}
for (const required of ALLOWED_ONLINE_BOOKING_FILES) {
  if (!(await exists(required))) problems.push(`Missing canonical Online Booking runtime: ${required}`);
}

for (const file of (await walk('journal')).filter((item) => /\.(?:js|mjs)$/i.test(item))) {
  const text = await fs.readFile(abs(file), 'utf8');
  if (/data-account|cova:account|accountMode|context:\s*['"]account['"]|core\/(?:note|event)\/account-owner|calendar-sync\/account/.test(text)) {
    problems.push(`End-user Journal marker remains: ${file}`);
  }
}

if (await exists('professional.js')) {
  const entry = await fs.readFile(abs('professional.js'), 'utf8');
  if (/renderGlobalClient|renderOnlineBooking|isEndUserAppHost|END_USER_APP_HOSTS|account-runtime|user-entry/.test(entry)) {
    problems.push('Professional entry still contains User runtime markers');
  }
  if (!entry.includes("from './core/runtime/server-sync.js'")) {
    problems.push('Professional entry must own server sync outside Public Booking');
  }
}

const duplicateBuckets = new Map();
for (const file of runtimeCode) {
  const text = (await fs.readFile(abs(file), 'utf8')).replaceAll('\r\n', '\n').trim();
  if (Buffer.byteLength(text, 'utf8') < 256) continue;
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  if (!duplicateBuckets.has(hash)) duplicateBuckets.set(hash, []);
  duplicateBuckets.get(hash).push(file);
}
for (const files of duplicateBuckets.values()) {
  if (files.length > 1) problems.push(`Exact duplicate runtime files: ${files.join(' = ')}`);
}

const obsoleteDevFiles = [
  'scripts/extract-from-core.mjs',
  '.github/workflows/probe-preview.yml',
];
for (const file of obsoleteDevFiles) if (await exists(file)) problems.push(`Obsolete development file present: ${file}`);

const uniqueProblems = [...new Set(problems)].sort();
console.log(`Professional clean audit: ${runtimeCode.length} runtime code files, ${reachable.size} reachable runtime/assets.`);
console.log(`Online Booking runtime: ${bookingFiles.length} canonical files.`);

if (uniqueProblems.length) {
  console.error(`Professional clean audit FAILED (${uniqueProblems.length}):`);
  for (const problem of uniqueProblems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log('Professional clean audit PASS: standalone boundaries, guest Booking isolation, retired markers, reachability and duplicate checks are clean.');
