import { initViewNavigation, viewNavigation } from '../ui/view-navigation/view-navigation.js';
import { openRecordCreationOwner } from '../ui/record/creation-flow.js';
import { timeSlots } from '../ui/time/index.js';
import { getTimeGridMinuteState } from '../core/time/grid.js';
import { minutesToTime, timeToMinutes } from '../core/time/math.js';

const JOURNAL_CREATE_MODES = [
  { id: 'record', label: 'Запись' },
  { id: 'event', label: 'Событие' },
  { id: 'note', label: 'Заметка' },
];

// The first Q belongs to Journal, not Record/Event/Note.
// It reads only the precomputed Time grid; the chosen entity owns all later steps.
export function openJournalCreation({
  date = '',
  workplaceId = '',
  timeHint = '',
  timeGrid = null,
  surfaceRoot = null,
  bodyRoot = null,
  onCreated = () => {},
  onCancel = () => {},
} = {}) {
  if (!timeGrid) return null;
  const owner = openRecordCreationOwner({
    onCancel,
    surfaceRoot,
    bodyRoot,
    shellTitle: '',
  });
  if (!owner) return null;

  let selectedTime = '';
  let requestVersion = 0;

  const hour = Math.floor((timeToMinutes(timeHint) ?? 0) / 60) * 60;
  const timeChoices = [hour, hour + 30]
    .map((minute) => minutesToTime(minute))
    .filter(Boolean)
    .map((value) => {
      const availability = getTimeGridMinuteState(timeGrid, value);
      return {
        value,
        label: value,
        available: availability.state === 'free',
        occupied: availability.state === 'occupied',
        state: availability.state,
      };
    });

  const returnToChoices = () => {
    // Discard the previous entity and invalidate any unfinished lazy import.
    ++requestVersion;
    selectedTime = '';
    showTimeChoices();
    return true;
  };

  const showTimeChoices = () => {
    owner.setBackHandler?.(() => {
      owner.close?.();
      return true;
    });
    const host = owner.setShellHeader(viewNavigation({
      views: JOURNAL_CREATE_MODES,
      activeView: 'record',
      ariaLabel: 'Действие в Журнале',
    }));
    if (host) {
      initViewNavigation(host, {
        views: JOURNAL_CREATE_MODES,
        activeView: 'record',
        onChange: (mode) => {
          if (mode !== 'event' && mode !== 'note') return;
          const version = ++requestVersion;
          void beginAuxiliary(mode, version);
        },
      });
    }
    const view = owner.render({
      step: 'time',
      body: `<div class="record-screen record-screen--time">${timeSlots({
        values: timeChoices,
        data: 'data-journal-start-time',
        selected: '',
        ariaLabel: 'Уточните время',
      })}</div>`,
    });
    view?.body?.querySelectorAll('[data-journal-start-time]:not(:disabled)').forEach((node) => {
      node.addEventListener('click', () => {
        const from = String(node.dataset.journalStartTime || '');
        if (getTimeGridMinuteState(timeGrid, from).state !== 'free') return;
        selectedTime = from;
        const version = ++requestVersion;
        void beginRecord(version);
      });
    });
  };

  const showEntityLoading = (mode) => {
    owner.setShellHeader(`<div class="record-creation-step-title">${mode === 'event' ? 'Событие' : 'Заметка'}</div>`);
    owner.setBackHandler?.(returnToChoices);
    owner.render({ step: mode, title: false, body: '' });
  };

  async function beginAuxiliary(mode, version) {
    if (!owner.isOpen?.() || version !== requestVersion) return;
    showEntityLoading(mode);
    try {
      if (mode === 'event') {
        const { createJournalEventFlow } = await import('./event-create.js');
        if (!owner.isOpen?.() || version !== requestVersion) return;
        // Event starts from the originally tapped free time, without a second time chooser.
        createJournalEventFlow({ owner, date, workplaceId, timeHint, onCreated });
      } else {
        const { createJournalNoteFlow } = await import('./note-create.js');
        if (!owner.isOpen?.() || version !== requestVersion) return;
        // Note is neutral: no time selection or occupancy check.
        createJournalNoteFlow({ owner, date, onCreated });
      }
    } catch (error) {
      if (!owner.isOpen?.() || version !== requestVersion) return;
      returnToChoices();
      const { openNotice } = await import('../ui/modals/index.js');
      openNotice({
        title: 'Не удалось открыть действие',
        message: String(error?.message || 'Попробуйте ещё раз.'),
      });
    }
  }

  async function beginRecord(version) {
    if (!owner.isOpen?.() || version !== requestVersion || !selectedTime) return;
    owner.setShellHeader('');
    owner.setBackHandler?.(returnToChoices);
    owner.render({
      step: 'procedures',
      title: 'Выбор процедур',
      body: '<div class="muted">Загружаем текущие процедуры…</div>',
    });
    try {
      const [{ openRecords }, { loadRecordCreationOperationalState }, { hasCurrentProceduresSnapshot }] = await Promise.all([
        import('../core/records/records.js'),
        import('../core/runtime/operational-state.js'),
        import('../core/service/procedures/data.js'),
      ]);
      if (!owner.isOpen?.() || version !== requestVersion) return;
      // The Journal and server sync may already have hydrated the procedures owner.
      // A failed duplicate request must never block an existing usable catalog.
      if (!hasCurrentProceduresSnapshot()) await loadRecordCreationOperationalState();
      if (!owner.isOpen?.() || version !== requestVersion) return;
      openRecords({
        context: 'journal',
        date,
        workplaceId,
        timeHint: selectedTime,
        journalTimeConfirmed: true,
        professionalActions: true,
        creationOwner: owner,
        stepBack: true,
        onBackFromStart: returnToChoices,
        onCreated: (...args) => window.setTimeout(() => onCreated(...args), 0),
      });
    } catch (error) {
      if (!owner.isOpen?.() || version !== requestVersion) return;
      // Keep the selected time and the same Q. No extra S-modal or duplicate chooser.
      const { escapeHtml } = await import('../ui/utils/escape-html.js');
      if (!owner.isOpen?.() || version !== requestVersion) return;
      const view = owner.render({
        step: 'procedures',
        title: 'Выбор процедур',
        body: `<p role="alert">${escapeHtml(String(error?.message || 'Не удалось загрузить рабочие данные'))}</p>`,
        action: { label: 'Повторить', data: 'data-record-retry-load' },
      });
      view?.action?.addEventListener('click', () => {
        const nextVersion = ++requestVersion;
        void beginRecord(nextVersion);
      });
    }
  }

  showTimeChoices();
  return owner;
}
