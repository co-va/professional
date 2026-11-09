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

assert.match(source, /if \(!workspaceReady \|\| !sectionAllowed\('chat'\)\) return;/,
  'Record-to-Chat action must not bypass a NOT_READY Chat instrument');


// Person Z2 must inherit the Finance and Loyalty tool gates. A saved finance
// relationship is not proof that its tool is READY/TESTING for this user.
const peoplePrograms = readFileSync('core/people/programs.js', 'utf8');
const personFinanceSource = peoplePrograms.match(/function personFinanceEntities\(person = \{\}\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(personFinanceSource, 'Z2 must explicitly gate finance relationships');
const financeEnabled = new Set();
const financePerson = runInNewContext(personFinanceSource + '\npersonFinanceEntities', {
  canUseCapability: (key) => financeEnabled.has(key),
  getInvestmentEntities: () => [
    { id: 'self', personKey: 'person-1', investmentTerms: { role: 'self' } },
    { id: 'raise', personKey: 'person-1', investmentTerms: { role: 'raise' } },
    { id: 'external', personKey: 'person-1', investmentTerms: { role: 'external' } },
  ],
  getLoanEntities: () => [{ id: 'loan', personKey: 'person-1' }],
  normalizeInvestmentTerms: (entity) => entity.investmentTerms || {},
  text: (value) => String(value ?? '').trim(),
});
const person = { key: 'person-1', accounts: [] };
let financeCards = financePerson(person);
assert.equal(financeCards.investments.length, 0, 'NOT_READY Investments hidden in Z2');
assert.equal(financeCards.loans.length, 0, 'NOT_READY Loans hidden in Z2');
financeEnabled.add('finance.cash.access');
financeCards = financePerson(person);
assert.equal(financeCards.investments.length + financeCards.loans.length, 0,
  'READY wallets do not imply access to Investment or Loan cards');
financeEnabled.add('finance.special.access');
financeCards = financePerson(person);
assert.equal(financeCards.loans.length, 1, 'Ready Loan visible in Z2');
assert.equal(financeCards.investments.length, 0, 'Loan readiness never exposes Investments');
financeEnabled.delete('finance.special.access');
financeEnabled.add('finance.investment.raise.access');
financeCards = financePerson(person);
assert.equal(financeCards.investments.length, 1, 'Only the authorized investment role is visible');
assert.equal(financeCards.investments[0].id, 'raise');
assert.equal(financeCards.loans.length, 0, 'Investment readiness never exposes Loans');
assert.match(peoplePrograms, /collectPersonLoyaltyCards\(person, \{ refresh \}\)/,
  'Tester Personal Account uses the existing Loyalty readiness without an extra gate');
console.log('Person Z2 finance/readiness isolation and tester Personal Account PASS');


// Assignment actions are not identical to visible Loyalty E-cards. The
// automatic Personal Account is visible in Loyalty and Person Z2, but cannot
// be manually assigned again through the "Choose program" action.
const loyaltySource = readFileSync('core/loyalty/index.js', 'utf8');
const assignSource = readFileSync('core/loyalty/person-program-actions.js', 'utf8');
const personalAccountSource = readFileSync('core/loyalty/personal-account/index.js', 'utf8');
const extract = (text, expression, description) => {
  const match = text.match(expression)?.[0];
  assert.ok(match, description);
  return match.replace(/^export /, '');
};
const registrySource = extract(loyaltySource, /const LOYALTY_NAVIGATION = \[[\s\S]*?\];/, 'Loyalty E registry');
const navSource = extract(loyaltySource, /export function loyaltyNavigationItems\(\) \{[\s\S]*?\n\}/, 'Loyalty E navigation');
const typesSource = extract(assignSource, /export function personProgramActionTypes\(\) \{[\s\S]*?\n\}/, 'Person assignment selection');
const loyaltyEnabled = new Set(['loyalty.deposit.access', 'loyalty.personal_account.access']);
const assignment = runInNewContext(
  [registrySource, navSource, typesSource,
    '({ loyaltyNavigationItems, personProgramActionTypes })'].join('\n'),
  { canUseCapability: (key) => loyaltyEnabled.has(key) },
);
assert.ok(assignment.loyaltyNavigationItems().some((item) => item.id === 'personal-account'),
  'Personal Account stays in Loyalty E when TESTING is authorized');
assert.equal(assignment.personProgramActionTypes().map((item) => item.id).join(','), 'deposit',
  'Only Deposit is offered for manual assignment with current enabled E');
loyaltyEnabled.add('loyalty.certificate.access');
assert.equal(assignment.personProgramActionTypes().map((item) => item.id).join(','), 'deposit,certificate',
  'New assignable Loyalty E is automatically included');
loyaltyEnabled.clear();
loyaltyEnabled.add('loyalty.personal_account.access');
assert.equal(assignment.personProgramActionTypes().length, 0,
  'Automatic Personal Account alone cannot be manually assigned');
assert.match(personalAccountSource, /export async function openPersonalAccountForPerson\(/,
  'Existing Personal Account still opens from Person Z2');
assert.doesNotMatch(personalAccountSource, /export async function getPersonProgramChoices\(/,
  'Automatic Personal Account must not export a manual assignment workflow');
console.log('Person assignment: automatic Personal Account excluded, Loyalty remains accessible PASS');
