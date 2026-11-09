import { normalizeEntityCardAppearance, entityCardDefaultRows, hasConfiguredEntityCardAppearance } from '../../ui/ui.js';
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
  if (hasConfiguredEntityCardAppearance(template?.appearance)) {
    return normalizeEntityCardAppearance(template.appearance);
  }
  const personal = type === 'personal-account';
  return normalizeEntityCardAppearance({
    lines: entityCardDefaultRows([
      { row: 1, field: 'uei', bold: true },
      { row: 2, field: 'status', align: 'right' },
      { row: 6, field: 'title', size: 'xl', bold: true },
      { row: 7, field: 'subtitle' },
      { row: 8, field: personal ? 'amountLabel' : 'metaLeft' },
      { row: 9, field: personal ? 'currentAmount' : 'metaRight', align: 'right' },
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
