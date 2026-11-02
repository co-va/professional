import { modal, mountModal } from '../modals/index.js';
import { escapeHtml } from '../utils/escape-html.js';

function text(value = '') {
  return escapeHtml(String(value ?? ''));
}

function dataAttributes(data = '') {
  const value = String(data || '').trim();
  return value ? ` ${value}` : '';
}

function titleLines(value = '') {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  const fullTitle = words.join(' ') || 'Документ';
  if (words.length <= 1 || fullTitle.length <= 26) return [fullTitle];

  let splitAt = 1;
  let bestDifference = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index += 1) {
    const left = words.slice(0, index).join(' ');
    const right = words.slice(index).join(' ');
    const difference = Math.abs(left.length - right.length);
    if (difference < bestDifference) {
      bestDifference = difference;
      splitAt = index;
    }
  }
  return [
    words.slice(0, splitAt).join(' '),
    words.slice(splitAt).join(' '),
  ];
}

function titleFontSize(lines = []) {
  const longest = Math.max(...lines.map((line) => String(line || '').length), 1);
  if (longest <= 24) return 16;
  if (longest <= 29) return 14.5;
  if (longest <= 35) return 12.5;
  if (longest <= 42) return 10.5;
  return Math.max(8.5, Math.min(10.5, 440 / longest));
}

function documentBody({ title, version, meta, lines, statusMarkup = '' } = {}) {
  return `
    <span class="document-tile__body">
      <strong class="document-tile__title" style="--document-title-size:${titleFontSize(lines)}px">${lines.map((line) => `<span>${text(line)}</span>`).join(' ')}</strong>
      ${version !== '' ? `<span class="document-tile__version">Версия ${text(version)}</span>` : ''}
    </span>
    <span class="document-tile__footer">
      <small class="document-tile__meta">${meta ? text(meta) : '&nbsp;'}</small>
      ${statusMarkup}
    </span>`;
}

export function documentTile({
  title = 'Документ',
  version = '',
  meta = '',
  status = '',
  statusState = '',
  interactive = true,
  data = '',
  aria = '',
  className = '',
  openData = '',
  toggleData = '',
  toggleChecked = false,
  toggleDisabled = false,
  toggleAria = '',
} = {}) {
  const state = ['signed', 'revoked', 'pending'].includes(String(statusState || ''))
    ? String(statusState)
    : '';
  const lines = titleLines(title);
  const statusSymbol = state === 'signed' ? '✓' : state === 'revoked' ? '×' : state === 'pending' ? '—' : '';
  const statusMarkup = status
    ? `<span class="document-tile__status${state ? ` is-${state}` : ''}" aria-label="${text(status)}" title="${text(status)}"><span class="document-tile__status-mark" aria-hidden="true">${statusSymbol}</span></span>`
    : '';

  if (String(toggleData || '').trim()) {
    const openAttrs = dataAttributes(openData || data);
    const toggleAttrs = dataAttributes(toggleData);
    return `<article class="document-tile document-tile--controlled${className ? ` ${text(className)}` : ''}">
      <span class="document-tile__fold" aria-hidden="true"></span>
      <button type="button" class="document-tile__open"${openAttrs} aria-label="${text(aria || title)}">
        ${documentBody({ title, version, meta, lines })}
      </button>
      <button type="button" class="document-tile__toggle${toggleChecked ? ' is-on' : ''}"${toggleAttrs} aria-pressed="${toggleChecked ? 'true' : 'false'}" aria-label="${text(toggleAria || title)}"${toggleDisabled ? ' disabled' : ''}><span aria-hidden="true"></span></button>
    </article>`;
  }

  const tag = interactive ? 'button' : 'article';
  const attrs = interactive
    ? ` type="button"${dataAttributes(data)} aria-label="${text(aria || title)}"`
    : '';
  return `<${tag} class="document-tile${className ? ` ${text(className)}` : ''}"${attrs}>
    <span class="document-tile__fold" aria-hidden="true"></span>
    ${documentBody({ title, version, meta, lines, statusMarkup })}
  </${tag}>`;
}

export function documentTiles(items = [], { className = '', layout = 'stack' } = {}) {
  const values = (Array.isArray(items) ? items : []).filter(Boolean);
  const layoutClass = layout === 'rail' ? ' document-tiles--rail' : '';
  return `<div class="document-tiles${layoutClass}${className ? ` ${text(className)}` : ''}" data-document-tiles data-document-layout="${layout === 'rail' ? 'rail' : 'stack'}">${values.join('')}</div>`;
}

export function documentPage({ title = 'Документ', version = '', content = '' } = {}) {
  const body = String(content || '').trim()
    ? String(content).trim().split(/\n{2,}/).map((part) => `<p>${text(part).replaceAll('\n', '<br>')}</p>`).join('')
    : '<p>Текст документа не заполнен.</p>';

  return `<article class="document-page">
    ${version !== '' ? `<div class="document-page__version">Версия ${text(version)}</div>` : ''}
    <h1>${text(title)}</h1>
    <div class="document-page__body">${body}</div>
  </article>`;
}

export function openDocumentViewer({
  title = 'Документ',
  version = '',
  content = '',
  pdfDataUrl = '',
} = {}) {
  const body = pdfDataUrl
    ? `<iframe class="document-viewer__pdf" src="${text(pdfDataUrl)}#toolbar=0&navpanes=0" title="${text(title)}"></iframe>`
    : documentPage({ title, version, content });
  const layer = mountModal(document.body, modal(
    `<div class="document-viewer__content">${body}</div>`,
    {
      title,
      variant: 'technical',
      surface: 'app',
      className: 'document-viewer-sheet',
    },
  ));
  layer?.classList.add('document-viewer-backdrop');
  return layer;
}
