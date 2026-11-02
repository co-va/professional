import { escapeHtml } from '../utils/escape-html.js';

export function segmentControl(items = [], { value = '', name = '', aria = 'Выбор' } = {}) {
  const options = (Array.isArray(items) ? items : []).filter(Boolean).map((item) => {
    const normalized = typeof item === 'string' ? { value: item, label: item } : (item || {});
    return {
      value: String(normalized.value ?? ''),
      label: String(normalized.label ?? normalized.value ?? ''),
    };
  });
  const current = String(value ?? options[0]?.value ?? '');
  const hidden = name ? `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(current)}" data-segment-value>` : '';
  return `<div class="segment-control" data-segment-control role="group" aria-label="${escapeHtml(aria)}">${options.map((item) => `<button type="button" data-segment-option="${escapeHtml(item.value)}" class="${item.value === current ? 'is-active' : ''}" aria-pressed="${item.value === current ? 'true' : 'false'}">${escapeHtml(item.label)}</button>`).join('')}${hidden}</div>`;
}

export function initSegmentControls(root) {
  root.querySelectorAll('[data-segment-control]').forEach((host) => {
    if (host.dataset.segmentReady === 'true') return;
    host.dataset.segmentReady = 'true';
    host.addEventListener('click', (event) => {
      const button = event.target.closest('[data-segment-option]');
      if (!button || !host.contains(button)) return;
      host.querySelectorAll('[data-segment-option]').forEach((item) => {
        const active = item === button;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      const input = host.querySelector('[data-segment-value]');
      if (input) {
        input.value = button.dataset.segmentOption || '';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  });
}
