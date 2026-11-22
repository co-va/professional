import {
  emptyState, field, initV2ListReorder, list, v2ListEntries,
} from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';

// The same catalogue threshold and interaction for Services and Products.
// Up to 50 rows retain standard V2; 51+ use the existing dense Stock-style List.
// No new shared UI family, sorting widget, or per-screen drag implementation.
export const SERVICE_COMPACT_THRESHOLD = 50;

export function renderServiceCatalogList(host, {
  items = [],
  emptyTitle = 'Пока нет позиций',
  renderV2,
  renderDense,
  searchText = item => item.name || '',
  onOpen = () => {},
  onReorder = () => {},
  onError = () => {},
} = {}) {
  const dense = items.length > SERVICE_COMPACT_THRESHOLD;
  if (!items.length) {
    host.innerHTML = emptyState(emptyTitle);
    return () => {};
  }

  // Search never recreates its own input while typing: only the result list
  // changes. It also never changes the saved/manual order.
  host.innerHTML = dense
    ? '<div class="ui-search-field">' +
      field({ label: 'Поиск', name: 'serviceCatalogSearch',
        type: 'search', placeholder: 'Наименование, артикул, производитель',
        autocomplete: 'off', data: 'data-service-catalog-search' }) +
      '</div><div data-service-catalog-results></div>'
    : v2ListEntries(items.map(renderV2));
  const results = dense ? host.querySelector('[data-service-catalog-results]') : host;
  const searchInput = dense ? host.querySelector('[data-service-catalog-search]') : null;
  let disposeDrag = () => {};

  const paint = (search = '') => {
    if (!dense) return;
    disposeDrag();
    disposeDrag = () => {};
    const query = String(search).trim().toLocaleLowerCase('ru-RU');
    const shown = query
      ? items.filter(item => String(searchText(item)).toLocaleLowerCase('ru-RU').includes(query))
      : items;
    results.innerHTML = shown.length
      ? list({
        className: 'ui-list--dense',
        items: shown.map(item => ({
          ...renderDense(item),
          interactive: true,
          reorderHandle: !query,
          data: 'data-service-catalog-id="' + escapeHtml(item.id) +
            '" data-reorder-id="' + escapeHtml(item.id) + '"',
          aria: 'Открыть ' + String(item.name || ''),
        })),
      })
      : emptyState('Ничего не найдено', 'Измените запрос.');
    if (!query && shown.length > 1) {
      disposeDrag = initV2ListReorder(results, {
        hostSelector: '.ui-list', onReorder, onError,
      });
    }
  };

  const handleOpen = event => {
    const target = event.target.closest?.('[data-service-catalog-id]');
    if (!target || !host.contains(target)) return;
    onOpen(String(target.dataset.serviceCatalogId || ''));
  };
  const handleSearch = event => paint(event.target.value);
  host.addEventListener('click', handleOpen);
  searchInput?.addEventListener('input', handleSearch);

  if (dense) paint();
  else {
    disposeDrag = initV2ListReorder(host, { onReorder, onError });
  }
  return () => {
    disposeDrag();
    host.removeEventListener('click', handleOpen);
    searchInput?.removeEventListener('input', handleSearch);
  };
}
