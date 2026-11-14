import { escapeHtml } from '../utils/escape-html.js';

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
  const variant = ['add', 'remove', 'info', 'copy', 'settings', 'repeat', 'card', 'previous', 'next'].includes(kind) ? kind : 'info';
  const labels = { add: 'Добавить', remove: 'Удалить', info: 'Информация', copy: 'Скопировать', settings: 'Настроить', repeat: 'Повторить', card: 'Действие карты', previous: 'Предыдущая дата', next: 'Следующая дата' };
  const copyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1"></path></svg><span class="small-action-button__done" aria-hidden="true">✓</span>';
  const glyph = variant === 'add' ? '+' : variant === 'remove' ? '×'
    : variant === 'info' ? '<span class="small-action-button__info" aria-hidden="true">i</span>'
    : variant === 'copy' ? copyIcon
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
