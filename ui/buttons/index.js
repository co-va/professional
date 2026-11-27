import { escapeHtml } from '../utils/escape-html.js';

// Desktop Excel entry uses the same symbol in every business module.
export const DATA_EXCHANGE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3v18m-4-4 4 4 4-4M17 21V3m-4 4 4-4 4 4"/></svg>';

// Existing Excel export symbol shared by the export menu and direct export.
export const DATA_EXPORT_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4"/></svg>';

// Full-size destructive tool icon; keep Compact remove (×) unchanged.
export const TRASH_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';

const BUTTON_VARIANTS = {
  primary: '',
  'delete-outline': 'ui-button--delete-outline',
  secondary: 'ui-button--secondary',
  danger: 'ui-button--danger',
  critical: 'ui-button--critical',
  outline: 'ui-button--outline',
};

export function button(label, { className = '', data = '', type = 'button', aria = '', variant = 'primary', disabled = false } = {}) {
  if (/^назад$/i.test(String(label || '').trim())) return '';
  const variantClass = BUTTON_VARIANTS[variant || 'primary'] ?? BUTTON_VARIANTS.secondary;
  return `<button type="${type}" class="ui-button ${variantClass} ${className}" ${data}${aria ? ` aria-label="${escapeHtml(aria)}"` : ''}${disabled ? ' disabled' : ''}>${label}</button>`;
}

// One Compact control for inline and mini-card actions, date navigation, add, remove, info and copy.
// Kind changes presentation only; data/aria remain owned by the caller.
const SETTINGS_ICON = '<svg class="mini-card__record-action-icon" viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5h3l.6 2.2 2.1.9 2-.9 2.1 2.1-.9 2 .9 2.1 2.2.6v3l-2.2.6-.9 2.1.9 2-2.1 2.1-2-.9-2.1.9-.6 2.2h-3l-.6-2.2-2.1-.9-2 .9-2.1-2.1.9-2-.9-2.1-2.2-.6v-3l2.2-.6.9-2.1-.9-2 2.1-2.1 2 .9 2.1-.9Z"/><circle cx="12" cy="12" r="3"/></svg>';
export function compactButton({ kind = 'add', symbol = '', className = '', data = '', aria = '', disabled = false } = {}) {
  const variant = ['add', 'remove', 'info', 'copy', 'settings', 'repeat', 'card', 'previous', 'next', 'document', 'history', 'payment', 'filter', 'sort', 'group'].includes(kind) ? kind : 'info';
  const labels = { add: 'Добавить', remove: 'Удалить', info: 'Информация', copy: 'Скопировать', settings: 'Настроить', repeat: 'Повторить', card: 'Действие карты', previous: 'Предыдущая дата', next: 'Следующая дата', document: 'Документы', history: 'История', payment: 'Платёж / Возврат', filter: 'Фильтр', sort: 'Сортировка', group: 'Группы' };
  const copyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1"></path></svg><span class="small-action-button__done" aria-hidden="true">✓</span>';
  const glyph = variant === 'add' ? '+' : variant === 'remove' ? '×'
    : variant === 'info' ? '<span class="small-action-button__info" aria-hidden="true">i</span>'
    : variant === 'copy' ? copyIcon
    : variant === 'filter' ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h18l-7 8v6l-4 2v-8z"/></svg>'
    : variant === 'sort' ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4v16m-3-3 3 3 3-3M10 5h11M10 10h8M10 15h5"/></svg>'
    : variant === 'group' ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h8l10 10-7 7L3 10V4Z"/><circle cx="7.5" cy="8.5" r="1"/></svg>'
    : variant === 'document' ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8"/></svg>'
    : variant === 'payment' ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M3 9h18M6 15h5"/></svg>'
    : variant === 'history' ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 1 2.6 6.4M3 12V5m0 7h7M12 7v5l3 2"/></svg>'
    : variant === 'settings' ? SETTINGS_ICON
    : variant === 'previous' ? '←' : variant === 'next' ? '→'
    : variant === 'repeat' ? escapeHtml(symbol || '↻')
    : escapeHtml(symbol);
  const legacy = variant === 'info' || variant === 'copy'
    ? ` small-action-button small-action-button--${variant}${variant === 'copy' ? ' copy-icon-button' : ''}`
    : '';
  const classes = `ui-compact-button ui-compact-button--${variant}${legacy}${className ? ' ' + escapeHtml(className) : ''}`;
  return `<button type="button" class="${classes}"${data ? ' ' + data.trim() : ''} aria-label="${escapeHtml(aria || labels[variant])}"${disabled ? ' disabled' : ''}>${glyph}</button>`;
}

export function compactAddButton(options = {}) {
  return compactButton({ ...options, kind: 'add' });
}

export function compactRemoveButton(options = {}) {
  return compactButton({ ...options, kind: 'remove' });
}

export function iconButton(label, { className = '', data = '', aria = label } = {}) {
  return `<button type="button" class="icon-button ${className}" ${data} aria-label="${escapeHtml(aria)}">${label}</button>`;
}

export function smallActionButton({ icon = 'info', className = '', data = '', aria = '' } = {}) {
  return compactButton({ kind: icon === 'copy' ? 'copy' : 'info', className, data, aria });
}

export function copyIconButton({ data = '', aria = 'Скопировать' } = {}) {
  return smallActionButton({ icon: 'copy', data, aria });
}

export function setCopyButtonCopied(button, { timeout = 1400 } = {}) {
  if (!(button instanceof HTMLElement)) return;
  const previousAria = button.getAttribute('aria-label') || 'Скопировать';
  button.classList.add('is-copied');
  button.setAttribute('aria-label', 'Скопировано');
  window.setTimeout(() => {
    button.classList.remove('is-copied');
    button.setAttribute('aria-label', previousAria);
  }, Math.max(300, Number(timeout) || 1400));
}

export async function copyTextToClipboard(value) {
  const text = String(value ?? '');
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied;
}

export function sheetIconButton({ data = '', aria = 'Открыть список' } = {}) {
  return iconButton('▤', { className: 'sheet-icon-button', data, aria });
}

export function iconButtonGroup(items = []) {
  return `<div class="icon-button-group">${items.join('')}</div>`;
}
