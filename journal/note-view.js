import { actionBlock, button, modal, mountModal, openNotice } from '../ui/ui.js';
import { createNote, readNote, removeNote, updateNote } from '../core/note/index.js';
import { flushBusinessPersistence } from '../core/business-persistence.js';
import { noteDetail } from '../ui/note/index.js';
import { noteTargetLabel } from './note-target.js';
import {
  initProfessionalNoteEditor,
  professionalNoteEditorMarkup,
  readProfessionalNoteEditor,
} from './note-editor.js';

export function openNoteView(noteOrId, {
  onClose = () => {},
  onSaved = () => {},
  onDeleted = () => {},
} = {}) {
  const noteId = String(typeof noteOrId === 'object' ? noteOrId?.id : noteOrId || '');
  const readCurrent = () => readNote(noteId);
  let current = readCurrent();
  if (!current) return null;

  const layer = mountModal(document.body, modal('<div data-note-view-host></div>', {
    variant: 'q',
    surface: 'app',
    className: 'user-note-detail-q',
  }));
  if (!layer) return null;
  layer.setAttribute('aria-label', 'Заметка');

  const originalClose = layer.v2Close?.bind(layer);
  if (originalClose) {
    layer.v2Close = () => {
      if (!layer.isConnected) return;
      originalClose();
      onClose?.();
    };
  }

  const host = () => layer.querySelector('[data-note-view-host]');
  const headerHost = layer.querySelector('[data-v2-q-header-content]');
  const setEditorHeader = (visible) => {
    if (!headerHost) return;
    headerHost.innerHTML = visible
      ? '<div class="user-note-shell-title" style="position:absolute;top:0;left:52px;height:24px;display:flex;align-items:center;margin:0;font-size:20px;line-height:24px;font-weight:500">Заметка</div>'
      : '';
  };

  const removeCurrent = async (control) => {
    control.disabled = true;
    const snapshot = readCurrent();
    if (!snapshot || !removeNote(noteId)) {
      control.disabled = false;
      return;
    }
    try {
      await flushBusinessPersistence();
      onDeleted?.(snapshot);
      layer.v2Close?.();
    } catch (error) {
      createNote(snapshot);
      openNotice({ title: 'Не удалось удалить заметку', message: String(error?.message || 'Сервер не подтвердил удаление.') });
      if (control.isConnected) control.disabled = false;
    }
  };

  const renderRead = () => {
    current = readCurrent();
    const root = host();
    if (!root || !current) return;
    setEditorHeader(false);
    root.innerHTML = `${noteDetail(current, { targetLabel: noteTargetLabel(current) })}${actionBlock(`${button('Изменить', { data: 'data-note-view-edit' })}${button('Удалить', { variant: 'danger', data: 'data-note-view-delete' })}`)}`;
    root.querySelector('[data-note-view-edit]')?.addEventListener('click', renderEdit);
    root.querySelector('[data-note-view-delete]')?.addEventListener('click', (event) => removeCurrent(event.currentTarget));
  };

  const renderEdit = () => {
    current = readCurrent();
    const root = host();
    if (!root || !current) return;
    setEditorHeader(true);
    root.innerHTML = `${professionalNoteEditorMarkup(current, {
      includeNote: current,
      formData: 'data-professional-note-edit-form',
    })}${actionBlock(`${button('Сохранить', { data: 'data-professional-note-save' })}${button('Отмена', { variant: 'secondary', data: 'data-professional-note-cancel' })}`)}`;
    initProfessionalNoteEditor(root);
    root.querySelector('[data-professional-note-cancel]')?.addEventListener('click', renderRead);
    root.querySelector('[data-professional-note-save]')?.addEventListener('click', async (event) => {
      const form = root.querySelector('[data-professional-note-edit-form]');
      const patch = readProfessionalNoteEditor(form, {
        currentContext: current.context || { scope: 'professional' },
        fallbackDate: current.date,
      });
      if (!patch.date) return openNotice({ title: 'Заметка', message: 'Укажите дату заметки.' });
      if (!patch.title && !patch.text) return openNotice({ title: 'Заметка', message: 'Укажите наименование или текст заметки.' });

      const before = { ...current, context: current.context && typeof current.context === 'object' ? { ...current.context } : current.context };
      const submit = event.currentTarget;
      submit.disabled = true;
      const updated = updateNote(noteId, patch);
      if (!updated) {
        submit.disabled = false;
        return openNotice({ title: 'Заметка', message: 'Не удалось сохранить заметку.' });
      }
      try {
        await flushBusinessPersistence();
        current = updated;
        onSaved?.(updated);
        renderRead();
      } catch (error) {
        updateNote(noteId, before);
        openNotice({ title: 'Не удалось сохранить заметку', message: String(error?.message || 'Сервер не подтвердил изменения.') });
        if (submit.isConnected) submit.disabled = false;
      }
    });
  };

  renderRead();
  return layer;
}
