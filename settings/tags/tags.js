import {
  button,
  colorPicker,
  emptyState,
  field,
  initColorPickers,
  miniCard,
  miniCardRail,
  modal,
  mountModal,
  page,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import { createTag, getTags, saveTags } from './data.js';

function tagCard(tag = {}) {
  return miniCard({
    title: String(tag.name || 'Ярлык'),
    subtitle: String(tag.color || ''),
    interactive: true,
    data: `data-tag-edit="${String(tag.id || '')}"`,
    aria: `Изменить ярлык ${String(tag.name || '')}`,
  });
}

function renderList(root) {
  const items = getTags();
  root.innerHTML = page([
    workspaceHeaderContext({
      title: 'Ярлыки',
      c: {
        label: '+',
        data: 'data-tag-add',
        aria: 'Добавить ярлык',
      },
    }),
    items.length
      ? miniCardRail(items.map(tagCard))
      : emptyState('Ярлыков пока нет', 'Добавьте первый ярлык кнопкой «+».'),
  ]);

  root.querySelector('[data-tag-add]')?.addEventListener('click', () => openForm(root));
  root.querySelectorAll('[data-tag-edit]').forEach((card) => {
    card.addEventListener('click', () => {
      const tag = getTags().find((item) => item.id === card.dataset.tagEdit);
      if (tag) openForm(root, tag);
    });
  });
  window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
}

function openForm(root, existing = null) {
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

    if (existing) {
      saveTags(getTags().map((item) => item.id === existing.id
        ? { ...item, name, color, updatedAt: new Date().toISOString() }
        : item));
    } else {
      saveTags([...getTags(), createTag({ name, color })]);
    }

    layer.v2Close?.();
    renderList(root);
  });
  return layer;
}

export function renderTags(root) {
  renderList(root);
}

export { renderTags as render };
