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
  v2ListEntry,
  v2ListEntries,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import { loadAuxiliaryState } from '../../core/runtime/auxiliary-state.js';
import { loadBusinessState } from '../../core/runtime/business-state.js';
import { loadOperationalState } from '../../core/runtime/operational-state.js';
import { getAllPeople } from '../../core/people/data.js';
import { getProcedures } from '../../core/service/procedures/data.js';
import { getProducts } from '../../core/service/products/data.js';
import { getWorkplaces } from '../../core/profile/workplaces/data.js';
import { getRecordRows } from '../../core/record/data.js';
import { getEvents } from '../../core/event/data.js';
import { getNotes } from '../../core/note/data.js';
import { tagAssignments } from './assignments.js';
import { createTag, getTags, saveTags } from './data.js';

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

function openTagAssignments(tag, onSaved) {
  const assignments = tagAssignments(tag, currentSources());
  const body = assignments.length
    ? v2ListEntries(assignments.map((item) => v2ListEntry({
        title: item.title,
        subtitle: item.kind,
        interactive: false,
      })))
    : emptyState('Назначений нет', 'Этот ярлык ещё никому не присвоен.');
  const layer = mountModal(document.body, modal(
    `${body}${actionBlock(button('Изменить ярлык', { data: 'data-tag-update' }))}`,
    { title: tag.name, variant: 'q', className: 'tags-assignments-q' },
  ));
  layer?.querySelector('[data-tag-update]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openTagEditor({ existing: tag, onSaved });
  });
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
  layer.querySelector('[data-tag-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('tagName') || '').trim();
    if (!name) return;
    const color = String(data.get('tagColor') || '#F6D32D');
    const saved = existing
      ? { ...existing, name, color, updatedAt: new Date().toISOString() }
      : createTag({ name, color });
    saveTags(existing
      ? getTags().map((item) => item.id === saved.id ? saved : item)
      : [...getTags(), saved]);
    layer.v2Close?.();
    onSaved(saved);
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
