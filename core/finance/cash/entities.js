import { queueAuxiliaryDataset } from '../../business-persistence.js';

let investmentsState = [];
let loansState = [];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function active(values = []) {
  return (Array.isArray(values) ? values : [])
    .filter((item) => !item?.deletedAt)
    .map((item) => ({ ...item }));
}

function writeInvestmentEntities(value) {
  investmentsState = Array.isArray(value) ? clone(value) : [];
  void queueAuxiliaryDataset('investments', investmentsState);
}

function writeLoanEntities(value) {
  loansState = Array.isArray(value) ? clone(value) : [];
  void queueAuxiliaryDataset('loans', loansState);
}

export function hydrateCashEntitiesFromServer({ investments = [], loans = [] } = {}) {
  investmentsState = Array.isArray(investments) ? clone(investments) : [];
  loansState = Array.isArray(loans) ? clone(loans) : [];
  return {
    investments: active(investmentsState),
    loans: active(loansState),
  };
}

export function getInvestmentEntities() {
  return active(investmentsState);
}

export function getLoanEntities() {
  return active(loansState);
}

function save(values, write, entity = {}) {
  const id = String(entity?.id || '').trim();
  if (!id) return null;
  const current = Array.isArray(values) ? values : [];
  const exists = current.some((item) => String(item?.id || '') === id);
  const next = exists
    ? current.map((item) => String(item?.id || '') === id ? { ...item, ...entity, id } : item)
    : [...current, { ...entity, id }];
  write(next);
  return { ...entity, id };
}

export function saveInvestmentEntity(entity = {}) {
  return save(investmentsState, writeInvestmentEntities, entity);
}

export function saveLoanEntity(entity = {}) {
  return save(loansState, writeLoanEntities, entity);
}
