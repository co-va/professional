import { rootApp } from './root-app.js';
import { isV2DesktopWorkspace } from './geometry.js';

// The same Y host belongs to the work area in Desktop, and to its original
// shell position in Mobile. Moving it preserves its content and handlers.
export function syncV2YPlacement(root) {
  const app = rootApp(root);
  const stage = app?.querySelector?.(':scope > .v2-app__stage');
  const front = stage?.querySelector(':scope > [data-v2-front]');
  const host = app?.querySelector?.(':scope > [data-v2-y-host]')
    || front?.querySelector(':scope > [data-v2-y-host]');
  if (!host || !stage || !front) return host || null;
  if (isV2DesktopWorkspace(app)) {
    if (host.parentElement !== front) front.prepend(host);
  } else if (host.parentElement !== app) {
    app.insertBefore(host, stage);
  }
  return host;
}

export function setV2Y(root, content = '') {
  const app = rootApp(root);
  const host = syncV2YPlacement(app);
  if (!host) return null;
  const html = String(content || '');
  host.innerHTML = html;
  const active = Boolean(html.trim());
  host.hidden = !active;
  host.style.paddingBottom = active ? '12px' : '';
  app.classList.toggle('has-v2-y', active);
  return host;
}

export function clearV2Y(root) {
  return setV2Y(root, '');
}
