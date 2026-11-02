import { select } from '../selectors/index.js';
import { escapeHtml } from '../utils/escape-html.js';

function normalizeSelected(values = [], tags = []) {
  const ids = new Set(tags.map((tag) => tag.id));
  const byName = new Map(tags.map((tag) => [tag.name, tag.id]));
  return [...new Set((Array.isArray(values) ? values : []).map((value) => ids.has(value) ? value : byName.get(value)).filter(Boolean))];
}

function tagChip(tag) {
  const color = escapeHtml(tag.color || '#E8E1DC');
  return `<span class="tag" data-tag-id="${escapeHtml(tag.id)}" style="background:${color}">${escapeHtml(tag.name)}<button type="button" class="remove-button" data-remove-tag aria-label="Снять ярлык ${escapeHtml(tag.name)}">×</button></span>`;
}

function tagManagerRow(tag) {
  return `<div class="tag-manager-list__item" data-edit-tag="${escapeHtml(tag.id)}" role="button" tabindex="0" aria-label="Изменить ярлык ${escapeHtml(tag.name)}">
    <span class="tag-manager-list__swatch" style="--tag-manager-color:${escapeHtml(tag.color)}" aria-hidden="true"></span>
    <strong class="tag-manager-list__name">${escapeHtml(tag.name)}</strong>
    <button type="button" class="remove-button tag-manager-list__delete" data-delete-tag="${escapeHtml(tag.id)}" aria-label="Удалить ярлык ${escapeHtml(tag.name)}">×</button>
  </div>`;
}

export function tagManagerList(items = []) {
  return `<div class="tag-manager-list">${items.map(tagManagerRow).join('')}</div>`;
}

function syncSelector(host) {
  const input = host.querySelector('[data-tag-add]');
  const trigger = host.querySelector('[data-ui-select-trigger][data-tag-add]');
  if (!input || !trigger) return;
  const catalog = JSON.parse(host.dataset.tagCatalog || '[]');
  const selected = new Set([...host.querySelectorAll('[data-tag-id]')].map((element) => element.dataset.tagId));
  const options = [{ value: '', label: 'Добавить ярлык' }, ...catalog.filter((tag) => !selected.has(tag.id)).map((tag) => ({ value: tag.id, label: tag.name }))];
  input.value = '';
  trigger.dataset.options = JSON.stringify(options);
  const value = trigger.querySelector('.ui-select__value');
  if (value) value.textContent = 'Добавить ярлык';
}

export function tags({ tags: available = [], selected = [], name = 'tags' } = {}) {
  const selectedIds = normalizeSelected(selected, available);
  const selectedSet = new Set(selectedIds);
  const selectedTags = selectedIds.map((id) => available.find((tag) => tag.id === id)).filter(Boolean);
  const options = [{ value: '', label: 'Добавить ярлык' }, ...available.filter((tag) => !selectedSet.has(tag.id)).map((tag) => ({ value: tag.id, label: tag.name }))];
  const catalog = escapeHtml(JSON.stringify(available.map(({ id, name: tagName, color }) => ({ id, name: tagName, color }))));
  return `<div class="ui-tags" data-tags="${escapeHtml(name)}" data-tag-catalog="${catalog}"><div class="tag-list" data-tag-list>${selectedTags.map(tagChip).join('')}</div>${available.length ? select({ name: `${name}-add`, value: '', options, aria: 'Добавить ярлык', data: 'data-tag-add' }) : '<span class="muted">Сначала создайте ярлыки в Настройках.</span>'}</div>`;
}

export function initTags(root) {
  root.querySelectorAll('[data-tags]').forEach((host) => {
    if (host.dataset.tagsReady === 'true') return;
    host.dataset.tagsReady = 'true';
    host.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-remove-tag]');
      if (!remove) return;
      remove.closest('[data-tag-id]')?.remove();
      syncSelector(host);
      host.dispatchEvent(new Event('change', { bubbles: true }));
    });
    host.querySelector('[data-tag-add]')?.addEventListener('change', (event) => {
      const id = event.target.value;
      if (!id || host.querySelector(`[data-tag-id="${CSS.escape(id)}"]`)) return;
      const catalog = JSON.parse(host.dataset.tagCatalog || '[]');
      const tag = catalog.find((item) => item.id === id);
      if (!tag) return;
      host.querySelector('[data-tag-list]')?.insertAdjacentHTML('beforeend', tagChip(tag));
      syncSelector(host);
      host.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}

export function collectTags(root, name = 'tags') {
  return [...root.querySelectorAll(`[data-tags="${CSS.escape(name)}"] [data-tag-id]`)].map((element) => element.dataset.tagId).filter(Boolean);
}
