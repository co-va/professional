import {
  actionBlock,
  button,
  costListParts,
  durationText,
  emptyState,
  entityVisualCard,
  escapeHtml,
  initV2ListReorder,
  miniCard,
  miniCardRail,
  modal,
  mountModal,
  mountV2ZLayer,
  openSharedProfileSettingsMenu,
  page,
  v2ListEntries,
  v2ListEntry,
  v2ZLayer,
  workplaceCountText,
} from '../../../ui/ui.js';
import { getSettlementItemTotals, getSettlementItemTotalsForRecords } from '../../../core/finance/index.js';
import { getRecords } from '../../../core/record/index.js';
import { getWorkplaces } from '../../profile/workplaces/data.js';
import { serviceHeaderContext, notifyServiceContext } from '../context.js';
import { openServiceWorkplaceSelection } from '../workplace-selection.js';
import { procedureCardAppearance, procedureCardFields, procedureCardPhoto } from '../card-presentation.js';
import { bindProcedureEditor, initialProcedure, procedureEditorForm } from './form.js';
import { deleteProcedure as deleteProcedureData, getProcedures, reorderProcedures, saveProcedure as saveProcedureData } from './data.js';

const money = (value) => `${new Intl.NumberFormat('ru-RU').format(Number(value || 0))} ₽`;

function activeProcedureRecords(procedureId) {
  const id = String(procedureId || '');
  return getRecords().filter((record) => record?.status !== 'cancelled'
    && (record?.procedures || []).some((item) => String(item?.id || '') === id));
}

function spentMinutes(records, procedure) {
  return (Array.isArray(records) ? records : []).reduce((sum, record) => {
    const item = (record?.procedures || []).find((value) => String(value?.id || '') === String(procedure?.id || ''));
    return sum + Math.max(0, Number(item?.duration ?? procedure?.duration ?? 0) || 0);
  }, 0);
}

function spentText(minutes) {
  const total = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} мин`;
  if (!rest) return `${hours} ч`;
  return `${hours} ч ${rest} мин`;
}

function updateProcedure(current, patch) {
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  saveProcedureData(next);
  return next;
}

function procedureRow(procedure) {
  const price = costListParts(procedure.cost);
  return v2ListEntry({
    title: procedure.name || '',
    subtitle: `${durationText(procedure.duration)} — ${workplaceCountText((procedure.workplaces || []).length)}`,
    image: procedureCardPhoto(procedure),
    initial: (procedure.name || '?').slice(0, 1).toUpperCase(),
    rightTop: price.rightTop || '',
    rightBottom: price.rightBottom || '',
    interactive: true,
    reorderHandle: true,
    reorderAria: 'Изменить порядок',
    data: `data-procedure="${escapeHtml(procedure.id)}" data-reorder-id="${escapeHtml(procedure.id)}"`,
    aria: `Открыть услугу ${procedure.name || ''}`,
  });
}

export function renderProcedureCatalog(host, { root = host, onChanged = () => {} } = {}) {
  const items = getProcedures();
  host.innerHTML = items.length
    ? v2ListEntries(items.map(procedureRow))
    : emptyState('Услуг пока нет', 'Добавьте первую услугу кнопкой «+».');

  host.querySelectorAll('[data-procedure]').forEach((node) => {
    node.addEventListener('click', () => openProcedureOverview(root, node.dataset.procedure, { onChanged }));
  });

  return initV2ListReorder(host, {
    onReorder: (ids) => {
      if (reorderProcedures(ids)) onChanged();
    },
  });
}

function procedureOverviewCard(procedure, records) {
  const fact = getSettlementItemTotals('procedure', procedure.id);
  return entityVisualCard({
    appearance: procedureCardAppearance(procedure),
    fields: procedureCardFields(procedure, {
      recordCount: records.length,
      spentTime: spentText(spentMinutes(records, procedure)),
      revenue: fact.factTotal,
    }),
    image: procedureCardPhoto(procedure),
    className: 'entity-visual-card--service',
  });
}

function procedureWorkplaceCards(procedure, records) {
  const byId = new Map(getWorkplaces().map((workplace) => [String(workplace.key || workplace.id || ''), workplace]));
  const byWorkplace = new Map();
  for (const record of records) {
    const id = String(record?.workplaceId || '');
    if (!byWorkplace.has(id)) byWorkplace.set(id, []);
    byWorkplace.get(id).push(record);
  }
  const cards = (procedure.workplaces || []).map((selection) => {
    const id = String(selection.workplaceId || selection.id || selection.key || '');
    const workplace = byId.get(id) || selection;
    const workplaceRecords = byWorkplace.get(id) || [];
    const fact = getSettlementItemTotalsForRecords('procedure', procedure.id, workplaceRecords.map((record) => record.id));
    return miniCard({
      title: workplace.name || selection.name || 'Рабочее пространство',
      rows: [
        { label: 'Кол-во', value: String(workplaceRecords.length) },
        { label: 'Время', value: spentText(spentMinutes(workplaceRecords, procedure)) },
        { label: 'Сумма', value: money(fact.factTotal) },
      ],
    });
  });
  return cards.length ? miniCardRail(cards) : '';
}

function confirmDeleteProcedure(procedure, onDeleted) {
  const layer = mountModal(document.body, modal(`<div class="modal-title"><h2>Удалить?</h2><p>${escapeHtml(procedure.name || 'Услуга')} будет удалена.</p></div><div class="modal-actions">${button('Удалить', { variant: 'danger', data: 'data-confirm-delete-procedure' })}${button('Отмена', { variant: 'secondary', data: 'data-cancel-delete-procedure' })}</div>`, {
    variant: 'x',
    title: 'Удаление услуги',
  }));
  if (!layer) return;
  layer.querySelector('[data-cancel-delete-procedure]')?.addEventListener('click', () => layer.v2Close?.());
  layer.querySelector('[data-confirm-delete-procedure]')?.addEventListener('click', () => {
    if (deleteProcedureData(procedure.id)) onDeleted?.();
    layer.v2Close?.();
  });
}

function openProcedureOverviewSettings(layer, baseRoot, procedure, { onChanged = () => {} } = {}) {
  return openSharedProfileSettingsMenu({
    title: 'Настройки',
    actions: [
      {
        id: 'workplaces',
        label: 'Рабочие пространства',
        onSelect: () => openServiceWorkplaceSelection({
          selected: procedure.workplaces || [],
          onChange: (workplaces) => {
            procedure = updateProcedure(procedure, { workplaces });
            renderProcedureOverview(layer, baseRoot, procedure.id, { onChanged });
          },
        }),
      },
      {
        id: 'editor',
        label: 'Редактор услуги',
        onSelect: () => renderProcedureEditor(layer, baseRoot, procedure, { onChanged }),
      },
      {
        id: 'delete',
        label: 'Удалить',
        variant: 'danger',
        onSelect: () => confirmDeleteProcedure(procedure, () => {
          layer.v2Close?.();
          onChanged();
        }),
      },
    ],
  });
}

function editorDraftSettings(draft) {
  return openSharedProfileSettingsMenu({
    title: 'Настройки',
    actions: [
      {
        id: 'workplaces',
        label: 'Рабочие пространства',
        onSelect: () => openServiceWorkplaceSelection({
          selected: draft.workplaces || [],
          onChange: (workplaces) => { draft.workplaces = workplaces; },
        }),
      },
    ],
  });
}

function renderProcedureEditor(layer, baseRoot, existing = null, { onChanged = () => {}, onSaved = () => {} } = {}) {
  const draft = initialProcedure(existing);
  const title = existing?.name || 'Новая услуга';
  layer.innerHTML = page([
    serviceHeaderContext({
      title,
      settingsData: 'data-procedure-editor-settings',
      settingsAria: 'Настройки услуги',
    }),
    procedureEditorForm(existing),
    actionBlock(button('Сохранить', { type: 'button', data: 'data-procedure-editor-primary', aria: 'Сохранить услугу' })),
  ]);

  layer.querySelector('[data-procedure-editor-settings]')?.addEventListener('click', () => editorDraftSettings(draft));
  bindProcedureEditor(layer, {
    existing,
    draft,
    onSaved: (saved) => {
      onSaved(saved);
      if (existing) renderProcedureOverview(layer, baseRoot, saved.id, { onChanged });
      else {
        layer.v2Close?.();
        onChanged();
      }
    },
  });
  notifyServiceContext();
}

export function openProcedureEditor(root, existing = null, { onChanged = () => {}, onSaved = () => {} } = {}) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'service-procedure-editor-layer' }), { stack: true });
  if (!layer) return null;
  renderProcedureEditor(layer, root, existing, { onChanged, onSaved });
  return layer;
}

function renderProcedureOverview(layer, baseRoot, id, { onChanged = () => {} } = {}) {
  const procedure = getProcedures().find((item) => String(item.id) === String(id));
  if (!procedure) {
    layer.v2Close?.();
    onChanged();
    return;
  }
  // Project Record/Finance once per opened entity, not once per workplace card.
  const records = activeProcedureRecords(procedure.id);
  layer.innerHTML = page([
    serviceHeaderContext({
      title: procedure.name || 'Услуга',
      settingsData: 'data-procedure-settings',
      settingsAria: `Настройки ${procedure.name || 'услуги'}`,
    }),
    procedureOverviewCard(procedure, records),
    procedureWorkplaceCards(procedure, records),
  ]);
  layer.querySelector('[data-procedure-settings]')?.addEventListener('click', () => openProcedureOverviewSettings(layer, baseRoot, procedure, { onChanged }));
  notifyServiceContext();
}

export function openProcedureOverview(root, id, { onChanged = () => {} } = {}) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'service-procedure-overview-layer' }), { stack: true });
  if (!layer) return null;
  renderProcedureOverview(layer, root, id, { onChanged });
  return layer;
}
