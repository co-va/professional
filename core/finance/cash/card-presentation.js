import { normalizeEntityCardAppearance, shortDate } from '../../../ui/ui.js';
import { getCardAppearanceTemplate } from '../../card-appearance-templates.js';

function money(value = 0) {
  return `${(Number(value) || 0).toLocaleString('ru-RU')} ₽`;
}

function defaultLines(entries = []) {
  const lines = Array.from({ length: 9 }, () => ({
    field: '',
    zone: 'full',
    align: 'left',
    size: 'm',
    color: 'white',
    bold: false,
    italic: false,
    underline: false,
    uppercase: false,
  }));
  entries.forEach(({ row, field, zone = 'full', align = 'left', size = 'm', color = 'white', bold = false }) => {
    const index = Math.max(0, Math.min(8, Number(row) - 1));
    lines[index] = { field, zone, align, size, color, bold, italic: false, underline: false, uppercase: false };
  });
  return lines;
}

function hasConfiguredLines(value = {}) {
  return Array.isArray(value?.lines) && value.lines.some((line) => String(line?.field || '').trim());
}

export function walletCardFields(wallet = {}, balance = 0) {
  return [
    { value: 'walletName', label: 'Наименование', text: String(wallet?.name || '') },
    { value: 'balance', label: 'Сумма', text: money(balance) },
  ];
}

export function walletCardAppearance(wallet = {}) {
  if (hasConfiguredLines(wallet?.cardAppearance)) {
    return normalizeEntityCardAppearance(wallet.cardAppearance);
  }
  const template = getCardAppearanceTemplate('wallet');
  if (hasConfiguredLines(template?.appearance)) {
    return normalizeEntityCardAppearance(template.appearance);
  }
  return normalizeEntityCardAppearance({
    lines: defaultLines([
      { row: 7, field: 'walletName', zone: 'full', align: 'left', size: 'l', bold: true },
      { row: 9, field: 'balance', zone: 'right', align: 'right', size: 'm', bold: true },
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
  if (hasConfiguredLines(entity?.cardAppearance)) {
    return normalizeEntityCardAppearance(entity.cardAppearance);
  }
  const template = getCardAppearanceTemplate(kind === 'loan' ? 'loan' : 'investment');
  if (hasConfiguredLines(template?.appearance)) {
    return normalizeEntityCardAppearance(template.appearance);
  }
  return normalizeEntityCardAppearance({
    lines: defaultLines([
      { row: 7, field: 'entityName', zone: 'full', align: 'left', size: 'l', bold: true },
      { row: 8, field: kind === 'loan' ? 'dueDate' : kind === 'investment' ? 'investmentRole' : '', zone: 'left', align: 'left', size: 'm' },
      { row: 9, field: 'balance', zone: 'right', align: 'right', size: 'm', bold: true },
    ]),
  });
}

export function cashEntityCardPhoto(entity = {}, kind = '') {
  const scope = kind === 'loan' ? 'loan' : 'investment';
  return String(entity?.photo || getCardAppearanceTemplate(scope)?.photo || '');
}
