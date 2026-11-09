import { normalizeEntityCardAppearance, entityCardDefaultRows, hasConfiguredEntityCardAppearance, shortDate } from '../../../ui/ui.js';
import { getCardAppearanceTemplate } from '../../card-appearance-templates.js';

function money(value = 0) {
  return `${(Number(value) || 0).toLocaleString('ru-RU')} ₽`;
}


export function walletCardFields(wallet = {}, balance = 0) {
  return [
    { value: 'walletName', label: 'Наименование', text: String(wallet?.name || '') },
    { value: 'balance', label: 'Сумма', text: money(balance) },
  ];
}

export function walletCardAppearance(wallet = {}) {
  if (hasConfiguredEntityCardAppearance(wallet?.cardAppearance)) {
    return normalizeEntityCardAppearance(wallet.cardAppearance);
  }
  const template = getCardAppearanceTemplate('wallet');
  if (hasConfiguredEntityCardAppearance(template?.appearance)) {
    return normalizeEntityCardAppearance(template.appearance);
  }
  return normalizeEntityCardAppearance({
    lines: entityCardDefaultRows([
      { row: 7, field: 'walletName', column:'left', align: 'left', size: 'l', bold: true },
      { row: 9, field: 'balance', column:'right', align: 'right', size: 'm', bold: true },
    ]),
  });
}

export function walletCardPhoto(wallet = {}) {
  return String(wallet?.photo || getCardAppearanceTemplate('wallet')?.photo || '');
}


export function cashEntityCardFields(entity = {}, balance = 0, kind = '', dueDate = '', investment = null) {
  const fields = [
    { value: 'entityName', label: 'Наименование', text: String(entity?.name || '') },
  ];
  if (kind === 'loan' && dueDate) {
    fields.push({ value: 'dueDate', label: 'Срок', text: shortDate(dueDate, '') });
  }
  if (kind === 'investment') {
    fields.push({ value: 'investmentRole', label: 'Роль', text: String(investment?.roleLabel || '') });
    fields.push({
      value: 'balance',
      label: investment?.balanceLabel || 'Результат',
      text: money(investment?.balanceValue ?? balance),
    });
    return fields;
  }
  fields.push({ value: 'balance', label: kind === 'loan' ? 'К возврату' : 'Остаток', text: money(balance) });
  return fields;
}

export function cashEntityCardAppearance(entity = {}, kind = '') {
  if (hasConfiguredEntityCardAppearance(entity?.cardAppearance)) {
    return normalizeEntityCardAppearance(entity.cardAppearance);
  }
  const template = getCardAppearanceTemplate(kind === 'loan' ? 'loan' : 'investment');
  if (hasConfiguredEntityCardAppearance(template?.appearance)) {
    return normalizeEntityCardAppearance(template.appearance);
  }
  return normalizeEntityCardAppearance({
    lines: entityCardDefaultRows([
      { row: 7, field: 'entityName', column:'left', align: 'left', size: 'l', bold: true },
      { row: 8, field: kind === 'loan' ? 'dueDate' : kind === 'investment' ? 'investmentRole' : '', column:'left', align: 'left', size: 'm' },
      { row: 9, field: 'balance', column:'right', align: 'right', size: 'm', bold: true },
    ]),
  });
}

export function cashEntityCardPhoto(entity = {}, kind = '') {
  const scope = kind === 'loan' ? 'loan' : 'investment';
  return String(entity?.photo || getCardAppearanceTemplate(scope)?.photo || '');
}
