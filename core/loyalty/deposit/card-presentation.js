import { normalizeEntityCardAppearance } from '../../../ui/ui.js';
import { getCardAppearanceTemplate } from '../../card-appearance-templates.js';

const SCOPE = 'loyalty-deposit';

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

export function depositCardScope() {
  return SCOPE;
}

export function depositCardAppearance() {
  const template = getCardAppearanceTemplate(SCOPE);
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

export function depositCardPhoto() {
  return String(getCardAppearanceTemplate(SCOPE)?.photo || '');
}

export function depositCardPhotoPosition() {
  return String(getCardAppearanceTemplate(SCOPE)?.photoPosition || '50% 50%');
}

export function depositCardFields({
  uei = '',
  title = 'Депозит',
  subtitle = 'Депозит',
  status = '',
  metaLeft = '',
  metaRight = '',
} = {}) {
  return [
    { value: 'uei', label: 'UEI', text: String(uei || '') },
    { value: 'title', label: 'Название', text: String(title || 'Депозит') },
    { value: 'subtitle', label: 'Подпись', text: String(subtitle || 'Депозит') },
    { value: 'status', label: 'Статус', text: String(status || '') },
    { value: 'metaLeft', label: 'Данные слева', text: String(metaLeft || '') },
    { value: 'metaRight', label: 'Данные справа', text: String(metaRight || '') },
  ];
}
