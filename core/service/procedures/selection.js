export function procedureWorkplaceAssignment(procedure = {}, workplaceId = '') {
  const target = String(workplaceId || '');
  return (Array.isArray(procedure?.workplaces) ? procedure.workplaces : [])
    .find((item) => String(item?.workplaceId ?? item?.key ?? item?.id ?? '') === target) || null;
}

export function procedureForWorkplace(procedure = {}, workplaceId = '') {
  return Boolean(procedureWorkplaceAssignment(procedure, workplaceId));
}

export function proceduresForWorkplace(procedures = [], workplaceId = '') {
  return (Array.isArray(procedures) ? procedures : []).filter((procedure) => procedureForWorkplace(procedure, workplaceId));
}

export function costDefinitionForWorkplace(procedure = {}, workplaceId = '') {
  const assignment = procedureWorkplaceAssignment(procedure, workplaceId);
  const assigned = assignment?.cost;
  const base = procedure?.cost;
  const hasAssigned = assigned && typeof assigned === 'object' && (
    assigned.free === true
    || assigned.amount !== '' && assigned.amount != null
    || assigned.from !== '' && assigned.from != null
    || assigned.to !== '' && assigned.to != null
  );
  return hasAssigned ? assigned : base;
}

export function procedurePricingForWorkplace(procedure = {}, workplaceId = '') {
  const cost = costDefinitionForWorkplace(procedure, workplaceId);
  if (cost == null || cost?.free) return { value: 0, variable: false, free: Boolean(cost?.free) };
  if (typeof cost === 'number' || typeof cost === 'string') return { value: cost, variable: false, free: false };
  const mode = String(cost?.mode || '').trim();
  const hasFrom = cost.from !== '' && cost.from != null;
  const hasTo = cost.to !== '' && cost.to != null;
  const hasAmount = cost.amount !== '' && cost.amount != null;
  const variable = mode === 'from'
    || mode === 'from-to'
    || (!mode && (hasTo || (!hasAmount && hasFrom)));
  return {
    value: (mode === 'from' || mode === 'from-to') && hasFrom
      ? cost.from
      : hasAmount ? cost.amount : hasFrom ? cost.from : 0,
    variable,
    free: false,
  };
}

export function procedureCostForWorkplace(procedure = {}, workplaceId = '') {
  const pricing = procedurePricingForWorkplace(procedure, workplaceId);
  return pricing.free ? '' : pricing.value;
}


export function procedureDurationForWorkplace(procedure = {}, workplaceId = '') {
  const assigned = procedureWorkplaceAssignment(procedure, workplaceId)?.duration;
  return Math.max(0, Number(assigned ?? procedure?.duration ?? 0) || 0);
}

export function procedureBreakForWorkplace(procedure = {}, workplaceId = '') {
  const assigned = procedureWorkplaceAssignment(procedure, workplaceId)?.breakDuration;
  return Math.max(0, Number(assigned ?? procedure?.breakDuration ?? 0) || 0);
}

export function procedureDescriptionForWorkplace(procedure = {}, workplaceId = '') {
  const assigned = procedureWorkplaceAssignment(procedure, workplaceId)?.description;
  return String(assigned ?? procedure?.description ?? '');
}

export function procedureVisibleInBooking(procedure = {}, workplaceId = '') {
  const assignment = procedureWorkplaceAssignment(procedure, workplaceId);
  if (!assignment) return false;
  return (assignment.visibleInPublicBooking ?? procedure?.visibleInPublicBooking ?? true) !== false;
}

export function procedureGroupBookingForWorkplace(procedure = {}, workplaceId = '') {
  return procedureWorkplaceAssignment(procedure, workplaceId)?.groupBooking || procedure?.groupBooking || { enabled: false, capacity: 2 };
}
