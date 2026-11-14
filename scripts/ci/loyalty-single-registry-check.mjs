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
assert.doesNotMatch(owner, /const\s+LOYALTY_CAPABILITIES\s*=/,
  'Capability information belongs to the single E registry, not a duplicate type list');

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
assert.match(people, /collectPersonLoyaltyCards\(person, \{ refresh \}\)/,
  'Contacts must derive Loyalty E cards from the canonical registry');
assert.doesNotMatch(people, /canSee\('[a-z-]+'\)|function (?:deposit|certificate|subscription|referral|bonus)Card\(/,
  'Contacts must not own Loyalty E card renderers');
assert.match(owner, /loyaltyNavigationItems\(\)\.map\(async \(\{ id \}\)/,
  'The canonical E registry must drive Person card discovery');
assert.match(assignment, /loyaltyNavigationItems\(\)\.filter\(\(item\)\s*=>\s*item\.assignableToPerson\)/,
  'Program assignment must derive types from the canonical registry');
for (const kind of kinds) {
  const pathname = 'core/loyalty/' + kind + '/index.js';
  assert.ok(existsSync(pathname), 'Registered E missing owner: ' + kind);
  const module = read(pathname);
  assert.match(module, /export function getPersonLoyaltyCards\(/,
    'Registered E missing Person card interface: ' + kind);
  assert.match(module, /export \{ render[A-Za-z]+ as render \};/,
    'Registered E missing its Loyalty screen entrypoint: ' + kind);
}
console.log('PASS: single Loyalty E registry, all Person cards owned by E modules');
