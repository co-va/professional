import { normalizeEntityCardAppearance, remapEntityCardAppearanceFields, entityCardDefaultRows, hasConfiguredEntityCardAppearance } from '../../../ui/ui.js';
import { getCardAppearanceTemplate } from '../../card-appearance-templates.js';

const SCOPE = 'loyalty-deposit';


function moneyValue(value) {
  if (value === null || value === undefined || value === '') return '';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
    .format(Math.max(0, amount)).replaceAll('\u00a0', ' ') + ' ₽';
}

// Only payments consume a deposit for services. Returns and benefit accruals
// do not count as spending; a payment reversal reduces the net spent amount.
export function depositSpentAmount(deposit = {}) {
  if (!Array.isArray(deposit?.history)) return null;
  const spent = deposit.history.reduce((sum, entry) => {
    if (entry?.kind !== 'payment') return sum;
    const amount = Number(entry?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return sum;
    const direction = String(entry?.direction || '').toUpperCase();
    return direction === 'OUT' ? sum + amount : direction === 'IN' ? sum - amount : sum;
  }, 0);
  return Math.max(0, spent);
}

export function depositCardScope() {
  return SCOPE;
}

export function depositCardAppearance() {
  const template = getCardAppearanceTemplate(SCOPE);
  if (hasConfiguredEntityCardAppearance(template?.appearance)) return remapEntityCardAppearanceFields(template.appearance, {metaLeft:'benefit',metaRight:'nominal'});
  return normalizeEntityCardAppearance({
    lines: entityCardDefaultRows([
      { row: 1, field: 'uei', bold: true },
      { row: 2, field: 'status', column:'right', align: 'right' },
      { row: 6, field: 'title', size: 'xl', bold: true },
      { row: 7, field: 'subtitle' },
      { row: 8, field: 'benefit', column:'left' },
      { row: 9, field: 'nominal', column:'right', align: 'right' },
    ]),
  });
}

export function depositCardPhoto() {
  return String(getCardAppearanceTemplate(SCOPE)?.photo || '');
}

export function depositCardPhotoPosition() {
  return String(getCardAppearanceTemplate(SCOPE)?.photoPosition || '50% 50%');
}

// One status label for the Deposit program and its assigned Person card.
// Rendering still reflects each entity's actual status.
export function depositCardStatusLabel(status = '') {
  if (status === 'paused') return 'Приостановлена';
  if (status === 'closed' || status === 'ended') return 'Завершена';
  if (status === 'expired') return 'Срок завершён';
  return 'Активна';
}

export function depositCardFields({
  uei = '',
  title = 'Депозит',
  subtitle = 'Депозит',
  status = '',
  benefit = '',
  nominal = null,
  funded = null,
  spent = null,
  balance = null,
  toFund = null,
} = {}) {
  return [
    { value: 'uei', label: 'UEI программы', text: String(uei || '') },
    { value: 'title', label: 'Название программы', text: String(title || 'Депозит') },
    { value: 'subtitle', label: 'Срок действия', text: String(subtitle || 'Депозит') },
    { value: 'status', label: 'Статус', text: String(status || '') },
    { value: 'benefit', label: 'Условие выгоды', text: String(benefit || '') },
    { value: 'nominal', label: 'Номинал программы', text: moneyValue(nominal) },
    { value: 'funded', label: 'Внесено клиентом', text: moneyValue(funded) },
    { value: 'spent', label: 'Списано за услуги', text: moneyValue(spent) },
    { value: 'balance', label: 'Остаток депозита', text: moneyValue(balance) },
    { value: 'toFund', label: 'Осталось внести', text: moneyValue(toFund) },
  ];
}
