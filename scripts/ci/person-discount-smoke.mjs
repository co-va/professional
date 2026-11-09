import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (path) => readFileSync(path, 'utf8');
const stripImports = (source) => source
  .replace(/^import\s+[\s\S]*?\sfrom\s+['"][^'"]+['"];\s*/gm, '')
  .replace(/^export\s+/gm, '');

const price = runInNewContext(stripImports(read('core/loyalty/price-condition.js'))
  + '\n({ resolvePersonPriceCondition, describePriceConditionConflict })');
const deposits = runInNewContext(stripImports(read('core/loyalty/deposit/data.js'))
  + '\n({ hydrateDepositInstances, getPersonDepositPriceConditions })', {
  resolvePersonPriceCondition: price.resolvePersonPriceCondition,
  describePriceConditionConflict: price.describePriceConditionConflict,
});
const condition = runInNewContext(stripImports(read('core/people/data.js'))
  + '\ngetPersonPriceCondition', {
  resolvePersonPriceCondition: price.resolvePersonPriceCondition,
  getPersonDepositPriceConditions: deposits.getPersonDepositPriceConditions,
});
const person = { key: 'client', name: 'Алекс', surname: 'Тест', discountPercent: 0 };
const activeDeposit = {
  depositId: 'deposit-1', programId: 'program-1', programName: 'Зима',
  person: { key: person.key }, status: 'active', discountPercent: 20,
  terms: { termMode: 'dated', termStartDate: '2020-01-01', termEndDate: '2099-12-31' },
};
deposits.hydrateDepositInstances([activeDeposit]);
let effective = condition(person);
assert.equal(effective.percent, 20, 'Active deposit grants 20%');
assert.equal(effective.source?.type, 'program', 'Discount belongs to the deposit');
assert.equal(effective.conflict, false, 'Single program does not conflict');
assert.equal(person.discountPercent, 0, 'Program discount never becomes personal percent');
assert.equal(condition({ ...person, discountPercent: 20 }).conflict, true,
  'An extra manual discount would conflict and must not be written');

const card = runInNewContext(stripImports(read('core/people/card-presentation.js'))
  + '\npersonCardFields', {
  getPersonPriceCondition: condition,
  getPersonMetadata: () => ({}),
  telegramDisplay: () => '',
});
assert.equal(card(person).find((item) => item.value === 'discount')?.text, '20%',
  'Client card shows the effective program discount');

const peopleSource = read('core/people/people.js');
function sourceBetween(start, end) {
  const from = peopleSource.indexOf(start);
  const to = peopleSource.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'Missing People source function ' + start);
  return peopleSource.slice(from, to);
}

let capturedDiscount = null;
const blank = () => '';
const personFields = runInNewContext(sourceBetween(
  'function personDataFields(', 'function formSnapshot(') + '\npersonDataFields', {
  getPersonPriceCondition: condition,
  uei: blank, ueiData: blank, v2Section: (_title, body) => body,
  field: (options) => {
    if (options.name === 'discountPercent') capturedDiscount = options;
    return '';
  },
  select: blank, monthDayPicker: blank, repeatedField: blank,
  businessEntries: blank, telegramEntries: blank, links: blank, tags: blank, getTags: blank,
});
personFields(person, [person]);
assert.equal(capturedDiscount?.value, 20, 'Edit form shows 20 from the program');
assert.equal(capturedDiscount?.disabled, true, 'Program discount cannot be manually edited');

const discountInput = { value: '20', disabled: true };
const fields = {
  name: { value: 'Алекс' }, surname: { value: 'Тест' },
  gender: { value: '' }, birthDate: { value: '' }, discountPercent: discountInput,
};
const root = {
  querySelector: (selector) => fields[selector.match(/name="([^"]+)"/)?.[1]] || null,
};
let saves = 0;
const save = runInNewContext(sourceBetween('function savePersonData(', 'function deletePersonByKey(')
  + '\nsavePersonData', {
  getAllPeople: () => [person], getMembers: () => [],
  getPersonPriceCondition: condition,
  saveBusinessEntries: () => {}, collectRepeatedEntries: () => [],
  collectLinks: () => [], collectTags: () => [],
  savePeople: () => { saves += 1; },
});
save(root, 'client');
assert.equal(saves, 1, 'Other fields can still be saved');
assert.equal(person.discountPercent, 0, 'Saving does not duplicate the program percentage');
discountInput.disabled = false;
assert.throws(() => save(root, 'client'), /Условия скидки изменились/,
  'A program discount cannot be manually overridden');

const expired = {
  ...activeDeposit, terms: {
    termMode: 'dated', termStartDate: '2000-01-01', termEndDate: '2000-12-31',
  },
};
deposits.hydrateDepositInstances([expired]);
effective = condition(person);
assert.equal(effective.percent, 0, 'Expired deposit no longer grants a discount');
assert.equal(effective.source, null);
capturedDiscount = null;
personFields(person, [person]);
assert.equal(capturedDiscount?.value, '', 'After expiry the input is blank');
assert.equal(capturedDiscount?.disabled, false, 'After expiry manual editing is enabled');
discountInput.value = '12';
save(root, 'client');
assert.equal(person.discountPercent, 12, 'Independent discount can be edited after expiry');

assert.match(peopleSource, /void listPersonDeposits\(key\)\.then/,
  'Edit Q must verify the active program against the server');
assert.match(peopleSource, /action\.disabled = saving \|\| !discountVerified/,
  'Save must remain locked until discount conditions are verified');
assert.match(peopleSource, /if \(saving \|\| !discountVerified \|\| !isDirty\(\)\) return;/,
  'Unverified discounts must not be saved');
console.log('Person discount: active 20%, locked, no duplication, expiry, card and server check PASS');
