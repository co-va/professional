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
  const variant = ['title', 'primary', 'muted', 'moment'].includes(line.variant) ? line.variant : '';
  const classes = [
    'mini-card__line',
    `mini-card__line--${align}`,
    variant ? `mini-card__line--${variant}` : '',
    line.rightValue != null && line.rightValue !== '' ? 'mini-card__line--pair' : '',
    line.strong ? 'is-strong' : '',
  ].filter(Boolean).join(' ');
  const right = line.rightValue != null && line.rightValue !== ''
    ? `<span class="mini-card__line-text">${value || '&nbsp;'}</span><strong class="mini-card__line-right">${escapeHtml(line.rightValue)}</strong>`
    : (value || '&nbsp;');
  const content = `<span class="${classes}">${right}</span>`;
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
  compactAction = null,
  interactive = false,
  data = '',
  aria = '',
  className = '',
} = {}) {
  const resolvedCompactAction = compactAction && typeof compactAction === 'object'
    ? compactAction
    : null;
  const hasCompactAction = Boolean(resolvedCompactAction?.data && resolvedCompactAction?.label);
  const dualAction = Boolean(interactive && hasCompactAction);
  const tag = dualAction ? 'section' : interactive ? 'button' : 'section';
  const resolvedSurface = surface === 'photo' ? 'photo' : 'default';
  const classes = [
    'mini-card',
    `mini-card--surface-${resolvedSurface}`,
    interactive ? 'mini-card--interactive' : '',
    hasCompactAction ? 'mini-card--dual-action' : '',
    image ? 'has-image' : '',
    className,
  ].filter(Boolean).join(' ');
  const surfaceStyle = resolvedSurface === 'photo' && image
    ? ` style="--mini-card-surface-image:url('${escapeHtml(image)}');--mini-card-image-position:${escapeHtml(imagePosition)}"`
    : '';
  const actionAttrs = interactive && !dualAction ? ` type="button"${attrs(data, aria || title)}` : '';
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
  const surfaceAction = dualAction
    ? `<button type="button" class="mini-card__surface-action"${attrs(data, aria || title)}></button>`
    : '';
  const compactActionMarkup = hasCompactAction
    ? `<button type="button" class="mini-card__compact-action"${attrs(resolvedCompactAction.data, resolvedCompactAction.aria || resolvedCompactAction.label)}>${escapeHtml(resolvedCompactAction.label)}</button>`
    : '';

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
    ${rowItems.length ? `<div class="mini-card__rows">${rowItems.map(rowMarkup).join('')}</div>` : ''}
    ${surfaceAction}
    ${compactActionMarkup}
  </${tag}>`;
}

export function miniCardRail(cards = [], { className = '', affordanceMinItems = 2 } = {}) {
  const items = Array.isArray(cards) ? cards : [];
  const minimum = Math.max(2, Math.round(Number(affordanceMinItems) || 2));
  return `<div class="mini-card-rail${className ? ` ${escapeHtml(className)}` : ''}" data-mini-card-rail data-v2-horizontal-rail data-v2-horizontal-affordance-min="${minimum}">${items.join('')}</div>`;
}

export function miniCardStack(cards = [], { className = '' } = {}) {
  const items = Array.isArray(cards) ? cards : [];
  return `<div class="mini-card-stack${className ? ` ${escapeHtml(className)}` : ''}" data-mini-card-stack>${items.join('')}</div>`;
}
