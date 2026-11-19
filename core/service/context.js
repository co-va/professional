import { workspaceHeaderContext } from '../../ui/header/index.js';

export function serviceHeaderContext({
  title = '',
  settingsData = '',
  settingsAria = 'Настройки',
  c = null,
  d = null,
} = {}) {
  // The shared Professional workspace owns Header A, including the live
  // profile photo. Service must not construct a second/stale avatar source.
  return workspaceHeaderContext({
    title,
    v: settingsData ? { data: settingsData, aria: settingsAria } : null,
    c,
    d,
  });
}

export function notifyServiceContext() {
  window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
}
