import {
  button,
  datePicker,
  emptyState,
  initDatePickers,
  list,
  openNotice,
  pageHeader,
} from '../../../ui/ui.js';
import { financeDateRange, financeLocalDateValue } from '../date.js';
import { getZReport } from '../read.js';

function money(value = 0, signed = false) {
  const amount = Number(value) || 0;
  const absolute = Math.abs(amount).toLocaleString('ru-RU').replaceAll('\u00a0', ' ');
  if (!signed || Math.abs(amount) < 0.009) return `${absolute} ₽`;
  return `${amount < 0 ? '−' : '+'}${absolute} ₽`;
}

function summaryList(report) {
  return list({
    items: [
      { title: 'Приход', right: money(report.totals.incoming), interactive: false },
      { title: 'Расход', right: money(report.totals.outgoing), interactive: false },
      { title: 'Чистое движение', right: money(report.totals.netCash, true), interactive: false },
      { title: 'Выручка услуг', right: money(report.totals.serviceRevenue), interactive: false },
      { title: 'Операционные доходы', right: money(report.totals.operatingRevenue), interactive: false },
      { title: 'Продажа товаров', right: money(report.totals.productRevenue), interactive: false },
      { title: 'Операционные расходы', right: money(report.totals.operatingExpense), interactive: false },
      { title: 'Налоги', right: money(report.totals.tax), interactive: false },
      { title: 'Чаевые', right: money(report.totals.tips), interactive: false },
      { title: 'Возвраты', right: money(report.totals.refunds), interactive: false },
      { title: 'Получено займов', right: money(report.totals.loanReceived), interactive: false },
      { title: 'Возвращено займов', right: money(report.totals.loanRepaid), interactive: false },
      { title: 'Получено инвестиций', right: money(report.totals.investmentReceived), interactive: false },
      { title: 'Возвращено инвестиций', right: money(report.totals.investmentReturned), interactive: false },
    ],
  });
}

function breakdown(title, rows = []) {
  if (!rows.length) return '';
  return `<section><h3>${title}</h3>${list({
    items: rows.map((row) => ({
      title: row.label,
      secondary: `Приход ${money(row.incoming)} · Расход ${money(row.outgoing)}`,
      right: money(row.net, true),
      interactive: false,
    })),
  })}</section>`;
}

function renderReport(root, from, to) {
  const range = financeDateRange(from, to);
  if (!range) {
    openNotice({ message: 'Проверьте период отчёта.' });
    return renderZReport(root);
  }
  const report = getZReport(range);
  const content = report.entries.length
    ? `${summaryList(report)}${breakdown('По кошелькам', report.byWallet)}${breakdown('По статьям', report.byArticle)}${breakdown('По экономическому смыслу', report.byEconomicType)}`
    : emptyState('Нет движений', 'За выбранный период в ДДС нет операций.');

  root.innerHTML = `${pageHeader('Z-отчёт', `${from} — ${to}`)}
    <form class="compact-form" data-z-report-form novalidate>
      ${datePicker({ label: 'С', name: 'from', value: from, required: true, allowClear: false })}
      ${datePicker({ label: 'По', name: 'to', value: to, required: true, allowClear: false })}
      ${button('Показать', { type: 'submit' })}
    </form>
    ${content}
    `;

  initDatePickers(root);

  root.querySelector('[data-z-report-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    renderReport(root, String(data.get('from') || ''), String(data.get('to') || ''));
  });
}

export function renderZReport(root) {
  const today = financeLocalDateValue();
  renderReport(root, today, today);
}
