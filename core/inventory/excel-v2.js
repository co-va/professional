import { desktopExcelActionLabel } from '../../ui/buttons/index.js';
import { isV2DesktopWorkspace } from '../../ui/v2/geometry.js';
import {
  button,
  field,
  modal,
  mountModal,
  openNotice,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import { apiRequest } from '../auth.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import {
  getInventoryMovement,
  getInventoryMovements,
} from './data.js';
import {
  correctInventoryMovement,
  createInventoryMovement,
} from './service.js';
import { renderInventory } from './inventory.js';

let activeMovementId = '';
let activeMovementKind = 'CONSUMPTION';
let movementKindListenerReady = false;

function notifyContext() {
  window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
}

function errorMessage(error, fallback = 'Ошибка Excel') {
  return error instanceof Error ? error.message : fallback;
}

async function downloadWorkbook(path, { method = 'GET', body = null, fallback = 'warehouse.xlsx' } = {}) {
  const response = await apiRequest(`/inventory/excel${path}`, {
    method,
    ...(body == null ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || 'Не удалось выгрузить Excel');
  }
  const blob = await response.blob();
  const disposition = String(response.headers.get('content-disposition') || '');
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallback;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function excelAction(trigger, actions = [], title = 'Excel') {
  const desktop = isV2DesktopWorkspace(trigger.closest('[data-v2-app]'));
  const content = actions.map((action) => button(desktop ? desktopExcelActionLabel(action.id, action.label) : action.label, {
    type: 'button',
    variant: 'secondary',
    data: `data-inventory-excel-action="${escapeHtml(action.id)}"`,
  })).join('');
  const modalRoot = mountModal(trigger, modal(desktop ? '<div class="people-action-menu">'+content+'</div>' : content, { title, variant: 'x', ...(desktop ? {surface:'app',xRole:'action',className:'people-action-popup'} : {}) }));
  actions.forEach((action) => {
    modalRoot?.querySelector(`[data-inventory-excel-action="${CSS.escape(action.id)}"]`)?.addEventListener('click', async () => {
      modalRoot.v2Close?.();
      try {
        await action.run();
      } catch (error) {
        openNotice({ title: 'Excel', message: errorMessage(error) });
      }
    });
  });
}

async function refresh(root, section) {
  await renderInventory(root, section);
  enhanceInventoryExcel(root, section);
}

function replaceContextAction(root, action, onClick) {
  const current = root.querySelector('[data-workspace-context-action]');
  if (current) {
    const clone = current.cloneNode(true);
    current.replaceWith(clone);
    clone.dataset.workspaceAKind = action.kind || 'settings';
    clone.dataset.workspaceALabel = action.label || '';
    clone.setAttribute('aria-label', action.aria || action.label || 'Действие');
    clone.addEventListener('click', onClick);
    notifyContext();
    return clone;
  }
  const contextRoot = root.querySelector('[data-workspace-header-context]');
  if (!contextRoot) return null;
  const holder = document.createElement('div');
  holder.innerHTML = workspaceHeaderContext({ title: '', a: action });
  const control = holder.querySelector('[data-workspace-context-action]');
  if (!control) return null;
  contextRoot.appendChild(control);
  control.addEventListener('click', onClick);
  notifyContext();
  return control;
}

export function openInventoryStockExcel(anchor){
  return excelAction(anchor,[{id:'export',label:'Выгрузить',run:()=>downloadWorkbook('/items/export',{fallback:'ostatki.xlsx'})}]);
}
function enhanceStock(root) {
  if(isV2DesktopWorkspace(root.closest('[data-v2-app]')))return;
  replaceContextAction(root,{kind:'settings',label:'Excel',aria:'Excel склада'},event=>openInventoryStockExcel(event.currentTarget));
}

function openMovementExport(trigger) {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now);
  fromDate.setMonth(fromDate.getMonth() - 1);
  const from = fromDate.toISOString().slice(0, 10);
  const content = `<form data-inventory-export-period>
    ${field({ label: 'С', name: 'from', type: 'date', value: from })}
    ${field({ label: 'До', name: 'to', type: 'date', value: to })}
    ${button('Выгрузить', { type: 'submit' })}
  </form>`;
  const modalRoot = mountModal(trigger, modal(content, { title: 'Период', variant: 'x' }));
  modalRoot?.querySelector('[data-inventory-export-period]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await downloadWorkbook(`/movements/export?from=${encodeURIComponent(String(data.get('from') || ''))}&to=${encodeURIComponent(String(data.get('to') || ''))}`, { fallback: 'dvizheniya.xlsx' });
      modalRoot.v2Close?.();
    } catch (error) {
      openNotice({ title: 'Excel', message: errorMessage(error) });
    }
  });
}

function sectionValues() {
  return [...new Set(getInventoryMovements()
    .filter((movement) => movement.procedureKey || movement.sourceType === 'excel-import')
    .flatMap((movement) => (Array.isArray(movement.lines) ? movement.lines : []).map((line) => String(line.note || '').trim()))
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ru'));
}

function sectionDatalist() {
  const values = sectionValues();
  if (!values.length) return '';
  return `<datalist id="inventory-section-values">${values.map((value) => `<option value="${escapeHtml(value)}"></option>`).join('')}</datalist>`;
}

function collectMovementRows(layer, section = '') {
  return [...layer.querySelectorAll('[data-inventory-movement-row]')].map((row) => {
    const index = row.dataset.rowIndex;
    const itemId = row.querySelector(`[name="itemId-${CSS.escape(index)}"]`)?.value || '';
    const quantity = Number(String(row.querySelector(`[name="quantity-${CSS.escape(index)}"]`)?.value || '0').replace(',', '.')) || 0;
    const direction = row.dataset.rowDirection === 'IN' || row.dataset.rowDirection === 'OUT' ? row.dataset.rowDirection : undefined;
    return { itemId, quantity, note: section, ...(direction ? { direction } : {}) };
  }).filter((row) => row.itemId && row.quantity > 0);
}

function enhanceMovementEditor(root, layer) {
  const form = layer?.querySelector('[data-inventory-movement-form]');
  if (!form || form.dataset.inventoryExcelEnhanced === 'true') return;
  form.dataset.inventoryExcelEnhanced = 'true';
  const movement = activeMovementId ? getInventoryMovement(activeMovementId) : null;
  const existingSection = movement?.lines?.find((line) => String(line.note || '').trim())?.note || '';
  const metadata = document.createElement('div');
  metadata.innerHTML = `${sectionDatalist()}
    ${field({ label: 'UEI', name: 'personUei', value: movement?.personUei || '', readonly: Boolean(movement) })}
    ${field({ label: 'Услуга', name: 'procedureKey', value: movement?.procedureKey || '', readonly: Boolean(movement) })}
    ${field({ label: 'Часть / зона', name: 'section', value: existingSection, autocomplete: 'off', data: 'list="inventory-section-values"' })}`;
  const rows = form.querySelector('[data-inventory-movement-rows]');
  if (rows) rows.before(...metadata.childNodes);

  layer.addEventListener('click', async (event) => {
    const control = event.target.closest?.('[data-inventory-movement-save]');
    if (!control || !layer.contains(control)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const data = new FormData(form);
    const lines = collectMovementRows(layer, String(data.get('section') || '').trim());
    if (!lines.length) {
      openNotice({ title: 'Позиции', message: 'Добавьте хотя бы один материал и количество.' });
      return;
    }
    try {
      if (movement) {
        await correctInventoryMovement(movement.movementId, {
          lines,
          note: String(data.get('note') || '').trim(),
        });
      } else {
        await createInventoryMovement({
          kind: activeMovementKind || 'CONSUMPTION',
          sourceType: 'manual',
          personUei: String(data.get('personUei') || '').trim(),
          procedureKey: String(data.get('procedureKey') || '').trim(),
          note: String(data.get('note') || '').trim(),
          lines,
        });
      }
      activeMovementId = '';
      layer.v2Close?.();
      await refresh(root, 'movements');
    } catch (error) {
      openNotice({ title: 'Не удалось сохранить', message: errorMessage(error, 'Ошибка склада') });
    }
  }, true);
}

export function openInventoryMovementExcel(anchor){
  return excelAction(anchor,[{id:'export',label:'Выгрузить за период',run:()=>openMovementExport(anchor)}]);
}
function enhanceMovements(root) {
  if(!isV2DesktopWorkspace(root.closest('[data-v2-app]')))replaceContextAction(root,{kind:'settings',label:'Excel',aria:'Excel движений'},event=>openInventoryMovementExcel(event.currentTarget));

  if (root.dataset.inventoryMovementEnhancer === 'true') return;
  root.dataset.inventoryMovementEnhancer = 'true';
  root.addEventListener('click', (event) => {
    const movementControl = event.target.closest?.('[data-inventory-movement]');
    if (movementControl) activeMovementId = String(movementControl.dataset.inventoryMovement || '');
    if (event.target.closest?.('[data-inventory-add-movement]')) activeMovementId = '';
    if (movementControl || event.target.closest?.('[data-inventory-kind]')) {
      queueMicrotask(() => {
        const layers = root.querySelectorAll('.inventory-movement-z');
        enhanceMovementEditor(root, layers[layers.length - 1]);
      });
    }
  }, true);
}

function ensureMovementKindListener() {
  if (movementKindListenerReady) return;
  movementKindListenerReady = true;
  document.addEventListener('click', (event) => {
    const control = event.target.closest?.('[data-inventory-kind]');
    if (!control) return;
    activeMovementKind = String(control.dataset.inventoryKind || 'CONSUMPTION');
  }, true);
}

export function enhanceInventoryExcel(root, section = 'stock') {
  // Purchase Orders own their complete Z1/Q/Z2 interface in orders.js.
  // Excel may extend Stock and Movements, but must never replace an Order screen.
  if (!root || (section !== 'stock' && section !== 'movements')) return;
  ensureMovementKindListener();
  if (section === 'stock') enhanceStock(root);
  else enhanceMovements(root);
}
