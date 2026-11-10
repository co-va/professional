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
  page,
  v2ListEntries,
  v2ListEntry,
  v2ZLayer,
  workplaceCountText,
} from '../../../ui/ui.js';
import { getSettlementItemTotals, getSettlementItemTotalsForRecords } from '../../../core/finance/index.js';
import { getRecordsForProcedure } from '../../../core/record/index.js';
import { getWorkplaces } from '../../profile/workplaces/data.js';
import { serviceHeaderContext, notifyServiceContext } from '../context.js';
import { procedureCardAppearance, procedureCardFields, procedureCardPhoto } from '../card-presentation.js';
import { bindProcedureEditor, initialProcedure, procedureEditorForm } from './form.js';
import { deleteProcedure as deleteProcedureData, getProcedures, reorderProcedures } from './data.js';
import { flushBusinessPersistence } from '../../../core/business-persistence.js';

const money = (value) => `${new Intl.NumberFormat('ru-RU').format(Number(value || 0))} ₽`;

function activeProcedureRecords(procedureId) {
  const id = String(procedureId || '');
  return getRecordsForProcedure(id).filter((record) => record?.status !== 'cancelled');
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
    interactive: true,
    data: 'data-procedure-open-editor',
    aria: `Редактировать услугу ${procedure.name || ''}`,
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
  const layer = mountModal(document.body, modal(`<div class="modal-title"><h2>Удалить услугу?</h2><p>${escapeHtml(procedure.name || 'Услуга')} будет исключена из прайса и новой записи. История сохранится.</p></div><div class="form-error" role="alert" data-procedure-delete-error></div><div class="modal-actions">${button('Удалить', { variant: 'danger', data: 'data-confirm-delete-procedure' })}${button('Отмена', { variant: 'secondary', data: 'data-cancel-delete-procedure' })}</div>`, {
    variant: 'x',
    title: 'Удаление услуги',
  }));
  if (!layer) return null;
  layer.querySelector('[data-cancel-delete-procedure]')?.addEventListener('click', () => layer.v2Close?.());
  const confirm = layer.querySelector('[data-confirm-delete-procedure]');
  confirm?.addEventListener('click', async () => {
    if (confirm.disabled) return;
    confirm.disabled = true;
    try {
      if (!deleteProcedureData(procedure.id)) throw new Error('Услуга уже удалена.');
      await flushBusinessPersistence();
      layer.v2Close?.();
      onDeleted?.();
    } catch (error) {
      const message = layer.querySelector('[data-procedure-delete-error]');
      if (message) message.textContent = error instanceof Error ? error.message : 'Не удалось удалить услугу.';
      confirm.disabled = false;
    }
  });
  return layer;
}

// The service Q editor owns editing, workplace assignment and deletion.
// Neither overview nor editor needs a V/settings menu.
export function openProcedureEditor(root, existing = null, {
  onChanged = () => {},
  onSaved = () => {},
  onDeleted = () => {},
  defaultWorkplace = null,
} = {}) {
  const draft = initialProcedure(existing, defaultWorkplace);
  const body = [
    procedureEditorForm(draft),
    actionBlock(button('Сохранить', { type: 'button', data: 'data-procedure-editor-primary', aria: 'Сохранить услугу' })),
    existing ? `<div class="app-settings-panel">${button('Удалить услугу', {
      type: 'button',
      variant: 'outline',
      className: 'ui-button--delete-outline',
      data: 'data-procedure-editor-delete',
    })}</div>` : '',
  ].join('');
  const layer = mountModal(document.body, modal(body, {
    title: existing?.name || 'Новая услуга',
    variant: 'q',
    surface: 'app',
    className: 'service-procedure-editor-layer',
  }));
  if (!layer) return null;
  bindProcedureEditor(layer, {
    existing,
    draft,
    onSaved: (saved) => {
      layer.v2Close?.();
      onSaved(saved);
      onChanged();
    },
  });
  if (existing) {
    layer.querySelector('[data-procedure-editor-delete]')?.addEventListener('click', () => {
      confirmDeleteProcedure(existing, () => {
        layer.v2Close?.();
        onDeleted(existing);
        onChanged();
      });
    });
  }
  notifyServiceContext();
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
    serviceHeaderContext({ title: procedure.name || 'Услуга' }),
    procedureOverviewCard(procedure, records),
    procedureWorkplaceCards(procedure, records),
  ]);
  layer.querySelector('[data-procedure-open-editor]')?.addEventListener('click', () => {
    openProcedureEditor(baseRoot, procedure, {
      onSaved: (saved) => {
        if (layer.isConnected) renderProcedureOverview(layer, baseRoot, saved.id, { onChanged });
      },
      onDeleted: () => layer.v2Close?.(),
      onChanged,
    });
  });
  notifyServiceContext();
}

export function openProcedureOverview(root, id, { onChanged = () => {} } = {}) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'service-procedure-overview-layer' }), { stack: true });
  if (!layer) return null;
  renderProcedureOverview(layer, root, id, { onChanged });
  return layer;
}
