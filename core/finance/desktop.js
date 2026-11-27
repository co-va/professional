import { button, setV2ZHeaderRows } from '../../ui/ui.js';
import { isV2DesktopWorkspace } from '../../ui/v2/geometry.js';
import { moveDesktopQTool } from '../../ui/v2/z-layout.js';

export function financeDesktop(root) {
  return isV2DesktopWorkspace(root?.closest('[data-v2-app]'));
}

// Existing H toolbar. No new layout or visual primitives.
export function financeZActions(root, title, actions = []) {
  if (!financeDesktop(root)) return null;
  const items = actions.filter(Boolean);
  const markup = items.map((item, index) => button(item.label, {
    variant: item.variant || 'secondary',
    className: item.className || '',
    data: 'data-finance-h-action="' + index + '"',
    aria: item.aria || '',
  })).join('');
  const [row] = setV2ZHeaderRows(root, markup ? ['<div class="v2-desktop-tool-row"><div class="v2-desktop-tool-actions">' + markup + '</div></div>'] : [], { desktopTitle: title });
  row?.querySelectorAll('[data-finance-h-action]').forEach(control => {
    control.addEventListener('click', () => items[Number(control.dataset.financeHAction)]?.run(control));
  });
  return row;
}

// Move the original action after its listener has been bound. Its owner/form
// remains unchanged; no duplicate save action or change to submitted data.
export function financeZSave(root, selector, title) {
  if (!financeDesktop(root)) return;
  const body = root.querySelector(':scope > [data-v2-z-body]') || root;
  const control = body.querySelector(selector);
  if (!control) return;
  const wrapper = control.closest('.modal-actions');
  const [row] = setV2ZHeaderRows(root, ['<div class="v2-desktop-tool-row"><div class="v2-desktop-tool-actions"></div></div>'], { desktopTitle: title });
  if (!row) return;
  control.classList.add('ui-button--secondary');
  row.querySelector('.v2-desktop-tool-actions').append(control);
  if (wrapper && !wrapper.children.length) wrapper.remove();
}

export function financeQSubmit(layer, form) {
  if (!financeDesktop(layer) || !form) return;
  const control = form.querySelector('button[type="submit"]');
  if (!control) return;
  if (!moveDesktopQTool(control)) return;
  control.type = 'button';
  control.classList.add('desktop-q-h-action');
  control.addEventListener('click', () => form.requestSubmit());
}
