import {
  details,
  emptyState,
  entityCardRail,
  entityVisualCard,
  escapeHtml,
  shortDateTime,
  v2ListEntries,
  v2ListEntry,
  v2Section,
} from '../../ui/ui.js';
import { collectPersonLoyaltyCards } from '../loyalty/index.js';
import { canUseCapability } from '../access.js';
import {
  calculateInvestmentState,
  calculateLoanState,
  cashEntityCardAppearance,
  cashEntityCardFields,
  cashEntityCardPhoto,
  getFinanceEntityMovements,
  getInvestmentEntities,
  getLoanEntities,
  investmentRoleLabel,
  normalizeInvestmentTerms,
} from '../finance/index.js';

const text = (value) => String(value ?? '').trim();
const money = (value) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0)).replaceAll('\u00a0', ' ')} ₽`;

// Keep all summary panels on the same shared vertical rhythm as titled sections.
function detailsSection(rows) {
  return `<section class="v2-section">${details(rows)}</section>`;
}

function historyList(items = [], emptyText = 'Истории пока нет') {
  if (!items.length) return emptyState(emptyText, 'Движения появятся после использования.');
  return v2ListEntries(items.map((item) => v2ListEntry({
    title: item.title || 'Операция',
    subtitle: item.subtitle || shortDateTime(item.occurredAt, '—'),
    rightTop: item.rightTop || '',
    rightBottom: item.rightBottom || '',
    interactive: false,
    initial: '',
  })));
}

function financeCard(entity, kind) {
  const movements = getFinanceEntityMovements(kind, entity.id);
  if (kind === 'loan') {
    const state = calculateLoanState(entity, movements);
    return entityVisualCard({
      appearance: cashEntityCardAppearance(entity, kind),
      fields: cashEntityCardFields(entity, state.totalDue, kind, state.endDate),
      image: cashEntityCardPhoto(entity, kind),
      interactive: true,
      data: `data-person-finance="loan:${escapeHtml(entity.id)}"`,
      aria: `Открыть займ ${entity.name || ''}`,
    });
  }
  const state = calculateInvestmentState(entity, movements);
  const terms = normalizeInvestmentTerms(entity);
  const balance = state.role === 'raise' ? state.remainingObligation : state.result;
  return entityVisualCard({
    appearance: cashEntityCardAppearance(entity, kind),
    fields: cashEntityCardFields(entity, balance, kind, '', {
      roleLabel: investmentRoleLabel(terms.role),
      balanceLabel: state.role === 'raise' ? 'Обязательства' : 'Результат',
      balanceValue: balance,
    }),
    image: cashEntityCardPhoto(entity, kind),
    interactive: true,
    data: `data-person-finance="investment:${escapeHtml(entity.id)}"`,
    aria: `Открыть инвестицию ${entity.name || ''}`,
  });
}

function financeDetail(entity, kind) {
  const movements = getFinanceEntityMovements(kind, entity.id);
  const state = kind === 'loan' ? calculateLoanState(entity, movements) : calculateInvestmentState(entity, movements);
  const rows = kind === 'loan'
    ? [
        { label: 'Займ', value: entity.name || '—' },
        { label: 'К возврату', value: money(state.totalDue) },
        { label: 'Срок', value: state.endDate || 'Бессрочно' },
      ]
    : [
        { label: 'Инвестиция', value: entity.name || '—' },
        { label: 'Роль', value: investmentRoleLabel(normalizeInvestmentTerms(entity).role) },
        { label: 'Результат', value: money(state.result) },
      ];
  const history = movements.slice().reverse().map((item) => ({
    title: item.articleName || item.operationKind || 'Финансовая операция',
    subtitle: shortDateTime(item.occurredAt, '—'),
    rightTop: money(item.amount || item.total),
  }));
  return `${detailsSection(rows)}${v2Section('История', historyList(history, 'Истории пока нет'))}`;
}

function personFinanceEntities(person = {}) {
  // The Z2 relationship card must obey exactly the same server-resolved
  // readiness/capabilities as Finance → Cash. Stored data are never deleted.
  const canSeeInvestments = canUseCapability('finance.investment.self.access')
    || canUseCapability('finance.investment.raise.access')
    || canUseCapability('finance.investment.external.access');
  const canSeeLoans = canUseCapability('finance.special.access');
  if (!canSeeInvestments && !canSeeLoans) return { investments: [], loans: [] };

  const personKey = text(person.key || person.id);
  const accountIds = new Set((Array.isArray(person.accounts) ? person.accounts : []).map(text).filter(Boolean));
  const investments = canSeeInvestments ? getInvestmentEntities().filter((entity) => {
    const terms = normalizeInvestmentTerms(entity);
    const role = text(terms.role || 'raise');
    const allowedRole = role === 'self'
      ? canUseCapability('finance.investment.self.access')
      : role === 'external'
        ? canUseCapability('finance.investment.external.access')
        : canUseCapability('finance.investment.raise.access');
    return allowedRole && (Boolean(terms.participantAccountId && accountIds.has(text(terms.participantAccountId)))
      || text(entity.personKey) === personKey);
  }) : [];
  const loans = canSeeLoans ? getLoanEntities().filter((entity) => text(entity.personKey) === personKey
    || (entity.loanTerms?.participantAccountId && accountIds.has(text(entity.loanTerms.participantAccountId)))) : [];
  return { investments, loans };
}

export async function buildPersonRelationshipSections(person = {}, { refresh = true } = {}) {
  const { cards: programEntries, refreshPromise } = await collectPersonLoyaltyCards(person, { refresh });
  const finance = personFinanceEntities(person);

  const programCards = programEntries.map(entry => entry.markup);

  const financeCards = [
    ...finance.investments.map((item) => financeCard(item, 'investment')),
    ...finance.loans.map((item) => financeCard(item, 'loan')),
  ];

  const detailByKey = new Map([
    ...programEntries.map(entry => [entry.key, entry.detail]),
    ...finance.investments.map(item => [`investment:${item.id}`, { title: item.name || 'Инвестиция', body: financeDetail(item, 'investment') }]),
    ...finance.loans.map(item => [`loan:${item.id}`, { title: item.name || 'Займ', body: financeDetail(item, 'loan') }]),
  ]);

  const sectionMarkup = `${programCards.length ? v2Section('Программы', entityCardRail(programCards)) : ''}${financeCards.length ? v2Section('Инвестиции / Займы', entityCardRail(financeCards)) : ''}`;
  const markup = `<div data-person-relationships>${sectionMarkup}</div>`;

  return {
    markup,
    bind(scope, onOpen = () => {}) {
      const relationshipRoot = scope?.querySelector?.('[data-person-relationships]') || scope;
      relationshipRoot?.querySelectorAll?.('[data-person-program]').forEach((node) => {
        node.addEventListener('click', () => {
          const detail = detailByKey.get(String(node.dataset.personProgram || ''));
          if (detail) onOpen(detail);
        });
      });
      relationshipRoot?.querySelectorAll?.('[data-person-finance]').forEach((node) => {
        node.addEventListener('click', () => {
          const detail = detailByKey.get(String(node.dataset.personFinance || ''));
          if (detail) onOpen(detail);
        });
      });
      if (refreshPromise) {
        void refreshPromise.then(async () => {
          if (!scope?.isConnected) return;
          const fresh = await buildPersonRelationshipSections(person, { refresh: false });
          const current = scope.querySelector?.('[data-person-relationships]');
          if (!current) return;
          const template = document.createElement('template');
          template.innerHTML = fresh.markup;
          const next = template.content.querySelector('[data-person-relationships]');
          current.innerHTML = next?.innerHTML || '';
          fresh.bind(current, onOpen);
        });
      }
    },
  };
}
