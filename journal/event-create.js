import {
  colorPicker,
  field,
  initColorPickers,
  initTimePickers,
  openNotice,
  textareaField,
  timePicker,
} from '../ui/ui.js';
import { checkTimeAvailability, minutesToTime, timeToMinutes } from '../core/time/index.js';
import { createEvent, removeEvent } from '../core/event/index.js';
import { flushBusinessPersistence } from '../core/business-persistence.js';

function initialTo(from) {
  const minute = timeToMinutes(from);
  if (minute == null) return '09:30';
  const next = Math.min(23 * 60 + 59, minute + 30);
  return minutesToTime(next) || '09:30';
}

function availabilityMessage(reason = '') {
  if (reason === 'occupied') return 'Это время уже занято.';
  if (reason === 'day-not-working' || reason === 'outside-working-time') return 'Время находится вне рабочего графика.';
  return 'Проверьте время события.';
}

function timeRangeValid(from, to) {
  const start = timeToMinutes(from);
  const end = timeToMinutes(to);
  return start != null && end != null && end > start;
}

export function createJournalEventFlow({ owner, date, workplaceId, timeHint = '', onCreated = () => {} } = {}) {
  if (!owner) return null;
  const initialFrom = String(timeHint || '09:00').slice(0, 5);
  const state = {
    date: String(date || '').slice(0, 10),
    workplaceId: String(workplaceId || ''),
    from: initialFrom,
    to: initialTo(initialFrom),
    title: '',
    description: '',
    color: '#777A7D',
  };

  const validateSelection = ({ from = state.from, to = state.to } = {}) => {
    if (!timeRangeValid(from, to)) {
      openNotice({ title: 'Событие', message: 'Время окончания должно быть позже времени начала.' });
      return false;
    }
    const availability = checkTimeAvailability({
      date: state.date,
      workplaceId: state.workplaceId,
      from,
      to,
    });
    if (!availability.ok) {
      openNotice({ title: 'Событие', message: availabilityMessage(availability.reason) });
      return false;
    }
    return true;
  };

  const render = () => {
    const view = owner.render({
      step: 'event',
      title: false,
      body: `<form class="form-grid" data-event-create-form>
        <div class="user-event-color-picker">${colorPicker({ name: 'color', value: state.color })}</div>
        <div class="time-range-fields">
          ${timePicker({ label: 'С', name: 'from', value: state.from, minuteStep: 1 })}
          ${timePicker({ label: 'До', name: 'to', value: state.to, minuteStep: 1 })}
        </div>
        ${field({ label: 'Наименование', name: 'title', value: state.title, required: true })}
        ${textareaField({ label: 'Описание', name: 'description', value: state.description, rows: 6 })}
      </form>`,
      action: { label: 'Создать', data: 'data-event-create' },
    });
    if (!view) return;
    initTimePickers(view.body);
    initColorPickers(view.body);

    view.action?.addEventListener('click', async (event) => {
      const form = view.body.querySelector('[data-event-create-form]');
      const data = form ? new FormData(form) : new FormData();
      state.from = String(data.get('from') || state.from).slice(0, 5);
      state.to = String(data.get('to') || state.to).slice(0, 5);
      state.title = String(data.get('title') || '').trim();
      state.description = String(data.get('description') || '').trim();
      state.color = String(data.get('color') || state.color || '#777A7D');

      if (!state.title) return openNotice({ title: 'Событие', message: 'Укажите наименование события.' });
      if (!validateSelection()) return;

      const submit = event.currentTarget;
      submit.disabled = true;
      const created = createEvent({
        ownerType: 'tenant',
        context: { scope: 'professional' },
        date: state.date,
        workplaceId: state.workplaceId,
        from: state.from,
        to: state.to,
        title: state.title,
        description: state.description,
        color: state.color,
      });
      try {
        await flushBusinessPersistence();
        owner.commit?.();
        onCreated?.(created);
      } catch (error) {
        removeEvent(created.id);
        openNotice({ title: 'Не удалось создать событие', message: String(error?.message || 'Сервер не подтвердил сохранение.') });
        if (submit.isConnected) submit.disabled = false;
      }
    });
  };

  render();
  return { resume: render, getState: () => ({ ...state }) };
}
