import { escapeHtml } from '../utils/escape-html.js';

function attrs(data = '', aria = '') {
  return `${data ? ` ${String(data).trim()}` : ''}${aria ? ` aria-label="${escapeHtml(aria)}"` : ''}`;
}

function rowMarkup(row = {}) {
  const label = escapeHtml(row.label || '');
  const value = row.checked === true ? '✓' : row.checked === false ? '—' : escapeHtml(row.value || '');
  const content = `<span class="mini-card__row-label">${label}</span><strong class="mini-card__row-value">${value}</strong>`;
  if (row.data) {
    return `<button type="button" class="mini-card__row mini-card__row--action"${attrs(row.data, row.aria || row.label)}>${content}</button>`;
  }
  return `<div class="mini-card__row">${content}</div>`;
}

function lineMarkup(line = {}) {
  const value = escapeHtml(line.value || '');
  const align = line.align === 'right' ? 'right' : 'left';
  const classes = ['mini-card__line', `mini-card__line--${align}`, line.strong ? 'is-strong' : ''].filter(Boolean).join(' ');
  const content = `<span class="${classes}">${value || '&nbsp;'}</span>`;
  if (line.data) {
    return `<button type="button" class="mini-card__line-action"${attrs(line.data, line.aria || line.value)}>${content}</button>`;
  }
  return content;
}

export function miniCard({
  title = '',
  value = '',
  subtitle = '',
  titleData = '',
  titleAria = '',
  valueData = '',
  valueAria = '',
  subtitleData = '',
  subtitleAria = '',
  rows = [],
  lines = [],
  image = '',
  imagePosition = '50% 50%',
  initials = '',
  surface = 'default',
  actionLabel = '',
  interactive = false,
  data = '',
  aria = '',
  className = '',
} = {}) {
  const tag = interactive ? 'button' : 'section';
  const resolvedSurface = surface === 'photo' ? 'photo' : 'default';
  const classes = ['mini-card', `mini-card--surface-${resolvedSurface}`, interactive ? 'mini-card--interactive' : '', image ? 'has-image' : '', className].filter(Boolean).join(' ');
  const surfaceStyle = resolvedSurface === 'photo' && image
    ? ` style="--mini-card-surface-image:url('${escapeHtml(image)}');--mini-card-image-position:${escapeHtml(imagePosition)}"`
    : '';
  const actionAttrs = interactive ? ` type="button"${attrs(data, aria || title)}` : '';
  const rowItems = Array.isArray(rows) ? rows : [];
  const lineItems = Array.isArray(lines) ? lines : [];
  const media = resolvedSurface === 'default'
    ? (image
      ? `<span class="mini-card__media" style="--mini-card-image:url('${escapeHtml(image)}');--mini-card-image-position:${escapeHtml(imagePosition)}" aria-hidden="true"></span>`
      : initials
        ? `<span class="mini-card__media mini-card__media--initials" aria-hidden="true">${escapeHtml(initials)}</span>`
        : '')
    : '';

  const resolvedClasses = [classes, lineItems.length ? 'mini-card--lines' : ''].filter(Boolean).join(' ');

  return `<${tag} class="${escapeHtml(resolvedClasses)}"${surfaceStyle}${actionAttrs}>
    ${lineItems.length ? `<div class="mini-card__lines">${lineItems.map(lineMarkup).join('')}</div>` : `<div class="mini-card__head">
      <span class="mini-card__copy">
        <strong class="mini-card__title"${attrs(titleData, titleAria)}>${escapeHtml(title)}</strong>
        ${value ? `<strong class="mini-card__value"${attrs(valueData, valueAria)}>${escapeHtml(value)}</strong>` : ''}
        ${subtitle ? `<span class="mini-card__subtitle"${attrs(subtitleData, subtitleAria)}>${escapeHtml(subtitle)}</span>` : ''}
      </span>
      ${media}
    </div>`}
    ${actionLabel ? `<span class="mini-card__context-action">${escapeHtml(actionLabel)}</span>` : ''}
    ${!lineItems.length && rowItems.length ? `<div class="mini-card__rows">${rowItems.map(rowMarkup).join('')}</div>` : ''}
  </${tag}>`;
}

export function miniCardRail(cards = [], { className = '' } = {}) {
  const items = Array.isArray(cards) ? cards : [];
  return `<div class="mini-card-rail${className ? ` ${escapeHtml(className)}` : ''}" data-mini-card-rail data-v2-horizontal-rail>${items.join('')}</div>`;
}

export function miniCardStack(cards = [], { className = '' } = {}) {
  const items = Array.isArray(cards) ? cards : [];
  return `<div class="mini-card-stack${className ? ` ${escapeHtml(className)}` : ''}" data-mini-card-stack>${items.join('')}</div>`;
}
