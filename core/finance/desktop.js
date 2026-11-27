import { button, dataTable, escapeHtml, modal, mountModal, openNotice, setV2ZHeaderRows } from '../../ui/ui.js';
import { isV2DesktopWorkspace } from '../../ui/v2/geometry.js';
import { moveDesktopQTool } from '../../ui/v2/z-layout.js';
import { formatPhone } from '../phone/index.js';

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

// Financial table contact uses the operation snapshot first, then an exact
// contact identity match. Never infer a phone from a person's name.
export function financeTableContact(item = {}, people = []) {
  const person = item.person || {};
  const code = String(person.uei || '').trim();
  const key = String(person.key || person.personKey || item.personKey || '').trim();
  const linked = people.find(candidate => (key && String(candidate.key) === key) || (code && String(candidate.uei) === code));
  const counterparty = item.counterparty;
  const partyName = typeof counterparty === 'string' ? counterparty : String(counterparty?.name || '');
  const name = [person.name, person.surname].filter(Boolean).join(' ').trim() || partyName;
  const phone = person.phones?.[0] || person.phone || (name && !person.name ? counterparty?.phone || item.counterpartyPhone : '') || linked?.phones?.[0] || linked?.phone || '';
  return { code: code || linked?.uei || '', person: name, contact: phone ? formatPhone(phone) : '' };
}

function twoLineCell(top, bottom = '', { contact = false } = {}) {
  const primary=escapeHtml(top||'—'),secondary=escapeHtml(bottom||(contact?'':'—'));
  return '<div><div class="people-table-person__name" title="'+primary+'">'+primary+'</div><div class="people-table-person__phone" title="'+secondary+'">'+secondary+'</div></div>';
}

function twoLineHeading(top, bottom) {
  return '<div>' + escapeHtml(top) + '</div><div>' + escapeHtml(bottom) + '</div>';
}

// Existing compact table; whole-row click delegates to the keyboard-accessible
// operation button, just as in the accepted Deposit list.
export function financeHistoryTable(rows, caption, columns) {
  return dataTable({ compact: true, caption, columns: columns.map(column => ({
    ...column, sortable: false,
    ...(column.key === 'date' ? { label: 'Дата', header: () => twoLineHeading('Дата', 'Время'), render: row => { const [date, time] = String(row.date || '').trim().split(/\s+/, 2); return twoLineCell(date, time); } } : {}),
    ...(column.key === 'person' ? { label: 'Клиент / контрагент', header: () => twoLineHeading('Клиент / контрагент', 'Контакт'), render: row => twoLineCell(row.person, row.contact, { contact: true }) } : {}),
    ...(column.key === 'workplace' ? (column.secondaryKey ? { header: () => '<div title="Рабочее пространство">Пространство</div><div>'+escapeHtml(column.secondaryLabel)+'</div>', render: row => twoLineCell(row.workplace,row[column.secondaryKey],{contact:true}) } : { header: () => twoLineHeading('Рабочее', 'пространство') }) : {}),
    ...(column.key === 'article' && column.articleValue ? { header: () => twoLineHeading('Статья','Значение'), render: row => twoLineCell(row.article,row.articleValue,{contact:true}) } : {}),
    ...(column.key === 'title' ? {
      ...(column.secondaryKey ? { header: () => twoLineHeading(column.label, column.secondaryLabel) } : {}),
      render: row => '<button type="button" data-finance-history-row="' + escapeHtml(row.id) + '" aria-label="' + escapeHtml(row.title) + '">' + (column.secondaryKey ? twoLineCell(row.displayTitle || row.title, row[column.secondaryKey]) : escapeHtml(row.displayTitle || row.title)) + '</button>',
    } : {}),
  })), rows });
}

export function bindFinanceHistoryTable(root, open) {
  root.querySelectorAll('[data-finance-history-row]').forEach(control => {
    (control.closest('tr') || control).addEventListener('click', () => open(control.dataset.financeHistoryRow));
  });
}

// Financial document: X in both layouts, actions below the receipt.
export function openFinanceReceiptX(root, title, receipt, actions = [], { actionLayout = '' } = {}) {
  const desktop = financeDesktop(root);
  const available = actions.filter(Boolean);
  const tools = available.map((item, index) => button(item.label, {
    variant: item.variant || 'secondary',
    data: 'data-finance-receipt-action="' + index + '"',
    aria: item.aria || '',
  })).join('');
  const footerClass = desktop ? 'modal-actions finance-receipt-actions' + (actionLayout === 'dds' ? ' finance-receipt-actions--dds' : '') : 'modal-actions';
  const layer = mountModal(root, modal(receipt + (tools ? '<div class="' + footerClass + '">' + tools + '</div>' : ''), { title, variant: 'x', surface: 'app' }));
  if (!layer) return null;
  layer.querySelectorAll('[data-finance-receipt-action]').forEach(control => {
    const action = available[Number(control.dataset.financeReceiptAction)];
    control.addEventListener('click', () => action.run(layer));
  });
  return layer;
}


// Reuse the canonical X deletion-confirmation contract. The document remains
// open until an explicit, successful confirmation; dismissing X is harmless.
export function openFinanceDeleteConfirmation(receipt, { message, onConfirm, onSuccess, closeOwner = true }) {
  const title = 'Удалить?';
  const content = `<div class="modal-title"><h2>${title}</h2><p>${escapeHtml(message)}</p></div>
    <div class="modal-actions">
      ${button('Отмена', { variant: 'secondary', data: 'data-finance-delete-close' })}
      ${button('Удалить', { variant: 'danger', data: 'data-finance-delete-confirm' })}
    </div>`;
  const confirmation = mountModal(receipt, modal(content, { title, variant: 'x', surface: 'app' }));
  if (!confirmation) return null;
  const cancel = confirmation.querySelector('[data-finance-delete-close]');
  const confirm = confirmation.querySelector('[data-finance-delete-confirm]');
  let pending = false;
  cancel?.addEventListener('click', () => { if (!pending) confirmation.v2Close?.(); });
  confirm?.addEventListener('click', async () => {
    if (pending) return;
    pending = true;
    confirm.disabled = true;
    if (cancel) cancel.disabled = true;
    try {
      const result = await onConfirm();
      if (result === false || result === null) throw new Error('Не удалось удалить');
      confirmation.v2Close?.();
      if (closeOwner) receipt.v2Close?.();
      onSuccess?.();
    } catch (error) {
      openNotice({ message: String(error?.message || 'Не удалось удалить') });
    } finally {
      pending = false;
      confirm.disabled = false;
      if (cancel) cancel.disabled = false;
    }
  });
  return confirmation;
}
