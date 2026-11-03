import { openNotice } from '../ui/ui.js';
import { createNote, removeNote } from '../core/note/index.js';
import { getProfile } from '../core/profile/data.js';
import { flushBusinessPersistence } from '../core/business-persistence.js';
import { noteTargetOptions, noteTargetValue } from './note-target.js';
import {
  initProfessionalNoteEditor,
  professionalNoteEditorMarkup,
  readProfessionalNoteEditor,
} from './note-editor.js';

function normalizeTargetForDate(state) {
  const current = noteTargetValue(state);
  if (!current) return;
  const allowed = new Set(noteTargetOptions(state.date || state.journalDate).map((option) => String(option.value || '')));
  if (allowed.has(current)) return;
  state.targetType = '';
  state.targetId = '';
}

export function createJournalNoteFlow({ owner, date, onCreated = () => {} } = {}) {
  if (!owner) return null;
  const now = new Date();
  const journalDate = String(date || '').slice(0, 10)
    || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const state = {
    journalDate,
    date: '',
    from: '',
    to: '',
    targetType: '',
    targetId: '',
    title: '',
    text: '',
    color: '#CFC3FF',
  };

  const capture = (root) => {
    const form = root?.querySelector('[data-professional-note-create]');
    if (!form) return;
    Object.assign(state, readProfessionalNoteEditor(form, {
      currentContext: { scope: 'professional' },
      fallbackDate: '',
    }));
  };

  const render = () => {
    normalizeTargetForDate(state);
    const view = owner.render({
      step: 'note',
      title: false,
      body: professionalNoteEditorMarkup(state, { formData: 'data-professional-note-create' }),
      action: { label: 'Создать', data: 'data-note-create' },
    });
    if (!view) return;
    initProfessionalNoteEditor(view.body);

    const form = view.body.querySelector('[data-professional-note-create]');
    form?.addEventListener('input', () => capture(view.body));
    form?.addEventListener('change', (event) => {
      const previousDate = state.date;
      capture(view.body);
      if (event.target?.name === 'date' && state.date !== previousDate) {
        normalizeTargetForDate(state);
        render();
      }
    });

    view.action?.addEventListener('click', async (event) => {
      capture(view.body);
      if (!state.title && !state.text) return openNotice({ title: 'Заметка', message: 'Укажите наименование или текст заметки.' });

      const ownerId = String(getProfile()?.id || '');
      if (!ownerId) return openNotice({ title: 'Заметка', message: 'Профиль ещё не загружен.' });

      const submit = event.currentTarget;
      submit.disabled = true;
      const created = createNote({
        ownerType: 'profile',
        ownerId,
        context: state.context,
        date: state.date || journalDate,
        from: state.from,
        to: state.to,
        targetType: state.targetType,
        targetId: state.targetId,
        title: state.title,
        text: state.text,
        color: state.color,
      });
      if (!created) {
        submit.disabled = false;
        return openNotice({ title: 'Заметка', message: 'Не удалось создать заметку.' });
      }

      try {
        await flushBusinessPersistence();
        owner.commit?.();
        onCreated?.(created);
      } catch (error) {
        removeNote(created.id);
        openNotice({ title: 'Не удалось создать заметку', message: String(error?.message || 'Сервер не подтвердил сохранение.') });
        if (submit.isConnected) submit.disabled = false;
      }
    });
  };

  render();
  return { resume: render, getState: () => ({ ...state }) };
}
