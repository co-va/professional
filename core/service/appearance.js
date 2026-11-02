import { openEntityCardAppearanceQ } from '../../ui/ui.js';
import { getCardAppearanceTemplate, saveCardAppearanceTemplate } from '../../core/card-appearance-templates.js';
import { getSettlementItemTotals } from '../../core/finance/index.js';
import { getRecords } from '../../core/record/index.js';
import { getProcedures, pushProcedureHistory, saveProcedure } from './procedures/data.js';
import { getProducts, pushProductHistory, saveProduct } from './products/data.js';
import {
  procedureCardAppearance,
  procedureCardFields,
  procedureCardPhoto,
  productCardAppearance,
  productCardFields,
  productCardPhoto,
} from './card-presentation.js';

function serviceEntities(type) {
  if (type === 'procedure') return getProcedures();
  if (type === 'product') return getProducts();
  return [];
}

function serviceTargetOptions(type) {
  const allLabel = type === 'product' ? 'Все товары' : 'Все процедуры';
  return [
    { value: 'all', label: allLabel },
    ...serviceEntities(type).map((item) => ({
      value: String(item.id || ''),
      label: String(item.name || (type === 'product' ? 'Товар' : 'Процедура')),
    })),
  ];
}

function recordsFor(type, id) {
  const key = type === 'product' ? 'products' : 'procedures';
  return getRecords().filter((record) => record?.status !== 'cancelled'
    && (record?.[key] || []).some((item) => String(item?.id || '') === String(id || '')));
}

function spentMinutes(records = [], procedure = {}) {
  return records.reduce((sum, record) => {
    const item = (record?.procedures || []).find((value) => String(value?.id || '') === String(procedure.id || ''));
    return sum + Math.max(0, Number(item?.duration ?? procedure.duration ?? 0) || 0);
  }, 0);
}

function spentText(minutes = 0) {
  const total = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} мин`;
  if (!rest) return `${hours} ч`;
  return `${hours} ч ${rest} мин`;
}

function serviceAppearanceEditor(type, target) {
  const values = serviceEntities(type);
  const selected = target === 'all'
    ? (values[0] || null)
    : (values.find((item) => String(item.id || '') === String(target || '')) || values[0] || null);
  const template = getCardAppearanceTemplate(type);

  if (type === 'product') {
    const product = selected || { id: '', name: 'Товар', photo: '', cardAppearance: {}, workplaces: [], cost: {} };
    const records = product.id ? recordsFor(type, product.id) : [];
    const fact = product.id ? getSettlementItemTotals('product', product.id) : { factTotal: 0 };
    return {
      appearance: target === 'all' && template?.appearance ? template.appearance : productCardAppearance(product),
      fields: productCardFields(product, { saleCount: records.length, revenue: fact.factTotal }),
      photo: target === 'all' ? String(template?.photo || product.photo || '') : productCardPhoto(product),
      photoPosition: String(template?.photoPosition || '50% 50%'),
    };
  }

  const procedure = selected || { id: '', name: 'Процедура', photo: '', cardAppearance: {}, workplaces: [], cost: {}, duration: 0 };
  const records = procedure.id ? recordsFor(type, procedure.id) : [];
  const fact = procedure.id ? getSettlementItemTotals('procedure', procedure.id) : { factTotal: 0 };
  return {
    appearance: target === 'all' && template?.appearance ? template.appearance : procedureCardAppearance(procedure),
    fields: procedureCardFields(procedure, {
      recordCount: records.length,
      spentTime: spentText(spentMinutes(records, procedure)),
      revenue: fact.factTotal,
    }),
    photo: target === 'all' ? String(template?.photo || procedure.photo || '') : procedureCardPhoto(procedure),
    photoPosition: String(template?.photoPosition || '50% 50%'),
  };
}

async function saveServiceAppearance({ type, target, appearance, photo, editor }) {
  if (target === 'all') {
    saveCardAppearanceTemplate(type, {
      appearance,
      photo,
      photoPosition: editor?.photoPosition || '50% 50%',
    });
    serviceEntities(type).forEach((item) => {
      if (type === 'product') saveProduct({ ...item, cardAppearance: {}, updatedAt: new Date().toISOString() });
      else saveProcedure({ ...item, cardAppearance: {}, updatedAt: new Date().toISOString() });
    });
    return;
  }

  const current = serviceEntities(type).find((item) => String(item.id || '') === String(target || ''));
  if (!current) return;
  if (type === 'product') {
    pushProductHistory(current, 'updated');
    saveProduct({ ...current, photo, cardAppearance: appearance, updatedAt: new Date().toISOString() });
  } else {
    pushProcedureHistory(current, 'updated');
    saveProcedure({ ...current, photo, cardAppearance: appearance, updatedAt: new Date().toISOString() });
  }
}

export function openServiceAppearanceQ(root, { onSaved = () => {} } = {}) {
  return openEntityCardAppearanceQ(root, {
    title: 'Вид',
    typeLabel: 'Тип карты',
    typeOptions: [
      { value: 'procedure', label: 'Процедура' },
      { value: 'product', label: 'Товар' },
    ],
    initialType: 'procedure',
    targetLabel: 'Карта',
    initialTarget: 'all',
    targetOptions: serviceTargetOptions,
    resolve: serviceAppearanceEditor,
    save: saveServiceAppearance,
    onSaved,
  });
}
