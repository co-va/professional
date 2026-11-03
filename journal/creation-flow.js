import {
  initViewNavigation,
  openRecordCreationOwner,
  timeSlots,
  viewNavigation,
} from '../ui/ui.js';
import { getTimeGridMinuteState, minutesToTime, timeToMinutes } from '../core/time/index.js';

const JOURNAL_CREATE_MODES = [
  { id: 'record', label: 'Запись' },
  { id: 'event', label: 'Событие' },
  { id: 'note', label: 'Заметка' },
];

// The Journal supplies an already built Time grid. No Record, Event, Note or
// operational-data loader participates in the first time-choice screen.
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
  const owner = openRecordCreationOwner({ onCancel, surfaceRoot, bodyRoot });
  if (!owner) return null;

  let activeMode = 'record';
  let selectedTime = '';
  let requestVersion = 0;
  let recordFlow = null;
  let eventFlow = null;
  let noteFlow = null;

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

  const showTimeChoices = () => {
    owner.setBackHandler?.(() => {
      owner.close?.();
      return true;
    });
    const view = owner.render({
      step: 'time',
      body: `<div class="record-screen record-screen--time">${timeSlots({
        values: timeChoices,
        data: 'data-journal-start-time',
        selected: selectedTime,
        ariaLabel: 'Уточните время',
      })}</div>`,
    });
    view?.body?.querySelectorAll('[data-journal-start-time]:not(:disabled)').forEach((node) => {
      node.addEventListener('click', () => {
        const from = String(node.dataset.journalStartTime || '');
        if (getTimeGridMinuteState(timeGrid, from).state !== 'free') return;
        selectedTime = from;
        const version = ++requestVersion;
        void showSelectedMode(version);
      });
    });
  };

  const showLoading = () => {
    owner.setBackHandler?.(() => {
      ++requestVersion;
      selectedTime = '';
      showTimeChoices();
      return true;
    });
    owner.render({
      step: 'procedures',
      title: 'Выбор процедур',
      body: '<div class="muted">Загружаем текущие процедуры…</div>',
    });
  };

  async function showSelectedMode(version) {
    if (!owner.isOpen?.() || version !== requestVersion) return;
    if (activeMode === 'note') {
      const { createJournalNoteFlow } = await import('./note-create.js');
      if (!owner.isOpen?.() || version !== requestVersion || activeMode !== 'note') return;
      owner.setBackHandler?.(() => { owner.close?.(); return true; });
      if (!noteFlow) noteFlow = createJournalNoteFlow({ owner, date, onCreated });
      else noteFlow.resume();
      return;
    }
    if (!selectedTime) {
      showTimeChoices();
      return;
    }
    if (activeMode === 'event') {
      const { createJournalEventFlow } = await import('./event-create.js');
      if (!owner.isOpen?.() || version !== requestVersion || activeMode !== 'event') return;
      owner.setBackHandler?.(() => { selectedTime = ''; showTimeChoices(); return true; });
      if (!eventFlow) eventFlow = createJournalEventFlow({
        owner, date, workplaceId, timeHint: selectedTime, onCreated,
      });
      else eventFlow.resume();
      return;
    }

    if (recordFlow) {
      recordFlow.resumeRecord?.();
      return;
    }

    showLoading();
    try {
      const [{ openRecords }, { loadRecordCreationOperationalState }] = await Promise.all([
        import('../core/records/records.js'),
        import('../core/runtime/operational-state.js'),
      ]);
      if (!owner.isOpen?.() || version !== requestVersion || activeMode !== 'record') return;
      await loadRecordCreationOperationalState();
      if (!owner.isOpen?.() || version !== requestVersion || activeMode !== 'record') return;
      recordFlow = openRecords({
        context: 'journal',
        date,
        workplaceId,
        selectedTime,
        professionalActions: true,
        creationOwner: owner,
        stepBack: true,
        onBackFromStart: () => {
          ++requestVersion;
          selectedTime = '';
          recordFlow = null;
          showTimeChoices();
          return true;
        },
        onCreated: (...args) => window.setTimeout(() => onCreated(...args), 0),
      });
    } catch (error) {
      if (!owner.isOpen?.() || version !== requestVersion) return;
      selectedTime = '';
      showTimeChoices();
      const { openNotice } = await import('../ui/modals/index.js');
      openNotice({
        title: 'Не удалось подготовить запись',
        message: String(error?.message || 'Попробуйте ещё раз.'),
      });
    }
  }

  const renderModeSwitch = () => {
    const host = owner.setShellHeader(viewNavigation({
      views: JOURNAL_CREATE_MODES,
      activeView: activeMode,
      ariaLabel: 'Режим Journal',
    }));
    if (!host) return;
    initViewNavigation(host, {
      views: JOURNAL_CREATE_MODES,
      activeView: activeMode,
      onChange: (mode) => {
        if (mode === activeMode) return;
        activeMode = mode;
        const version = ++requestVersion;
        renderModeSwitch();
        void showSelectedMode(version);
      },
    });
  };

  renderModeSwitch();
  showTimeChoices();
  return owner;
}
