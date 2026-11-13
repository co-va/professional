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


function recordActionMarkup(action, side) {
  if (!action?.data || !action?.label) {
    return `<span class="mini-card__record-action-placeholder mini-card__record-action-placeholder--${side}" aria-hidden="true"></span>`;
  }
  const variant = action.variant === 'secondary' ? ' mini-card__record-action--secondary' : '';
  const content = action.icon === 'settings'
    ? '<svg class="mini-card__record-action-icon" viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5h3l.6 2.2 2.1.9 2-.9 2.1 2.1-.9 2 .9 2.1 2.2.6v3l-2.2.6-.9 2.1.9 2-2.1 2.1-2-.9-2.1.9-.6 2.2h-3l-.6-2.2-2.1-.9-2 .9-2.1-2.1.9-2-.9-2.1-2.2-.6v-3l2.2-.6.9-2.1-.9-2 2.1-2.1 2 .9 2.1-.9Z"/><circle cx="12" cy="12" r="3"/></svg>'
    : escapeHtml(action.label);
  return `<button type="button" class="mini-card__record-action mini-card__record-action--${side}${variant}"${attrs(action.data, action.aria || action.label)}>${content}</button>`;
}

function cardShell({
  tag = 'section', classes = '', style = '', attributes = '',
  head = '', center = '', footer = '', footerClass = '', extra = '',
  centerAria = 'Содержимое мини-карты', scrollFocus = true,
} = {}) {
  const focusAttrs = scrollFocus ? ` tabindex="0" role="region" aria-label="${escapeHtml(centerAria)}"` : '';
  return `<${tag} class="${escapeHtml(classes)}" data-mini-card-ui="shared"${style}${attributes}>
    <div class="mini-card__record-head">${head}</div>
    <div class="mini-card__record-center"${focusAttrs}>${center}</div>
    <div class="mini-card__record-footer${footerClass ? ` ${escapeHtml(footerClass)}` : ''}">${footer}</div>
    ${extra}
  </${tag}>`;
}

function recordMarkup(layout = {}, { className = '', aria = '', interactive = false, data = '' } = {}) {
  const entries = Array.isArray(layout.services) ? layout.services : [];
  const details = Array.isArray(layout.details) ? layout.details : [];
  const personHeader = layout.headerMode === 'person';
  const showLeft = Boolean(layout.leftAction?.data && layout.leftAction?.label);
  const showRight = Boolean(layout.rightAction?.data && layout.rightAction?.label);
  const topLayout = personHeader
    ? `${showLeft ? '' : ' mini-card__record-top--no-left'}${showRight ? '' : ' mini-card__record-top--no-right'}`
    : '';
  const headMarkup = `
      <div class="mini-card__record-top${topLayout}">
        ${recordActionMarkup(layout.leftAction, 'left')}
        <div class="mini-card__record-main">
          ${personHeader
            ? `${layout.identity ? `<strong class="mini-card__record-identity">${escapeHtml(layout.identity)}</strong>` : ''}${layout.phone ? `<span class="mini-card__record-phone">${escapeHtml(layout.phone)}</span>` : ''}`
            : `<strong class="mini-card__record-workplace">${escapeHtml(layout.workplace || '')}</strong><div class="mini-card__record-moment">${escapeHtml(layout.moment || '')}</div>`}
        </div>
        ${recordActionMarkup(layout.rightAction, 'right')}
      </div>
      ${personHeader && layout.momentParts?.date && layout.momentParts?.start
        ? `<div class="mini-card__record-moment mini-card__record-moment--parts" aria-label="${escapeHtml(layout.moment || '')}">
            <span class="mini-card__record-date">${escapeHtml(layout.momentParts.date)}</span>
            <span class="mini-card__record-time-start">${escapeHtml(layout.momentParts.start)}</span>
            ${layout.momentParts.end ? `<span class="mini-card__record-time-end">–${escapeHtml(layout.momentParts.end)}</span>` : ''}
          </div>`
        : personHeader ? `<div class="mini-card__record-moment">${escapeHtml(layout.moment || '')}</div>`
        : `${layout.identity ? `<div class="mini-card__record-identity">${escapeHtml(layout.identity)}</div>` : ''}${layout.phone ? `<div class="mini-card__record-phone">${escapeHtml(layout.phone)}</div>` : ''}`}`;
  const centerMarkup = `
      ${[...entries, ...details].map(lineMarkup).join('')}`;
  const footerMarkup = `
      ${layout.footerLayout === 'three-column'
        ? `<div class="mini-card__record-stat mini-card__record-stat--duration">
            <span class="mini-card__record-stat-label">Время</span>
            <strong class="mini-card__record-stat-value">${escapeHtml(layout.duration || '')}</strong>
          </div>
          <div class="mini-card__record-stat mini-card__record-stat--discount">
            ${layout.discount ? `<span class="mini-card__record-stat-label">Скидка</span><strong class="mini-card__record-stat-value">${escapeHtml(layout.discount)}</strong>` : ''}
          </div>
          <div class="mini-card__record-stat mini-card__record-stat--total">
            <span class="mini-card__record-stat-label">Итого</span>
            <strong class="mini-card__record-stat-value">${escapeHtml(layout.total || '')}</strong>
          </div>`
        : `<div class="mini-card__record-totals">
          <span class="mini-card__record-meta">
            <span class="mini-card__record-duration">${escapeHtml(layout.duration || '')}</span>
            ${layout.discount ? `<span class="mini-card__record-discount">${escapeHtml(layout.discount)}</span>` : ''}
          </span>
          <strong class="mini-card__record-total">${escapeHtml(layout.total || '')}</strong>
        </div>`}`;
  return cardShell({
    tag: 'section',
    classes: `mini-card mini-card--record${personHeader ? ' mini-card--record-person' : ''}${personHeader && !showLeft ? ' mini-card--record-no-left' : ''}${className ? ` ${className}` : ''}`,
    attributes: interactive && data
      ? ` tabindex="0" role="button"${attrs(data, aria || 'Открыть запись')}`
      : ` aria-label="${escapeHtml(aria || 'Данные записи')}"`,
    head: headMarkup,
    center: centerMarkup,
    footer: footerMarkup,
    footerClass: layout.footerLayout === 'three-column' ? 'mini-card__record-footer--triple' : '',
    centerAria: 'Услуги записи',
  });
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
  recordLayout = null,
  interactive = false,
  data = '',
  aria = '',
  className = '',
} = {}) {
  if (recordLayout && typeof recordLayout === 'object') {
    return recordMarkup(recordLayout, { className, aria, interactive, data });
  }
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
  const surfaceStyle = '';
  const actionAttrs = interactive && !dualAction ? ` type="button"${attrs(data, aria || title)}` : '';
  const rowItems = Array.isArray(rows) ? rows : [];
  const lineItems = Array.isArray(lines) ? lines : [];
  const media = image
    ? `<span class="mini-card__media" style="--mini-card-image:url('${escapeHtml(image)}');--mini-card-image-position:${escapeHtml(imagePosition)}" aria-hidden="true"></span>`
    : initials
      ? `<span class="mini-card__media mini-card__media--initials" aria-hidden="true">${escapeHtml(initials)}</span>`
      : '';

  const resolvedClasses = [classes, lineItems.length ? 'mini-card--lines' : ''].filter(Boolean).join(' ');
  const surfaceAction = dualAction
    ? `<button type="button" class="mini-card__surface-action"${attrs(data, aria || title)}></button>`
    : '';
  const compactActionMarkup = hasCompactAction
    ? `<button type="button" class="mini-card__compact-action"${attrs(resolvedCompactAction.data, resolvedCompactAction.aria || resolvedCompactAction.label)}>${escapeHtml(resolvedCompactAction.label)}</button>`
    : '';

  const headerMarkup = lineItems.length ? '' : `<div class="mini-card__head">
      <span class="mini-card__copy">
        <strong class="mini-card__title"${attrs(titleData, titleAria)}>${escapeHtml(title)}</strong>
        ${value ? `<strong class="mini-card__value"${attrs(valueData, valueAria)}>${escapeHtml(value)}</strong>` : ''}
        ${subtitle ? `<span class="mini-card__subtitle"${attrs(subtitleData, subtitleAria)}>${escapeHtml(subtitle)}</span>` : ''}
      </span>
      ${media}
    </div>`;
  const centerMarkup = `${lineItems.length ? `<div class="mini-card__lines">${lineItems.map(lineMarkup).join('')}</div>` : ''}
    ${rowItems.length ? `<div class="mini-card__rows">${rowItems.map(rowMarkup).join('')}</div>` : ''}`;
  const footerMarkup = actionLabel ? `<span class="mini-card__context-action">${escapeHtml(actionLabel)}</span>` : '';
  const centerAttrs = interactive ? '' : ' tabindex="0" role="region" aria-label="Содержимое мини-карты"';
  return cardShell({
    tag, classes: resolvedClasses, style: surfaceStyle, attributes: actionAttrs,
    head: headerMarkup, center: centerMarkup, footer: footerMarkup,
    extra: `${surfaceAction}${compactActionMarkup}`,
    scrollFocus: !interactive,
  });
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
