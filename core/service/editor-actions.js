import { setSharedActionVisible } from '../../ui/page/page.js';
import { setSharedProfilePrimary } from '../../ui/profile/index.js';

// Group and value editors share one name-change and Save visibility rule.
export function bindServiceNameSave(form, saveButton, previous = null) {
  const hasChange = () => {
    const name = String(new FormData(form).get('name') || '').trim();
    return Boolean(name) && (!previous || name !== String(previous.name || '').trim());
  };
  const syncSave = () => {
    if (saveButton) saveButton.style.display = hasChange() ? '' : 'none';
  };
  form?.addEventListener('input', syncSave);
  form?.addEventListener('change', syncSave);
  if (form) syncSave();
  return hasChange;
}

// Preserve each editor's own draft, signature and persistence; share only UI state.
export function createServiceSaveController(primary, { signature, baseline, busy }) {
  const actions = primary.closest('.modal-actions');
  let visible = null;
  let wasBusy = null;
  const syncDirty = () => {
    const changed = signature() !== baseline();
    const pending = busy();
    if (visible === changed && wasBusy === pending) return changed;
    if (visible !== changed) setSharedActionVisible(actions, changed);
    visible = changed;
    wasBusy = pending;
    setSharedProfilePrimary(primary, { visible: changed, label: 'Сохранить', disabled: pending });
    return changed;
  };
  return { syncDirty, currentVisibility: () => visible };
}
