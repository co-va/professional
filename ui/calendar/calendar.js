import { modal, mountModal } from '../modals/index.js';
import { button } from '../buttons/index.js';
import { select } from '../selectors/index.js';
import { escapeHtml } from '../utils/escape-html.js';

const MONTH_FORMATTER = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });
const MONTH_ONLY_FORMATTER = new Intl.DateTimeFormat('ru-RU', { month: 'long' });
const DATE_FORMATTER = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const MONTH_DAY_FORMATTER = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const MONTH_DAY_REFERENCE_YEAR = 2000;

function pad(value) {
  return String(value).padStart(2, '0');
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthDayKey(date) {
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseMonthDay(value = '') {
  const text = String(value || '').trim();
  const direct = text.match(/^(\d{2})-(\d{2})$/);
  const fullDate = text.match(/^\d{4}-(\d{2})-(\d{2})$/);
  const match = direct || fullDate;
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1) return null;
  const date = new Date(MONTH_DAY_REFERENCE_YEAR, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function parseDateValue(value = '') {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function compactDateLabel(value = '') {
  const date = value instanceof Date ? value : parseDateValue(value);
  return date ? `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}` : '';
}

function startOfMondayWeek(date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - weekday);
  return result;
}

function endOfSundayWeek(date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() + (6 - weekday));
  return result;
}

function capitalize(label) {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function monthLabel(date, mode = 'date') {
  return capitalize((mode === 'month-day' ? MONTH_ONLY_FORMATTER : MONTH_FORMATTER).format(date));
}

function dateLabel(date) {
  return capitalize(DATE_FORMATTER.format(date));
}

function monthDayLabel(value) {
  const date = value instanceof Date ? value : parseMonthDay(value);
  return date ? MONTH_DAY_FORMATTER.format(date) : '';
}

function normalizeModalVariant() {
  return 'q';
}

function calendarHeader({ label, prevAriaLabel, nextAriaLabel, prevAttribute, nextAttribute }) {
  return `<header class="calendar__header"><button type="button" class="calendar__month-button" ${prevAttribute} aria-label="${prevAriaLabel}">←</button><div class="calendar__month" aria-live="polite">${label}</div><button type="button" class="calendar__month-button" ${nextAttribute} aria-label="${nextAriaLabel}">→</button></header>`;
}

function normalizeDateIndicators(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === 'string') return { color: item, label: '' };
    if (!item || typeof item !== 'object') return null;
    return { color: String(item.color || ''), label: String(item.label || '') };
  }).filter((item) => item?.color);
}

function dateIndicatorsMarkup(indicators) {
  const values = normalizeDateIndicators(indicators);
  if (!values.length) return '';
  return `<span class="calendar__date-indicators">${values.map((item) => `<span class="calendar__date-indicator" style="--calendar-indicator:${escapeHtml(item.color)}"${item.label ? ` role="img" aria-label="${escapeHtml(item.label)}" title="${escapeHtml(item.label)}"` : ' aria-hidden="true"'}></span>`).join('')}</span>`;
}

function buildCalendar({ displayedMonth, workingDates = [], renderDateContent = () => '', resolveDateIndicators = () => [], mode = 'date', selectedValue = '' } = {}) {
  const year = displayedMonth.getFullYear();
  const month = displayedMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const start = startOfMondayWeek(firstDay);
  const end = endOfSundayWeek(lastDay);
  const today = new Date();
  const todayKey = dateKey(today);
  const working = new Set(workingDates);
  const cells = [];

  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const date = new Date(cursor);
    const key = mode === 'month-day' ? monthDayKey(date) : dateKey(date);
    const fullKey = dateKey(date);
    const isCurrentMonth = date.getMonth() === month;
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const isToday = mode === 'date' && fullKey === todayKey;
    const isSelected = String(selectedValue || '') === key;
    const isWorking = working.has(fullKey);
    const classes = [
      'calendar__date',
      isCurrentMonth ? '' : 'is-neighbor',
      isWeekend ? 'is-weekend' : '',
      isWorking ? 'is-working' : '',
      isToday ? 'is-today' : '',
      isSelected ? 'is-selected' : '',
    ].filter(Boolean).join(' ');
    const dateMeta = { date, dateKey: key, isCurrentMonth, isWeekend, isWorking, isToday, isSelected };
    const content = renderDateContent(dateMeta);
    const indicators = mode === 'date' ? dateIndicatorsMarkup(resolveDateIndicators(dateMeta)) : '';

    cells.push(`<button type="button" class="${classes}" data-calendar-date="${key}" data-calendar-current-month="${isCurrentMonth}" aria-pressed="${isSelected ? 'true' : 'false'}"><span class="calendar__date-number">${date.getDate()}</span>${content ? `<span class="calendar__date-content">${content}</span>` : '<span class="calendar__date-content" aria-hidden="true"></span>'}${indicators}</button>`);
  }

  return `<section class="calendar" data-calendar data-calendar-mode="${mode}">${calendarHeader({ label: monthLabel(displayedMonth, mode), prevAriaLabel: 'Предыдущий месяц', nextAriaLabel: 'Следующий месяц', prevAttribute: 'data-calendar-prev', nextAttribute: 'data-calendar-next' })}<div class="calendar__weekdays" aria-hidden="true">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => `<span>${day}</span>`).join('')}</div><div class="calendar__grid">${cells.join('')}</div></section>`;
}

function initialMonth(options = {}) {
  if (options.month) return new Date(options.month.getFullYear(), options.month.getMonth(), 1);
  if (options.mode === 'month-day') {
    const selected = parseMonthDay(options.selectedValue);
    if (selected) return new Date(MONTH_DAY_REFERENCE_YEAR, selected.getMonth(), 1);
    return new Date(MONTH_DAY_REFERENCE_YEAR, new Date().getMonth(), 1);
  }
  return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
}

export function calendar(options = {}) {
  const displayedMonth = initialMonth(options);
  return buildCalendar({ ...options, displayedMonth });
}

export function initCalendar(root, options = {}) {
  let displayedMonth = initialMonth(options);
  const mode = options.mode || 'date';
  const workingDates = options.workingDates || [];
  const renderDateContent = options.renderDateContent || (() => '');
  const resolveDateIndicators = options.resolveDateIndicators || (() => []);
  const onDateSelect = options.onDateSelect || (() => {});
  const onMonthChange = options.onMonthChange || (() => {});
  let selectedValue = mode === 'month-day' ? (parseMonthDay(options.selectedValue) ? monthDayKey(parseMonthDay(options.selectedValue)) : '') : String(options.selectedValue || '');
  const render = () => {
    root.innerHTML = buildCalendar({ displayedMonth, workingDates, renderDateContent, resolveDateIndicators, mode, selectedValue });
    root.querySelector('[data-calendar-prev]')?.addEventListener('click', () => {
      displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() - 1, 1);
      render();
      onMonthChange(new Date(displayedMonth));
    });
    root.querySelector('[data-calendar-next]')?.addEventListener('click', () => {
      displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + 1, 1);
      render();
      onMonthChange(new Date(displayedMonth));
    });
    root.querySelectorAll('[data-calendar-date]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedValue = button.dataset.calendarDate || '';
        onDateSelect(selectedValue);
      });
    });
  };

  render();

  return {
    getDisplayedMonth: () => new Date(displayedMonth),
    getSelectedValue: () => selectedValue,
  };
}

export function datePicker({
  name = '',
  label = '',
  value = '',
  placeholder = 'Выберите дату',
  min = '',
  max = '',
  minYear = null,
  maxYear = null,
  initialYear = null,
  showYear = true,
  modalVariant = 'standard',
  modalClassName = '',
  modalSurface = '',
  allowClear = true,
  required = false,
} = {}) {
  const parsed = parseDateValue(value);
  const normalized = parsed ? dateKey(parsed) : '';
  const text = normalized ? compactDateLabel(normalized) : placeholder;
  const attrs = [
    'data-date-picker',
    `data-date-picker-min="${escapeHtml(String(min || ''))}"`,
    `data-date-picker-max="${escapeHtml(String(max || ''))}"`,
    `data-date-picker-min-year="${escapeHtml(minYear == null ? '' : String(minYear))}"`,
    `data-date-picker-max-year="${escapeHtml(maxYear == null ? '' : String(maxYear))}"`,
    `data-date-picker-initial-year="${escapeHtml(initialYear == null ? '' : String(initialYear))}"`,
    `data-date-picker-show-year="${showYear ? 'true' : 'false'}"`,
    `data-date-picker-modal-variant="${escapeHtml(modalVariant)}"`,
    `data-date-picker-modal-class="${escapeHtml(modalClassName)}"`,
    `data-date-picker-modal-surface="${escapeHtml(modalSurface)}"`,
    `data-date-picker-placeholder="${escapeHtml(placeholder)}"`,
    `data-date-picker-allow-clear="${allowClear ? 'true' : 'false'}"`,
  ].join(' ');
  return `<label class="field" ${attrs}><span>${escapeHtml(label)}${required ? ' *' : ''}</span><button type="button" class="ui-select__control" data-date-picker-open><span class="ui-select__value">${escapeHtml(text)}</span><span class="ui-select__chevron" aria-hidden="true">⌄</span></button><input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(normalized)}" data-date-picker-value${required ? ' required' : ''}></label>`;
}

export function initDatePickers(root) {
  root.querySelectorAll('[data-date-picker]').forEach((host) => {
    const openButton = host.querySelector('[data-date-picker-open]');
    if (!openButton || openButton.dataset.datePickerReady === 'true') return;
    openButton.dataset.datePickerReady = 'true';
    openButton.addEventListener('click', () => openDatePicker(host));
  });
}

function dateYearOptions(minYear, maxYear) {
  const low = Math.min(minYear, maxYear);
  const high = Math.max(minYear, maxYear);
  return Array.from({ length: high - low + 1 }, (_, index) => {
    const year = high - index;
    return { value: String(year), label: String(year) };
  });
}

function openDatePicker(host) {
  const hidden = host.querySelector('[data-date-picker-value]');
  if (!hidden) return;

  const now = new Date();
  const current = parseDateValue(hidden.value);
  const minDate = parseDateValue(host.dataset.datePickerMin || '');
  const maxDate = parseDateValue(host.dataset.datePickerMax || '');
  const minYearText = String(host.dataset.datePickerMinYear || '').trim();
  const maxYearText = String(host.dataset.datePickerMaxYear || '').trim();
  const initialYearText = String(host.dataset.datePickerInitialYear || '').trim();
  const declaredMinYear = minYearText ? Number(minYearText) : Number.NaN;
  const declaredMaxYear = maxYearText ? Number(maxYearText) : Number.NaN;
  const declaredInitialYear = initialYearText ? Number(initialYearText) : Number.NaN;
  const minYear = Number.isInteger(declaredMinYear)
    ? declaredMinYear
    : (minDate?.getFullYear() ?? now.getFullYear() - 100);
  const maxYear = Number.isInteger(declaredMaxYear)
    ? declaredMaxYear
    : (maxDate?.getFullYear() ?? now.getFullYear() + 5);
  const initialYear = Number.isInteger(declaredInitialYear)
    ? Math.max(minYear, Math.min(maxYear, declaredInitialYear))
    : Math.max(minYear, Math.min(maxYear, now.getFullYear()));
  const placeholder = host.dataset.datePickerPlaceholder || 'Выберите дату';
  const showYear = host.dataset.datePickerShowYear !== 'false';
  const modalVariant = normalizeModalVariant(host.dataset.datePickerModalVariant || 'standard');
  const modalClassName = host.dataset.datePickerModalClass || '';
  const modalSurface = host.dataset.datePickerModalSurface || '';
  const allowClear = host.dataset.datePickerAllowClear !== 'false';
  let displayed = current
    ? new Date(current.getFullYear(), current.getMonth(), 1)
    : new Date(initialYear, now.getMonth(), 1);
  let selectedValue = current ? dateKey(current) : '';

  const content = `<div class="form-grid">${showYear ? '<div data-date-picker-year></div>' : ''}<div data-date-picker-calendar></div>${allowClear && selectedValue ? button('Очистить дату', { variant: 'secondary', data: 'data-date-picker-clear' }) : ''}</div>`;
  const modalRoot = mountModal(document.body, modal(content, {
    variant: modalVariant,
    className: modalClassName,
    surface: modalSurface,
    title: host.querySelector(':scope > span')?.textContent?.replace(/\s*\*$/, '') || 'Дата',
  }));
  if (!modalRoot) return;
  const yearHost = modalRoot.querySelector('[data-date-picker-year]');
  const calendarHost = modalRoot.querySelector('[data-date-picker-calendar]');
  if (!calendarHost) return;

  const withinRange = (value) => {
    const parsed = parseDateValue(value);
    if (!parsed) return false;
    const key = dateKey(parsed);
    if (minDate && key < dateKey(minDate)) return false;
    if (maxDate && key > dateKey(maxDate)) return false;
    return parsed.getFullYear() >= minYear && parsed.getFullYear() <= maxYear;
  };

  const setVisible = (value) => {
    const visible = host.querySelector('.ui-select__value');
    if (visible) visible.textContent = value ? compactDateLabel(value) : placeholder;
  };

  const emit = () => {
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const commit = (value) => {
    if (!withinRange(value)) return;
    hidden.value = value;
    setVisible(value);
    emit();
    modalRoot.v2Close?.();
  };

  const mountCalendar = () => {
    initCalendar(calendarHost, {
      selectedValue,
      month: new Date(displayed.getFullYear(), displayed.getMonth(), 1),
      onMonthChange: (month) => {
        displayed = month;
        if (showYear) setYearControl();
      },
      onDateSelect: (value) => {
        selectedValue = value;
        commit(value);
      },
    });
  };

  const setYearControl = () => {
    if (!showYear || !yearHost) return;
    yearHost.innerHTML = select({
      label: 'Год',
      name: 'sharedDatePickerYear',
      value: String(displayed.getFullYear()),
      options: dateYearOptions(minYear, maxYear),
      aria: 'Год',
    });
    yearHost.querySelector('[name="sharedDatePickerYear"]')?.addEventListener('change', (event) => {
      const year = Number(event.target.value);
      if (!Number.isInteger(year)) return;
      displayed = new Date(year, displayed.getMonth(), 1);
      mountCalendar();
    });
  };

  if (showYear) setYearControl();
  mountCalendar();

  modalRoot.querySelector('[data-date-picker-clear]')?.addEventListener('click', () => {
    hidden.value = '';
    selectedValue = '';
    setVisible('');
    emit();
    modalRoot.v2Close?.();
  });
}

export function monthDayPicker({ name = '', label = '', value = '' } = {}) {
  const parsed = parseMonthDay(value);
  const normalized = parsed ? monthDayKey(parsed) : '';
  const text = normalized ? monthDayLabel(normalized) : 'Выберите дату';
  return `<label class="field" data-month-day-picker><span>${escapeHtml(label)}</span><button type="button" class="ui-select__control" data-month-day-open><span class="ui-select__value">${escapeHtml(text)}</span><span class="ui-select__chevron" aria-hidden="true">⌄</span></button><input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(normalized)}" data-month-day-value></label>`;
}

export function initMonthDayPickers(root) {
  root.querySelectorAll('[data-month-day-picker]').forEach((host) => {
    const openButton = host.querySelector('[data-month-day-open]');
    if (!openButton || openButton.dataset.monthDayReady === 'true') return;
    openButton.dataset.monthDayReady = 'true';
    openButton.addEventListener('click', () => openMonthDayPicker(host));
  });
}

function openMonthDayPicker(host) {
  const hidden = host.querySelector('[data-month-day-value]');
  if (!hidden) return;
  const current = parseMonthDay(hidden.value);
  const content = `<div class="modal-title"><h2>${escapeHtml(host.querySelector(':scope > span')?.textContent || 'Дата')}</h2></div><div data-month-day-calendar></div>${hidden.value ? `<div class="modal-actions">${button('Очистить', { data: 'data-month-day-clear', variant: 'secondary' })}</div>` : ''}`;
  const modalRoot = mountModal(document.body, modal(content, { variant: 'q', title: host.querySelector(':scope > span')?.textContent || 'Дата' }));
  if (!modalRoot) return;
  const calendarRoot = modalRoot.querySelector('[data-month-day-calendar]');
  if (!calendarRoot) return;

  initCalendar(calendarRoot, {
    mode: 'month-day',
    selectedValue: current ? monthDayKey(current) : '',
    month: new Date(MONTH_DAY_REFERENCE_YEAR, current?.getMonth() ?? new Date().getMonth(), 1),
    onDateSelect: (value) => {
      hidden.value = value;
      const visible = host.querySelector('.ui-select__value');
      if (visible) visible.textContent = monthDayLabel(value);
      hidden.dispatchEvent(new Event('input', { bubbles: true }));
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
      modalRoot.v2Close?.();
    },
  });

  modalRoot.querySelector('[data-month-day-clear]')?.addEventListener('click', () => {
    hidden.value = '';
    const visible = host.querySelector('.ui-select__value');
    if (visible) visible.textContent = 'Выберите дату';
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
    modalRoot.v2Close?.();
  });
}

export function dateNavigator({ date = new Date() } = {}) {
  return calendarHeader({
    label: dateLabel(date),
    prevAriaLabel: 'Предыдущий день',
    nextAriaLabel: 'Следующий день',
    prevAttribute: 'data-date-navigator-prev',
    nextAttribute: 'data-date-navigator-next',
  });
}

export function initDateNavigator(root, { date = new Date(), onChange = () => {} } = {}) {
  let currentDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const render = () => {
    root.innerHTML = dateNavigator({ date: currentDate });
    root.querySelector('[data-date-navigator-prev]')?.addEventListener('click', () => {
      currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - 1);
      render();
      onChange(new Date(currentDate));
    });
    root.querySelector('[data-date-navigator-next]')?.addEventListener('click', () => {
      currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1);
      render();
      onChange(new Date(currentDate));
    });
  };

  render();

  return {
    getDate: () => new Date(currentDate),
  };
}
