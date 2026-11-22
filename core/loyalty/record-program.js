import { getDepositInstances, isActiveDepositAssignment } from './deposit/data.js';

const text = (value) => String(value ?? '').trim();
const percent = (value) => Math.max(0, Math.min(100, Number(value) || 0));

function personKeyOf(personOrKey = '') {
  if (personOrKey && typeof personOrKey === 'object') {
    return text(personOrKey.key || personOrKey.id);
  }
  return text(personOrKey);
}

function option({ type, typeLabel, assignmentId = '', programId = '', name = '', pricePercent = 0, balance = null } = {}) {
  const normalizedType = text(type);
  const normalizedAssignmentId = text(assignmentId);
  const normalizedProgramId = text(programId);
  const stableId = normalizedAssignmentId || normalizedProgramId;
  if (!normalizedType || !stableId) return null;
  return {
    key: `${normalizedType}:${stableId}`,
    type: normalizedType,
    typeLabel: text(typeLabel) || 'Программа',
    assignmentId: normalizedAssignmentId,
    programId: normalizedProgramId,
    name: text(name) || 'Программа',
    pricePercent: percent(pricePercent),
    balance: balance == null ? null : Math.max(0, Number(balance) || 0),
  };
}

function depositOptions(personKey,at=new Date()) {
  return getDepositInstances()
    .filter((deposit) => personKeyOf(deposit?.person) === personKey && isActiveDepositAssignment(deposit,at))
    .map((deposit) => option({
      type: 'deposit',
      typeLabel: 'Депозит',
      assignmentId: deposit?.depositId || deposit?.id,
      programId: deposit?.programId,
      name: deposit?.programName || 'Депозит',
      pricePercent: deposit?.terms?.benefitType==='discount' ? Number(deposit?.terms?.benefitValue||0) : 0,
      balance: deposit?.balance ?? 0,
    }))
    .filter(Boolean);
}

export function getRecordProgramOptions(personOrKey = '', at = new Date()) {
  const personKey = personKeyOf(personOrKey);
  if (!personKey) return [];
  // Only server-backed deposit instances are eligible at this stage.
  // Certificate, subscription, referral and bonus are not implemented yet;
  // their demo data must never create a Record discount.
  const values = depositOptions(personKey,at);
  const seen = new Set();
  return values.filter((item) => {
    if (!item?.key || seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

export function recordProgramSelection(optionValue = null) {
  if (!optionValue?.key || !optionValue?.type) return null;
  return {
    key: text(optionValue.key),
    type: text(optionValue.type),
    assignmentId: text(optionValue.assignmentId),
    programId: text(optionValue.programId),
    name: text(optionValue.name),
    pricePercent: percent(optionValue.pricePercent),
  };
}

export function getSelectedRecordProgram(record = null) {
  const stored = record?.loyaltyProgram && typeof record.loyaltyProgram === 'object'
    ? record.loyaltyProgram
    : null;
  if (!stored) return null;
  const personKey = personKeyOf(record?.person);
  const options = getRecordProgramOptions(personKey);
  const storedKey = text(stored.key);
  if (storedKey) return options.find((item) => item.key === storedKey) || { ...stored, pricePercent: percent(stored.pricePercent) };
  const storedType = text(stored.type);
  const storedAssignment = text(stored.assignmentId);
  const storedProgram = text(stored.programId);
  return options.find((item) => item.type === storedType
    && ((storedAssignment && item.assignmentId === storedAssignment)
      || (!storedAssignment && storedProgram && item.programId === storedProgram)))
    || { ...stored, pricePercent: percent(stored.pricePercent) };
}

export function selectedRecordProgramPricePercent(record = null) {
  const stored = record?.loyaltyProgram && typeof record.loyaltyProgram === 'object'
    ? record.loyaltyProgram
    : null;
  return percent(stored?.pricePercent);
}

export function selectedRecordDepositId(record = null) {
  const stored = record?.loyaltyProgram && typeof record.loyaltyProgram === 'object'
    ? record.loyaltyProgram
    : null;
  return text(stored?.type) === 'deposit' ? text(stored?.assignmentId) : '';
}
