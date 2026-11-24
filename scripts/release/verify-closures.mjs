#!/usr/bin/env node
// Fast, opt-in release guard. Not a CI workflow and never changes source files.
// Run from this repo: node scripts/release/verify-closures.mjs
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const registry = JSON.parse(readFileSync(resolve(root, 'RELEASE_CLOSURE_REGISTRY.json'), 'utf8'));
const errors = [];
const all = Array.isArray(registry.items) ? registry.items : [];
const byId = new Map();

for (const item of all) {
  if (!item.id || byId.has(item.id)) errors.push('Повторный или пустой ID: ' + item.id);
  else byId.set(item.id, item);
  if (!['open','verifying','locked'].includes(item.closure?.state))
    errors.push(item.id + ': некорректный статус');
  if (!Array.isArray(item.paths) || !Array.isArray(item.requires))
    errors.push(item.id + ': отсутствует список исходников или зависимостей');
}
for (const item of all) {
  if (item.parent && !byId.has(item.parent)) errors.push(item.id + ': нет родителя ' + item.parent);
  for (const dep of item.requires || []) if (!byId.has(dep))
    errors.push(item.id + ': нет зависимости ' + dep);
}
const checked = new Set();
const active = new Set();
function checkCycle(id) {
  if (active.has(id)) { errors.push('Циклическая зависимость: ' + id); return; }
  if (checked.has(id)) return;
  const item = byId.get(id);
  if (!item) return;
  active.add(id);
  for (const dep of item.requires || []) checkCycle(dep);
  active.delete(id);
  checked.add(id);
}
for (const item of all) checkCycle(item.id);

const children = new Map(all.map(item => [item.id, []]));
for (const item of all) if (item.parent && children.has(item.parent))
  children.get(item.parent).push(item.id);

const git = (...args) => execFileSync('git', args, {
  cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'],
}).trim();
const matches = (source, path) => source.endsWith('/**')
  ? path.startsWith(source.slice(0, -3) + '/')
  : source === path;
const changedSince = new Map();
function diffFrom(sha) {
  if (changedSince.has(sha)) return changedSince.get(sha);
  const files = git('diff', '--name-only', '--no-renames', sha, '--')
    .split('\n').filter(Boolean);
  const untracked = git('ls-files', '--others', '--exclude-standard')
    .split('\n').filter(Boolean);
  const result = [...new Set([...files, ...untracked])];
  changedSince.set(sha, result);
  return result;
}

for (const item of all.filter(item => item.closure?.state === 'locked')) {
  const close = item.closure;
  if (!close.approvedBy || !close.approvedAt
    || !/^[0-9a-f]{40}$/.test(close.baselineSha || '')
    || !Array.isArray(close.evidence) || !close.evidence.length) {
    errors.push(item.id + ': закрыт без согласования, доказательств или SHA');
    continue;
  }
  if (Object.values(item.acceptance || {}).some(value => value === 'не проверено' || !value))
    errors.push(item.id + ': закрыт с непроверенной приёмкой');
  for (const dep of [...(item.requires || []), ...(children.get(item.id) || [])]) {
    if (byId.get(dep)?.closure?.state !== 'locked')
      errors.push(item.id + ': зависимость или дочерний элемент ещё не закрыт: ' + dep);
  }
  try {
    const changed = diffFrom(close.baselineSha)
      .filter(path => (item.paths || []).some(source => matches(source, path)));
    if (changed.length) errors.push(
      item.id + ': изменены замороженные исходники после ' + close.baselineSha.slice(0, 8)
      + ': ' + changed.join(', ')
    );
  } catch (e) {
    errors.push(item.id + ': не удалось сверить Git SHA (нужна полная история): '
      + (e?.stderr?.toString().trim() || e.message));
  }
}
if (registry.rules?.noNewCI !== true)
  errors.push('Контракт защиты допускает неожиданные CI: настройка noNewCI должна быть true');

const totals = { open: 0, verifying: 0, locked: 0 };
for (const item of all) if (item.closure?.state in totals) totals[item.closure.state]++;

console.log(`Карта закрытия: ${all.length} элементов; не закрыто: ${totals.open}; в проверке: ${totals.verifying}; закрыто: ${totals.locked}`);
if (errors.length) {
  for (const error of errors) console.error('НАРУШЕНИЕ:', error);
  process.exitCode = 1;
} else {
  console.log('Контракт карты цел; вмешательств в закрытые элементы не обнаружено.');
  if (!totals.locked) console.log('Замороженных элементов пока нет: защиту изменений проверять ещё не на чем.');
}
