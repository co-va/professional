import { actionBlock } from '../page/page.js';
import { button } from '../buttons/index.js';
import { modal, mountModal } from '../modals/index.js';
import { select } from '../selectors/index.js';
import { mountEntityCardConstructor } from './entity-card-constructor.js';
import { isV2DesktopWorkspace } from '../v2/geometry.js';

function optionValue(options = [], preferred = '') {
  const values = (Array.isArray(options) ? options : []).map((item) => String(item?.value ?? ''));
  const candidate = String(preferred || '');
  return values.includes(candidate) ? candidate : (values[0] || '');
}

export function openEntityCardAppearanceQ(root, {
  title = 'Вид',
  className = '',
  typeLabel = 'Тип карты',
  typeOptions = [],
  showTypeSelector = false,
  initialType = '',
  targetLabel = 'Карта',
  showTargetSelector = false,
  initialTarget = 'all',
  defaultTarget = () => 'all',
  targetOptions = () => [],
  resolve = () => ({}),
  save = async () => {},
  onSaved = () => {},
  allowPhoto = true,
} = {}) {
  const types = Array.isArray(typeOptions) ? typeOptions.filter(Boolean) : [];
  if (!types.length) return null;

  let type = optionValue(types, initialType);
  let target = String(initialTarget || 'all');
  const layer = mountModal(root, modal('<div data-entity-card-appearance-q></div>', {
    // The title is for accessibility only: the header is reserved for actual selectors.
    title: '',
    variant: 'q',
    className: ['entity-card-appearance-q', className].filter(Boolean).join(' '),
  }));
  layer?.querySelector('.modal-sheet')?.setAttribute('aria-label', title);
  const host = layer?.querySelector('[data-entity-card-appearance-q]');
  const headerHost = layer?.querySelector('[data-v2-q-header-content]');
  if (!host || !headerHost) return layer;
  const sheet = headerHost.closest('.v2-layer--standard');
  const desktop = Boolean(sheet && sheet.closest('[data-v2-q="true"]') && isV2DesktopWorkspace(sheet.closest('[data-v2-app]')));
  if (desktop) sheet.classList.add('desktop-q-fixed-tools', 'desktop-appearance-q');

  const render = () => {
    const options = targetOptions(type);
    const targets = Array.isArray(options) ? options.filter(Boolean) : [];
    target = targets.length ? optionValue(targets, target) : '';
    const editor = resolve(type, target) || {};
    const canEditPhoto = typeof allowPhoto === 'function' ? Boolean(allowPhoto(type, target)) : Boolean(allowPhoto);
    const typeSelector = (showTypeSelector || types.length > 1) ? select({
      name: 'entityCardAppearanceType',
      label: '',
      aria: typeLabel,
      placeholder: typeLabel,
      value: type,
      options: types,
      data: 'data-entity-card-appearance-type',
    }) : '';
    const targetSelector = (targets.length > 1 || (showTargetSelector && targets.length)) ? select({
      name: 'entityCardAppearanceTarget',
      label: '',
      aria: targetLabel,
      placeholder: targetLabel,
      value: target,
      options: targets,
      data: 'data-entity-card-appearance-target',
    }) : '';

    // The Q Header owns the card-type controls; the Q Body owns the sole preview.
    // No duplicate preview is mounted into the Header.
    const saveMarkup = button('Сохранить', {
      data: 'data-card-q-save',
      aria: 'Сохранить вид карты',
    });
    const selectors = `<div class="entity-card-appearance-q__selectors"${desktop ? ' data-desktop-q-secondary-tools data-v2-layer-gesture-ignore' : ''}>${typeSelector}${targetSelector}</div>`;
    if (desktop) {
      // The shared Q reserves the title/close line even without a title.
      // Save and selectors occupy fixed tool rows above the sole body constructor.
      headerHost.innerHTML = `<div class="desktop-q-toolbar" data-v2-layer-gesture-ignore>${actionBlock(saveMarkup, { className: 'desktop-q-action-slot' })}</div>${selectors}`;
      host.innerHTML = '<div data-entity-card-appearance-constructor></div>';
    } else {
      headerHost.innerHTML = typeSelector || targetSelector ? selectors : '';
      host.innerHTML = `<div data-entity-card-appearance-constructor></div>${actionBlock(saveMarkup)}`;
    }

    const selectorHost = headerHost;
    selectorHost.querySelector('[name="entityCardAppearanceType"]')?.addEventListener('change', (event) => {
      type = String(event.target.value || '');
      target = String(defaultTarget(type) || 'all');
      render();
    });
    selectorHost.querySelector('[name="entityCardAppearanceTarget"]')?.addEventListener('change', (event) => {
      target = String(event.target.value || '');
      render();
    });

    const constructor = host.querySelector('[data-entity-card-appearance-constructor]');
    const saveButton = (desktop ? headerHost : host).querySelector('[data-card-q-save]');
    const saveActions = saveButton?.closest('.modal-actions');
    let controller = null;
    const syncSaveButton = ({ dirty = false, saving = false } = {}) => {
      if (!saveButton) return;
      saveButton.disabled = Boolean(saving);
      if (saveActions) saveActions.hidden = !dirty;
    };
    controller = mountEntityCardConstructor(constructor, {
      appearance: editor.appearance || {},
      fields: editor.fields || [],
      photo: editor.photo || '',
      photoPosition: editor.photoPosition || '50% 50%',
      allowPhoto: canEditPhoto,
      onSave: async ({ appearance, photo }) => {
        await save({ type, target, appearance, photo, editor });
        layer.v2Close?.();
        onSaved({ type, target });
      },
      onStateChange: syncSaveButton,
    });
    saveButton?.addEventListener('click', () => {
      void controller?.save?.();
    });
    syncSaveButton({
      dirty: controller?.isDirty?.() || false,
      saving: controller?.isSaving?.() || false,
    });
  };

  render();
  return layer;
}
