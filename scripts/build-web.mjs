// Production-only, content-versioned delivery. Source modules stay unchanged.
// CSS is concatenated in the exact HTML order; esbuild keeps ESM lazy chunks.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'dist');
const publicRoots = [
  'app-icon.svg', 'icon-192.png', 'booking.html', 'chat', 'core', 'css',
  'index.html', 'invite', 'journal', 'manifest.webmanifest', 'online-booking',
  'professional.js', 'professional', 'reset-password.html',
  'service-worker.js', 'settings', 'timetable', 'ui', 'verify-email.html',
];
const source = (p) => path.join(root, p);
const posix = path.posix;
const sha = (value) => createHash('sha256').update(value).digest('hex');

await mkdir(output, { recursive: true });
for (const item of publicRoots) {
  await cp(source(item), path.join(output, item), { recursive: true, force: true });
}

async function descendants(location, prefix = '') {
  const entries = await readdir(location, { withFileTypes: true });
  const collected = [];
  for (const entry of entries) {
    const name = posix.join(prefix, entry.name);
    if (entry.isDirectory()) collected.push(...await descendants(path.join(location, entry.name), name));
    else if (entry.isFile()) collected.push(name);
  }
  return collected;
}

const publicFiles = (await descendants(output))
  .filter((file) => !file.startsWith('assets/')).sort();
const digest = createHash('sha256');
for (const file of publicFiles) {
  digest.update(file).update('\0').update(await readFile(path.join(output, file)));
}
const revision = digest.digest('hex').slice(0, 20);
const assetDirectory = path.join(output, 'assets', revision);
await mkdir(assetDirectory, { recursive: true });

const pages = publicFiles.filter((file) => file.endsWith('.html'));
const htmlByPage = new Map(await Promise.all(pages.map(async file =>
  [file, await readFile(path.join(output, file), 'utf8')]
)));
const entries = new Set();
function referencedFile(page, specifier) {
  if (/^(https?:|data:|blob:|\/\/)/i.test(specifier)) return null;
  const clean = specifier.split(/[?#]/, 1)[0];
  const baseAtRoot = /<base\s+href=["']\/["']/.test(htmlByPage.get(page) || '');
  const base = clean.startsWith('/') || baseAtRoot ? '' : posix.dirname(page);
  const resolved = posix.normalize(posix.join(base, clean.replace(/^\/+/, '')));
  if (resolved.startsWith('../') || resolved === '..') throw new Error('Unsafe asset path: ' + specifier);
  return resolved;
}
const scriptPattern = /<script\b[^>]*>/gi;
const literalImport = /\bimport\(\s*(['"])(\.\/[^'"]+\.js)\1\s*\)/g;
for (const [page, html] of htmlByPage) {
  for (const tag of html.match(scriptPattern) || []) {
    if (!/\btype=["']module["']/i.test(tag)) continue;
    const match = tag.match(/\bsrc=["']([^"']+\.js(?:[?#][^"']*)?)["']/i);
    if (match) entries.add(referencedFile(page, match[1]));
  }
  for (const match of html.matchAll(literalImport)) entries.add(referencedFile(page, match[2]));
}
if (!entries.size) throw new Error('No ESM entrypoints found');
const entryPoints = [...entries].filter(Boolean).sort();
for (const entry of entryPoints) await stat(source(entry));

const result = await build({
  entryPoints: entryPoints.map(source),
  outbase: root,
  outdir: assetDirectory,
  publicPath: '/assets/' + revision + '/',
  entryNames: '[dir]/[name]-[hash]',
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'files/[name]-[hash]',
  bundle: true,
  splitting: true,
  platform: 'browser',
  format: 'esm',
  target: ['safari15.4', 'chrome100'],
  minifyWhitespace: true,
  minifySyntax: true,
  minifyIdentifiers: false,
  metafile: true,
  logLevel: 'warning',
});

const entryUrls = new Map();
for (const [file, meta] of Object.entries(result.metafile.outputs)) {
  if (!meta.entryPoint) continue;
  const input = posix.normalize(path.relative(root, path.resolve(meta.entryPoint)).replaceAll('\\', '/'));
  const url = '/' + path.relative(output, path.resolve(file)).replaceAll('\\', '/');
  entryUrls.set(input, url);
}
for (const entry of entryPoints) {
  if (!entryUrls.has(entry)) throw new Error('Missing bundled entry: ' + entry);
}
function relocateCssUrls(css, sourcePath) {
  return css.replace(/url\(\s*(?:(["'])(.*?)\1|([^)]*))\s*\)/g, (whole, quote, quoted, unquoted) => {
    const url = String(quoted ?? unquoted ?? '').trim();
    if (!url || /^(?:\/|#|data:|blob:|https?:|\/\/)/i.test(url)) return whole;
    const absolute = '/' + posix.normalize(posix.join(posix.dirname(sourcePath), url));
    return 'url("' + absolute + '")';
  });
}
for (const [page, original] of htmlByPage) {
  let html = original;
  const styles = [];
  html = html.replace(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi, (tag) => {
    const match = tag.match(/\bhref=["']([^"']+)["']/i);
    if (!match) return tag;
    const src = referencedFile(page, match[1]);
    if (!src || !src.endsWith('.css')) return tag;
    styles.push(src);
    return styles.length === 1 ? '__APP_CSS_BUNDLE__' : '';
  });
  if (styles.length) {
    const combined = (await Promise.all(styles.map(async src => {
      const originalCss = await readFile(source(src), 'utf8');
      if (/^\s*@import\b/m.test(originalCss)) throw new Error('CSS imports need explicit handling: ' + src);
      return '/* ' + src + ' */\n' + relocateCssUrls(originalCss, src);
    }))).join('\n');
    const filename = 'styles-' + sha(combined).slice(0, 20) + '.css';
    await writeFile(path.join(assetDirectory, filename), combined);
    html = html.replace('__APP_CSS_BUNDLE__',
      '<link rel="stylesheet" href="/assets/' + revision + '/' + filename + '">');
  }
  html = html.replace(/<script\b[^>]*>/gi, (tag) => {
    if (!/\btype=["']module["']/i.test(tag)) return tag;
    return tag.replace(/\bsrc=(["'])([^"']+\.js(?:[?#][^"']*)?)\1/i, (full, quote, specifier) => {
      const url = entryUrls.get(referencedFile(page, specifier));
      if (!url) throw new Error('Bundled entry missing for ' + page + ': ' + specifier);
      return 'src=' + quote + url + quote;
    });
  });
  html = html.replace(literalImport, (full, quote, specifier) => {
    const url = entryUrls.get(referencedFile(page, specifier));
    if (!url) throw new Error('Bundled inline import missing for ' + page + ': ' + specifier);
    return 'import(' + quote + url + quote + ')';
  });
  await writeFile(path.join(output, page), html);
}
const bundled = Object.keys(result.metafile.outputs).filter(file => file.endsWith('.js')).length;
console.log('PASS: built immutable /assets/' + revision + '/ with '
  + pages.length + ' HTML, ' + entryPoints.length + ' JS entrypoints, '
  + bundled + ' JS bundles/chunks and one ordered CSS asset per HTML');
