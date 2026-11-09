import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// Single CI invariant: Loyalty owns E types. Contacts and assignment must
// derive from its registry; adding an E cannot silently omit its Person card.
const read = file => readFileSync(file, 'utf8');
const canonical = 'core/loyalty/index.js';
const owner = read(canonical);
const matches = [...owner.matchAll(/\bconst\s+LOYALTY_NAVIGATION\s*=\s*\[([\s\S]*?)\];/g)];
assert.equal(matches.length, 1, 'There must be exactly one Loyalty E registry');

const kinds = [...matches[0][1].matchAll(/\bid:\s*'([^']+)'/g)].map(match => match[1]);
assert.ok(kinds.length > 0, 'Loyalty E registry is empty');
assert.equal(new Set(kinds).size, kinds.length, 'Duplicate Loyalty E identifiers');
for (const kind of kinds) assert.match(kind, /^[a-z][a-z0-9-]*$/, 'Invalid Loyalty E identifier');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const filename = join(dir, entry.name);
    return entry.isDirectory() ? walk(filename) : filename.endsWith('.js') ? [filename] : [];
  });
}

for (const filename of [...walk('core/loyalty'), ...walk('core/people')]) {
  const pathname = relative('.', filename).replaceAll('\\', '/');
  if (pathname === canonical) continue;
  const source = read(filename);
  assert.doesNotMatch(source, /\b(?:const|let|var)\s+LOYALTY_(?:NAVIGATION|TYPES|KINDS)\s*=/,
    'Second Loyalty registry forbidden: ' + pathname);
  for (const array of source.matchAll(/\[[^\[\]]{1,4000}\]/gs)) {
    const copied = kinds.filter(kind => new RegExp("(?:\\bid\\s*:\\s*)?['\"]" + kind + "['\"]").test(array[0]));
    assert.ok(copied.length < 2,
      'Copied Loyalty E list in ' + pathname + ': ' + copied.join(', '));
  }
}

const people = read('core/people/programs.js');
const assignment = read('core/loyalty/person-program-actions.js');
assert.match(people, /loyaltyNavigationItems\(\)\.map\(\(\{\s*id\s*\}\)\s*=>\s*id\)/,
  'Contacts must derive available E types from the Loyalty registry');
assert.match(assignment, /loyaltyNavigationItems\(\)\.filter\(\(item\)\s*=>\s*item\.assignableToPerson\)/,
  'Program assignment must use the same Loyalty registry');

const BT = String.fromCharCode(96);
const dollar = String.fromCharCode(36);
assert.ok(assignment.includes('import(' + BT + './' + dollar + '{kind}/index.js' + BT + ')'),
  'Program assignment must load modules by type instead of using a second catalog');
for (const kind of kinds) {
  assert.ok(existsSync('core/loyalty/' + kind + '/index.js'),
    'Missing owning Loyalty module for ' + kind);
  assert.ok(people.includes("canSee('" + kind + "')"),
    'Contacts omit registered type ' + kind + ' from visibility');
  assert.ok(people.includes('data-person-program="' + kind + (kind === 'personal-account' ? '"' : ':')),
    'Contacts omit registered E card ' + kind);
  const detail = kind === 'personal-account'
    ? "[['personal-account'"
    : '[' + BT + kind + ':' + dollar + '{';
  assert.ok(people.includes(detail),
    'Contacts omit opening registered E ' + kind);
}
console.log('PASS: single Loyalty registry and Contacts coverage for every E');
