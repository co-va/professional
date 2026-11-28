import { dataTable, setSharedActionVisible } from '../../../ui/page/page.js';
import { DATA_EXCHANGE_ICON, TRASH_ICON, VIEW_ICON } from '../../../ui/buttons/index.js';
import { moveDesktopQTool } from '../../../ui/v2/z-layout.js';
import { isV2DesktopWorkspace } from '../../../ui/v2/geometry.js';
import { compactCheck } from '../../../ui/selection/check-list.js';
import {
  actionBlock,
  button,
  compactButton,
  datePicker,
  emptyState,
  entityCardStack,
  entityCardRail,
  entityVisualCard,
  escapeHtml,
  field,
  formValidationMessage,
  initDatePickers,
  modal,
  mountModal,
  mountV2ZLayer,
  openEntityCardAppearanceQ,
  openNotice,
  openSharedProfileSettingsMenu,
  page,
  select,
  setSharedProfilePrimary,
  setV2ZHeaderRows,
  shortDateTime,
  textareaField,
  twoColumnLayout,
  v2ListEntries,
  v2ListEntry,
  v2Section,
  v2ZLayer,
  workspaceHeaderContext,
} from '../../../ui/ui.js';
import { getFinanceOperation, getWallets, refreshFinanceState } from '../../finance/index.js';
import { financeDesktop, financeQSubmit } from '../../finance/desktop.js';
import { readOnlyReceipt } from '../../../ui/receipt/index.js';
import { getProfile } from '../../profile/data.js';
import { getAllPeople } from '../../people/data.js';
import { personDisplay } from '../../people/presentation.js';
import { getCardAppearanceTemplate, saveCardAppearanceTemplate } from '../../card-appearance-templates.js';
import { flushBusinessPersistence, isBusinessServerReady } from '../../business-persistence.js';
import { createUEI, getUEI, listUEIs, normalizeUEI, releaseUEI, replaceUEI } from '../../uei.js';
import { crop, formObject, personOption as contactOption, openLoyaltySettingsMenu, renderDesktopProgramSection } from '../shared.js';
import { openDepositExcelQ } from './excel.js';
import {
  correctDepositFunding,
  deleteDepositFunding,
  deleteDeposit,
  fundDeposit,
  fundExistingDeposit,
  getDepositInstances,
  getDepositPrograms,
  listAllDeposits,
  listPersonDeposits,
  loadDepositPrograms,
  saveDepositPrograms,
  updateDepositSettings,
  withdrawDeposit,
} from './data.js';
import {
  depositCardAppearance,
  depositCardFields,
  depositCardPhoto,
  depositCardPhotoPosition,
  depositCardScope,
  depositCardStatusLabel,
  depositFundingProgress,
  depositFundingListStatus,
  depositSpentAmount,
} from './card-presentation.js';

const PROGRAM_UEI_TYPE = 'loyalty-deposit-program';
const ASSIGNED_DEPOSIT_UEI_TYPE = 'loyalty-deposit';

const money = (value) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0)).replaceAll('\u00a0', ' ')} ₽`;
const uid = () => globalThis.crypto?.randomUUID?.() || `deposit-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function notifyContext() {
  window.dispatchEvent(new CustomEvent('va-tools:v2-context-changed'));
}

function depositHeaderContext({ title = 'Депозит', settingsData = '', settingsAria = 'Настройки депозита', c = null } = {}) {
  const profile = getProfile();
  const profileName = [profile?.name, profile?.surname].filter(Boolean).join(' ').trim() || 'Профиль';
  return workspaceHeaderContext({
    title,
    a: {
      kind: 'avatar',
      image: String(profile?.photo || ''),
      imagePosition: `${crop(profile?.photoCropX)}% ${crop(profile?.photoCropY)}%`,
      initials: profileName.slice(0, 1).toUpperCase() || '?',
    },
    v: settingsData ? {
      data: settingsData,
      aria: settingsAria,
    } : null,
    c,
  });
}

function depositStatusLabel(status = '') {
  if (status === 'expired') return 'Списан';
  if (status === 'closed') return 'Закрыт';
  return 'Активен';
}

function contactLabel(person = {}) {
  const display = personDisplay(person);
  return display.name || 'Без имени';
}

function programUei(program = {}) {
  return getUEI(PROGRAM_UEI_TYPE, program.id) || '';
}

function depositPerson(deposit = {}) {
  const key = String(deposit?.person?.key || deposit?.person?.personKey || deposit?.person?.id || '');
  return getAllPeople().find((item) => String(item?.key || item?.id || '') === key) || deposit?.person || {};
}

function depositUei(deposit = {}) {
  const program = getDepositPrograms().find((item) => String(item?.id || '') === String(deposit?.programId || '')) || {};
  const programCode = programUei(program) || '0000';
  const personCode = personDisplay(depositPerson(deposit)).uei || '0000';
  const sequence = String(Math.max(0, Math.trunc(Number(deposit?.cardSequence || 0)))).padStart(4, '0').slice(-4);
  return `${programCode} ${personCode} ${sequence}`;
}

function normalizeRequiredUei(value) {
  const normalized = normalizeUEI(value);
  if (!normalized || normalized === '0000') throw new Error('Укажите код');
  return normalized;
}

function ensureUeiAvailable(value, current = '') {
  const normalized = normalizeRequiredUei(value);
  if (normalized === current) return normalized;
  if (listUEIs().some((item) => String(item?.uei || '') === normalized)) throw new Error('Этот код уже используется');
  return normalized;
}

function bindUeiInput(root, name = 'uei') {
  const input = root?.querySelector?.(`[name="${CSS.escape(name)}"]`);
  input?.addEventListener('input', () => {
    input.value = Array.from(String(input.value || ''))
      .filter((char) => /[A-Za-zА-Яа-яЁё0-9]/.test(char))
      .slice(0, 4)
      .join('')
      .toUpperCase();
  });
}

function ueiField({ name = 'uei', value = '', readonly = false, required = true } = {}) {
  return field({
    label: 'Код',
    name,
    value,
    maxlength: 4,
    autocomplete: 'off',
    required: required && !readonly,
    readonly,
    data: 'data-deposit-uei-field',
  });
}

function programFields(program = {}, { editorPreview = false } = {}) {
  const amount = Number(program?.amount || 0);
  const fields = depositCardFields({
    uei: programUei(program),
    title: program?.name || 'Депозит',
    subtitle: program?.termRule || 'Бессрочно',
    status: depositCardStatusLabel(program?.status),
    benefit: program?.benefit || 'Без дополнительной выгоды',
    nominal: amount > 0 ? amount : 'Свободная сумма',
    // A catalog program has no Person transactions. The editor shows only
    // clearly marked positions, never fictitious amounts on actual cards.
    ...(editorPreview ? {
      funded: 'Пример: внесено',
      spent: 'Пример: списано',
      balance: 'Пример: остаток',
      toFund: 'Пример: к внесению',
    } : {}),
  });
  fields.push({ value: 'personName', label: 'Имя клиента', text: editorPreview ? 'Пример: имя клиента' : '' });
  return fields;
}

function card(fields, { data = '', aria = '', interactive = true, program = {} } = {}) {
  return entityVisualCard({
    appearance: depositCardAppearance(program),
    fields,
    image: depositCardPhoto(program),
    imagePosition: depositCardPhotoPosition(program),
    interactive,
    data,
    aria,
  });
}

function historyKindLabel(kind) {
  if (kind === 'deposit-funding') return 'Внесение';
  if (kind === 'deposit-benefit') return 'Выгода';
  if (kind === 'deposit-benefit-reversal') return 'Отмена выгоды';
  if (kind === 'deposit-withdrawal') return 'Возврат';
  if (kind === 'refund') return 'Возврат';
  if (kind === 'payment') return 'Списание';
  if (kind === 'deposit-import-spend') return 'Списание';
  return 'Операция';
}

function depositHistoryWithBalance(deposit = {}) {
  const source = Array.isArray(deposit?.history) ? deposit.history : [];
  const chronological = source
    .map((item, index) => ({ item, index }))
    .sort((left, right) => String(left.item?.occurredAt || '').localeCompare(String(right.item?.occurredAt || '')) || left.index - right.index);
  let balance = 0;
  return chronological.map(({ item }) => {
    const amount = Math.max(0, Number(item?.amount || 0));
    const direction = String(item?.direction || '').toUpperCase();
    // Core is the sole owner of the historical running balance. Never
    // recompute accrued benefits or imported spending a second time in UI.
    if (item?.balanceAfter != null && Number.isFinite(Number(item.balanceAfter))) {
      balance = Number(item.balanceAfter);
    } else if (item?.kind === 'deposit-withdrawal') balance = 0;
    else balance = Math.max(0, balance + (direction === 'IN' ? amount : -amount));
    return { ...item, balanceAfter: balance };
  });
}

function depositHistoryNewest(deposit = {}) {
  return depositHistoryWithBalance(deposit).slice().reverse();
}

function historyListMarkup(deposit = {}, items = depositHistoryNewest(deposit)) {
  if (!items.length) return emptyState('Истории пока нет', 'Движения депозита появятся здесь.');
  return v2ListEntries(items.map((item, index) => v2ListEntry({
    title: historyKindLabel(item?.kind),
    subtitle: shortDateTime(item?.occurredAt, '—'),
    rightBottom: item?.origin === 'excel_import' ? 'Excel' : '',
    rightTop: `${String(item?.direction || '').toUpperCase() === 'IN' ? '+' : '−'}${money(item?.amount)}`,
    initial: '',
    interactive: true,
    data: `data-deposit-history-entry="${index}"`,
    aria: `Открыть ${historyKindLabel(item?.kind).toLowerCase()}`,
  })));
}

function historyOperationId(item = {}) {
  return String(item?.operationId || '').replace(/:benefit$/, '');
}

async function resolveHistoryOperation(item = {}) {
  const id = historyOperationId(item);
  if (!id) return null;
  let operation = getFinanceOperation(id);
  if (operation) return operation;
  try {
    await refreshFinanceState();
  } catch {}
  operation = getFinanceOperation(id);
  return operation;
}

function settlementRows(operation = null) {
  const settlement = operation?.data?.settlement && typeof operation.data.settlement === 'object'
    ? operation.data.settlement
    : null;
  const items = Array.isArray(settlement?.items) ? settlement.items : [];
  return items.map((item) => ({
    label: String(item?.name || (String(item?.sourceType || '') === 'product' ? 'Товар' : 'Услуга')),
    value: money(item?.planAmount ?? item?.correctedPrice ?? item?.price),
  }));
}

function historyEventMarkup(item = {}, operation = null) {
  const incoming = String(item?.direction || '').toUpperCase() === 'IN';
  const rows = [
    { label: 'Дата', value: shortDateTime(item?.occurredAt, '—') },
  ];
  if (item?.kind === 'payment') {
    rows.push(...settlementRows(operation));
    if(Number(item.grossAmount)>0&&Number(item.benefitGranted)>0)rows.push({label:'Сумма до выгоды',value:'−'+money(item.grossAmount)},{label:'Выгода по депозиту',value:'+'+money(item.benefitGranted)});
    rows.push({ label: 'Итого', value: `−${money(item?.amount)}` });
  } else {
    if(item?.kind==='refund'&&Number(item.grossAmount)>0&&Number(item.benefitReversed)>0)rows.push({label:'Стоимость возврата',value:'+'+money(item.grossAmount)},{label:'Аннулирование выгоды',value:'−'+money(item.benefitReversed)});
    if(item?.kind==='deposit-withdrawal'&&Number(operation?.data?.conditionalBenefitWrittenOff)>0)rows.push({label:'Доступный остаток',value:money(operation.data.balanceBefore)},{label:'Аннулирование выгоды по депозиту',value:'−'+money(operation.data.conditionalBenefitWrittenOff)},{label:'Основание',value:'Досрочное расторжение депозитного договора'});
    rows.push({ label: 'Сумма', value: `${incoming ? '+' : '−'}${money(item?.amount)}` });
    const walletName = String(item?.walletName || operation?.data?.walletName || '').trim();
    if (walletName) rows.push({ label: 'Кошелёк', value: walletName });
  }
  if (item?.origin === 'excel_import') {
    rows.push({ label: 'Источник', value: 'Импорт Excel' });
  } else {
    rows.push({ label: 'Источник', value: 'Приложение' });
  }
  if (item?.kind === 'deposit-funding' && item?.walletResolution === 'unknown') {
    rows.push({ label: 'Кошелёк', value: 'Не определён' });
  }
  // Reconciliation metadata belongs to the technical layer, not user receipts.
  rows.push({ label: 'Остаток', value: money(item?.balanceAfter) });
  if (item?.dueToFund != null) rows.push({ label: 'К оплате', value: money(item?.dueToFund) });
  rows.push({ label: 'Дата формирования', value: shortDateTime(item?.recordedAt || operation?.recordedAt || item?.occurredAt, '—') });
  return readOnlyReceipt({ groups: [rows] });
}

function openDepositSummaryS(root, deposit) {
  const progress = depositFundingProgress(deposit);
  const first = fundingEntries(deposit).slice().reverse()[0];
  const rows = [
    { label: 'Код карты', value: depositUei(deposit) },
    { label: 'Клиент', value: contactLabel(depositPerson(deposit)) },
    { label: 'Дата оформления', value: shortDateTime(deposit.fundedAt, '—') },
    { label: 'Дата формирования', value: shortDateTime(first?.recordedAt, '—') },
    { label: 'Кто оформил', value: 'Не зафиксировано' },
    { label: 'Источник', value: first?.origin === 'excel_import' ? 'Импорт Excel' : first ? 'Приложение' : '—' },
  ];
  const totals = [
    ...(progress.fixed ? [{ label: 'Номинал', value: money(progress.nominal) }] : []),
    { label: 'Внесено', value: money(progress.funded) },
    ...(progress.fixed ? [{ label: 'К оплате', value: money(progress.due) }] : []),
    { label: 'Остаток депозита', value: money(deposit.balance), strong: true },
  ];
  return mountModal(root, modal(readOnlyReceipt({ groups: [rows, totals] }), {
    variant: 's', surface: 'app', title: 'Оформление депозита',
  }));
}

async function openDepositHistoryEvent(root, item, { deposit = null, onSaved = () => {} } = {}) {
  const operation = await resolveHistoryOperation(item);
  const funding = deposit && item?.kind === 'deposit-funding' && String(item?.operationId || '');
  const allowDelete = funding && fundingEntries(deposit).length > 1;
  const desktop = financeDesktop(root);
  const correction = funding ? button('Корректировать', { variant: desktop ? 'primary' : 'secondary', data: 'data-deposit-history-correct' }) : '';
  const remove = allowDelete ? button(desktop ? 'Удалить' : 'Удалить платёж', { variant: 'danger', data: 'data-deposit-history-delete' }) : '';
  const actions = !funding ? '' : desktop
    ? '<div class="modal-actions finance-receipt-actions finance-receipt-actions--dds">' + remove + correction + '</div>'
    : actionBlock(correction + remove);
  const layer = mountModal(root, modal(historyEventMarkup(item, operation) + actions, {
    variant: funding ? 'x' : 's',
    surface: 'app',
    title: historyKindLabel(item?.kind),
  }));
  if (!layer || !funding) return layer;
  layer.querySelector('[data-deposit-history-correct]')?.addEventListener('click', () => {
    layer.v2Close?.();
    void openPaymentsQ(root, deposit, { operationId: item.operationId, onSaved });
  });
  layer.querySelector('[data-deposit-history-delete]')?.addEventListener('click', () => {
    layer.v2Close?.();
    const confirmation = mountModal(root, modal(`<div class="modal-title"><h2>Удалить платёж?</h2><p>${escapeHtml(money(item.amount))} · ${escapeHtml(shortDateTime(item.occurredAt, '—'))}</p></div>
      <div class="modal-actions">
        ${button('Удалить', { variant: 'danger', data: 'data-confirm-funding-delete' })}
        ${button('Отмена', { variant: 'secondary', data: 'data-cancel-funding-delete' })}
      </div>`, { title: 'Удалить платёж', variant: 'x', surface: 'app' }));
    confirmation?.querySelector('[data-cancel-funding-delete]')?.addEventListener('click', () => confirmation.v2Close?.());
    confirmation?.querySelector('[data-confirm-funding-delete]')?.addEventListener('click', async event => {
      const control = event.currentTarget;
      control.disabled = true;
      try {
        await deleteDepositFunding({ depositId: deposit.depositId, operationId: item.operationId });
      } catch (error) {
        openNotice({ title: 'Удалить платёж', message: error instanceof Error ? error.message : 'Не удалось удалить платёж.' });
        if (control.isConnected) control.disabled = false;
        return;
      }
      confirmation.v2Close?.();
      try { await onSaved(); } catch {
        openNotice({ title: 'Платёж удалён', message: 'Не удалось обновить данные. Откройте депозит заново.' });
      }
    });
  });
  return layer;
}

function bindDepositHistory(root, items, options = {}) {
  root.querySelectorAll('[data-deposit-history-entry]').forEach((node) => {
    node.addEventListener('click', () => {
      const item = items[Number(node.dataset.depositHistoryEntry)];
      if (item) void openDepositHistoryEvent(root, item, options);
    });
  });
}

function fundingEntries(deposit = {}) {
  return (Array.isArray(deposit?.history) ? deposit.history : [])
    .filter((item) => item?.kind === 'deposit-funding' && String(item?.operationId || ''))
    .sort((a, b) => String(b?.occurredAt || '').localeCompare(String(a?.occurredAt || '')));
}

function effectiveDepositVisibility(deposit, program) {
  return typeof deposit.visibleToPersonOverride === 'boolean'
    ? deposit.visibleToPersonOverride
    : program?.showToAll !== false;
}

function issuedList(items = [], desktop = false, program = {}) {
  if (!items.length) return emptyState('Депозитов пока нет', 'Оформленные депозиты этой программы появятся здесь.');
  if (desktop) return dataTable({
    compact: true, caption: 'Оформленные депозиты',
    columns: [
      { key: 'code', label: 'Код', sortable: false },
      { key: 'name', label: 'Клиент', sortable: false, render: row => `<button type="button" data-deposit-instance="${escapeHtml(row.id)}">${escapeHtml(row.name)}</button>` },
      { key: 'nominal', label: 'Номинал', sortable: false }, { key: 'funded', label: 'Внесено', sortable: false },
      { key: 'balance', label: 'Остаток', sortable: false }, { key: 'status', label: 'Состояние', sortable: false, render: row => `<div class="deposit-list-status"><span>${escapeHtml(row.status)}</span>${row.statusAmount != null ? `<span class="deposit-list-status__amount">${escapeHtml(money(row.statusAmount))}</span>` : ''}</div>` },
      { key: 'visible', label: 'Показать', sortable: false, narrow: true, render: row => compactCheck({
        checked: row.visible, data: `data-deposit-row-visible="${escapeHtml(row.id)}"`, aria: `Показать карту клиенту ${row.name}`,
      }) },
    ],
    rows: items.map(deposit => {
      const payment = depositFundingProgress(deposit);
      const fundingState = depositFundingListStatus(deposit);
      return { id: deposit.depositId, code: depositUei(deposit), name: contactLabel(depositPerson(deposit)), visible: effectiveDepositVisibility(deposit, program),
        nominal: payment.fixed ? money(payment.nominal) : 'Свободная сумма', funded: money(payment.funded), balance: money(deposit.balance),
        status: fundingState?.label ?? depositStatusLabel(deposit.status), statusAmount: fundingState?.amount ?? null };
    }),
  });
  return v2ListEntries(items.map((deposit) => v2ListEntry({
    title: contactLabel(depositPerson(deposit)),
    subtitle: depositUei(deposit),
    rightTop: money(deposit?.balance),
    rightBottom: deposit?.status === 'active' && depositFundingProgress(deposit).fixed
      ? (depositFundingProgress(deposit).paid ? 'Оплачено' : 'К оплате ' + money(depositFundingProgress(deposit).due))
      : depositStatusLabel(deposit?.status),
    interactive: true,
    initial: '',
    data: `data-deposit-instance="${escapeHtml(deposit.depositId)}"`,
    aria: `Открыть депозит ${contactLabel(depositPerson(deposit))}`,
  })));
}

async function setProgramVisibility(programId, showToAll) {
  const now = new Date().toISOString();
  const next = getDepositPrograms().map((item) => String(item?.id) === String(programId)
    ? { ...item, showToAll: Boolean(showToAll), updatedAt: now }
    : item);
  await saveDepositPrograms(next);
}

async function deleteProgram(programId) {
  const id = String(programId || '');
  await saveDepositPrograms(getDepositPrograms().filter((item) => String(item?.id) !== id));
  releaseUEI({ entityType: PROGRAM_UEI_TYPE, entityId: id });
}

function openProgramCodeX(program, onSaved = () => {}, { desktop = false } = {}) {
  const current = programUei(program);
  const layer = mountModal(document.body, modal(`<form class="form-grid" data-deposit-code-form>
    ${ueiField({ value: current, required: true })}
    ${button('Сохранить', { type: 'submit' })}
    <div class="form-error" data-deposit-code-error></div>
  </form>`, { title: desktop ? 'Код программы' : 'UEI программы', variant: 'x', surface: 'app', className: desktop ? 'deposit-program-code-x' : '' }));
  if (!layer) return null;
  bindUeiInput(layer);
  const form = layer.querySelector('[data-deposit-code-form]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorNode = layer.querySelector('[data-deposit-code-error]');
    try {
      const value = ensureUeiAvailable(new FormData(form).get('uei'), current);
      replaceUEI({ entityType: PROGRAM_UEI_TYPE, entityId: program.id, value });
      layer.v2Close?.();
      await onSaved?.();
    } catch (error) {
      if (errorNode) errorNode.textContent = error instanceof Error ? error.message : 'Не удалось сохранить UEI';
    }
  });
  return layer;
}

export function programAppearanceOptions(onSaved = () => {}) {
  const programs = () => getDepositPrograms().filter(item => !item?.archivedAt);
  const targets = () => programs().length
    ? programs().map(item => ({ value: String(item.id), label: item.name || 'Депозит' }))
    : [{ value: 'all', label: 'Общий вид' }];
  const sample = target => programs().find(item => String(item.id) === target) || {};
  return {
    title: 'Вид',
    typeLabel: 'Тип программы',
    typeOptions: [{ value: depositCardScope(), label: 'Депозит' }],
    initialType: depositCardScope(),
    showTypeSelector: true,
    targetLabel: 'Название программы',
    showTargetSelector: true,
    targetOptions: targets,
    defaultTarget: () => targets()[0]?.value,
    allowPhoto: true,
    resolve: (_type, target) => {
      const program = sample(target);
      const assigned = getDepositInstances().find(item => String(item?.programId) === String(program.id));
      return {
        appearance: depositCardAppearance(program),
        fields: assigned ? assignedDepositFields(assigned) : programFields(program, { editorPreview: true }),
        photo: depositCardPhoto(program),
        photoPosition: depositCardPhotoPosition(program),
      };
    },
    save: async ({ target, appearance, photo, editor }) => {
      if (!isBusinessServerReady()) throw new Error('Серверное сохранение недоступно');
      if (target === 'all') {
        saveCardAppearanceTemplate(depositCardScope(), { appearance, photo, photoPosition: editor?.photoPosition || depositCardPhotoPosition() });
        await flushBusinessPersistence();
        return;
      }
      // Appearance belongs to the program. Reload authoritative values first;
      // never change other programs or the immutable issued deposit terms.
      const values = await loadDepositPrograms();
      if (!values.some(item => String(item.id) === target && !item.archivedAt)) throw new Error('Программа недоступна');
      await saveDepositPrograms(values.map(item => String(item.id) === target
        ? { ...item, cardAppearance: appearance, photo, photoPosition: editor?.photoPosition || depositCardPhotoPosition(item) }
        : item));
    },
    onSaved,
  };
}

function openAppearanceQ(root, onSaved = () => {}) {
  return openEntityCardAppearanceQ(root, programAppearanceOptions(onSaved));
}

function initDepositProgramConstructor(layer) {
  const form = layer?.querySelector?.('[data-deposit-program-form]');
  if (!form) return;
  initDatePickers(form);
  const amountMode = form.querySelector('[name="amountMode"]');
  const termMode = form.querySelector('[name="termMode"]');
  const benefitType = form.querySelector('[name="benefitType"]');
  const sync = () => {
    const amountPanel = form.querySelector('[data-deposit-amount-fixed]');
    const termPanel = form.querySelector('[data-deposit-term-dates]');
    const benefitPanel = form.querySelector('[data-deposit-benefit-value]');
    if (amountPanel) amountPanel.hidden = amountMode?.value !== 'fixed';
    if (termPanel) termPanel.hidden = termMode?.value !== 'dated';
    if (benefitPanel) benefitPanel.hidden = benefitType?.value === 'none';
  };
  amountMode?.addEventListener('change', sync);
  termMode?.addEventListener('change', sync);
  benefitType?.addEventListener('change', sync);
  sync();
}

function depositBenefit(values = {}) {
  const type = String(values.benefitType || 'none');
  const value = Math.max(0, Number(String(values.benefitValue || '0').replace(',', '.')) || 0);
  if (type === 'discount') return value > 0 ? `На обслуживание ${value}%` : '';
  if (type === 'accrual') return value > 0 ? `Сразу +${value}%` : '';
  return '';
}

export async function openCreateProgramQ(root, onSaved = () => {}, sourceProgram = null) {
  const copying = Boolean(sourceProgram?.id);
  const title = copying ? 'Создать копию' : 'Новая депозитная программа';
  const layer = mountModal(root, modal(`${depositHeaderContext({ title })}
    <form class="form-grid" data-deposit-program-form>
      ${field({ label: 'Название', name: 'name', value: sourceProgram?.name || '', required: true })}
      ${ueiField({ name: 'programUei', value: '', required: true })}
      ${select({ label: 'Сумма', name: 'amountMode', value: sourceProgram?.amountMode || (Number(sourceProgram?.amount || 0) > 0 ? 'fixed' : 'free'), options: [
        { value: 'fixed', label: 'Фиксированная сумма' },
        { value: 'free', label: 'Свободная сумма' },
      ] })}
      <div data-deposit-amount-fixed>${field({ label: 'Сумма программы', name: 'amount', type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal', value: sourceProgram?.amount || '' })}</div>
      ${select({ label: 'Срок', name: 'termMode', value: sourceProgram?.termMode || 'indefinite', options: [
        { value: 'indefinite', label: 'Бессрочно' },
        { value: 'dated', label: 'Период' },
      ] })}
      <div data-deposit-term-dates hidden>${twoColumnLayout(
        datePicker({ label: 'С', name: 'termStartDate', value: sourceProgram?.termStartDate || '', showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false }),
        datePicker({ label: 'До', name: 'termEndDate', value: sourceProgram?.termEndDate || '', showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false }),
        { ariaLabel: 'Период депозитной программы' },
      )}</div>
      ${select({ label: 'Выгода', name: 'benefitType', value: sourceProgram?.benefitType || 'none', options: [
        { value: 'none', label: 'Без дополнительной выгоды' },
        { value: 'discount', label: 'Выгода на обслуживание' },
        { value: 'accrual', label: 'Выгода сразу' },
      ] })}
      <div data-deposit-benefit-value hidden>${field({ label: 'Размер, %', name: 'benefitValue', type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal', value: sourceProgram?.benefitValue || '' })}</div>
      ${textareaField({ label: 'Условия', name: 'description', value: sourceProgram?.description || '' })}
      <div class="form-error" data-deposit-program-error></div>
      ${actionBlock(button('Сохранить', { type: 'button', data: 'data-deposit-program-save', aria: 'Сохранить депозитную программу' }))}
    </form>`, { variant: 'q', surface: 'app', title }));
  if (!layer) return null;
  bindUeiInput(layer, 'programUei');
  initDepositProgramConstructor(layer);
  const form = layer.querySelector('[data-deposit-program-form]');
  const primary = layer.querySelector('[data-deposit-program-save]');
  const actions = primary?.closest('.modal-actions');
  const desktop = moveDesktopQTool(primary);
  const signature = () => JSON.stringify(formObject(form));
  const baseline = signature();
  let saving = false;
  const syncDirty = () => {
    const changed = signature() !== baseline;
    if (desktop) {
      setSharedActionVisible(actions, changed);
      setSharedProfilePrimary(primary, { visible: changed, label: 'Сохранить', disabled: saving });
    } else if (primary) primary.disabled = saving;
    return changed;
  };
  if (desktop) {
    form.addEventListener('input', syncDirty);
    form.addEventListener('change', syncDirty);
  }
  primary?.addEventListener('click', async () => {
    if (saving || (desktop && !syncDirty())) return;
    const errorNode = layer.querySelector('[data-deposit-program-error]');
    const validationError = formValidationMessage(form);
    if (validationError) {
      if (errorNode) errorNode.textContent = validationError;
      return;
    }
    const values = formObject(form);
    const amountMode = values.amountMode || 'fixed';
    const amount = amountMode === 'free' ? 0 : Math.max(0, Number(String(values.amount || '0').replace(',', '.')) || 0);
    if (amountMode === 'fixed' && amount <= 0) {
      if (errorNode) errorNode.textContent = 'Укажите сумму программы';
      return;
    }
    const termMode = values.termMode || 'indefinite';
    const termStartDate = values.termStartDate || '';
    const termEndDate = values.termEndDate || '';
    if (termMode === 'dated' && (!termStartDate || !termEndDate)) {
      if (errorNode) errorNode.textContent = 'Укажите начало и конец периода';
      return;
    }
    if (termMode === 'dated' && termStartDate > termEndDate) {
      if (errorNode) errorNode.textContent = 'Дата начала не может быть позже даты окончания';
      return;
    }
    if (copying) {
      const sameName = String(values.name || '').trim() === String(sourceProgram?.name || '').trim();
      const samePeriod = termMode === String(sourceProgram?.termMode || 'indefinite')
        && termStartDate === String(sourceProgram?.termStartDate || '')
        && termEndDate === String(sourceProgram?.termEndDate || '');
      if (sameName && samePeriod) {
        if (errorNode) errorNode.textContent = 'Измените название или период новой программы';
        return;
      }
    }
    const benefit = depositBenefit(values);
    if (values.benefitType !== 'none' && !benefit) {
      if (errorNode) errorNode.textContent = 'Укажите размер выгоды';
      return;
    }
    const id = uid();
    saving = true;
    syncDirty();
    try {
      const code = ensureUeiAvailable(values.programUei);
      const now = new Date().toISOString();
      const program = {
        ...(sourceProgram || {}),
        id,
        name: values.name,
        amount,
        amountMode,
        termMode,
        termStartDate,
        termEndDate,
        termRule: termMode === 'dated' ? `${termStartDate} — ${termEndDate}` : 'Бессрочно',
        benefitType: values.benefitType || 'none',
        benefitValue: Math.max(0, Number(String(values.benefitValue || '0').replace(',', '.')) || 0),
        benefit,
        description: values.description || '',
        showToAll: sourceProgram?.showToAll !== false,
        status: 'active',
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await saveDepositPrograms([...getDepositPrograms(), program]);
      createUEI({ entityType: PROGRAM_UEI_TYPE, entityId: id, value: code });
      layer.v2Close?.();
      await onSaved?.();
    } catch (error) {
      if (errorNode) errorNode.textContent = error instanceof Error ? error.message : 'Не удалось сохранить программу';
    } finally {
      saving = false;
      if (layer.isConnected) syncDirty();
    }
  });
  syncDirty();
  notifyContext();
  return layer;
}

async function openFundQ(root, program, { person = null, onSaved = () => {} } = {}) {
  const wallets = getWallets();
  const people = getAllPeople();
  const fixedPersonKey = String(person?.key || person?.id || '');
  const selectedPerson = fixedPersonKey ? person : null;
  const contactField = selectedPerson
    ? field({ label: 'Контакт', name: 'personName', value: contactLabel(selectedPerson), disabled: true })
    : select({
        label: 'Контакт',
        name: 'personKey',
        value: '',
        options: [{ value: '', label: 'Выберите контакт' }, ...people.map(contactOption).filter((item) => item.value)],
      });
  const layer = mountModal(root, modal(`${depositHeaderContext({ title: 'Оформить депозит' })}
    <form class="form-grid" data-deposit-fund-form>
      ${contactField}
      ${field({ label: 'Сумма', name: 'amount', type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal', value: Number(program?.amount || 0) > 0 ? program.amount : '' })}
      ${field({ label: 'Срок', name: 'termPreview', value: program?.termRule || 'Бессрочно', disabled: true })}
      ${select({ label: 'Кошелёк приёма денег', name: 'walletId', value: '', options: [{ value: '', label: 'Выберите кошелёк' }, ...wallets.map((wallet) => ({ value: wallet.id, label: wallet.name }))] })}
      ${datePicker({ label: 'Дата внесения', name: 'occurredAt', value: new Date().toISOString().slice(0, 10), showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false })}
      <div class="form-error" data-deposit-fund-error></div>
      ${actionBlock(button('Оформить', { type: 'button', data: 'data-deposit-fund-save', aria: 'Оформить депозит' }))}
    </form>`, { variant: 'q', surface: 'app', title: 'Оформить депозит' }));
  if (!layer) return null;
  initDatePickers(layer);
  const form = layer.querySelector('[data-deposit-fund-form]');
  layer.querySelector('[data-deposit-fund-save]')?.addEventListener('click', async () => {
    const errorNode = layer.querySelector('[data-deposit-fund-error]');
    const validationError = formValidationMessage(form);
    if (validationError) {
      if (errorNode) errorNode.textContent = validationError;
      return;
    }
    const values = formObject(form);
    const owner = selectedPerson || people.find((item) => String(item?.key || item?.id || '') === String(values.personKey || ''));
    const wallet = wallets.find((item) => String(item?.id) === String(values.walletId));
    const amount = Math.max(0, Number(String(values.amount || '0').replace(',', '.')) || 0);
    if (!owner || !wallet || amount <= 0) {
      if (errorNode) errorNode.textContent = 'Укажите контакт, сумму и кошелёк';
      return;
    }
    try {
      const display = personDisplay(owner);
      const deposit = await fundDeposit({
        programId: program.id,
        person: { key: owner.key || owner.id || '', uei: display.uei || '', name: display.name || '' },
        amount,
        walletId: wallet.id,
        walletName: wallet.name,
        occurredAt: new Date(`${values.occurredAt}T12:00:00`),
      });
      if (!deposit?.depositId) throw new Error('Депозит не создан');
      layer.v2Close?.();
      const available = Number(deposit?.balance || 0);
      const benefit = Number(deposit?.benefitBalance || 0);
      const message = benefit > 0.009
        ? `Принято ${money(amount)}. Выгода ${money(benefit)}. Доступно ${money(available)}. UEI: ${depositUei(deposit)}`
        : `Принято ${money(amount)}. Доступно ${money(available || amount)}. UEI: ${depositUei(deposit)}`;
      openNotice({ title: 'Депозит оформлен', message });
      await onSaved?.(deposit);
    } catch (error) {
      if (errorNode) errorNode.textContent = error instanceof Error ? error.message : 'Не удалось оформить депозит';
    }
  });
  notifyContext();
  return layer;
}

function paymentForm(entry, wallets, { amount = '', max = null } = {}) {
  const operationId = String(entry?.operationId || '');
  const selectedWallet = String(entry?.walletId || '');
  const occurredAt = operationId ? String(entry?.occurredAt || '').slice(0, 10) : new Date().toISOString().slice(0, 10);
  return `<form class="form-grid" data-deposit-payment-form data-operation-id="${escapeHtml(operationId)}">
    ${field({ label: 'Сумма', name: 'amount', type: 'number', min: '0.01', max: max == null ? undefined : Math.round(max * 100) / 100, step: '0.01', inputmode: 'decimal', value: operationId ? entry.amount : amount })}
    ${select({ label: 'Кошелёк', name: 'walletId', value: selectedWallet, options: [{ value: '', label: 'Выберите кошелёк' }, ...wallets.map((wallet) => ({ value: wallet.id, label: wallet.name }))] })}
    ${datePicker({ label: 'Дата', name: 'occurredAt', value: occurredAt, showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false })}
    <div class="form-error" data-deposit-payment-error></div>
    ${actionBlock(button(operationId ? 'Сохранить' : 'Внести', { type: 'submit' }))}
  </form>`;
}

async function openPaymentsQ(root, deposit, { onSaved = () => {}, operationId: selectedOperationId = '' } = {}) {
  const layer = mountModal(root, modal('<div data-deposit-payment-host></div>', {
    variant: 'q',
    surface: 'app',
    title: selectedOperationId ? 'Коррекция платежа' : 'Платёж',
  }));
  if (!layer) return null;

  const render = (current) => {
    if (layer.isConnected === false) return;
    const host = layer.querySelector('[data-deposit-payment-host]');
    if (!host) return;
    const wallets = getWallets();
    const entries = fundingEntries(current).slice().reverse().filter(entry => !selectedOperationId || String(entry.operationId) === String(selectedOperationId));
    const progress = depositFundingProgress(current);
    const sections = entries.map((entry) => paymentForm(entry, wallets, {
      max: progress.fixed ? progress.due + Math.max(0, Number(entry.amount || 0)) : null,
    }));
    if (!selectedOperationId && (!progress.fixed || !progress.paid)) {
      sections.push(paymentForm(null, wallets, {
        amount: progress.fixed ? progress.due : '',
        max: progress.fixed ? progress.due : null,
      }));
    }

    // The nominal is an invoice: each funding operation reduces the amount due.
    // Do not substitute the Deposit's spendable balance for that amount.
    host.innerHTML = page([
      ...(progress.fixed ? [readOnlyReceipt({
        totals: [
          { label: 'Номинал', value: money(progress.nominal) },
          { label: 'Внесено', value: money(progress.funded) },
          { label: progress.paid ? 'Платёж' : 'К оплате',
            value: progress.paid ? 'Оплачено' : money(progress.due), strong: true },
        ],
      })] : []),
      ...sections,
    ]);
    initDatePickers(host);
    host.querySelectorAll('[data-deposit-payment-form]').forEach((form) => {
      const submit = form.querySelector('button[type="submit"]');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const values = formObject(form);
        const errorNode = form.querySelector('[data-deposit-payment-error]');
        const wallet = wallets.find((item) => String(item?.id) === String(values.walletId));
        const amount = Math.max(0, Number(String(values.amount || '0').replace(',', '.')) || 0);
        if (!wallet || amount <= 0) {
          if (errorNode) errorNode.textContent = 'Укажите сумму и кошелёк';
          return;
        }
        const operationId = String(form.dataset.operationId || '');
        const maximum = progress.fixed ? progress.due + (operationId
          ? Math.max(0, Number(entries.find((item) => String(item.operationId) === operationId)?.amount || 0))
          : 0) : null;
        if (maximum !== null && amount > maximum + 0.009) {
          if (errorNode) errorNode.textContent = 'Сумма превышает остаток по программе';
          return;
        }
        if (submit?.disabled) return;
        if (submit) submit.disabled = true;
        if (errorNode) errorNode.textContent = '';
        try {
          if (operationId) {
            await correctDepositFunding({
              depositId: current.depositId,
              operationId,
              amount,
              walletId: wallet.id,
              walletName: wallet.name,
              occurredAt: new Date(`${values.occurredAt}T12:00:00`),
            });
          } else {
            await fundExistingDeposit({
              depositId: current.depositId,
              amount,
              walletId: wallet.id,
              walletName: wallet.name,
              occurredAt: new Date(`${values.occurredAt}T12:00:00`),
            });
          }
        } catch (error) {
          if (errorNode) errorNode.textContent = error instanceof Error ? error.message : 'Не удалось сохранить платёж';
          if (submit) submit.disabled = false;
          return;
        }
        // Payment is already recorded at this point: never offer to submit it
        // again from an old form, even if the following read fails.
        try {
          const fresh = (await listAllDeposits()).find((item) =>
            String(item?.depositId || '') === String(current.depositId || ''));
          if (fresh) {
            const updated = depositFundingProgress(fresh);
            if (!selectedOperationId && updated.fixed && !updated.paid) render(fresh);
            else layer.v2Close?.();
          } else {
            layer.v2Close?.();
          }
          await onSaved?.();
        } catch (error) {
          if (errorNode?.isConnected) errorNode.textContent =
            'Платёж проведён, но обновить данные не удалось. Откройте депозит заново.';
          layer.v2Close?.();
        }
      });
      // Keep the original submit control and its in-flight lock in Q H.
      if (selectedOperationId) financeQSubmit(layer, form);
    });
  };

  render(deposit);
  return layer;
}

async function openWithdrawX(root, deposit, onSaved = () => {}) {
  const wallets = getWallets();
  const refundable = Math.max(0, Number(deposit?.refundableAmount ?? deposit?.principalBalance ?? 0));
  if (!deposit?.canRefund || refundable <= 0.009) {
    openNotice({ title: 'Возврат недоступен', message: deposit?.accountingComplete===false?'Денежная и бонусная части исторических операций не подтверждены. Возврат заблокирован до сверки.':'У этого депозита нет возвратного остатка.' });
    return null;
  }
  const layer = mountModal(root, modal(`<form class="form-grid" data-deposit-withdraw-form>
    ${Number(deposit?.conditionalWrittenOff)>0?readOnlyReceipt({groups:[[{label:'Доступный остаток',value:money(deposit.balance)},{label:'Аннулирование выгоды по депозиту',value:'−'+money(deposit.conditionalWrittenOff)}]]}):''}
    ${field({ label: 'К возврату', name: 'amount', type: 'number', min: '0.01', max: refundable, step: '0.01', inputmode: 'decimal', value: refundable, readonly: true })}
    ${select({ label: 'Кошелёк возврата', name: 'walletId', value: '', options: [{ value: '', label: 'Выберите кошелёк' }, ...wallets.map((wallet) => ({ value: wallet.id, label: wallet.name }))] })}
    ${datePicker({ label: 'Дата возврата', name: 'occurredAt', value: new Date().toISOString().slice(0, 10), showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false })}
    ${textareaField({ label: 'Комментарий', name: 'reason' })}
    ${button('Вернуть', { type: 'submit', variant: 'danger' })}
    <div class="form-error" data-deposit-withdraw-error></div>
  </form>`, { variant: 'x', surface: 'app', title: 'Возврат депозита' }));
  if (!layer) return null;
  initDatePickers(layer);
  const form = layer.querySelector('[data-deposit-withdraw-form]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formObject(form);
    const errorNode = layer.querySelector('[data-deposit-withdraw-error]');
    const wallet = wallets.find((item) => String(item?.id) === String(values.walletId));
    if (!wallet) {
      if (errorNode) errorNode.textContent = 'Выберите кошелёк';
      return;
    }
    try {
      await withdrawDeposit({
        depositId: deposit.depositId,
        amount: refundable,
        walletId: wallet.id,
        walletName: wallet.name,
        reason: values.reason || '',
        occurredAt: new Date(`${values.occurredAt}T12:00:00`),
      });
      layer.v2Close?.();
      await onSaved?.();
    } catch (error) {
      if (errorNode) errorNode.textContent = error instanceof Error ? error.message : 'Не удалось вернуть депозит';
    }
  });
  return layer;
}

function openRootSettings(root, rerender) {
  return openSharedProfileSettingsMenu({
    title: 'Депозит',
    actions: [
      { id: 'appearance', label: 'Вид', onSelect: () => openAppearanceQ(root, rerender) },
      { id: 'excel', label: 'Excel', onSelect: () => openDepositExcelQ(root, rerender) },
    ],
  });
}

function openDepositSettingsMenu(options = {}) {
  return openLoyaltySettingsMenu(options);
}

function programSettings(root, program, { person = null, rerender = async () => {}, onChanged = () => {}, desktop = false } = {}) {
  return {
    title: program.name || 'Депозит',
    checked: program?.showToAll !== false,
    onToggle: async (checked) => {
      await setProgramVisibility(program.id, checked);
      await rerender();
      await onChanged?.();
      return checked;
    },
    actions: [
      { id: 'code', label: `UEI · ${programUei(program) || 'не задан'}`, onSelect: () => openProgramCodeX(program, async () => {
        await rerender();
        await onChanged?.();
      }, { desktop }) },
      { id: 'copy', label: 'Создать копию', onSelect: () => openCreateProgramQ(root, async () => {
        await rerender();
        await onChanged?.();
      }, program) },
      {
        id: 'fund',
        label: 'Оформить',
        onSelect: () => openFundQ(root, program, {
          person,
          onSaved: async () => {
            await rerender();
            await onChanged?.();
          },
        }),
      },
      {
        id: 'delete', label: 'Удалить депозит', variant: 'danger', onSelect: async () => {
          await deleteProgram(program.id);
          await rerender();
          await onChanged?.();
        },
      },
    ],
  };
}

function openProgramSettings(root, program, options) {
  return openDepositSettingsMenu(programSettings(root, program, options));
}

function bindProgramVisibility(control, save, title) {
  control?.addEventListener('change', async () => {
    const requested = Boolean(control.checked);
    control.disabled = true;
    try {
      const resolved = await save(requested);
      if (control.isConnected && typeof resolved === 'boolean') control.checked = resolved;
    } catch (error) {
      if (control.isConnected) control.checked = !requested;
      openNotice({ title, message: error instanceof Error ? error.message : 'Не удалось сохранить видимость карты.' });
    } finally {
      if (control.isConnected) control.disabled = false;
    }
  });
}

function bindDesktopProgramTools(layer, program, settings) {
  const toolsMarkup = `<div class="v2-desktop-tool-row" data-deposit-program-toolbar>
    <div class="v2-desktop-tool-actions">
      ${button(escapeHtml(programUei(program) || 'Код'), { variant: 'secondary', data: 'data-deposit-program-action="code"', aria: 'Изменить код программы' })}
      ${button('Создать копию', { variant: 'secondary', data: 'data-deposit-program-action="copy"' })}
      ${button(TRASH_ICON, { variant: 'danger', className: 'v2-desktop-tool-icon', data: 'data-deposit-program-action="delete" title="Удалить программу"', aria: 'Удалить программу' })}
      ${button('+', { variant: 'secondary', className: 'v2-desktop-tool-primary', data: 'data-deposit-program-action="fund" title="Оформить карту"', aria: 'Оформить карту' })}
    </div>
  </div>`;
  const [tools] = setV2ZHeaderRows(layer, [toolsMarkup], { desktopTitle: settings.title });
  if (!tools) return;
  tools.querySelectorAll('[data-deposit-program-action]').forEach(control => {
    control.addEventListener('click', () => {
      const action = settings.actions.find(item => item.id === control.dataset.depositProgramAction);
      if (!action) return;
      if (action.id !== 'delete') {
        void action.onSelect();
        return;
      }
      const confirmation = mountModal(layer, modal(`<div class="modal-title"><h2>Удалить программу?</h2><p>${escapeHtml(settings.title)}. Будут удалены данные этой программы в соответствии с действующим механизмом удаления.</p></div>
        <div class="modal-actions">
          ${button('Удалить', { variant: 'danger', data: 'data-confirm-program-delete' })}
          ${button('Отмена', { variant: 'secondary', data: 'data-cancel-program-delete' })}
        </div>`, { title: 'Удалить программу', variant: 'x', surface: 'app' }));
      confirmation?.querySelector('[data-cancel-program-delete]')?.addEventListener('click', () => confirmation.v2Close?.());
      confirmation?.querySelector('[data-confirm-program-delete]')?.addEventListener('click', async event => {
        const confirm = event.currentTarget;
        confirm.disabled = true;
        try {
          await action.onSelect();
          confirmation.v2Close?.();
        } catch (error) {
          openNotice({ title: 'Удалить программу', message: error instanceof Error ? error.message : 'Не удалось удалить программу.' });
        } finally {
          if (confirm.isConnected) confirm.disabled = false;
        }
      });
    });
  });
}

function depositInstanceSettings(root, layer, deposit, effectiveVisible, render, onChanged) {
  return {
    title: deposit.programName || 'Депозит',
    checked: effectiveVisible,
    onToggle: async (checked) => {
      await updateDepositSettings(deposit.depositId, { visibleToPerson: checked });
      await render();
      await onChanged?.();
      return checked;
    },
    actions: [
      {
        id: 'payment',
        label: 'Платёж',
        onSelect: () => openPaymentsQ(root, deposit, { onSaved: async () => {
          await render();
          await onChanged?.();
        } }),
      },
      ...(deposit?.canRefund ? [{
        id: 'refund',
        label: 'Возврат',
        onSelect: () => openWithdrawX(root, deposit, async () => {
          await render();
          await onChanged?.();
        }),
      }] : []),
      {
        id: 'delete',
        label: 'Удалить карту',
        variant: 'danger',
        onSelect: async () => {
          await deleteDeposit(deposit.depositId);
          releaseUEI({ entityType: ASSIGNED_DEPOSIT_UEI_TYPE, entityId: deposit.depositId });
          layer.v2Close?.();
          await onChanged?.();
        },
      },
    ],
  };
}

function openDepositSettings(root, layer, deposit, effectiveVisible, render, onChanged) {
  const settings = depositInstanceSettings(root, layer, deposit, effectiveVisible, render, onChanged);
  return openDepositSettingsMenu(settings);
}

function bindDesktopDepositTools(layer, settings) {
  const header = layer.querySelector('[data-v2-q-header-content]');
  if (!header) return;
  header.innerHTML = `<div class="desktop-q-heading"><h2 class="v2-q-title">${escapeHtml(settings.title)}</h2></div>
    <div class="desktop-q-toolbar" data-v2-layer-gesture-ignore>
      ${compactCheck({ label: 'Показать', checked: settings.checked, data: 'data-deposit-desktop-visible', aria: 'Показать карту клиенту' })}
      <div class="desktop-q-tools">
        ${compactButton({ kind: 'payment', data: 'data-deposit-desktop-payment title="Платёж / Возврат"', aria: 'Платёж / Возврат' })}
      </div>
    </div>`;
  const visible = header.querySelector('[data-deposit-desktop-visible]');
  visible?.addEventListener('change', async () => {
    const requested = Boolean(visible.checked);
    visible.disabled = true;
    try {
      const resolved = await settings.onToggle(requested);
      if (typeof resolved === 'boolean' && visible.isConnected) visible.checked = resolved;
    } catch (error) {
      if (visible.isConnected) visible.checked = !requested;
      openNotice({ title: 'Настройки карты', message: error instanceof Error ? error.message : 'Не удалось сохранить видимость карты.' });
    } finally {
      if (visible.isConnected) visible.disabled = false;
    }
  });
  header.querySelector('[data-deposit-desktop-payment]')?.addEventListener('click', (event) => {
    const actions = settings.actions.filter(item => item.id === 'payment' || item.id === 'refund');
    const menu = mountModal(event.currentTarget, modal(`<div class="desktop-q-action-menu">${actions.map(item => button(escapeHtml(item.label), {
      variant: 'secondary', data: `data-deposit-desktop-operation="${escapeHtml(item.id)}"`,
    })).join('')}</div>`, {
      title: 'Платёж / Возврат', variant: 'x', surface: 'app', className: 'desktop-q-action-popup', xRole: 'action',
    }));
    if (!menu) return;
    menu.querySelectorAll('[data-deposit-desktop-operation]').forEach(control => {
      control.addEventListener('click', () => {
        const action = actions.find(item => item.id === control.dataset.depositDesktopOperation);
        if (!action) return;
        menu.v2Close?.();
        void action.onSelect();
      });
    });
  });
}

function bindDepositDelete(layer, host, settings) {
  host.querySelector('[data-deposit-instance-delete]')?.addEventListener('click', () => {
    const action = settings.actions.find(item => item.id === 'delete');
    if (!action) return;
    const confirmation = mountModal(layer, modal(`<div class="modal-title"><h2>Удалить карту?</h2><p>${escapeHtml(settings.title)}</p></div>
      <div class="modal-actions">
        ${button('Удалить карту', { variant: 'danger', data: 'data-confirm-deposit-delete' })}
        ${button('Отмена', { variant: 'secondary', data: 'data-cancel-deposit-delete' })}
      </div>`, { title: 'Удалить карту', variant: 'x', surface: 'app' }));
    if (!confirmation) return;
    confirmation.querySelector('[data-cancel-deposit-delete]')?.addEventListener('click', () => confirmation.v2Close?.());
    confirmation.querySelector('[data-confirm-deposit-delete]')?.addEventListener('click', async (event) => {
      const control = event.currentTarget;
      control.disabled = true;
      try {
        await action.onSelect();
        confirmation.v2Close?.();
      } catch (error) {
        openNotice({ title: 'Удалить карту', message: error instanceof Error ? error.message : 'Не удалось удалить карту.' });
      } finally {
        if (control.isConnected) control.disabled = false;
      }
    });
  });
}

async function openDepositQ(root, depositId, onChanged = () => {}) {
  const initialDeposits = await listAllDeposits();
  const initialDeposit = initialDeposits.find((item) => String(item?.depositId) === String(depositId));
  if (!initialDeposit) return null;

  const layer = mountModal(root, modal('<div data-deposit-instance-q-host></div>', {
    variant: 'q',
    surface: 'app',
    title: initialDeposit.programName || 'Депозит',
    className: 'loyalty-deposit-instance-q',
  }));
  if (!layer) return null;

  const render = async () => {
    const deposits = await listAllDeposits();
    const deposit = deposits.find((item) => String(item?.depositId) === String(depositId));
    if (!deposit) {
      layer.v2Close?.();
      return;
    }
    if (getUEI(ASSIGNED_DEPOSIT_UEI_TYPE, deposit.depositId)) {
      releaseUEI({ entityType: ASSIGNED_DEPOSIT_UEI_TYPE, entityId: deposit.depositId });
    }
    const program = getDepositPrograms().find((item) => String(item?.id) === String(deposit.programId)) || {};
    const effectiveVisible = effectiveDepositVisibility(deposit, program);
    const host = layer.querySelector('[data-deposit-instance-q-host]');
    if (!host) return;
    const desktop = isV2DesktopWorkspace(layer.closest('[data-v2-app]'));
    const header = layer.querySelector('[data-v2-q-header-content]');
    if (!desktop && header?.querySelector('.desktop-q-toolbar')) header.innerHTML = `<h2 class="v2-q-title">${escapeHtml(deposit.programName || 'Депозит')}</h2>`;
    const items = depositHistoryNewest(deposit);
    const settings = depositInstanceSettings(root, layer, deposit, effectiveVisible, render, onChanged);
    host.innerHTML = page([
      depositHeaderContext({
        title: deposit.programName || 'Депозит',
        settingsData: desktop ? '' : 'data-deposit-instance-settings',
        settingsAria: 'Настройки депозита',
      }),
      personDepositCard(deposit, { interactive: true, summary: true }),
      v2Section('История', historyListMarkup(deposit, items)),
      desktop ? actionBlock(button('Удалить карту', {
        variant: 'danger', data: 'data-deposit-instance-delete data-ui-keyboard-action="auxiliary"',
      })) : '',
    ]);
    if (desktop) bindDesktopDepositTools(layer, settings);
    else host.querySelector('[data-deposit-instance-settings]')?.addEventListener('click', () => {
      openDepositSettings(root, layer, deposit, effectiveVisible, render, onChanged);
    });
    bindDepositHistory(host, items, { deposit, onSaved: async () => {
      await render();
      await onChanged?.();
    } });
    host.querySelector('[data-deposit-summary]')?.addEventListener('click', () => openDepositSummaryS(layer, deposit));
    if (desktop) bindDepositDelete(layer, host, settings);
    notifyContext();
  };

  await render();
  return layer;
}

async function openProgramLayer(root, programId, { person = null, onChanged = () => {} } = {}) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'loyalty-deposit-program-z' }), { stack: true });
  if (!layer) return null;
  const render = async () => {
    await loadDepositPrograms();
    const program = getDepositPrograms().find((item) => String(item?.id) === String(programId));
    if (!program) {
      layer.v2Close?.();
      await onChanged?.();
      return;
    }
    const allDeposits = await listAllDeposits();
    const issued = allDeposits.filter((item) => String(item?.programId) === String(program.id));
    for (const deposit of issued) {
      if (getUEI(ASSIGNED_DEPOSIT_UEI_TYPE, deposit.depositId)) releaseUEI({ entityType: ASSIGNED_DEPOSIT_UEI_TYPE, entityId: deposit.depositId });
    }
    const desktop = isV2DesktopWorkspace(layer.closest('[data-v2-app]'));
    const visibility = new Map(issued.map(deposit => [String(deposit.depositId), effectiveDepositVisibility(deposit, program)]));
    layer.innerHTML = page([
      depositHeaderContext({
        title: program.name || 'Депозит',
        settingsData: desktop ? '' : 'data-deposit-program-settings',
        settingsAria: 'Настройки депозитной программы',
      }),
      v2Section('Оформленные депозиты', issuedList(issued, desktop, program), {
        accessory: desktop ? '<output data-deposit-count aria-live="polite"></output>' : '',
      }),
    ]);
    if (desktop) {
      const counter = layer.querySelector('[data-deposit-count]');
      const updateCount = () => {
        if (!counter?.isConnected) return;
        const total = issued.length;
        const shown = [...visibility.values()].filter(Boolean).length;
        counter.textContent = `${total} / ${shown}`;
        counter.setAttribute('aria-label', `Оформлено депозитов: ${total}. Показано клиентам: ${shown}`);
      };
      updateCount();
      bindDesktopProgramTools(layer, program, programSettings(layer, program, { person, rerender: render, onChanged, desktop: true }));
      layer.querySelectorAll('[data-deposit-row-visible]').forEach(control => {
        bindProgramVisibility(control, async checked => {
          const id = control.dataset.depositRowVisible;
          const saved = await updateDepositSettings(id, { visibleToPerson: checked });
          const resolved = saved ? effectiveDepositVisibility(saved, program) : checked;
          visibility.set(id, resolved);
          updateCount();
          return resolved;
        }, 'Настройки карты');
      });
    } else {
      setV2ZHeaderRows(layer, []);
      layer.querySelector('[data-deposit-program-settings]')?.addEventListener('click', () => openProgramSettings(root, program, {
        person,
        rerender: render,
        onChanged,
      }));
    }
    let openingDeposit = false;
    layer.querySelectorAll('[data-deposit-instance]').forEach((node) => {
      const open = async () => {
        if (openingDeposit) return;
        openingDeposit = true;
        try {
          const detail = await openDepositQ(layer, node.dataset.depositInstance, async () => {
            await render();
            await onChanged?.();
          });
          if (!detail) openNotice({ title: 'Депозит', message: 'Не удалось открыть оформленную карту.' });
        } catch (error) {
          openNotice({ title: 'Депозит', message: error instanceof Error ? error.message : 'Не удалось открыть оформленную карту.' });
        } finally {
          openingDeposit = false;
        }
      };
      if (desktop) {
        const row = node.closest('tr');
        if (row) {
          row.dataset.depositOpenRow = node.dataset.depositInstance;
          // The native client button remains keyboard-accessible. The whole
          // row delegates to the same Q, except the independent visibility cell.
          row.addEventListener('click', event => {
            if (event.target.closest('[data-table-column="visible"]')) return;
            void open();
          });
        } else node.addEventListener('click', open);
      } else node.addEventListener('click', open);
    });
    notifyContext();
  };
  await render();
  return layer;
}

function assignedDepositFields(deposit) {
  const terms = deposit?.terms && typeof deposit.terms === 'object' ? deposit.terms : {};
  const nominal = Number(terms.amount);
  const funded = Number(deposit?.fundedAmount);
  const hasNominal = terms.amount !== undefined && terms.amount !== null && nominal > 0;
  const fields = depositCardFields({
      uei: depositUei(deposit),
      title: String(deposit?.programName || 'Депозит'),
      subtitle: terms.termRule || 'Бессрочно',
      status: deposit?.status === 'active' && depositFundingProgress(deposit).fixed
        ? (depositFundingProgress(deposit).paid ? 'Оплачено' : 'К оплате ' + money(depositFundingProgress(deposit).due))
        : depositCardStatusLabel(deposit?.status),
      benefit: terms.benefit || 'Депозит',
      nominal: hasNominal ? nominal : null,
      funded: deposit?.fundedAmount ?? null,
      spent: depositSpentAmount(deposit),
      balance: deposit?.balance ?? null,
      toFund: hasNominal && Number.isFinite(funded) ? Math.max(0, nominal - funded) : null,
  });
  const owner = depositPerson(deposit);
  fields.push({ value: 'personName', label: 'Имя клиента', text: [owner?.name, owner?.surname].filter(Boolean).join(' ') });
  return fields;
}

function personDepositCard(deposit, { interactive = true, summary = false } = {}) {
  const program = getDepositPrograms().find(item => String(item.id) === String(deposit?.programId)) || {};
  return entityVisualCard({
    appearance: depositCardAppearance(program),
    fields: assignedDepositFields(deposit),
    image: depositCardPhoto(program),
    imagePosition: depositCardPhotoPosition(program),
    interactive,
    data: interactive ? (summary ? 'data-deposit-summary' : `data-person-program="deposit:${escapeHtml(deposit?.depositId || deposit?.id || '')}"`) : '',
    aria: summary ? 'Информация об оформлении депозита' : interactive ? `Открыть депозит ${deposit?.programName || ''}` : String(deposit?.programName || 'Депозит'),
  });
}


export function getPersonLoyaltyCards(person = {}, { refresh = true } = {}) {
  const key = String(person?.key || person?.id || '').trim();
  const deposits = key ? getDepositInstances().filter(item => {
    const owner = item?.person && typeof item.person === 'object' ? item.person : {};
    return String(owner.key || owner.personKey || owner.id || '') === key;
  }) : [];
  return {
    cards: deposits.map(deposit => {
      const id = String(deposit.depositId || deposit.id || '');
      return {
        key: 'deposit:' + id, markup: personDepositCard(deposit),
        detail: {
          title: deposit.programName || 'Депозит',
          open: (root, currentPerson, onChanged) =>
            openAssignedDepositForPerson(root, currentPerson, id, onChanged),
        },
      };
    }),
    refreshPromise: refresh && key ? listPersonDeposits(key) : null,
  };
}
export async function openDepositForPerson(root, person = null) {
  await loadDepositPrograms();
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'loyalty-deposit-z' }), { stack: true });
  if (!layer) return null;
  const render = async () => {
    await loadDepositPrograms();
    const programs = getDepositPrograms().filter((item) => !item?.archivedAt);
    const cards = programs.length
      ? entityCardStack(programs.map((program) => card(programFields(program), {
          program,
          data: `data-deposit-program="${escapeHtml(program.id)}"`,
          aria: `Открыть депозитную программу ${program.name || ''}`,
        })))
      : emptyState('Депозитных программ пока нет', 'Создайте первую программу кнопкой «+».');
    layer.innerHTML = page([
      depositHeaderContext({
        title: 'Депозит',
        settingsData: 'data-deposit-settings',
        settingsAria: 'Настройки депозита',
        c: { label: '+', data: 'data-deposit-program-add', aria: 'Создать депозитную программу' },
      }),
      cards,
    ]);
    layer.querySelector('[data-deposit-settings]')?.addEventListener('click', () => openRootSettings(root, render));
    layer.querySelector('[data-deposit-program-add]')?.addEventListener('click', () => openCreateProgramQ(root, render));
    layer.querySelectorAll('[data-deposit-program]').forEach((node) => {
      node.addEventListener('click', () => openProgramLayer(root, node.dataset.depositProgram, { person, onChanged: render }));
    });
    notifyContext();
  };
  await render();
  return layer;
}


/**
 * Entry from the already-selected Person. Reuse the canonical funding and
 * issued-deposit Q flows; never ask the operator to choose the person twice.
 */
export async function issueDepositForPerson(root, person, programId, onSaved = () => {}) {
  if (!person?.key) throw new Error('Клиент не выбран');
  // Person's auxiliary scope does not include wallets. Fetch the authoritative
  // Loyalty scope before opening the original payment form.
  const { loadAuxiliaryState } = await import('../../runtime/auxiliary-state.js');
  await loadAuxiliaryState('loyalty');
  await loadDepositPrograms();
  const program = getDepositPrograms().find((item) => String(item?.id) === String(programId)
    && !item.archivedAt && (!item.status || item.status === 'active'));
  if (!program) throw new Error('Депозитная программа больше недоступна');
  return openFundQ(root, program, { person, onSaved });
}

export async function openAssignedDepositForPerson(root, person, depositId, onChanged = () => {}) {
  if (!person?.key) throw new Error('Клиент не выбран');
  const [deposits] = await Promise.all([listPersonDeposits(person.key), loadDepositPrograms()]);
  if (!deposits.some((item) => String(item?.depositId || item?.id) === String(depositId))) {
    throw new Error('Депозит не принадлежит выбранному клиенту');
  }
  return openDepositQ(root, depositId, onChanged);
}


/**
 * Shared E → Person program contract. Choice values are concrete IDs from the
 * same server-backed deposit catalog that renders Loyalty's Deposit E screen.
 */
export async function getPersonProgramChoices(person) {
  if (!person?.key) return { options: [] };
  const programs = await loadDepositPrograms();
  return {
    label: 'Депозитная программа',
    placeholder: 'Выберите депозитную программу',
    actionLabel: 'Оформить',
    options: programs
      .filter((item) => item?.id && !item.archivedAt && (!item.status || item.status === 'active'))
      .map((item) => ({ value: String(item.id), label: String(item.name || 'Депозит') })),
  };
}

export async function openPersonProgramChoice(root, person, programId, onChanged = () => {}) {
  return issueDepositForPerson(root, person, programId, onChanged);
}

export async function renderDeposit(root) {
  await loadDepositPrograms();
  if (!root.isConnected) return;
  const desktop = isV2DesktopWorkspace(root.closest('[data-v2-app]'));
  const programs = getDepositPrograms().filter((item) => !item?.archivedAt);
  const cards = programs.map((program) => card(programFields(program), {
          program,
    data: `data-deposit-program="${escapeHtml(program.id)}"`,
    aria: `Открыть депозитную программу ${program.name || ''}`,
  }));
  const rerender = () => renderDeposit(root);
  if (root.hasAttribute('data-loyalty-program-section')) {
    renderDesktopProgramSection(root, cards, emptyState('Депозитных программ пока нет', 'Создайте первую программу кнопкой «+».'));
    root.querySelectorAll('[data-deposit-program]').forEach(node => node.addEventListener('click', () => openProgramLayer(root, node.dataset.depositProgram, { onChanged: rerender })));
    notifyContext();
    return;
  }
  root.innerHTML = page([
    depositHeaderContext({
      title: 'Депозит',
      settingsData: desktop ? '' : 'data-deposit-settings',
      settingsAria: 'Настройки депозита',
      c: desktop ? null : { label: '+', data: 'data-deposit-program-add', aria: 'Создать депозитную программу' },
    }),
    '<div data-deposit-program-cards data-loyalty-program-section="deposit">' + (cards.length
      ? (desktop ? entityCardRail(cards) : entityCardStack(cards))
      : emptyState('Депозитных программ пока нет', 'Создайте первую программу кнопкой «+».')) + '</div>',
  ]);
  let tools = root;
  if (desktop) {
    const toolbar = `<div class="v2-desktop-tool-row" data-deposit-desktop-toolbar>
      <div class="v2-desktop-tool-actions">
        ${button(DATA_EXCHANGE_ICON, { variant: 'secondary', className: 'v2-desktop-tool-icon', data: 'data-deposit-desktop-excel title="Обмен данными" aria-haspopup="dialog"', aria: 'Обмен данными' })}
        ${button(VIEW_ICON, { variant: 'secondary', className: 'v2-desktop-tool-icon', data: 'data-deposit-desktop-view title="Вид"', aria: 'Вид' })}
        ${button('<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>', { variant: 'secondary', className: 'v2-desktop-tool-primary', data: 'data-deposit-program-add title="Создать депозитную программу" aria-haspopup="dialog"', aria: 'Создать депозитную программу' })}
      </div>
    </div>`;
    const [row] = setV2ZHeaderRows(root, [toolbar], {
      desktopTitle: 'Депозит',
      desktopAccessory: `<output aria-label="Количество депозитных программ">${programs.length}</output>`,
    });
    if (!row) root.querySelector('[data-deposit-program-cards]')?.insertAdjacentHTML('beforebegin', toolbar);
    tools = row || root;
    tools.querySelector('[data-deposit-desktop-view]')?.addEventListener('click', () => openAppearanceQ(root, rerender));
    tools.querySelector('[data-deposit-desktop-excel]')?.addEventListener('click', event => openDepositExcelQ(root, rerender, { anchor: event.currentTarget }));
  }
  root.querySelector('[data-deposit-settings]')?.addEventListener('click', () => openRootSettings(root, rerender));
  tools.querySelector('[data-deposit-program-add]')?.addEventListener('click', () => openCreateProgramQ(root, rerender));
  root.querySelectorAll('[data-deposit-program]').forEach((node) => node.addEventListener('click', () => openProgramLayer(root, node.dataset.depositProgram, { onChanged: rerender })));
  notifyContext();
}

export { renderDeposit as render };
export { openDepositExcelQ as openProgramExcel };
