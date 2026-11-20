// Read-only stock figures. No movement or stock adjustment is created here.
// The Core snapshot contains a maximum of 600 movement records. Never present
// a truncated journal as a lifetime receipt, usage, or sale total.
const numeric = value => value == null || value === '' ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;
const rounded = value => Math.round((value + Number.EPSILON) * 1000) / 1000;
const direction = line => line?.direction === 'OUT' ? -1 : 1;

function movementKind(movement, byId) {
  if (movement?.kind !== 'CORRECTION') return movement?.kind || '';
  let original = byId.get(movement.originalMovementId);
  const visited = new Set();
  while (original?.kind === 'CORRECTION') {
    if (visited.has(original.movementId)) return '';
    visited.add(original.movementId);
    original = byId.get(original.originalMovementId);
  }
  return original?.kind || '';
}

export function stockItemMetrics(item = {}, snapshot = {}) {
  const itemId = String(item.itemId || '');
  const unit = String(item.unit || 'шт.');
  const balance = numeric(item.balance);
  const movements = Array.isArray(snapshot.movements) ? snapshot.movements : null;
  const complete = !!movements && movements.length < 600;

  const metrics = {
    receipt: { quantity: complete ? 0 : null, amount: complete ? 0 : null },
    consumption: { quantity: complete ? 0 : null, amount: complete ? 0 : null },
    sale: { quantity: complete ? 0 : null, amount: complete ? 0 : null },
    balance: { quantity: balance, amount: null },
    unit,
  };

  if (complete) {
    const movementsById = new Map(movements.map(movement => [movement.movementId, movement]));
    for (const movement of movements) {
      const relevant = (movement.lines || []).filter(line => String(line.itemId) === itemId);
      if (!relevant.length) continue;
      const kind = movementKind(movement, movementsById);
      // A record-linked product return reverses a previous sale, not a receipt.
      const key = kind === 'RECEIPT' ? 'receipt'
        : kind === 'CONSUMPTION' ? 'consumption'
        : kind === 'SALE' || kind === 'RETURN' && movement.sourceType === 'record-sale'
          ? 'sale' : '';
      if (!key) {
        if (movement.kind === 'CORRECTION') {
          // Without the original kind, correction figures cannot be assigned
          // to a category safely. The stock balance remains server-verified.
          for (const category of ['receipt', 'consumption', 'sale']) {
            metrics[category].quantity = null;
            metrics[category].amount = null;
          }
        }
        continue;
      }
      const target = metrics[key];
      for (const line of relevant) {
        const qty = numeric(line.quantity);
        if (qty == null || qty < 0) {
          target.quantity = null;
          target.amount = null;
          continue;
        }
        const signed = (key === 'receipt' ? 1 : -1) * direction(line);
        if (target.quantity != null) target.quantity += qty * signed;
        const cost = numeric(line.amount);
        if (target.amount != null) {
          if (cost == null && qty > 0) target.amount = null;
          else target.amount += (cost ?? 0) * signed;
        }
      }
    }
    for (const key of ['receipt', 'consumption', 'sale']) {
      const value = metrics[key].quantity;
      metrics[key].quantity = value == null ? null : rounded(value);
      const amount = metrics[key].amount;
      metrics[key].amount = amount == null ? null : rounded(amount);
    }
  }

  // Sale reporting is not connected yet. Neither quantity nor revenue is
  // an established figure; keep both blank until the sale workflow supplies them.
  // Inventory movement amounts reflect FIFO cost, not sales revenue.
  metrics.sale.quantity = null;
  metrics.sale.amount = null;

  // Active FIFO lots are the source of stock valuation, not the latest catalog
  // purchase price (which may differ from prices of items still in stock).
  if (balance != null) {
    const lots = (Array.isArray(snapshot.lots) ? snapshot.lots : [])
      .filter(lot => String(lot.itemId || '') === itemId);
    let lotQuantity = 0, lotValue = 0, valued = true;
    for (const lot of lots) {
      const quantity = numeric(lot.quantityRemaining);
      const price = numeric(lot.unitCost);
      if (quantity == null || quantity < 0) { valued = false; break; }
      lotQuantity += quantity;
      if (price == null && quantity > 0) { valued = false; break; }
      lotValue += quantity * (price ?? 0);
    }
    if (valued && Math.abs(lotQuantity - balance) <= 0.001)
      metrics.balance.amount = rounded(lotValue);
  }
  return metrics;
}
