import { renderPeople } from '../core/people/people.js';
import { financeNavigationItems, renderFinanceSection } from '../core/finance/index.js';
import { inventoryNavigationItems, renderInventorySection } from '../core/inventory/index.js';
import { loyaltyNavigationItems, renderLoyaltySection } from '../core/loyalty/index.js';
import { renderJournal } from '../journal/journal.js';
import { settingsNavigationItems, renderSettingsSection } from '../settings/settings.js';
import { render as renderProfile } from '../core/profile/profile.js';
import { getProfile } from '../core/profile/data.js';
import { render as renderService } from '../core/service/service.js';
import { renderChat } from '../chat/chat.js';
import { getWorkplaces as getWorkplaceEntities } from '../core/profile/workplaces/data.js';
import { loadProfileState } from '../core/profile/runtime.js';
import { loadBusinessState } from '../core/runtime/business-state.js';
import { loadOperationalState } from '../core/runtime/operational-state.js';
import { ensureRknGuide, loadTenantDocumentArchive, refreshTenantDocumentArchive } from '../core/runtime/tenant-document-archive.js';
import { loadAuxiliaryState, loadFinanceState } from '../core/runtime/auxiliary-state.js';
import { startProfessionalServerSync, stopProfessionalServerSync } from '../core/runtime/server-sync.js';
import { getJournalTimeUsages } from '../journal/time-usage-source.js';
import { configureWorkplaceSource } from '../core/workplace-time.js';
import { configureTimeUsageSource } from '../core/time/index.js';
import { activateDemo, canUseCapability, getAccess, loadAccess } from '../core/access.js';
import { mountV2ZLayer, openNotice, initV2WorkspaceInteraction, setV2DeckOpen, v2CardDeck, v2Header, v2Shell, v2Sticker, v2ZLayer } from '../ui/ui.js';
import { startPlatformNotices } from '../core/platform-notices.js';
import { setThemeColor } from '../ui/viewport/index.js';

configureWorkplaceSource(getWorkplaceEntities);
configureTimeUsageSource(getJournalTimeUsages);

const ROOT_SECTIONS = [
  { id: 'people', label: 'Клиенты', capability: 'people.access' },
  { id: 'journal', label: 'Журнал', capability: '' },
  { id: 'profile', label: 'Профиль', capability: '' },
  { id: 'service', label: 'Сервис', capability: 'services.access' },
  { id: 'loyalty', label: 'Лояльность', capability: '' },
  { id: 'finance', label: 'Финансы', capability: '' },
  { id: 'inventory', label: 'Склад', capability: '' },
  { id: 'settings', label: 'Настройки', capability: '' },
];

const state = {
  activeSection: 'journal',
  lastRootSection: 'journal',
  navigationOpen: false,
  navigationLevel: 'f',
  navigationEnterZ: false,
  chatPersonKey: '',
  journalView: 'day',
  secondary: {
    finance: 'cash',
    inventory: 'stock',
    loyalty: 'deposit',
    settings: 'online-booking',
  },
};
const app = document.querySelector('#app');
let disposeView = () => {};
let workspaceReady = false;
let authenticatedAccount = null;
let serverSyncStarted = false;
let disposePlatformNotices = () => {};
let rknGuideSyncTimer = null;
let workspaceRenderVersion = 0;

async function syncRknGuideIfReady() {
  if (!authenticatedAccount) return false;
  const result = await ensureRknGuide();
  if (!result?.ready) return false;
  await refreshTenantDocumentArchive();
  return true;
}

function scheduleRknGuideSync() {
  if (!authenticatedAccount) return;
  if (rknGuideSyncTimer) window.clearTimeout(rknGuideSyncTimer);
  rknGuideSyncTimer = window.setTimeout(() => {
    rknGuideSyncTimer = null;
    void syncRknGuideIfReady().catch((error) => {
      console.error('RKN guide sync failed', error);
    });
  }, 700);
}

window.addEventListener('professional:profile-changed', scheduleRknGuideSync);
window.addEventListener('professional:server-mutation-completed', (event) => {
  const scopes = Array.isArray(event?.detail?.scopes) ? event.detail.scopes : [];
  if (scopes.includes('operational')) scheduleRknGuideSync();
});

window.addEventListener('professional:business-persistence-error', (event) => {
  const message = String(event?.detail?.message || 'Не удалось сохранить изменения на сервере.');
  openNotice({ title: 'Не удалось сохранить', message, surface: 'app' });
});

window.addEventListener('professional:record-chat-request', (event) => {
  // Direct Record actions must obey the same Chat readiness as root navigation.
  if (!workspaceReady || !sectionAllowed('chat')) return;
  const layer = mountV2ZLayer(app, v2ZLayer('', { className: 'record-chat-z' }), { stack: true });
  if (!layer) return;
  renderChat(layer, {
    personKey: String(event?.detail?.personKey || ''),
  });
});

function ensureServerSync() {
  if (serverSyncStarted) return;
  serverSyncStarted = true;
  startProfessionalServerSync({ initialRefresh: false, getActiveScopes: () => {
    if (state.activeSection === 'journal') return ['business'];
    if (state.activeSection === 'people') return ['business', 'documents'];
    if (state.activeSection === 'profile') return ['profile'];
    if (state.activeSection === 'finance') return ['finance'];
    if (state.activeSection === 'settings') return ['documents'];
    if (state.activeSection === 'loyalty') return ['business'];
    if (state.activeSection === 'service') return ['operational'];
    return [];
  } });
}

function rootDefinition(section) {
  return ROOT_SECTIONS.find((item) => item.id === section) || null;
}

function sectionAllowed(section) {
  if (section === 'chat') return canUseCapability('chat.access');
  // Root navigation must use the same server-resolved readiness as submodes.
  if (section === 'journal') {
    return ['journal.day.access', 'journal.month.access', 'journal.list.access']
      .some((key) => canUseCapability(key));
  }
  if (section === 'profile') return canUseCapability('profile.access');
  if (section === 'finance' || section === 'inventory' || section === 'loyalty' || section === 'settings') {
    return secondaryItems(section).length > 0;
  }
  const item = rootDefinition(section);
  return Boolean(item && (!item.capability || canUseCapability(item.capability)));
}

function allowedSections() {
  return ROOT_SECTIONS.filter((item) => sectionAllowed(item.id)).map((item) => item.id);
}

function rootDisplayLabel(section) {
  const definition = rootDefinition(section);
  if (!definition) return '';
  const children = secondaryItems(section);
  return children.length === 1 ? children[0].label : definition.label;
}

function allowedRootItems() {
  return ROOT_SECTIONS
    .filter((item) => sectionAllowed(item.id))
    .map(({ id }) => {
      const children = secondaryItems(id);
      return {
        id,
        label: rootDisplayLabel(id),
        childrenCount: children.length > 1 ? children.length : 0,
      };
    });
}

function defaultSection() {
  if (sectionAllowed('journal')) return 'journal';
  return allowedSections()[0] || '';
}

function normalizeRequestedSection(section) {
  return String(section || '').trim();
}
function activeRootSection() {
  return state.activeSection === 'chat' ? state.lastRootSection : state.activeSection;
}

function secondaryItems(section = activeRootSection()) {
  if (section === 'finance') return financeNavigationItems();
  if (section === 'inventory') return inventoryNavigationItems();
  if (section === 'loyalty') return loyaltyNavigationItems();
  if (section === 'settings') return settingsNavigationItems();
  return [];
}

function ensureSecondary(section) {
  const items = secondaryItems(section);
  if (!items.length) return '';
  const selected = String(state.secondary[section] || '');
  if (items.some((item) => item.id === selected)) return selected;
  state.secondary[section] = items[0].id;
  return items[0].id;
}

function setNavigationOpen(open) {
  state.navigationOpen = Boolean(open);
  if (!state.navigationOpen) state.navigationLevel = 'f';
  setV2DeckOpen(app, state.navigationOpen);
}

function navigate(section, { navigationOpen = state.navigationOpen, updateHash = true, chatPersonKey = '' } = {}) {
  if (!workspaceReady) return;
  const next = normalizeRequestedSection(section);
  if (!sectionAllowed(next)) return;
  if (next === 'chat') {
    if (state.activeSection !== 'chat') state.lastRootSection = activeRootSection();
    state.activeSection = 'chat';
    state.chatPersonKey = String(chatPersonKey || '');
    state.navigationOpen = false;
    state.navigationLevel = 'f';
  } else {
    state.activeSection = next;
    state.chatPersonKey = '';
    state.lastRootSection = next;
    state.navigationOpen = Boolean(navigationOpen);
    if (!state.navigationOpen) state.navigationLevel = 'f';
    ensureSecondary(next);
  }
  renderWorkspace();
  if (updateHash) history.replaceState({}, '', `#${state.activeSection}`);
}

function selectSecondary(id) {
  const section = activeRootSection();
  const items = secondaryItems(section);
  if (!items.some((item) => item.id === id)) return;
  state.secondary[section] = id;
  state.navigationOpen = false;
  state.navigationLevel = 'f';
  state.navigationEnterZ = true;
  renderWorkspace();
  history.replaceState({}, '', `#${section}`);
}

function sourceText(node, fallback = '') {
  const value = String(node?.textContent || '').replace(/\s+/g, ' ').trim();
  return value || fallback;
}

function isAddPrimarySource(source) {
  if (!source) return false;
  const label = String(source.dataset.v2PrimaryLabel || source.getAttribute('aria-label') || source.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ru-RU');
  if (label === '+' || label.startsWith('добав')) return true;
  if (source.matches('[data-add],[data-add-workplace]')) return true;
  return [...source.attributes].some((attribute) => /^data-(?:[a-z0-9-]*-)?add(?:-|$)/i.test(attribute.name));
}

function primarySource(surface) {
  const candidates = [
    ...surface.querySelectorAll('[data-v2-primary-action], .page-header-action button, [data-add], [data-add-workplace]'),
  ];
  return candidates.find(isAddPrimarySource) || null;
}

function primaryLabel(source) {
  return source ? '+' : '';
}

function primaryVisible(source) {
  if (!source || source.hidden || source.dataset.v2PrimaryVisible === 'false') return false;
  if (source.matches('.accordion-save') && !source.classList.contains('is-visible')) return false;
  return true;
}

function syncWorkspacePrimarySource(surface, source) {
  surface.querySelectorAll('.v2-workspace-source-hidden').forEach((node) => {
    if (node !== source) node.classList.remove('v2-workspace-source-hidden');
  });
  if (source && !source.classList.contains('v2-workspace-source-hidden')) {
    source.classList.add('v2-workspace-source-hidden');
  }
}

function activeWorkspaceSurface(surface) {
  const qLayers = [...document.querySelectorAll('[data-v2-q="true"] .v2-layer')];
  if (qLayers.length) return qLayers.at(-1);
  const layers = [...app.querySelectorAll('[data-v2-z-layer]')];
  return layers.at(-1) || surface;
}

function workspaceProfileASlot() {
  const profile = getProfile();
  const name = [profile.name, profile.surname].filter(Boolean).join(' ') || 'Профиль';
  const crop = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Math.round(Number(value)))) : 50;
  return {
    kind: 'avatar',
    label: name,
    image: String(profile.photo || ''),
    imagePosition: `${crop(profile.photoCropX)}% ${crop(profile.photoCropY)}%`,
    initials: name.slice(0, 1).toUpperCase() || '?',
  };
}

function syncWorkspaceHeader(surface) {
  if (!surface?.isConnected) return;
  const contextRoot = activeWorkspaceSurface(surface);
  // Q never owns Header B. Read the title from the underlying F/Z surface,
  // while keeping its own title within the canonical Q header.
  const titleRoot = contextRoot.closest?.('[data-v2-q="true"]')
    ? ([...app.querySelectorAll('[data-v2-z-layer]')].at(-1) || surface)
    : contextRoot;
  const context = titleRoot.querySelector('[data-workspace-header-context]');
  const root = activeRootSection();
  const fallbackTitle = state.activeSection === 'chat'
    ? 'Чат'
    : rootDefinition(root)?.label || '';
  const title = context?.dataset.workspaceTitle || sourceText(
    titleRoot.querySelector('.page-header h1'),
    fallbackTitle,
  );
  const subtitle = context?.dataset.workspaceSubtitle || '';
  const aContext = contextRoot.querySelector('[data-workspace-a-context]');
  const dSource = contextRoot.querySelector('[data-workspace-d-action]');
  const cSource = primarySource(contextRoot);
  const cVisible = primaryVisible(cSource);
  syncWorkspacePrimarySource(contextRoot, cVisible ? cSource : null);
  const header = app.querySelector('[data-v2-header]');
  if (!header) return;

  const aSlot = aContext
    ? {
        kind: 'avatar',
        label: aContext.dataset.workspaceALabel || '',
        image: aContext.dataset.workspaceAImage || '',
        imagePosition: aContext.dataset.workspaceAImagePosition || '',
        initials: aContext.dataset.workspaceAInitials || '',
      }
    : workspaceProfileASlot();

  header.outerHTML = v2Header({
    a: aSlot,
    b: subtitle ? { label: title, subtitle } : title,
    c: cVisible ? {
      kind: 'text',
      label: primaryLabel(cSource),
      data: 'data-v2-workspace-primary',
      aria: cSource.getAttribute('aria-label') || 'Добавить',
      disabled: Boolean(cSource.disabled),
    } : null,
    d: sectionAllowed('chat') ? {
      kind: dSource?.dataset.workspaceDKind || 'chat',
      data: 'data-v2-workspace-chat',
      aria: dSource?.getAttribute('aria-label') || (state.activeSection === 'chat' ? 'Вернуться из чата' : 'Чат'),
    } : null,
  });

  app.querySelector('[data-v2-workspace-primary]')?.addEventListener('click', () => cSource?.click());
  app.querySelector('[data-v2-workspace-chat]')?.addEventListener('click', () => {
    if (dSource) {
      dSource.click();
      return;
    }
    if (state.activeSection === 'chat') navigate(state.lastRootSection, { navigationOpen: false });
    else navigate('chat', { navigationOpen: false });
  });
}

async function ensureWorkspaceState(section) {
  const secondary = section === 'finance' || section === 'settings' ? ensureSecondary(section) : '';
  const tasks = [];
  if (section === 'journal' || section === 'profile' || section === 'people' || section === 'service' || section === 'settings') tasks.push(loadProfileState());
  if (section === 'journal' || section === 'people' || section === 'loyalty') tasks.push(loadBusinessState());
  if (section === 'journal' || section === 'service') tasks.push(loadOperationalState());
  if (section === 'journal' || section === 'finance') tasks.push(loadFinanceState());
  const needsAuxiliary = section === 'people'
    || section === 'loyalty'
    || section === 'service'
    || (section === 'finance' && secondary === 'cash')
    || (section === 'settings' && secondary === 'tags');
  if (needsAuxiliary) tasks.push(loadAuxiliaryState());
  if (section === 'people' || (section === 'settings' && secondary === 'documents')) tasks.push(loadTenantDocumentArchive());
  await Promise.all(tasks);
}

async function renderActiveWorkspaceSurface(surface) {
  const section = state.activeSection;
  await ensureWorkspaceState(section);
  ensureServerSync();
  const openNavigation = () => setNavigationOpen(true);
  if (section === 'people') return renderPeople(surface, {
    onDirectChat: (personKey) => navigate('chat', { navigationOpen: false, chatPersonKey: personKey }),
  });
  if (section === 'finance') return renderFinanceSection(surface, ensureSecondary('finance'), {
    onDirectChat: (personKey) => navigate('chat', { navigationOpen: false, chatPersonKey: personKey }),
  });
  if (section === 'inventory') return renderInventorySection(surface, ensureSecondary('inventory'));
  if (section === 'loyalty') return renderLoyaltySection(surface, ensureSecondary('loyalty'));
  if (section === 'journal') {
    return renderJournal(surface, {
      initialView: state.journalView || 'day',
      onViewChange: (view) => {
        state.journalView = view;
      },
    });
  }
  if (section === 'profile') return renderProfile(surface, openNavigation, {
    accountEmail: authenticatedAccount?.account?.email || '',
  });
  if (section === 'service') return renderService(surface, openNavigation);
  if (section === 'settings') return renderSettingsSection(surface, ensureSecondary('settings'), { onBack: openNavigation });
  if (section === 'chat') return renderChat(surface, { personKey: state.chatPersonKey });
  return renderPeople(surface);
}

function renderWorkspace() {
  setThemeColor('#2F3338');
  app.classList.remove('app-shell--booking');
  app.classList.remove('app-shell--auth');
  workspaceReady = true;
  disposeView();
  disposeView = () => {};
  // Do not invent a Settings fallback when every instrument is NOT_READY.
  if (!allowedSections().length) {
    app.innerHTML = v2Sticker({
      title: 'Нет доступных инструментов',
      body: '<p>Инструменты станут доступны после допуска к проверке или выпуску.</p>',
      className: 'v2-sticker-screen--technical',
    });
    return;
  }
  const requested = normalizeRequestedSection(state.activeSection);
  if (!sectionAllowed(requested)) state.activeSection = defaultSection();
  if (state.activeSection !== 'chat') state.lastRootSection = state.activeSection;

  const root = activeRootSection();
  const rootItems = allowedRootItems();
  const childItems = secondaryItems(root);
  const childActive = ensureSecondary(root);
  const rootDeck = v2CardDeck(rootItems, {
    axis: 'x',
    active: root,
    data: 'data-v2-root-item',
    className: 'v2-deck--root',
    role: 'root',
    level: 'f',
  });
  const eDeck = childItems.length > 1 ? v2CardDeck(childItems, {
    axis: 'y',
    active: childActive,
    data: 'data-v2-secondary-item',
    level: 'e',
  }) : '';

  const headerMarkup = v2Header({
    a: workspaceProfileASlot(),
    b: state.activeSection === 'chat' ? 'Чат' : rootDisplayLabel(root),
    d: sectionAllowed('chat') ? { kind: 'chat', data: 'data-v2-workspace-chat', aria: 'Чат' } : null,
  });
  let shell = app.querySelector(':scope > [data-v2-app].v2-app--workspace');
  if (!shell) {
    app.innerHTML = v2Shell({
      header: headerMarkup,
      deck: rootDeck,
      eDeck,
      deckOpen: state.navigationOpen,
      eOpen: state.navigationOpen && state.navigationLevel === 'e',
      zEnter: Boolean(state.navigationEnterZ),
      className: 'v2-app--workspace',
      body: '<section class="v2-workspace-surface" data-v2-workspace-surface></section>',
    });
    shell = app.querySelector(':scope > [data-v2-app].v2-app--workspace');
  } else {
    const currentHeader = shell.querySelector(':scope > .v2-header');
    if (currentHeader) currentHeader.outerHTML = headerMarkup;

    const feHost = shell.querySelector('[data-v2-fe]');
    const currentF = feHost?.querySelector('[data-v2-card-deck][data-v2-deck-level="f"]');
    const nextFIds = rootItems.map((item) => String(item.id || '')).join('|');
    const currentFIds = [...(currentF?.querySelectorAll('[data-v2-card-item]') || [])]
      .map((card) => String(card.dataset.v2CardItem || '')).join('|');
    if (nextFIds !== currentFIds) {
      if (currentF) currentF.outerHTML = rootDeck;
      else if (rootDeck && feHost) feHost.insertAdjacentHTML('afterbegin', rootDeck);
    }

    const currentE = feHost?.querySelector('[data-v2-card-deck][data-v2-deck-level="e"]');
    const nextEIds = childItems.map((item) => String(item.id || '')).join('|');
    const currentEIds = [...(currentE?.querySelectorAll('[data-v2-card-item]') || [])]
      .map((card) => String(card.dataset.v2CardItem || '')).join('|');
    if (nextEIds !== currentEIds) {
      currentE?.remove();
      if (eDeck && feHost) feHost.insertAdjacentHTML('beforeend', eDeck);
    }

    setV2DeckOpen(shell, state.navigationOpen);
    shell.classList.toggle('is-e-open', Boolean(state.navigationOpen && state.navigationLevel === 'e' && eDeck));
    shell.classList.toggle('is-z-entering', Boolean(state.navigationEnterZ && !state.navigationOpen));
    const persistentSurface = shell.querySelector('[data-v2-workspace-surface]');
    persistentSurface?.replaceChildren();
  }

  state.navigationEnterZ = false;

  const surface = shell?.querySelector('[data-v2-workspace-surface]');
  const disposers = [];
  let moduleDispose = () => {};
  let disposed = false;
  const renderVersion = ++workspaceRenderVersion;

  app.querySelector('[data-v2-workspace-chat]')?.addEventListener('click', () => navigate('chat', { navigationOpen: false }));

  if (shell) disposers.push(initV2WorkspaceInteraction(shell, {
    activeId: root,
    eActiveId: childActive,
    deckOpen: state.navigationOpen,
    eOpen: state.navigationOpen && state.navigationLevel === 'e',
    onDeckOpenChange: (open) => {
      state.navigationOpen = open;
      if (open) state.navigationLevel = 'f';
      else state.navigationLevel = 'f';
    },
    onEOpenChange: (open) => {
      state.navigationLevel = open ? 'e' : 'f';
    },
    onRootSelect: (id) => {
      const hasE = secondaryItems(id).length > 1;
      state.navigationLevel = hasE ? 'e' : 'f';
      state.navigationEnterZ = !hasE;
      navigate(id, { navigationOpen: hasE });
    },
    onSecondarySelect: (id) => selectSecondary(id),
  }));

  const onV2ContextChanged = () => syncWorkspaceHeader(surface);
  window.addEventListener('va-tools:v2-context-changed', onV2ContextChanged);
  disposers.push(() => window.removeEventListener('va-tools:v2-context-changed', onV2ContextChanged));

  let headerSyncQueued = false;
  const observer = new MutationObserver(() => {
    if (headerSyncQueued || disposed) return;
    headerSyncQueued = true;
    queueMicrotask(() => {
      headerSyncQueued = false;
      if (!disposed) syncWorkspaceHeader(surface);
    });
  });
  if (surface) observer.observe(surface, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'disabled', 'aria-label', 'data-v2-primary-visible', 'data-v2-primary-label', 'data-v2-primary-variant'],
  });

  const result = surface ? renderActiveWorkspaceSurface(surface) : null;
  Promise.resolve(result).then((nextDispose) => {
    if (disposed || renderVersion !== workspaceRenderVersion) {
      if (typeof nextDispose === 'function') nextDispose();
      return;
    }
    if (typeof nextDispose === 'function') moduleDispose = nextDispose;
    syncWorkspaceHeader(surface);
  }).catch((error) => {
    console.error('Workspace UI render failed', error);
  });
  syncWorkspaceHeader(surface);

  disposeView = () => {
    disposed = true;
    observer.disconnect();
    disposers.forEach((dispose) => dispose?.());
    moduleDispose?.();
  };
}

function renderSuspended() {
  app.classList.remove('app-shell--booking');
  workspaceReady = false;
  disposeView();
  disposeView = () => {};
  app.innerHTML = v2Sticker({
    title: 'Рабочее пространство временно недоступно',
    body: '<p>Доступ к этому рабочему пространству приостановлен владельцем платформы.</p>',
    className: 'v2-sticker-screen--technical',
    closeData: 'data-suspended-u-close',
  });
  app.querySelector('[data-suspended-u-close]')?.addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
  });
}

function startRegularPlatformNotices() {
  disposePlatformNotices();
  disposePlatformNotices = startPlatformNotices({
    onAccessChanged: async () => {
      await loadAccess();
      if (getAccess().status === 'SUSPENDED') {
        renderSuspended();
        return;
      }
      if (workspaceReady) renderWorkspace();
    },
  });
}

export async function renderAuthenticated(account = authenticatedAccount) {
  authenticatedAccount = account || authenticatedAccount;
  await loadAccess();
  if (getAccess().status === 'SUSPENDED') {
    renderSuspended();
    return;
  }

  disposePlatformNotices();
  disposePlatformNotices = () => {};

  const freshDemo = getAccess().commercialMode === 'DEMO' && !getAccess().demoActivatedAt;
  state.activeSection = freshDemo && sectionAllowed('profile')
    ? 'profile'
    : sectionAllowed('journal') ? 'journal' : defaultSection();
  if (freshDemo && state.activeSection === 'profile') await activateDemo();
  if (state.activeSection !== 'chat') state.lastRootSection = state.activeSection;
  history.replaceState({}, '', `#${state.activeSection}`);
  renderWorkspace();
  startRegularPlatformNotices();
}

window.addEventListener('professional:auth-logout', () => {
  authenticatedAccount = null;
  workspaceReady = false;
  disposeView();
  disposeView = () => {};
  disposePlatformNotices();
  disposePlatformNotices = () => {};
  stopProfessionalServerSync();
  serverSyncStarted = false;
});

window.addEventListener('hashchange', () => {
  if (!workspaceReady) return;
  const section = normalizeRequestedSection(location.hash.slice(1));
  if (sectionAllowed(section)) {
    navigate(section, { navigationOpen: false, updateHash: false });
  } else {
    history.replaceState({}, '', `#${state.activeSection}`);
  }
});
window.addEventListener('va-tools:v2-navigation-request', (event) => {
  if (!workspaceReady) return;
  setNavigationOpen(event?.detail?.open !== false);
});
