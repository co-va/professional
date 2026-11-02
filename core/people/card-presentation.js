import { normalizeEntityCardAppearance } from '../../ui/ui.js';
import { getCardAppearanceTemplate } from '../card-appearance-templates.js';
import { getPersonMetadata, formatPersonVisitDate } from './metadata.js';

function first(values = []) {
  return String(Array.isArray(values) ? (values[0] || '') : '');
}

function money(value) {
  return new Intl.NumberFormat('ru-RU').format(Math.max(0, Number(value) || 0)) + ' ₽';
}

function defaultLines(entries = []) {
  const lines = Array.from({ length: 9 }, () => ({
    field: '', zone: 'full', align: 'left', size: 'm', color: 'white',
    bold: false, italic: false, underline: false, uppercase: false,
  }));
  entries.forEach(({ row, field, zone = 'full', align = 'left', size = 'm', color = 'white', bold = false }) => {
    const index = Math.max(0, Math.min(8, Number(row) - 1));
    lines[index] = { ...lines[index], field, zone, align, size, color, bold };
  });
  return lines;
}

function hasConfiguredLines(value = {}) {
  return Array.isArray(value?.lines) && value.lines.some((line) => String(line?.field || '').trim());
}

export function personCardFields(person = {}) {
  const meta = person?.key ? getPersonMetadata(person.key) : { recordCount: 0, paidTotal: 0, lastVisit: '' };
  const fullName = [person.name, person.surname].filter(Boolean).join(' ');
  return [
    { value: 'uei', label: 'UEI', text: person.uei || '' },
    { value: 'name', label: 'Имя и фамилия', text: fullName },
    { value: 'firstName', label: 'Имя', text: person.name || '' },
    { value: 'surname', label: 'Фамилия', text: person.surname || '' },
    { value: 'phone', label: 'Телефон', text: first(person.phones) },
    { value: 'email', label: 'Email', text: first(person.emails) },
    { value: 'telegram', label: 'Telegram', text: first(person.telegrams) },
    { value: 'birthDate', label: 'Дата рождения', text: person.birthDate || '' },
    { value: 'discount', label: 'Скидка', text: person.discountPercent ? `${Number(person.discountPercent)}%` : '' },
    { value: 'recordCount', label: 'Количество записей', text: String(meta.recordCount || 0) },
    { value: 'paidTotal', label: 'Сумма оплат', text: money(meta.paidTotal) },
    { value: 'lastVisit', label: 'Последнее посещение', text: meta.lastVisit ? formatPersonVisitDate(meta.lastVisit) : '' },
  ];
}

export function personCardAppearance() {
  const template = getCardAppearanceTemplate('person');
  if (hasConfiguredLines(template?.appearance)) return normalizeEntityCardAppearance(template.appearance);
  return normalizeEntityCardAppearance({
    lines: defaultLines([
      { row: 1, field: 'uei', bold: true },
      { row: 7, field: 'name', size: 'l', bold: true },
      { row: 8, field: 'phone' },
      { row: 9, field: 'lastVisit' },
    ]),
  });
}
