import {
  emptyState,
  initViewNavigation,
  openSharedProfileSettingsMenu,
  openNotice,
  page,
  setV2ZHeaderRows,
  clearV2ZHeaderRows,
  viewNavigation,
} from '../../ui/ui.js';
import { loadOperationalState } from '../runtime/operational-state.js';
import { loadAuxiliaryState } from '../runtime/auxiliary-state.js';
import { openServiceGroupingQ } from './catalog-grouping.js';
import { hasCurrentProceduresSnapshot } from './procedures/data.js';
import { loadInventory } from '../inventory/service.js';
import { serviceHeaderContext, notifyServiceContext } from './context.js';

const views = [
  { id: 'procedures', label: 'Услуги' },
  { id: 'products', label: 'Товары' },
];

let activeView = 'procedures';
let appearanceModulePromise = null;
let proceduresModulePromise = null;
let productsModulePromise = null;

function loadAppearanceModule() {
  appearanceModulePromise ||= import('./appearance.js');
  return appearanceModulePromise;
}

function loadProceduresModule() {
  proceduresModulePromise ||= import('./procedures/procedures.js');
  return proceduresModulePromise;
}

function loadProductsModule() {
  productsModulePromise ||= import('./products/products.js');
  return productsModulePromise;
}

function openServiceSettings(root, rerender) {
  return openSharedProfileSettingsMenu({
    title: 'Настройки',
    actions: [
      {
        id: 'appearance',
        label: 'Вид',
        onSelect: async () => {
          const { openServiceAppearanceQ } = await loadAppearanceModule();
          if (!root?.isConnected) return;
          openServiceAppearanceQ(root, { onSaved: rerender });
        },
      },
      {
        id: 'grouping',
        label: 'Группы',
        onSelect: async () => {
          try {
            // Never edit an unhydrated catalogue: otherwise the first group
            // write could overwrite saved stock-linked retail presentations.
            await loadAuxiliaryState('service');
            if (!root?.isConnected) return;
            openServiceGroupingQ(activeView, { onSaved: rerender });
          } catch (cause) {
            openNotice({ title: 'Группы', message: cause instanceof Error
              ? cause.message : 'Не удалось загрузить группы.' });
          }
        },
      },
    ],
  });
}

export function renderService(root, navigateBack = () => {}) {
  let disposeCatalog = () => {};
  let renderVersion = 0;
  let disposed = false;

  const renderCurrent = () => {
    if (disposed) return;
    const version = ++renderVersion;
    disposeCatalog?.();
    disposeCatalog = () => {};
    const view = views.some((item) => item.id === activeView) ? activeView : 'procedures';

    root.innerHTML = page([
      serviceHeaderContext({
        title: 'Сервис',
        settingsData: 'data-service-settings',
        settingsAria: 'Настройки сервиса',
        c: {
          label: '+',
          data: 'data-service-add',
          aria: view === 'products' ? 'Добавить товар' : 'Добавить услугу',
        },
      }),
      '<div data-service-catalog></div>',
    ]);

    // Service mode is a navigation control, not scrollable catalogue content.
    // Use the same stationary Z header slot as Inventory; do not alter Shared
    // surface geometry or introduce a second header inside the Z body.
    const navMarkup = viewNavigation({ views, activeView: view, ariaLabel: 'Сервис' });
    const headerRows = setV2ZHeaderRows(root, [navMarkup]);
    const navigationRoot = headerRows[0] || root;
    if (!headerRows.length) {
      // Direct-mounted previews without a Z surface retain a usable control.
      root.querySelector('[data-service-catalog]')?.insertAdjacentHTML('beforebegin', navMarkup);
    }

    root.querySelector('[data-service-settings]')?.addEventListener('click', () => openServiceSettings(root, renderCurrent));

    initViewNavigation(navigationRoot, {
      views,
      activeView: view,
      onChange: (next) => {
        activeView = next;
        renderCurrent();
      },
    });

    const catalog = root.querySelector('[data-service-catalog]');
    if (catalog) {
      const modulePromise = view === 'products' ? loadProductsModule() : loadProceduresModule();
      void modulePromise.then(async (module) => {
        if (view === 'products') await Promise.all([
          loadInventory(), loadAuxiliaryState('service'),
        ]);
        if (version !== renderVersion || !catalog.isConnected) return;
        disposeCatalog = view === 'products'
          ? module.renderProductCatalog(catalog, { root, onChanged: renderCurrent })
          : module.renderProcedureCatalog(catalog, { root, onChanged: renderCurrent });
      }).catch((error) => {
        console.error('Service catalog load failed', error);
      });
    }

    root.querySelector('[data-service-add]')?.addEventListener('click', async () => {
      const module = view === 'products' ? await loadProductsModule() : await loadProceduresModule();
      if (!root?.isConnected || version !== renderVersion) return;
      if (view === 'products') void module.openStockSaleCreate(root, { onChanged: renderCurrent });
      else {
        try {
          await loadAuxiliaryState('service');
          if (root?.isConnected && version === renderVersion)
            module.openProcedureEditor(root, null, { onChanged: renderCurrent });
        } catch (cause) {
          openNotice({ title: 'Сервис', message: cause instanceof Error
            ? cause.message : 'Не удалось загрузить группы.' });
        }
      }
    });

    notifyServiceContext();
  };

  // The grouped catalogue settings share the existing tenant-scoped Service
  // auxiliary snapshot with retail product presentations. No new Core dataset.
  void loadAuxiliaryState('service').then(() => {
    if (!disposed) renderCurrent();
  }).catch(error => {
    console.error('Service grouping snapshot load failed', error);
  });

  // Workspace already hydrates the operational Service snapshot on entry.
  // Do not run a second full hydration or delay catalog rendering.
  if (hasCurrentProceduresSnapshot()) {
    renderCurrent();
  } else {
    // Direct mounts outside the Professional workspace still obtain their own snapshot.
    root.innerHTML = page([serviceHeaderContext({ title: 'Сервис' }), emptyState('Загрузка', 'Загружаем сервис.')]);
    void loadOperationalState({ full: true })
      .then(renderCurrent)
      .catch((error) => {
        if (disposed) return;
        root.innerHTML = page([
          serviceHeaderContext({ title: 'Сервис' }),
          emptyState('Не удалось открыть сервис', error instanceof Error ? error.message : 'Ошибка загрузки'),
        ]);
      });
  }

  return () => {
    disposed = true;
    renderVersion += 1;
    disposeCatalog?.();
    const header = root?.closest?.('[data-v2-z],[data-v2-z-layer]')
      ?.querySelector?.(':scope > [data-v2-z-header] > [data-v2-z-header-content]');
    if (header?.querySelector('[data-view-navigation]')) clearV2ZHeaderRows(root);
  };
}

export { renderService as render };
