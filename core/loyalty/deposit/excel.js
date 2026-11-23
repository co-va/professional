import {
  actionBlock, button, datePicker, field, initDatePickers,
  modal, mountModal, openNotice, twoColumnLayout, v2ListEntries, v2ListEntry, v2Section,
} from '../../../ui/ui.js';
import { apiRequest } from '../../auth.js';
import { hydratePeopleFromServer } from '../../people/data.js';
import { hydrateUEIFromServer } from '../../uei.js';
import { refreshFinanceState } from '../../finance/index.js';
import { loadAllDeposits, loadDepositPrograms } from './data.js';

function failure(value, fallback = 'Не удалось обработать Excel') {
  const message = value?.message;
  return Array.isArray(message) ? message.join('; ') : typeof message === 'string' ? message : fallback;
}
async function jsonRequest(path, options = {}) {
  const response = await apiRequest('/loyalty/deposits/excel' + path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(failure(data));
  return data;
}
async function download(path, fallback) {
  const response = await apiRequest('/loyalty/deposits/excel' + path);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(failure(data, 'Не удалось скачать Excel'));
  }
  const blob = await response.blob();
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = fallback;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}
function formatAmount(n) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(n || 0)) + ' ₽';
}

export function openDepositExcelQ(root, rerender = async () => {}) {
  const content = '<form class="form-grid" data-deposit-excel-form>'
    + v2Section('Шаблон', actionBlock(button('Скачать шаблон', {
      type: 'button', variant: 'secondary', data: 'data-deposit-excel-template',
    })))
    + v2Section('Период операций', twoColumnLayout(
      datePicker({ label: 'С', name: 'from', value: '', showYear: true,
        modalVariant: 'q', modalSurface: 'app', allowClear: true }),
      datePicker({ label: 'По', name: 'to', value: '', showYear: true,
        modalVariant: 'q', modalSurface: 'app', allowClear: true }),
      { ariaLabel: 'Период операций Excel' },
    ))
    + actionBlock(button('Выгрузить', { type: 'button', variant: 'secondary',
      data: 'data-deposit-excel-export' }))
    + v2Section('Загрузка', field({ label: 'Заполненный Excel', name: 'file', type: 'file' }))
    + actionBlock(button('Проверить', { type: 'button', data: 'data-deposit-excel-check' }))
    + '<div data-deposit-excel-preview aria-live="polite"></div></form>';
  const layer = mountModal(root, modal(content, {
    variant: 'q', surface: 'app', title: 'Excel', className: 'loyalty-deposit-excel-q',
  }));
  if (!layer) return null;
  initDatePickers(layer);
  const form = layer.querySelector('[data-deposit-excel-form]');
  const host = layer.querySelector('[data-deposit-excel-preview]');
  const period = () => {
    const values = new FormData(form);
    const from = String(values.get('from') || '').trim();
    const to = String(values.get('to') || '').trim();
    if (from && to && from > to) throw new Error('Дата «С» не может быть позже «По»');
    return { from, to };
  };
  const error = (e) => openNotice({
    title: 'Excel', message: e instanceof Error ? e.message : 'Ошибка обработки Excel',
  });
  let prepared = null;
  let busy = false;
  const locked = async (fn) => {
    if (busy) return;
    busy = true;
    form?.querySelectorAll('button').forEach(node => { node.disabled = true; });
    try { await fn(); }
    catch (e) { error(e); }
    finally {
      busy = false;
      form?.querySelectorAll('button').forEach(node => { node.disabled = false; });
    }
  };
  layer.querySelector('[data-deposit-excel-template]')?.addEventListener('click', () => {
    locked(() => download('/template', 'deposits-template.xlsx'));
  });
  layer.querySelector('[data-deposit-excel-export]')?.addEventListener('click', () => {
    locked(async () => {
      const { from, to } = period();
      await download('/export?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to), 'deposits.xlsx');
    });
  });
  const fileInput = layer.querySelector('input[name="file"]');
  const reset = () => { prepared = null; if (host) host.innerHTML = ''; };
  fileInput?.addEventListener('change', reset);
  form?.querySelectorAll('[name="from"],[name="to"]').forEach(node => node.addEventListener('change', reset));
  layer.querySelector('[data-deposit-excel-check]')?.addEventListener('click', () => {
    locked(async () => {
      reset();
      const file = fileInput?.files?.[0];
      if (!file) throw new Error('Выберите заполненный файл XLSX');
      if (!String(file.name).toLowerCase().endsWith('.xlsx') || file.size > 4 * 1024 * 1024)
        throw new Error('Нужен XLSX размером до 4 МБ');
      const base64 = await readBase64(file);
      const dates = period();
      const body = { file: base64, ...dates };
      const preview = await jsonRequest('/preview', { method: 'POST', body: JSON.stringify(body) });
      const summary = '<div>Операций: ' + preview.operations + ', пропущено повторов: ' + preview.skipped
        + ', программ: ' + preview.programs + ', новых контактов: ' + preview.people + '</div>';
      const issues = (preview.errors || []).map(e => v2ListEntry({
        title: 'Строка ' + e.row, subtitle: String(e.message || ''), interactive: false,
      }));
      const entries = (preview.rows || []).slice(0, 20).map(e => v2ListEntry({
        title: String(e.person || '') + ' · ' + String(e.deposit || ''),
        subtitle: String(e.date || '') + ' · ' + String(e.action || '') + ' · ' + String(e.wallet || ''),
        rightTop: formatAmount(e.amount), interactive: false,
      }));
      host.innerHTML = [
        v2Section('Результат проверки', summary),
        issues.length ? v2Section('Ошибки', v2ListEntries(issues)) : '',
        entries.length ? v2Section('Операции', v2ListEntries(entries)) : '',
        preview.ready ? actionBlock(button('Применить', {
          type: 'button', data: 'data-deposit-excel-apply',
        })) : '',
      ].join('');
      if (!preview.ready) return;
      prepared = { ...body, batchId: preview.batchId };
      host.querySelector('[data-deposit-excel-apply]')?.addEventListener('click', () => {
        locked(async () => {
          if (!prepared) return;
          const result = await jsonRequest('/apply', {
            method: 'POST', body: JSON.stringify(prepared),
          });
          const remoteResponse = await apiRequest('/business-state/journal');
          if (remoteResponse.ok) {
            const business = await remoteResponse.json().catch(() => ({}));
            hydratePeopleFromServer(Array.isArray(business.people) ? business.people : []);
            hydrateUEIFromServer(business.uei || {});
          }
          await Promise.all([loadDepositPrograms(), loadAllDeposits(), refreshFinanceState()]);
          layer.v2Close?.();
          await rerender?.();
          openNotice({
            title: 'Excel загружен',
            message: 'Операций: ' + result.imported + '. Повторов пропущено: ' + result.skipped + '.',
          });
        });
      });
    });
  });
  return layer;
}
