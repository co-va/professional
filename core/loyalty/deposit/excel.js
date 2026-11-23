import {
  button, datePicker, escapeHtml, initDatePickers, modal, mountModal,
  openNotice, selectFile, twoColumnLayout, v2ListEntries, v2ListEntry, v2Section,
} from '../../../ui/ui.js';
import { apiRequest } from '../../auth.js';
import { hydratePeopleFromServer } from '../../people/data.js';
import { hydrateUEIFromServer } from '../../uei.js';
import { refreshFinanceState } from '../../finance/index.js';
import { loadAllDeposits, loadDepositPrograms } from './data.js';

function errorText(value, fallback = 'Не удалось обработать Excel') {
  const message = value?.message;
  return Array.isArray(message) ? message.join('; ') : typeof message === 'string' ? message : fallback;
}
function reportError(error) {
  openNotice({ title: 'Excel', message: error instanceof Error ? error.message : 'Не удалось обработать файл' });
}
async function jsonRequest(path, options = {}) {
  const response = await apiRequest('/loyalty/deposits/excel' + path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorText(data));
  return data;
}
async function download(path, fallback) {
  const response = await apiRequest('/loyalty/deposits/excel' + path);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(errorText(data, 'Не удалось скачать Excel'));
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fallback;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function range(root) {
  const data = new FormData(root);
  const from = String(data.get('from') || '').trim();
  const to = String(data.get('to') || '').trim();
  if (from && to && from > to) throw new Error('Дата «С» не может быть позже «По»');
  return { from, to };
}
function periodFields() {
  return twoColumnLayout(
    datePicker({ label: 'С', name: 'from', value: '', showYear: true, modalVariant: 'q',
      modalSurface: 'app', allowClear: true }),
    datePicker({ label: 'По', name: 'to', value: '', showYear: true, modalVariant: 'q',
      modalSurface: 'app', allowClear: true }),
    { ariaLabel: 'Период операций' },
  );
}
function formatAmount(value) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
    .format(Number(value || 0)) + ' ₽';
}
function openExport(root) {
  const body = '<form class="form-grid" data-deposit-excel-export>'
    + periodFields()
    + button('Выгрузить', { type: 'submit' })
    + '</form>';
  const layer = mountModal(root, modal(body, {
    title: 'Выгрузка Excel', variant: 'x', surface: 'app', xRole: 'action',
  }));
  if (!layer) return;
  initDatePickers(layer);
  const form = layer.querySelector('[data-deposit-excel-export]');
  let working = false;
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (working) return;
    working = true;
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const { from, to } = range(form);
      await download('/export?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to),
        'deposits.xlsx');
      layer.v2Close?.();
    } catch (error) {
      reportError(error);
    } finally {
      working = false;
      if (submit) submit.disabled = false;
    }
  });
}
function previewMarkup(preview) {
  const summary = 'Операций: ' + preview.operations
    + ' · Программ: ' + preview.programs
    + ' · Карточек: ' + preview.deposits
    + (preview.skipped ? ' · Повторов: ' + preview.skipped : '');
  const issues = (preview.errors || []).slice(0, 20).map((item) => v2ListEntry({
    title: 'Строка ' + item.row, subtitle: String(item.message || ''), interactive: false,
  }));
  const entries = (preview.rows || []).slice(0, 12).map((item) => v2ListEntry({
    title: String(item.person || '') + ' · ' + String(item.deposit || ''),
    subtitle: String(item.date || '') + ' · ' + String(item.action || '')
      + (item.wallet ? ' · ' + item.wallet : ''),
    rightTop: formatAmount(item.amount),
    interactive: false,
  }));
  return v2Section('Результат загрузки', '<div>' + escapeHtml(summary) + '</div>')
    + (issues.length ? v2Section('Ошибки', v2ListEntries(issues)) : '')
    + (entries.length ? v2Section('Операции', v2ListEntries(entries)) : '');
}
async function refreshAfterImport(rerender) {
  const remoteResponse = await apiRequest('/business-state/journal');
  if (remoteResponse.ok) {
    const business = await remoteResponse.json().catch(() => ({}));
    hydratePeopleFromServer(Array.isArray(business.people) ? business.people : []);
    hydrateUEIFromServer(business.uei || {});
  }
  await Promise.all([loadDepositPrograms(), loadAllDeposits(), refreshFinanceState()]);
  await rerender?.();
}
function openImportPreview(root, file, rerender) {
  const content = '<form class="form-grid" data-deposit-excel-import>'
    + '<div>' + escapeHtml(file.name) + '</div>'
    + v2Section('Период (необязательно)', periodFields())
    + '<div data-deposit-excel-preview aria-live="polite"></div>'
    + '</form>';
  const layer = mountModal(root, modal(content, {
    title: 'Загрузка Excel', variant: 'q', surface: 'app',
  }));
  if (!layer) return;
  initDatePickers(layer);
  const form = layer.querySelector('[data-deposit-excel-import]');
  const results = layer.querySelector('[data-deposit-excel-preview]');
  const encoded = String(file.dataUrl || '').split(',')[1] || '';
  let latest = null;
  let revision = 0;
  let committing = false;

  async function updatePreview() {
    const current = ++revision;
    latest = null;
    if (!results) return;
    results.textContent = 'Обработка файла…';
    try {
      const dates = range(form);
      const body = { file: encoded, ...dates };
      const preview = await jsonRequest('/preview', {
        method: 'POST', body: JSON.stringify(body),
      });
      if (current !== revision || committing) return;
      latest = preview.ready ? { ...body, batchId: preview.batchId } : null;
      results.innerHTML = previewMarkup(preview)
        + (preview.ready ? button('Загрузить', { type: 'button', data: 'data-deposit-excel-apply' }) : '');
    } catch (error) {
      if (current !== revision || committing) return;
      results.textContent = error instanceof Error ? error.message : 'Ошибка загрузки';
    }
  }

  form?.querySelectorAll('input[name="from"],input[name="to"]').forEach((node) => {
    node.addEventListener('change', () => { void updatePreview(); });
  });
  results?.addEventListener('click', async (event) => {
    const target = event.target?.closest?.('[data-deposit-excel-apply]');
    if (!target || !latest || committing) return;
    committing = true;
    target.disabled = true;
    const body = latest;
    latest = null;
    try {
      const result = await jsonRequest('/apply', {
        method: 'POST', body: JSON.stringify(body),
      });
      layer.v2Close?.();
      openNotice({
        title: 'Excel загружен',
        message: 'Операций: ' + result.imported + '. Повторов пропущено: ' + result.skipped + '.',
      });
      try {
        await refreshAfterImport(rerender);
      } catch (error) {
        reportError(error);
      }
    } catch (error) {
      reportError(error);
      committing = false;
      await updatePreview();
    }
  });
  void updatePreview();
}
async function openImport(root, rerender) {
  const selected = await selectFile({
    accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  if (!selected) return;
  if (!String(selected.name || '').toLowerCase().endsWith('.xlsx')
    || Number(selected.size) > 4 * 1024 * 1024) {
    throw new Error('Выберите файл XLSX размером до 4 МБ');
  }
  openImportPreview(root, selected, rerender);
}

export function openDepositExcelQ(root, rerender = async () => {}) {
  // The same X action menu pattern is used by Inventory Excel.
  const actions = [
    { id: 'export', label: 'Выгрузка', run: () => openExport(root) },
    { id: 'import', label: 'Загрузка', run: () => openImport(root, rerender) },
    { id: 'template', label: 'Шаблон', run: () => download('/template', 'deposits-template.xlsx') },
  ];
  const markup = actions.map((item) => button(item.label, {
    type: 'button', variant: 'secondary',
    data: 'data-deposit-excel-action="' + item.id + '"',
  })).join('');
  const menu = mountModal(root, modal(markup, {
    title: 'Excel', variant: 'x', surface: 'app', xRole: 'action',
  }));
  if (!menu) return null;
  actions.forEach((item) => {
    menu.querySelector('[data-deposit-excel-action="' + item.id + '"]')
      ?.addEventListener('click', () => {
        menu.v2Close?.();
        Promise.resolve().then(item.run).catch(reportError);
      });
  });
  return menu;
}
