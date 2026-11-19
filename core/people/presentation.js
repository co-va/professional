import { formatPhone } from '../phone/index.js';
import { getUEI } from '../uei.js';

export function personDisplay(person = {}) {
  return {
    uei: person.uei || getUEI('person', person.key) || '',
    name: [person?.name, person?.surname].filter(Boolean).join(' ') || 'Без имени',
    phone: formatPhone(person?.phones?.[0] || person?.phone || ''),
  };
}
