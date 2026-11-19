import { getProcedures, commitProcedureBatch } from './data.js';
import { changeWorkplaceAssignment } from '../workplace-assignment.js';
import { procedureWorkplaceAssignment } from './selection.js';

const idOf = (value) => String(value || '').trim();

// A single batched ACK for all selected Procedures. Uses the same immutable
// transformation as Q's individual workspace editor.
export async function assignProceduresToWorkplace({
  procedureIds = [],
  workplaceId = '',
  workplaceName = '',
} = {}) {
  const id = idOf(workplaceId);
  const selected = new Set((Array.isArray(procedureIds) ? procedureIds : []).map(idOf).filter(Boolean));
  if (!id || !selected.size) return [];
  if (!getProcedures().some((procedure) => selected.has(idOf(procedure.id)) && !procedureWorkplaceAssignment(procedure, id))) return [];

  const assigned = [];
  await commitProcedureBatch((values) => {
    assigned.length = 0;
    return values.map((procedure) => {
      if (procedure.deletedAt || !selected.has(idOf(procedure.id)) || procedureWorkplaceAssignment(procedure, id)) return procedure;
      const next = changeWorkplaceAssignment(procedure, id, {
        workplaceId: id, name: String(workplaceName || '').trim(),
      });
      assigned.push(next);
      return next;
    });
  });
  return assigned;
}
