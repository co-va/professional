import { escapeHtml } from '../utils/escape-html.js';
import { entityVisualCard } from './entity-card-constructor.js';

export function entityCard({
  title = '',
  subtitle = '',
  image = '',
  meta = [],
  topRightMeta = [],
  interactive = false,
  data = '',
  aria = '',
} = {}) {
  const fields = [
    { value: 'title', label: 'Название', text: String(title || '') },
    { value: 'subtitle', label: 'Подпись', text: String(subtitle || '') },
    ...topRightMeta.slice(0, 2).map((item, index) => ({
      value: `topRight${index + 1}`,
      label: `Показатель ${index + 1}`,
      text: String(item?.value || ''),
    })),
    ...meta.slice(0, 2).map((item, index) => ({
      value: `meta${index + 1}`,
      label: String(item?.label || `Данные ${index + 1}`),
      text: String(item?.value || ''),
    })),
  ];
  const lines = Array.from({ length: 9 }, () => ({}));
  if (topRightMeta[0]) lines[0] = { field: 'topRight1', zone: 'right', align: 'right', size: 'm', color: 'white' };
  if (topRightMeta[1]) lines[1] = { field: 'topRight2', zone: 'right', align: 'right', size: 'm', color: 'white' };
  lines[5] = { field: 'title', zone: 'full', align: 'left', size: 'xl', color: 'white', bold: true };
  if (subtitle) lines[6] = { field: 'subtitle', zone: 'full', align: 'left', size: 'm', color: 'white' };
  if (meta[0]) lines[7] = { field: 'meta1', zone: 'left', align: 'left', size: 'm', color: 'white' };
  if (meta[1]) lines[8] = { field: 'meta2', zone: 'right', align: 'right', size: 'm', color: 'white' };
  return entityVisualCard({
    appearance: { lines },
    fields,
    image,
    interactive,
    data,
    aria,
  });
}

export function entityCardStack(cards = [], { className = '' } = {}) {
  const items = Array.isArray(cards) ? cards : [];
  return `<div class="entity-card-stack${className ? ` ${escapeHtml(className)}` : ''}" data-entity-card-stack style="display:grid;grid-template-columns:minmax(0,1fr);gap:10px;width:100%;min-width:0;align-content:start">${items.join('')}</div>`;
}

export function entityCardRail(cards = [], { className = '' } = {}) {
  const items = Array.isArray(cards) ? cards : [];
  return `<div class="entity-card-rail${className ? ` ${escapeHtml(className)}` : ''}" data-entity-card-rail data-v2-horizontal-rail>${items.join('')}</div>`;
}
