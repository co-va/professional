import { escapeHtml } from '../utils/escape-html.js';

export function text(value = '') {
  return escapeHtml(String(value ?? ''));
}

export function dataAttributes(data = '') {
  return String(data || '').trim() ? ` ${String(data).trim()}` : '';
}
