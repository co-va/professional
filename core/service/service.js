import { VIEW_ICON, GROUP_ICON } from '../../ui/buttons/index.js';
import {
  button,
  compactButton,
  emptyState,
  field,
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
import { renderDesktopServiceCatalog } from './desktop-catalog.js';
import { hasCurrentProceduresSnapshot } from './procedures/data.js';
import { loadInventory } from '../inventory/service.js';
import { serviceHeaderContext, notifyServiceContext } from './context.js';
import { isV2DesktopWorkspace } from '../../ui/v2/geometry.js';

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

function serviceSettingsActions(root, rerender) {
  return [
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
            openServiceGroupingQ({ onSaved: rerender, desktop: isV2DesktopWorkspace(root.closest('[data-v2-app]')) });
          } catch (cause) {
            openNotice({ title: 'Группы', message: cause instanceof Error
              ? cause.message : 'Не удалось загрузить группы.' });
          }
        },
      },
  ];
}

export function renderService(root, navigateBack = () => {}) {
  let disposeCatalog = () => {};
  let renderVersion = 0;
  let disposed = false;
  const desktopState={query:'',sort:'manual',kind:'',group:'',workplace:''};

  const renderCurrent = () => {
    if (disposed) return;
    const version = ++renderVersion;
    disposeCatalog?.();
    disposeCatalog = () => {};
    const view = views.some((item) => item.id === activeView) ? activeView : 'procedures';

    const desktop = isV2DesktopWorkspace(root.closest('[data-v2-app]'));
    const actions = serviceSettingsActions(root, renderCurrent);
    const addAria = view === 'products' ? 'Добавить товар' : 'Добавить услугу';
    root.innerHTML = page([
      serviceHeaderContext({
        title: 'Сервис',
        settingsData: desktop ? '' : 'data-service-settings',
        settingsAria: 'Настройки сервиса',
        c: desktop ? null : {
          label: '+',
          data: 'data-service-add',
          aria: addAria,
        },
      }),
      '<div data-service-catalog></div>',
    ]);

    // Service mode is a navigation control, not scrollable catalogue content.
    // Use the same stationary Z header slot as Inventory; do not alter Shared
    // surface geometry or introduce a second header inside the Z body.
    const navMarkup = viewNavigation({ views, activeView: view, ariaLabel: 'Сервис' });
    const toolbar = desktop ? `<section data-people-desktop-toolbar data-service-desktop-toolbar><div class="people-desktop-tools">
      ${field({name:'serviceSearch',type:'search',placeholder:'Поиск',autocomplete:'off',value:desktopState.query,data:'data-service-search'})}
      <div class="people-desktop-actions people-desktop-query-tools">
        ${compactButton({kind:'filter',data:'data-service-filter title="Фильтр" aria-haspopup="dialog" aria-pressed="false"'})}
        ${compactButton({kind:'sort',data:'data-service-sort title="Сортировка" aria-haspopup="dialog" aria-pressed="false"'})}
      </div>
      <div class="people-desktop-actions people-desktop-actions--right">
        ${button(GROUP_ICON,{variant:'secondary',className:'people-desktop-icon',data:'data-service-tool="grouping" title="Группы"',aria:'Группы'})}
        ${button(VIEW_ICON,{variant:'secondary',className:'people-desktop-icon',data:'data-service-tool="appearance" title="Вид"',aria:'Вид'})}
        ${button('+',{variant:'secondary',className:'people-desktop-icon people-desktop-add',data:'data-service-add-position title="Добавить"',aria:'Добавить'})}
      </div></div></section>` : navMarkup;
    const headerRows = setV2ZHeaderRows(root, [toolbar], {
      desktopTitle: desktop ? 'Сервис' : null,
      desktopAccessory: desktop ? '<output data-service-count aria-live="polite">—</output>' : '',
    });
    const counter = desktop ? root.closest('[data-v2-z],[data-v2-z-layer]')?.querySelector('[data-h-accessory]>[data-service-count]') : null;
    const onCount = (count) => {
      if (!counter?.isConnected || version !== renderVersion) return;
      counter.textContent = String(count);
      counter.setAttribute('aria-label', 'Позиций в списке: ' + count);
    };
    const navigationRoot = headerRows[0] || root;
    if (!headerRows.length) {
      // Direct-mounted previews without a Z surface retain a usable control.
      root.querySelector('[data-service-catalog]')?.insertAdjacentHTML('beforebegin', toolbar);
    }

    root.querySelector('[data-service-settings]')?.addEventListener('click', () => openSharedProfileSettingsMenu({ title: 'Настройки', actions }));
    navigationRoot.querySelectorAll('[data-service-tool]').forEach(control => {
      const action = actions.find(item => item.id === control.dataset.serviceTool);
      if (action) control.addEventListener('click', action.onSelect);
    });

    if(!desktop) initViewNavigation(navigationRoot, {
      views,
      activeView: view,
      onChange: (next) => {
        activeView = next;
        renderCurrent();
      },
    });

    const catalog = root.querySelector('[data-service-catalog]');
    if(catalog && desktop) {
      disposeCatalog=renderDesktopServiceCatalog(catalog,{root,toolbar:navigationRoot,onChanged:renderCurrent,state:desktopState,onCount,loadProceduresModule,loadProductsModule});
    } else if (catalog) {
      const modulePromise = view === 'products' ? loadProductsModule() : loadProceduresModule();
      void modulePromise.then(async (module) => {
        if (view === 'products') await Promise.all([
          loadInventory(), loadAuxiliaryState('service'),
        ]);
        if (version !== renderVersion || !catalog.isConnected) return;
        disposeCatalog = view === 'products'
          ? module.renderProductCatalog(catalog, { root, onChanged: renderCurrent, desktop, onCount })
          : module.renderProcedureCatalog(catalog, { root, onChanged: renderCurrent, desktop, onCount });
      }).catch((error) => {
        console.error('Service catalog load failed', error);
      });
    }

    (desktop ? navigationRoot : root).querySelector('[data-service-add]')?.addEventListener('click', async () => {
      const module = view === 'products' ? await loadProductsModule() : await loadProceduresModule();
      if (!root?.isConnected || version !== renderVersion) return;
      if (view === 'products') void module.openStockSaleCreate(root, { onChanged: renderCurrent });
      else {
        try {
          await loadAuxiliaryState('service');
          if (root?.isConnected && version === renderVersion)
            module.openProcedureEditor(root, null, {
              onSaved: saved => {
                renderCurrent();
                if (root.isConnected) module.openProcedureOverview(root, saved.id, { onChanged: renderCurrent });
              },
            });
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
    if (header?.querySelector('[data-view-navigation],[data-service-desktop-toolbar]')) clearV2ZHeaderRows(root);
  };
}

export { renderService as render };
