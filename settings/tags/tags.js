import {
  actionBlock,
  button,
  colorPicker,
  emptyState,
  escapeHtml,
  field,
  initColorPickers,
  modal,
  mountModal,
  page,
  select,
  v2ListEntry,
  v2ListEntries,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import { loadAuxiliaryState } from '../../core/runtime/auxiliary-state.js';
import { loadBusinessState } from '../../core/runtime/business-state.js';
import { loadOperationalState } from '../../core/runtime/operational-state.js';
import { commitPersonTags, getAllPeople } from '../../core/people/data.js';
import { commitProcedure, getProcedures } from '../../core/service/procedures/data.js';
import { commitProduct, getProducts } from '../../core/service/products/data.js';
import { getWorkplaces } from '../../core/profile/workplaces/data.js';
import { getRecordRows } from '../../core/record/data.js';
import { getEvents } from '../../core/event/data.js';
import { getNotes } from '../../core/note/data.js';
import { replaceAssignmentTag, tagAssignments } from './assignments.js';
import { commitTags, createTag, getTags } from './data.js';

function currentSources() {
  return {
    people: getAllPeople(),
    products: getProducts(),
    procedures: getProcedures(),
    workplaces: getWorkplaces(),
    records: getRecordRows(),
    events: getEvents(),
    notes: getNotes(),
  };
}

function tagRow(tag, count) {
  return v2ListEntry({
    title: tag.name,
    omitEmptySubtitle: true,
    leadingSwatch: /^#[0-9a-fA-F]{6}$/.test(String(tag.color || '')) ? tag.color : '#3B302B',
    rightTop: String(count),
    interactive: true,
    data: `data-tag-open="${escapeHtml(tag.id)}"`,
    aria: `Ярлык ${tag.name}, назначений: ${count}`,
  });
}

// Mutate the real domain owner; counts are derived from it, not stored.
async function updateAssignment(tag, assignment, nextTagId = '') {
  const sources = currentSources();
  const rows = sources[assignment.source];
  const entity = Array.isArray(rows)
    ? rows.find((item) => String(item.key || item.id || '') === assignment.id)
    : null;
  if (!entity) throw new Error('Позиция больше не найдена.');
  const nextTags = replaceAssignmentTag(entity.tags, tag, nextTagId);
  if (assignment.source === 'people') {
    await commitPersonTags(assignment.id, nextTags);
  } else if (assignment.source === 'products') {
    await commitProduct({ ...entity, tags: nextTags, updatedAt: new Date().toISOString() });
  } else if (assignment.source === 'procedures') {
    await commitProcedure({ ...entity, tags: nextTags, updatedAt: new Date().toISOString() });
  } else {
    throw new Error('Для этого типа пока нет сохранения ярлыков.');
  }
}

const EDITABLE_TAG_SOURCES = new Set(['people', 'products', 'procedures']);

function openAssignmentAction(tag, assignment, refresh) {
  const body = `<div class="compact-form">
    <div class="modal-title"><h2>${escapeHtml(assignment.title)}</h2></div>
    <div data-tag-assignment-actions></div>
    <p class="form-error" role="alert" data-tag-assignment-error hidden></p>
  </div>`;
  const layer = mountModal(document.body, modal(body, {
    title: assignment.title,
    variant: 'x',
    xRole: 'action',
    surface: 'app',
  }));
  if (!layer) return null;
  const host = layer.querySelector('[data-tag-assignment-actions]');
  const errorNode = layer.querySelector('[data-tag-assignment-error]');
  let busy = false;

  const apply = async (nextTagId = '') => {
    if (busy) return;
    busy = true;
    errorNode.hidden = true;
    try {
      await updateAssignment(tag, assignment, nextTagId);
      layer.v2Close?.();
      refresh();
    } catch (error) {
      errorNode.textContent = error?.message || 'Не удалось изменить ярлык.';
      errorNode.hidden = false;
    } finally {
      busy = false;
    }
  };
  const startCreate = () => {
    if (busy) return;
    layer.v2Close?.();
    openTagEditor({
      onSaved: async (created) => {
        await updateAssignment(tag, assignment, created.id);
        refresh();
      },
    });
  };

  const showTransfer = () => {
    const choices = getTags().filter((item) => item.id !== tag.id);
    // The same shared dropdown used to assign tags in Contacts.
    host.innerHTML = `<div class="compact-form">
      ${select({
        name: 'tag-transfer-target',
        value: '',
        options: [
          { value: '', label: 'Выбрать ярлык' },
          ...choices.map((item) => ({ value: item.id, label: item.name })),
        ],
        aria: 'Выбрать ярлык',
        data: 'data-tag-transfer-choice',
      })}
      ${actionBlock(button('+ Создать ярлык', { data: 'data-tag-create' }))}
    </div>`;
    host.querySelector('input[data-tag-transfer-choice]')?.addEventListener('change', (event) => {
      const target = event.target.value;
      if (target) void apply(target);
    });
    host.querySelector('[data-tag-create]')?.addEventListener('click', startCreate);
  };
  const showActions = () => {
    host.innerHTML = actionBlock(
      button('Перенести', { variant: 'secondary', data: 'data-tag-transfer' }) +
      button('Удалить ярлык', { variant: 'danger', data: 'data-tag-detach' }),
    );
    host.querySelector('[data-tag-detach]')?.addEventListener('click', () => { void apply(); });
    host.querySelector('[data-tag-transfer]')?.addEventListener('click', showTransfer);
  };
  showActions();
  return layer;
}

function openTagAssignments(tag, onSaved) {
  const layer = mountModal(document.body, modal(
    `<div data-tag-assignment-list></div>${actionBlock(button('Изменить ярлык', { data: 'data-tag-update' }))}`,
    { title: tag.name, variant: 'q', className: 'tags-assignments-q' },
  ));
  if (!layer) return null;
  const refresh = () => {
    if (!layer.isConnected) return;
    const assignments = tagAssignments(tag, currentSources());
    const host = layer.querySelector('[data-tag-assignment-list]');
    if (!host) return;
    host.innerHTML = assignments.length
      ? v2ListEntries(assignments.map((item) => v2ListEntry({
          title: item.title,
          omitEmptySubtitle: true,
          interactive: EDITABLE_TAG_SOURCES.has(item.source),
          data: EDITABLE_TAG_SOURCES.has(item.source) ? `data-tag-assignment="${escapeHtml(item.key)}"` : '',
        })))
      : emptyState('Назначений нет', 'Этот ярлык ещё никому не присвоен.');
    host.querySelectorAll('[data-tag-assignment]').forEach((row) => {
      row.addEventListener('click', () => {
        const item = assignments.find((candidate) => candidate.key === row.dataset.tagAssignment);
        if (item) openAssignmentAction(tag, item, () => {
          refresh();
          onSaved();
        });
      });
    });
  };
  layer.querySelector('[data-tag-update]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openTagEditor({ existing: tag, onSaved });
  });
  refresh();
  return layer;
}

function renderList(root) {
  const tags = getTags();
  const sources = currentSources();
  root.innerHTML = page([
    workspaceHeaderContext({
      title: 'Ярлыки',
      c: { label: '+', data: 'data-tag-add', aria: 'Добавить ярлык' },
    }),
    tags.length
      ? `<div class="settings-tags-v2">${v2ListEntries(tags.map((tag) =>
          tagRow(tag, tagAssignments(tag, sources).length)))}</div>`
      : emptyState('Ярлыков пока нет', 'Добавьте первый ярлык кнопкой «+».'),
  ]);
  root.querySelector('[data-tag-add]')?.addEventListener('click', () =>
    openTagEditor({ onSaved: () => renderList(root) }));
  root.querySelectorAll('[data-tag-open]').forEach((row) => {
    row.addEventListener('click', () => {
      const tag = getTags().find((item) => item.id === row.dataset.tagOpen);
      if (tag) openTagAssignments(tag, () => renderList(root));
    });
  });
  window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
}

export function openTagEditor({ existing = null, onSaved = () => {} } = {}) {
  const title = existing ? 'Изменить ярлык' : 'Новый ярлык';
  const html = `<form class="compact-form" data-tag-form>
    ${colorPicker({ name: 'tagColor', value: existing?.color || '#F6D32D' })}
    ${field({
      label: 'Название ярлыка',
      name: 'tagName',
      value: existing?.name || '',
      placeholder: 'Название ярлыка',
      required: true,
    })}
    ${button('Сохранить', { type: 'submit' })}
  </form>`;
  const layer = mountModal(document.body, modal(html, {
    title,
    variant: 'x',
    surface: 'app',
    className: 'modal--form-sheet',
  }));
  if (!layer) return null;
  initColorPickers(layer);
  const form = layer.querySelector('[data-tag-form]');
  form?.insertAdjacentHTML('beforeend', '<p class="form-error" role="alert" data-tag-save-error hidden></p>');
  let busy = false;
  let created = null;
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(form);
    const name = String(data.get('tagName') || '').trim();
    if (!name) return;
    const color = String(data.get('tagColor') || '#F6D32D');
    const saved = existing
      ? { ...existing, name, color, updatedAt: new Date().toISOString() }
      : { ...(created || createTag({ name, color })), name, color };
    if (!existing) created = saved;
    const errorNode = layer.querySelector('[data-tag-save-error]');
    const submit = form.querySelector('button[type="submit"]');
    busy = true;
    if (submit) submit.disabled = true;
    if (errorNode) errorNode.hidden = true;
    try {
      await commitTags(existing
        ? getTags().map((item) => item.id === saved.id ? saved : item)
        : [...getTags().filter((item) => item.id !== saved.id), saved]);
      await onSaved(saved);
      layer.v2Close?.();
    } catch (error) {
      if (errorNode) {
        errorNode.textContent = error?.message || 'Не удалось сохранить ярлык.';
        errorNode.hidden = false;
      }
    } finally {
      busy = false;
      if (submit) submit.disabled = false;
    }
  });
  return layer;
}

export async function renderTags(root) {
  // Settings normally loads only the tag catalog. Read all existing owners
  // before showing counts; unloaded entities must never silently count as 0.
  root.innerHTML = page([
    workspaceHeaderContext({ title: 'Ярлыки' }),
    emptyState('Загрузка', 'Загружаем назначения ярлыков.'),
  ]);
  const loadingView = root.firstElementChild;
  try {
    await Promise.all([
      loadBusinessState(),
      loadOperationalState({ full: true }),
      loadAuxiliaryState('service'),
    ]);
    if (root.firstElementChild !== loadingView) return;
    renderList(root);
  } catch (error) {
    if (root.firstElementChild !== loadingView) return;
    root.innerHTML = page([
      workspaceHeaderContext({ title: 'Ярлыки' }),
      emptyState('Не удалось загрузить назначения', String(error?.message || 'Повторите попытку.')),
      button('Повторить', { data: 'data-tags-retry' }),
    ]);
    root.querySelector('[data-tags-retry]')?.addEventListener('click', () => {
      void renderTags(root);
    });
  }
}

export { renderTags as render };
