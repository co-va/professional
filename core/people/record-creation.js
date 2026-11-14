import { openRecords } from '../records/records.js';
import { listPersonDeposits } from '../loyalty/deposit/data.js';
import { openNotice } from '../../ui/ui.js';
import { openRecordConfirmationNotice } from '../../ui/record/confirmation-notice.js';
import { calculateSettlement, recordSettlementPricePercent } from '../finance/index.js';
import { getProfile } from '../profile/data.js';
import { loadRecordCreationOperationalState } from '../runtime/operational-state.js';
import { procedurePricingForWorkplace } from '../service/procedures/selection.js';

function actionContext() {
  const profile = getProfile();
  return {
    source: 'journal',
    actor: {
      type: 'profile',
      profileId: String(profile?.id || ''),
      accountId: String(profile?.platformAccountId || ''),
    },
  };
}

export async function openPersonRecordCreation({ person, workplaceId = '', procedures = [], onCreated = () => {} } = {}) {
  if (!person?.key) return null;

  try {
    await Promise.all([loadRecordCreationOperationalState(), listPersonDeposits(person.key)]);
  } catch (error) {
    openNotice({
      title: 'Запись недоступна',
      message: String(error?.message || 'Не удалось загрузить рабочие данные.'),
    });
    return null;
  }

  return openRecords({
    context: 'person',
    person,
    workplaceId,
    procedures,
    professionalActions: true,
    actionContext: actionContext(),
    stepBack: true,
    onCreated: (created, state) => {
      onCreated?.(created);
      const procedures = (state?.procedures || []).map((entry) => {
        const pricing = procedurePricingForWorkplace(entry.raw || {}, state.workplaceId);
        return {
          name: entry.name || '',
          value: entry.cost === '' || entry.cost == null ? pricing.value : entry.cost,
          variable: pricing.variable,
          free: pricing.free,
        };
      });
      const settlement = calculateSettlement((state?.procedures || []).map((entry) => ({
        id: entry.id || '',
        name: entry.name || '',
        cost: entry.cost,
      })), {
        pricePercent: recordSettlementPricePercent(person),
      });
      openRecordConfirmationNotice({
        date: state?.date || '',
        time: state?.from || '',
        procedures,
        total: settlement.planTotal,
        variable: procedures.some((entry) => entry.variable),
      });
    },
  });
}
