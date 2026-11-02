import { getProcedures, pushProcedureHistory, saveProcedure } from './data.js';

const normalizeId = (value) => String(value || '').trim();

function hasWorkplace(procedure, workplaceId) {
  const id = normalizeId(workplaceId);
  return (Array.isArray(procedure?.workplaces) ? procedure.workplaces : [])
    .some((item) => normalizeId(item?.workplaceId ?? item?.id ?? item?.key) === id);
}

export function assignProceduresToWorkplace({
  procedureIds = [],
  workplaceId = '',
  workplaceName = '',
} = {}) {
  const targetWorkplaceId = normalizeId(workplaceId);
  const ids = new Set((Array.isArray(procedureIds) ? procedureIds : []).map(normalizeId).filter(Boolean));
  if (!targetWorkplaceId || !ids.size) return [];

  const updated = [];
  getProcedures().forEach((procedure) => {
    const procedureId = normalizeId(procedure?.id);
    if (!ids.has(procedureId) || hasWorkplace(procedure, targetWorkplaceId)) return;

    const previous = {
      ...procedure,
      workplaces: Array.isArray(procedure?.workplaces) ? procedure.workplaces.map((item) => ({ ...item })) : [],
    };
    const next = {
      ...procedure,
      workplaces: [
        ...(Array.isArray(procedure?.workplaces) ? procedure.workplaces : []),
        { workplaceId: targetWorkplaceId, name: String(workplaceName || '').trim() },
      ],
      updatedAt: new Date().toISOString(),
    };
    pushProcedureHistory(previous, 'updated');
    saveProcedure(next);
    updated.push(next);
  });
  return updated;
}
