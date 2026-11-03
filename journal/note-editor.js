import {
  colorPicker,
  datePicker,
  field,
  initColorPickers,
  initDatePickers,
  initTimePickers,
  select,
  textareaField,
  timePicker,
} from '../ui/ui.js';
import { NOTE_DEFAULT_COLOR } from '../core/note/index.js';
import {
  noteContextWithTarget,
  noteTargetOptions,
  noteTargetValue,
  parseNoteTargetValue,
} from './note-target.js';

export function professionalNoteEditorMarkup(note = {}, {
  includeNote = null,
  formData = 'data-professional-note-editor',
} = {}) {
  return `<form class="form-grid" ${formData}>
    <div class="user-note-color-picker">${colorPicker({ name: 'color', value: note.color || NOTE_DEFAULT_COLOR })}</div>
    ${datePicker({ label: 'Дата', name: 'date', value: note.date || '', required: true, allowClear: false })}
    <div class="time-range-fields">
      ${timePicker({ label: 'С', name: 'from', value: note.from || '', allowEmpty: true, minuteStep: 1 })}
      ${timePicker({ label: 'До', name: 'to', value: note.to || '', allowEmpty: true, minuteStep: 1 })}
    </div>
    ${select({
      label: 'Прикрепить к',
      name: 'target',
      value: noteTargetValue(note),
      options: noteTargetOptions(note.date, { includeNote }),
      aria: 'Прикрепить заметку',
    })}
    ${field({ label: 'Наименование', name: 'title', value: note.title || '' })}
    ${textareaField({ label: 'Текст', name: 'text', value: note.text || '', rows: 8, placeholder: 'Текст заметки' })}
  </form>`;
}

export function initProfessionalNoteEditor(root) {
  initDatePickers(root);
  initTimePickers(root);
  initColorPickers(root);
}

export function readProfessionalNoteEditor(form, {
  currentContext = { scope: 'professional' },
  fallbackDate = '',
} = {}) {
  const data = form ? new FormData(form) : new FormData();
  const target = parseNoteTargetValue(data.get('target'));
  return {
    context: noteContextWithTarget(currentContext, target.targetType, target.targetId),
    date: String(data.get('date') || fallbackDate || '').slice(0, 10),
    from: String(data.get('from') || '').slice(0, 5),
    to: String(data.get('to') || '').slice(0, 5),
    targetType: target.targetType,
    targetId: target.targetId,
    title: String(data.get('title') || '').trim(),
    text: String(data.get('text') || '').trim(),
    color: String(data.get('color') || NOTE_DEFAULT_COLOR),
  };
}
