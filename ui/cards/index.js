import { escapeHtml } from '../utils/escape-html.js';
import { entityVisualCard, entityCardDefaultRows } from './entity-card-constructor.js';

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
  const lines = entityCardDefaultRows([
    ...(topRightMeta[0]?[{row:1,column:'right',field:'topRight1',align:'right'}]:[]),
    ...(topRightMeta[1]?[{row:2,column:'right',field:'topRight2',align:'right'}]:[]),
    {row:6,column:'left',field:'title',size:'xl',bold:true},
    ...(subtitle?[{row:7,column:'left',field:'subtitle'}]:[]),
    ...(meta[0]?[{row:8,column:'left',field:'meta1'}]:[]),
    ...(meta[1]?[{row:9,column:'right',field:'meta2',align:'right'}]:[]),
  ]);
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
