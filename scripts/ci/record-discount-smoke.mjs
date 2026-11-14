import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (file) => readFileSync(file, 'utf8');
const strip = (source) => source
  .replace(/^import\s+[\s\S]*?\sfrom\s+['"][^'"]+['"];\s*/gm, '')
  .replace(/^export\s+/gm, '');
const price = runInNewContext(strip(read('core/loyalty/price-condition.js'))
  + '\n({ resolvePersonPriceCondition, personalPricePercentSource })');
const rules = runInNewContext(strip(read('core/finance/rules.js'))
  + '\n({ calculateSettlement, calculateSettlementTotals, calculateSettlementItemTotals,'
  + ' calculateSettlementPaymentState, clampFinancialPercent, financialNumber,'
  + ' normalizeStoredSettlement, recordSettlementItems })');

const person = { key: 'person-1', discountPercent: 0 };
let active = false;
let stored = null;
let recordedPayments = [];
const getPersonPriceCondition = () => price.resolvePersonPriceCondition(person, active ? [{
  type: 'program', programType: 'deposit', depositId: 'issued-1',
  programId: 'program-1', name: 'Зима 2025', percent: 20,
}] : []);
const settlement = runInNewContext(strip(read('core/finance/settlement.js'))
  + '\n({ recordSettlementPriceCondition, resolveRecordSettlement, getRecordPaymentState })', {
  getStoredSettlement: () => stored,
  getActiveDDSMovements: () => recordedPayments,
  getActiveDDSMovementsForSource: () => recordedPayments,
  personalPricePercentSource: price.personalPricePercentSource,
  resolvePersonPriceCondition: price.resolvePersonPriceCondition,
  getAllPeople: () => [person],
  getPersonPriceCondition,
  ...rules,
});
const record = {
  id: 'record-1', person: { key: 'person-1' },
  procedures: [{ id: 'procedure-1', name: 'Услуга', cost: 50000 }],
};
const scenario = ({ programPercent = 0, manualPercent = 0, paid = false }) => {
  active = programPercent > 0;
  person.discountPercent = manualPercent;
  stored = paid ? rules.calculateSettlement([
    { sourceType: 'procedure', sourceId: 'procedure-1', price: 50000 },
  ], { pricePercent: 0 }) : null;
  recordedPayments = paid ? [{ id: 'payment-1', amount: 50000 }] : [];
  return settlement.resolveRecordSettlement(record);
};

let calc = scenario({ programPercent: 20 });
assert.equal(calc.planTotal, 40000, 'Assigned deposit 20% automatically reduces due');
assert.equal(calc.items[0].pricePercent, 20, 'Program discount is applied without selecting a Record program');
assert.equal(calc.items[0].correctionMode, 'none', 'Program does not stack with manual correction');
assert.equal(person.discountPercent, 0, 'Program does not copy a second percentage to Person');

const procedure = runInNewContext(strip(read('core/payment/procedure-adjustment.js'))
  + '\ngetRecordProcedurePaymentAdjustment', {
  getRecord: () => record, getRecordPaymentState: settlement.getRecordPaymentState,
  resolveRecordSettlement: settlement.resolveRecordSettlement,
});
let adjustment = procedure(record, 'procedure-1');
assert.equal(adjustment.programDiscount, true, 'Assigned program locks price editor discount');
assert.equal(adjustment.discountPercent, 20);

calc = scenario({ manualPercent: 12 });
adjustment = procedure(record, 'procedure-1');
assert.equal(calc.planTotal, 44000, 'Manual 12% is suggested to the price');
assert.equal(adjustment.programDiscount, false, 'Manual discount stays editable');
assert.equal(adjustment.discountPercent, 12);

calc = scenario({});
assert.equal(calc.planTotal, 50000, 'No valid discount is applied after expiry');

active = true;
const selected = {
  ...record, loyaltyProgram: {
    type: 'deposit', key: 'deposit:issued-1', assignmentId: 'issued-1',
    programId: 'program-1', name: 'Зима 2025', pricePercent: 20,
  },
};
assert.equal(settlement.resolveRecordSettlement(selected).planTotal, 40000,
  'Selected active deposit applies locked program percent');
active = false;
assert.equal(settlement.resolveRecordSettlement(selected).planTotal, 50000,
  'Expired selected deposit no longer locks 20%');
active = true;
const unknown = { ...selected, loyaltyProgram: { ...selected.loyaltyProgram, assignmentId: 'other',
  programId: 'other-program' } };
assert.equal(settlement.resolveRecordSettlement(unknown).planTotal, 50000,
  'Unknown selected deposit cannot borrow another discount');

calc = scenario({ programPercent: 20, paid: true });
assert.equal(calc.planTotal, 50000,
  'Historical paid settlement must never be repriced by a newly assigned program');
assert.equal(calc.pricePercent, 0, 'Recorded paid discount remains historical');

const recordView = read('core/records/view.js');
const creation = read('core/people/record-creation.js');
const editor = read('core/records/records.js');
const payment = read('core/payment/record-payment.js');
const entryStart = payment.indexOf('async function openPaymentEntry(');
const fetchIndex = payment.indexOf('await listPersonDeposits(key)', entryStart);
const priceIndex = payment.indexOf('settlement = settlementForRecord(verifiedRecord)', entryStart);
assert.ok(fetchIndex > entryStart && priceIndex > fetchIndex,
  'Payment must fetch current deposit conditions before calculating due');
assert.match(payment, /Не удалось проверить условия оплаты/,
  'A failed deposit check blocks incorrect payment');
assert.match(payment, /const checkedSettlement = settlementForRecord\(checkedRecord\)/,
  'Payment must recheck current settlement before committing');
assert.match(payment, /if \(changed\) throw new Error\('Скидка или сумма оплаты изменилась/,
  'A changed program or due must reject stale payment');
assert.match(recordView, /void listPersonDeposits\(personKey\)\.then/,
  'Record view refreshes current program conditions');
assert.match(creation, /loadRecordCreationOperationalState\(\), listPersonDeposits\(person\.key\)/,
  'Contact-created Record preloads active program');
assert.match(editor, /export async function openProcedureAdjustment/,
  'Price editor must verify the program before opening');
assert.match(editor, /await listPersonDeposits\(personKey\)/,
  'Price editor cannot use unverified cache');
assert.match(editor, /disabled: adjustment\.programDiscount/,
  'Program discount percent stays disabled in price editor');
assert.match(editor, /getPersonPriceCondition\(contact\)/,
  'Record confirmation shows effective discount rather than the manual field only');
console.log('Record discount: automatic program, manual edit, expiry, paid history and payment gates PASS');
