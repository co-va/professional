import { normalizeEntityCardAppearance, entityCardDefaultRows, hasConfiguredEntityCardAppearance } from '../../ui/ui.js';
import { getCardAppearanceTemplate } from '../card-appearance-templates.js';
import { getPersonMetadata, formatPersonVisitDate } from './metadata.js';
import { telegramDisplay } from './telegram-usernames.js';
import { getPersonPriceCondition } from './data.js';

function first(values = []) {
  return String(Array.isArray(values) ? (values[0] || '') : '');
}

function money(value) {
  return new Intl.NumberFormat('ru-RU').format(Math.max(0, Number(value) || 0)) + ' ₽';
}


export function personCardFields(person = {}) {
  const meta = person?.key ? getPersonMetadata(person.key) : { recordCount: 0, paidTotal: 0, lastVisit: '' };
  const fullName = [person.name, person.surname].filter(Boolean).join(' ');
  const discount = getPersonPriceCondition(person);
  return [
    { value: 'uei', label: 'UEI', text: person.uei || '' },
    { value: 'name', label: 'Имя и фамилия', text: fullName },
    { value: 'firstName', label: 'Имя', text: person.name || '' },
    { value: 'surname', label: 'Фамилия', text: person.surname || '' },
    { value: 'phone', label: 'Телефон', text: first(person.phones) },
    { value: 'email', label: 'Email', text: first(person.emails) },
    { value: 'telegram', label: 'Telegram', text: telegramDisplay(first(person.telegrams)) },
    { value: 'birthDate', label: 'Дата рождения', text: person.birthDate || '' },
    { value: 'discount', label: 'Скидка', text: discount.source && !discount.conflict ? `${discount.percent}%` : '' },
    { value: 'recordCount', label: 'Количество записей', text: String(meta.recordCount || 0) },
    { value: 'paidTotal', label: 'Сумма оплат', text: money(meta.paidTotal) },
    { value: 'lastVisit', label: 'Последнее посещение', text: meta.lastVisit ? formatPersonVisitDate(meta.lastVisit) : '' },
  ];
}

export function personCardAppearance() {
  const template = getCardAppearanceTemplate('person');
  if (hasConfiguredEntityCardAppearance(template?.appearance)) return normalizeEntityCardAppearance(template.appearance);
  return normalizeEntityCardAppearance({
    lines: entityCardDefaultRows([
      { row: 1, field: 'uei', bold: true },
      { row: 7, field: 'name', size: 'l', bold: true },
      { row: 8, field: 'phone' },
      { row: 9, field: 'lastVisit' },
    ]),
  });
}
