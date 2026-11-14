import { openEntityCardAppearanceQ } from '../../ui/ui.js';
import { getCardAppearanceTemplate, saveCardAppearanceTemplate } from '../../core/card-appearance-templates.js';
import { getProcedures, resetProcedureCardAppearances, saveProcedure } from './procedures/data.js';
import { getProducts, pushProductHistory, resetProductCardAppearances, saveProduct } from './products/data.js';
import { serviceItemStatistics, serviceSpentText } from './statistics.js';
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
  const allLabel = type === 'product' ? 'Все товары' : 'Все услуги';
  return [
    { value: 'all', label: allLabel },
    ...serviceEntities(type).map((item) => ({
      value: String(item.id || ''),
      label: String(item.name || (type === 'product' ? 'Товар' : 'Услуга')),
    })),
  ];
}

function serviceAppearanceEditor(type, target) {
  const values = serviceEntities(type);
  const selected = target === 'all'
    ? (values[0] || null)
    : (values.find((item) => String(item.id || '') === String(target || '')) || values[0] || null);
  const template = getCardAppearanceTemplate(type);

  if (type === 'product') {
    const product = selected || { id: '', name: 'Товар', photo: '', cardAppearance: {}, workplaces: [], cost: {} };
    const statistics = serviceItemStatistics('product', product);
    return {
      appearance: target === 'all' && template?.appearance ? template.appearance : productCardAppearance(product),
      fields: productCardFields(product, { saleCount: statistics.count, revenue: statistics.revenue }),
      photo: target === 'all' ? String(template?.photo || product.photo || '') : productCardPhoto(product),
      photoPosition: String(template?.photoPosition || '50% 50%'),
    };
  }

  const procedure = selected || { id: '', name: 'Услуга', photo: '', cardAppearance: {}, workplaces: [], cost: {}, duration: 0 };
  const statistics = serviceItemStatistics('procedure', procedure);
  return {
    appearance: target === 'all' && template?.appearance ? template.appearance : procedureCardAppearance(procedure),
    fields: procedureCardFields(procedure, {
      recordCount: statistics.count,
      spentTime: serviceSpentText(statistics.minutes),
      revenue: statistics.revenue,
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
    if (type === 'product') resetProductCardAppearances();
    else resetProcedureCardAppearances();
    return;
  }

  const current = serviceEntities(type).find((item) => String(item.id || '') === String(target || ''));
  if (!current) return;
  if (type === 'product') {
    pushProductHistory(current, 'updated');
    saveProduct({ ...current, photo, cardAppearance: appearance, updatedAt: new Date().toISOString() });
  } else {
    saveProcedure({ ...current, photo, cardAppearance: appearance, updatedAt: new Date().toISOString() });
  }
}

export function openServiceAppearanceQ(root, { onSaved = () => {} } = {}) {
  return openEntityCardAppearanceQ(root, {
    title: 'Вид',
    typeLabel: 'Тип карты',
    typeOptions: [
      { value: 'procedure', label: 'Услуга' },
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
