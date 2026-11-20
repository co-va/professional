import { escapeHtml } from '../../ui/utils/escape-html.js';

// Shared classification disclosure for Supplier and Stock. Use the existing
// compact selection checkbox outside native <details>, so toggling selection
// cannot open or close the group.
export function catalogDisclosure(title, content, nested = false, count = null, check = '', reorderId = '') {
  const countMarkup = Number.isSafeInteger(count) && count >= 0
    ? '<span class="ui-list__secondary">' + count + ' поз.</span>' : '';
  const selection = check ? '<div class="inventory-editor-heading__selection">' + check + '</div>' : '';
  // Count and reordering share one controls slot, so they never overlap.
  const reorderMarkup = reorderId
    ? '<span class="list-entry__reorder-handle" data-reorder-handle role="button" tabindex="0" ' +
      'aria-label="Переместить группу ' + escapeHtml(title) + '">' +
      '<span aria-hidden="true">⋮⋮</span></span>' : '';
  const controls = countMarkup || reorderMarkup
    ? '<div class="inventory-editor-heading__controls">' + countMarkup + reorderMarkup + '</div>' : '';
  return '<section class="inventory-editor-panel' + (nested ? ' inventory-editor-panel--nested' : '') +
    (check ? ' inventory-editor-panel--catalog-choice' : '') +
    (reorderId ? ' inventory-stock-category' : '') + '"' +
    (reorderId ? ' data-stock-category data-reorder-id="' + escapeHtml(reorderId) + '"' : '') + '>' +
    '<details><summary class="inventory-editor-summary">' + escapeHtml(title) + '</summary>' +
    '<div class="inventory-editor-panel__body">' + content + '</div></details>' +
    selection + controls + '</section>';
}
