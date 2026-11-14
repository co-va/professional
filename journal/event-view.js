import { actionBlock } from '../ui/page/page.js';
import {
  button,
  colorPicker,
  field,
  initColorPickers,
  initTimePickers,
  modal,
  mountModal,
  openNotice,
  textareaField,
  timePicker,
} from '../ui/ui.js';
import { checkTimeAvailability, timeToMinutes } from '../core/time/index.js';
import { createEvent, readEvent, removeEvent, updateEvent } from '../core/event/index.js';
import { getNotesForTarget } from '../core/note/index.js';
import { flushBusinessPersistence } from '../core/business-persistence.js';
import { noteAttachmentStickers } from '../ui/note/index.js';
import { openNoteView } from './note-view.js';

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

function dateLabel(value = '') {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1].slice(-2)}` : String(value || '');
}

function unavailable(reason = '') {
  if (reason === 'occupied') return 'Это время уже занято.';
  if (reason === 'day-not-working' || reason === 'outside-working-time') return 'Время находится вне рабочего графика.';
  return 'Проверьте время события.';
}

function timeRangeValid(from, to) {
  const start = timeToMinutes(from);
  const end = timeToMinutes(to);
  return start != null && end != null && end > start;
}

export function openEventView(eventOrId, { onClose = () => {} } = {}) {
  const eventId = String(typeof eventOrId === 'object' ? eventOrId?.id : eventOrId || '');
  const readCurrent = () => readEvent(eventId);
  let current = readCurrent();
  if (!current) return null;

  const layer = mountModal(document.body, modal('<div data-event-view-host></div>', {
    variant: 'q',
    surface: 'app',
    title: 'Событие',
    className: 'user-event-detail-q',
  }));
  if (!layer) return null;
  layer.setAttribute('aria-label', 'Событие');

  const originalClose = layer.v2Close?.bind(layer);
  if (originalClose) {
    layer.v2Close = () => {
      if (!layer.isConnected) return;
      originalClose();
      onClose?.();
    };
  }
  const host = () => layer.querySelector('[data-event-view-host]');

  const renderRead = () => {
    current = readCurrent();
    const root = host();
    if (!root || !current) return;
    const attachedNotes = getNotesForTarget('event', eventId);
    const metaStyle = 'color:var(--text-secondary);font-size:13px;line-height:1.35;font-weight:650';
    root.innerHTML = `<section class="form-grid event-view">
      <h2 style="margin:0;font-size:23px;line-height:1.15">${esc(current.title || 'Событие')}</h2>
      ${current.description ? `<div class="event-view__description" style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:18px;line-height:1.5">${esc(current.description)}</div>` : ''}
      <div style="${metaStyle}">${esc(dateLabel(current.date || ''))}</div>
      <div style="${metaStyle}">${esc(current.from || '')}–${esc(current.to || '')}</div>
      ${noteAttachmentStickers(attachedNotes)}
      ${actionBlock(`${button('Изменить', { data: 'data-event-edit' })}${button('Удалить', { variant: 'danger', data: 'data-event-delete' })}`)}
    </section>`;

    root.querySelector('[data-event-edit]')?.addEventListener('click', renderEdit);
    root.querySelectorAll('[data-note-attachment]').forEach((node) => node.addEventListener('click', () => {
      const noteId = String(node.dataset.noteAttachment || '');
      const note = attachedNotes.find((item) => String(item?.id || '') === noteId);
      if (!note) return;
      openNoteView(note, { onSaved: renderRead, onDeleted: renderRead });
    }));
    root.querySelector('[data-event-delete]')?.addEventListener('click', async (event) => {
      const submit = event.currentTarget;
      submit.disabled = true;
      const snapshot = { ...current };
      if (!removeEvent(eventId)) {
        submit.disabled = false;
        return;
      }
      try {
        await flushBusinessPersistence();
        layer.v2Close?.();
      } catch (error) {
        createEvent(snapshot);
        openNotice({ title: 'Не удалось удалить событие', message: String(error?.message || 'Сервер не подтвердил удаление.') });
        if (submit.isConnected) submit.disabled = false;
      }
    });
  };

  const renderEdit = () => {
    current = readCurrent();
    const root = host();
    if (!root || !current) return;
    root.innerHTML = `<form class="form-grid" data-event-edit-form>
      <div class="user-event-color-picker">${colorPicker({ name: 'color', value: current.color || '#777A7D' })}</div>
      <div class="time-range-fields">
        ${timePicker({ label: 'С', name: 'from', value: current.from, minuteStep: 1 })}
        ${timePicker({ label: 'До', name: 'to', value: current.to, minuteStep: 1 })}
      </div>
      ${field({ label: 'Наименование', name: 'title', value: current.title, required: true })}
      ${textareaField({ label: 'Описание', name: 'description', value: current.description, rows: 6 })}
      ${actionBlock(`${button('Сохранить', { type: 'submit' })}${button('Отмена', { variant: 'secondary', data: 'data-event-cancel' })}`)}
    </form>`;
    initTimePickers(root);
    initColorPickers(root);
    root.querySelector('[data-event-cancel]')?.addEventListener('click', renderRead);
    root.querySelector('[data-event-edit-form]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const title = String(data.get('title') || '').trim();
      const from = String(data.get('from') || '').slice(0, 5);
      const to = String(data.get('to') || '').slice(0, 5);
      if (!title) return openNotice({ title: 'Событие', message: 'Укажите наименование события.' });
      if (!timeRangeValid(from, to)) return openNotice({ title: 'Событие', message: 'Проверьте время события.' });

      const availability = checkTimeAvailability({
        date: current.date,
        workplaceId: current.workplaceId,
        from,
        to,
        excludeId: eventId,
      });
      if (!availability.ok) return openNotice({ title: 'Событие', message: unavailable(availability.reason) });

      const before = { ...current };
      const patch = {
        title,
        description: String(data.get('description') || '').trim(),
        from,
        to,
        color: String(data.get('color') || '#777A7D'),
      };
      const submit = form.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;
      const updated = updateEvent(eventId, patch);
      if (!updated) {
        if (submit) submit.disabled = false;
        return openNotice({ title: 'Событие', message: 'Не удалось сохранить событие.' });
      }
      try {
        await flushBusinessPersistence();
        renderRead();
      } catch (error) {
        updateEvent(eventId, before);
        openNotice({ title: 'Не удалось сохранить событие', message: String(error?.message || 'Сервер не подтвердил изменения.') });
        if (submit?.isConnected) submit.disabled = false;
      }
    });
  };

  renderRead();
  return layer;
}
