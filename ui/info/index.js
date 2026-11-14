import { escapeHtml } from '../utils/escape-html.js';
import { smallActionButton } from '../buttons/index.js';

let infoSequence = 0;

export function infoUI(message = '', {
  aria = 'Дополнительная информация',
  className = '',
  inverse = false,
  data = '',
  actionOnly = false,
} = {}) {
  const id = `ui-info-${++infoSequence}`;
  const classes = ['ui-info', inverse ? 'ui-info--inverse' : '', className].filter(Boolean).join(' ');
  if (actionOnly) {
    return `<span class="${escapeHtml(classes)}" data-info-ui${data ? ` ${data}` : ''}>
      ${smallActionButton({ icon: 'info', className: 'ui-info__trigger', data: 'data-info-trigger', aria })}
    </span>`;
  }
  return `<span class="${escapeHtml(classes)}" data-info-ui${data ? ` ${data}` : ''}>
    ${smallActionButton({
      icon: 'info',
      className: 'ui-info__trigger',
      data: `data-info-trigger aria-expanded="false" aria-controls="${id}"`,
      aria,
    })}
    <span class="ui-info__panel" id="${id}" data-info-panel role="note" hidden>${escapeHtml(message)}</span>
  </span>`;
}

export function initInfoUI(root = document) {
  root.querySelectorAll?.('[data-info-ui]').forEach((host) => {
    if (host.dataset.infoReady === 'true') return;
    host.dataset.infoReady = 'true';
    const trigger = host.querySelector('[data-info-trigger]');
    const panel = host.querySelector('[data-info-panel]');
    if (!trigger || !panel) return;
    const close = () => {
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    };
    trigger.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    host.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });
  });
}
