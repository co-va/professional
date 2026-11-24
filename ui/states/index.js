import { escapeHtml } from '../utils/escape-html.js';
import { stateView, initStateView } from './state-view.js';

export { stateView, initStateView };

export function emptyState(title, text = '') {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${text ? `<span>${escapeHtml(text)}</span>` : ''}</div>`;
}
