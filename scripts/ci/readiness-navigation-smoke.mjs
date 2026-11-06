import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync('professional/workspace.js', 'utf8');
const section = source.match(/function sectionAllowed\(section\) \{[\s\S]*?\n\}/)?.[0];
const fallback = source.match(/function defaultSection\(\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(section, 'Professional must expose the authoritative section gate');
assert.ok(fallback, 'Professional must have a guarded initial section');

const enabled = new Set();
const ctx = {
  canUseCapability: (key) => enabled.has(key),
  rootDefinition: (id) => {
    const known = {
      journal: { id: 'journal', capability: '' },
      profile: { id: 'profile', capability: '' },
      service: { id: 'service', capability: 'services.access' },
    };
    return known[id] || null;
  },
  secondaryItems: () => [],
  ROOT_SECTIONS: [
    {id:'journal'}, {id:'profile'}, {id:'service'},
  ],
};
const sectionAllowed = runInNewContext(section + '\nsectionAllowed', ctx);
ctx.sectionAllowed = sectionAllowed;
const allowedSections = () => ctx.ROOT_SECTIONS.filter(item => sectionAllowed(item.id)).map(item=>item.id);
ctx.allowedSections = allowedSections;
const defaultSection = runInNewContext(fallback + '\ndefaultSection', ctx);

assert.equal(sectionAllowed('journal'), false, 'journal cannot bypass readiness via empty root entitlement');
assert.equal(sectionAllowed('profile'), false, 'profile cannot bypass NOT_READY');
assert.equal(sectionAllowed('service'), false, 'service must obey readiness');
assert.equal(defaultSection(), '', 'no denied Settings fallback when all tools are hidden');
enabled.add('journal.month.access');
assert.equal(sectionAllowed('journal'), true, 'approved month makes Journal visible');
assert.equal(defaultSection(), 'journal', 'approved Journal is default');
enabled.clear();
enabled.add('profile.access');
assert.equal(sectionAllowed('profile'), true, 'approved Profile is visible');
enabled.clear();
enabled.add('journal.list.access');
assert.equal(sectionAllowed('journal'), true, 'approved list makes Journal visible');
enabled.clear();
enabled.add('services.access');
assert.equal(sectionAllowed('service'), true, 'approved Service makes its root visible');
assert.equal(sectionAllowed('journal'), false);
assert.match(source, /if \(!allowedSections\(\)\.length\) \{/,
  'empty available toolset must show an empty state, not render a hidden tool');
console.log('Professional root readiness navigation PASS');
