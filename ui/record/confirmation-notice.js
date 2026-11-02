import { modal, mountModal } from '../modals/index.js';
import { escapeHtml } from '../utils/escape-html.js';

function numberValue(value) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function money(value) {
  return `${numberValue(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replaceAll('\u00a0', ' ')} ₽`;
}

function bookingDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value || '');
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
}

export function openRecordConfirmationNotice({
  headline = '',
  date = '',
  time = '',
  procedures = [],
  total = null,
  variable = false,
} = {}) {
  const rows = (Array.isArray(procedures) ? procedures : []).map((procedure) => ({
    name: String(procedure?.name || 'Процедура'),
    value: procedure?.value ?? procedure?.cost ?? 0,
    variable: Boolean(procedure?.variable),
    free: Boolean(procedure?.free),
  }));
  const hasVariablePrice = Boolean(variable || rows.some((row) => row.variable));
  const resolvedTotal = total == null
    ? rows.reduce((sum, row) => sum + numberValue(row.value), 0)
    : numberValue(total);
  const moment = [bookingDate(date), String(time || '').trim()].filter(Boolean).join(' · ');
  const rowsHtml = rows.map((row) => `<div class="record-confirmation-notice__row">
    <span>${escapeHtml(row.name)}</span>
    <strong>${row.free ? 'Бесплатно' : `${row.variable ? 'от ' : ''}${money(row.value)}`}</strong>
  </div>`).join('');
  const content = `<div class="record-confirmation-notice">
    ${headline ? `<h2 class="record-confirmation-notice__headline">${escapeHtml(headline)}</h2>` : ''}
    ${moment ? `<div class="record-confirmation-notice__moment">${escapeHtml(moment)}</div>` : ''}
    ${rowsHtml ? `<div class="record-confirmation-notice__procedures">${rowsHtml}</div>` : ''}
    <div class="record-confirmation-notice__total"><span>Итого</span><strong>${hasVariablePrice ? 'от ' : ''}${money(resolvedTotal)}</strong></div>
    <strong class="record-confirmation-notice__status">Запись подтверждена</strong>
  </div>`;
  return mountModal(document.body, modal(content, {
    variant: 's',
    surface: 'app',
    title: headline || 'Запись подтверждена',
    className: 'record-confirmation-notice-s',
  }));
}
