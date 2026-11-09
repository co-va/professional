import { costListParts, durationText, normalizeEntityCardAppearance, entityCardDefaultRows, hasConfiguredEntityCardAppearance } from '../../ui/ui.js';
import { getCardAppearanceTemplate } from '../../core/card-appearance-templates.js';

function money(value = 0) {
  return `${new Intl.NumberFormat('ru-RU').format(Number(value || 0))} ₽`;
}


function costText(cost = {}) {
  const parts = costListParts(cost);
  return [parts.rightTop, parts.rightBottom].filter(Boolean).join(' ');
}

export function procedureCardFields(procedure = {}, stats = {}) {
  return [
    { value: 'name', label: 'Наименование', text: String(procedure.name || '') },
    { value: 'duration', label: 'Длительность', text: durationText(procedure.duration) },
    { value: 'cost', label: 'Стоимость', text: costText(procedure.cost) },
    { value: 'groupBooking', label: 'Групповая запись', text: procedure?.groupBooking?.enabled === true ? `До ${Math.max(2, Math.floor(Number(procedure?.groupBooking?.capacity) || 2))} человек` : 'Нет' },
    { value: 'workplaceCount', label: 'Кол-во пространств', text: String((procedure.workplaces || []).length) },
    { value: 'recordCount', label: 'Кол-во записей', text: String(Number(stats.recordCount || 0)) },
    { value: 'spentTime', label: 'Потраченное время', text: String(stats.spentTime || '') },
    { value: 'revenue', label: 'Заработанная сумма', text: money(stats.revenue || 0) },
  ];
}

export function procedureCardAppearance(procedure = {}) {
  if (hasConfiguredEntityCardAppearance(procedure.cardAppearance)) return normalizeEntityCardAppearance(procedure.cardAppearance);
  const template = getCardAppearanceTemplate('procedure');
  if (hasConfiguredEntityCardAppearance(template?.appearance)) return normalizeEntityCardAppearance(template.appearance);
  return normalizeEntityCardAppearance({
    lines: entityCardDefaultRows([
      { row: 1, field: 'duration', column:'right', align: 'right' },
      { row: 2, field: 'cost', column:'right', align: 'right' },
      { row: 3, field: 'workplaceCount', column:'right', align: 'right' },
      { row: 5, field: 'recordCount', column:'left', align: 'left' },
      { row: 6, field: 'spentTime', column:'left', align: 'left' },
      { row: 7, field: 'name', column:'left', align: 'left', size: 'l', bold: true },
      { row: 9, field: 'revenue', column:'right', align: 'right', bold: true },
    ]),
  });
}

export function procedureCardPhoto(procedure = {}) {
  return String(procedure.photo || getCardAppearanceTemplate('procedure')?.photo || '');
}

export function productCardFields(product = {}, stats = {}) {
  return [
    { value: 'name', label: 'Наименование', text: String(product.name || '') },
    { value: 'cost', label: 'Стоимость', text: costText(product.cost) },
    { value: 'workplaceCount', label: 'Кол-во пространств', text: String((product.workplaces || []).length) },
    { value: 'saleCount', label: 'Кол-во продаж', text: String(Number(stats.saleCount || 0)) },
    { value: 'revenue', label: 'Заработанная сумма', text: money(stats.revenue || 0) },
  ];
}

export function productCardAppearance(product = {}) {
  if (hasConfiguredEntityCardAppearance(product.cardAppearance)) return normalizeEntityCardAppearance(product.cardAppearance);
  const template = getCardAppearanceTemplate('product');
  if (hasConfiguredEntityCardAppearance(template?.appearance)) return normalizeEntityCardAppearance(template.appearance);
  return normalizeEntityCardAppearance({
    lines: entityCardDefaultRows([
      { row: 1, field: 'cost', column:'right', align: 'right' },
      { row: 2, field: 'workplaceCount', column:'right', align: 'right' },
      { row: 5, field: 'saleCount', column:'left', align: 'left' },
      { row: 7, field: 'name', column:'left', align: 'left', size: 'l', bold: true },
      { row: 9, field: 'revenue', column:'right', align: 'right', bold: true },
    ]),
  });
}

export function productCardPhoto(product = {}) {
  return String(product.photo || getCardAppearanceTemplate('product')?.photo || '');
}
