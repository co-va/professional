import { openEntityCardAppearanceQ } from '../../ui/ui.js';
import { flushBusinessPersistence } from '../business-persistence.js';
import { getCardAppearanceTemplate, saveCardAppearanceTemplate } from '../../core/card-appearance-templates.js';
import { getProcedures, commitProcedureCardAppearance, resetProcedureCardAppearances } from './procedures/data.js';
import { getProducts, commitProductCardAppearance, resetProductCardAppearances } from './products/data.js';
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
      photoPosition: String((target === 'all' ? template?.photoPosition : product.photoPosition || template?.photoPosition) || '50% 50%'),
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
    photoPosition: String((target === 'all' ? template?.photoPosition : procedure.photoPosition || template?.photoPosition) || '50% 50%'),
  };
}

async function saveServiceAppearance({ type, target, appearance, photo, editor }) {
  if (target === 'all') {
    saveCardAppearanceTemplate(type, {
      appearance,
      photo,
      photoPosition: editor?.photoPosition || '50% 50%',
    });
    if (type === 'product') await resetProductCardAppearances();
    else await resetProcedureCardAppearances();
    await flushBusinessPersistence();
    return;
  }

  const current = serviceEntities(type).find((item) => String(item.id || '') === String(target || ''));
  if (!current) throw new Error('Позиция больше не доступна.');
  const update = { appearance, photo, photoPosition: editor?.photoPosition || '50% 50%' };
  if (type === 'product') await commitProductCardAppearance(current.id, update);
  else await commitProcedureCardAppearance(current.id, update);
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
