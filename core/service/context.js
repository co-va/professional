import { workspaceHeaderContext } from '../../ui/header/index.js';
import { page } from '../../ui/page/page.js';
import { miniCardRail } from '../../ui/cards/mini-card.js';
import { setV2ZHeaderRows } from '../../ui/v2/z-layout.js';
import { isV2DesktopWorkspace } from '../../ui/v2/geometry.js';

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

// Both Service Z2 overviews use the same presentation; retain Mobile layout.
export function renderServiceOverviewLayout(layer, {
  title, card, workplaceCards = [], actions = '',
} = {}) {
  const desktop = isV2DesktopWorkspace(layer.closest('[data-v2-app]'));
  layer.innerHTML = page([
    serviceHeaderContext({ title }),
    ...(desktop
      ? ['<div class="service-desktop-overview-cards">' + card +
        (workplaceCards.length ? '<div class="service-desktop-workplace-cards">' + workplaceCards.join('') + '</div>' : '') +
        '</div>']
      : [card, workplaceCards.length ? miniCardRail(workplaceCards) : '',
        actions ? '<div class="app-settings-panel">' + actions + '</div>' : '']),
  ]);
  if (desktop) setV2ZHeaderRows(layer, actions
    ? ['<div class="v2-desktop-tool-row" data-service-overview-toolbar><div class="v2-desktop-tool-actions">' + actions + '</div></div>']
    : [], { desktopTitle: title });
}
