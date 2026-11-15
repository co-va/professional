// Read-only inventory-card audit. Optional commercial fields (supplier,
// discount, stock thresholds, prices) are not mistaken for mandatory fields.
// Zero tare is a valid value; an unset tare is not.
const value = (input) => String(input ?? '').trim();
const hasText = (input) => value(input).length > 0;
const hasPositive = (input) => input !== '' && input != null && Number.isFinite(Number(input)) && Number(input) > 0;
const hasNonNegative = (input) => input !== '' && input != null && Number.isFinite(Number(input)) && Number(input) >= 0;

export function isWeighedInventoryItem(item = {}) {
  return ['г', 'гр', 'гр.', 'грамм', 'граммы'].includes(value(item?.unit).toLocaleLowerCase('ru-RU'));
}

export function inventoryItemCompletion(item = {}) {
  const checks = [
    { label: 'Наименование', ok: hasText(item.name) },
    { label: 'Производитель', ok: hasText(item.manufacturer) },
    { label: 'Единица', ok: hasText(item.unit) },
    { label: 'Категория', ok: hasText(item.category) || hasText(item.productType) },
    { label: 'Артикул или штрихкод', ok: hasText(item.sku) || hasText(item.barcode) },
  ];
  if (isWeighedInventoryItem(item)) {
    checks.push(
      { label: 'В упаковке', ok: hasPositive(item.packageQuantity) },
      { label: 'Масса брутто', ok: hasPositive(item.grossWeight) },
      { label: 'Масса тары', ok: hasNonNegative(item.tareWeight) },
    );
  }
  if (hasNonNegative(item.tareWeight) && hasPositive(item.grossWeight)
    && Number(item.tareWeight) > Number(item.grossWeight)) {
    checks.push({ label: 'Проверить массу тары', ok: false });
  }
  const missing = checks.filter((check) => !check.ok).map(({ label }) => label);
  return {
    filled: checks.length - missing.length,
    total: checks.length,
    percentage: Math.round(100 * (checks.length - missing.length) / checks.length),
    missing,
    complete: missing.length === 0,
  };
}

export function inventoryManufacturerCompletion(items = []) {
  const audits = (Array.isArray(items) ? items : []).map(inventoryItemCompletion);
  const total = audits.reduce((sum, audit) => sum + audit.total, 0);
  const filled = audits.reduce((sum, audit) => sum + audit.filled, 0);
  return {
    percentage: total ? Math.round(100 * filled / total) : 100,
    incomplete: audits.filter((audit) => !audit.complete).length,
    count: audits.length,
  };
}

// Product content is recorded in grams; tareWeight is grams per actual tube.
// We never guess the count from a gross measurement, or treat an absent tare
// as 0. A negative result is an error, not an inventory adjustment to zero.
export function netStocktakeGrams({ gross, containers, tareWeight } = {}) {
  const numericGross = Number(gross);
  const numericCount = Number(containers);
  const numericTare = Number(tareWeight);
  if (gross === '' || gross == null || !Number.isFinite(numericGross) || numericGross < 0)
    throw new Error('Укажите общий вес с тарой.');
  if (containers === '' || containers == null || !Number.isInteger(numericCount) || numericCount < 0)
    throw new Error('Укажите количество тюбиков.');
  // An empty location may contain zero tubes and zero grams of gross weight.
  if (numericCount === 0) {
    if (numericGross !== 0) throw new Error('При нуле тюбиков общий вес должен быть равен нулю.');
    return 0;
  }
  if (tareWeight === '' || tareWeight == null || !Number.isFinite(numericTare) || numericTare < 0)
    throw new Error('В карточке товара не указана масса тары.');
  const content = numericGross - numericCount * numericTare;
  if (content < -0.000001) throw new Error('Масса тары превышает общий вес.');
  return Math.max(0, Math.round(content * 1000) / 1000);
}

// Order thresholds are kept in the InventoryItem's canonical accounting unit
// (grams for colour). Operators configure them as fractions of a full tube.
// A tube is packageQuantity grams, never containerCount (physical tubes).
export function inventoryStockThresholdUnit(item = {}) {
  return isWeighedInventoryItem(item) ? 'тюб.' : String(item.unit || 'шт.');
}

export function inventoryStockThresholdInput(item = {}, value = null) {
  if (value == null || value === '') return '';
  const raw = Number(value);
  if (!Number.isFinite(raw)) return '';
  const size = Number(item.packageQuantity);
  const perUnit = isWeighedInventoryItem(item) && Number.isFinite(size) && size > 0
    ? raw / size : raw;
  return Number(perUnit.toFixed(6));
}

export function inventoryStockThresholdStored(item = {}, value = null) {
  if (value == null || value === '') return null;
  const units = Number(value);
  if (!Number.isFinite(units) || units < 0) throw new Error('Укажите неотрицательный минимум и цель.');
  if (!isWeighedInventoryItem(item)) return units;
  const size = Number(item.packageQuantity);
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('Сначала укажите содержимое одного тюбика в поле «Упаковка».');
  }
  return Number((units * size).toFixed(6));
}
