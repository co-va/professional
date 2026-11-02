import { normalizeEntityCardAppearance } from '../../ui/ui.js';
import { getCardAppearanceTemplate } from '../card-appearance-templates.js';

const TYPES = {
  'personal-account': { scope: 'loyalty-personal-account', label: 'Личный счёт' },
  certificate: { scope: 'loyalty-certificate', label: 'Сертификат' },
  subscription: { scope: 'loyalty-subscription', label: 'Абонемент' },
  referral: { scope: 'loyalty-referral', label: 'Реферальная программа' },
  bonus: { scope: 'loyalty-bonus', label: 'Бонусная программа' },
};

function typeConfig(type = '') {
  return TYPES[String(type || '').trim()] || TYPES['personal-account'];
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

function configured(value = {}) {
  return Array.isArray(value?.lines) && value.lines.some((line) => String(line?.field || '').trim());
}

export function loyaltyCardTypes() {
  return Object.entries(TYPES).map(([value, config]) => ({ value, ...config }));
}

export function loyaltyCardScope(type = '') {
  return typeConfig(type).scope;
}

export function loyaltyCardLabel(type = '') {
  return typeConfig(type).label;
}

export function loyaltyCardAppearance(type = '') {
  const template = getCardAppearanceTemplate(loyaltyCardScope(type));
  if (configured(template?.appearance)) return normalizeEntityCardAppearance(template.appearance);
  return normalizeEntityCardAppearance({
    lines: defaultLines([
      { row: 1, field: 'uei', bold: true },
      { row: 2, field: 'status', zone: 'right', align: 'right' },
      { row: 6, field: 'title', size: 'xl', bold: true },
      { row: 7, field: 'subtitle' },
      { row: 8, field: 'metaLeft', zone: 'left' },
      { row: 9, field: 'metaRight', zone: 'right', align: 'right' },
    ]),
  });
}

export function loyaltyCardPhoto(type = '') {
  return String(getCardAppearanceTemplate(loyaltyCardScope(type))?.photo || '');
}

export function loyaltyCardPhotoPosition(type = '') {
  return String(getCardAppearanceTemplate(loyaltyCardScope(type))?.photoPosition || '50% 50%');
}

export function loyaltyCardFields({
  uei = '',
  title = '',
  subtitle = '',
  status = '',
  metaLeft = '',
  metaRight = '',
} = {}) {
  return [
    { value: 'uei', label: 'UEI', text: String(uei || '') },
    { value: 'title', label: 'Название', text: String(title || '') },
    { value: 'subtitle', label: 'Подпись', text: String(subtitle || '') },
    { value: 'status', label: 'Статус', text: String(status || '') },
    { value: 'metaLeft', label: 'Данные слева', text: String(metaLeft || '') },
    { value: 'metaRight', label: 'Данные справа', text: String(metaRight || '') },
  ];
}
