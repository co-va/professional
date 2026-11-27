import { formatSignedMoney } from '../../../ui/utils/values.js';

function formatMoney(value = 0, { signed = false } = {}) {
  return formatSignedMoney(value, signed);
}

import {
  actionBlock,
  button,
  datePicker,
  emptyState,
  field,
  formValidationMessage,
  infoUI,
  initDatePickers,
  modal,
  mountModal,
  mountV2ZLayer,
  openNotice,
  openSharedProfileSettingsMenu,
  select,
  shortDateTime,
  shortDateTimeParts,
  v2ListEntries,
  v2ListEntry,
  v2ZLayer,
  workspaceHeaderContext,
} from '../../../ui/ui.js';
import { financeDesktop, financeZActions, financeZSave, financeHistoryTable, financeTableContact, bindFinanceHistoryTable, openFinanceReceiptX } from '../desktop.js';
import { financeReceipt } from '../receipt.js';
import { paymentMethods, initPaymentMethods } from '../../../ui/payment/index.js';
import { readOnlyReceipt } from '../../../ui/receipt/index.js';
import { DATA_EXCHANGE_ICON, FINANCE_OPERATIONS_ICON, GROUP_ICON, TRASH_ICON } from '../../../ui/buttons/index.js';
import { financeOperationGroups, openFinanceOperations } from '../operations/index.js';
import { canUseCapability } from '../../access.js';
import { getAllPeople } from '../../people/data.js';
import { getFinanceOperation } from '../data.js';
import { getWallets } from '../cash/data.js';
import { financeLocalDateValue, financeOccurredAtForDate } from '../date.js';
import { cancelFinanceOperation, correctFinanceOperation, hardDeleteFinanceOperation } from '../service.js';
import { getLedgerEntries } from '../read.js';
import { openFinanceArticlesQ } from './articles.js';
import { openIncomeExpenseQ, renderIncomeExpenseOperation } from './income-expense.js';
import { SPECIAL_FINANCE_ACTIONS, renderSpecialFinanceOperation } from './special-operations.js';
import { openDDSExcel } from './excel.js';
import { bindWalletHistory, walletHistoryBody, localDate } from '../cash/wallet-history.js';


function operationMoment(item) {
  const raw = item?.occurredAt || item?.refundedAt || item?.paidAt || '';
  const fallback = `${item?.date || ''} ${item?.time || ''}`.trim();
  return shortDateTime(raw, fallback);
}

function operationName(item) {
  const kind = String(item?.operationKind || '');
  const type = String(item?.economicType || '');
  let label = 'Движение';
  if (kind === 'payment') label = 'Оплата услуги';
  else if (kind === 'cancel') label = 'Отмена операции';
  else if (kind === 'refund') label = 'Возврат';
  else if (kind === 'manual-income') label = 'Доход';
  else if (kind === 'manual-expense') label = 'Расход';
  else if (kind === 'loan-received') label = 'Получен займ';
  else if (kind === 'loan-repayment') label = 'Возврат займа';
  else if (kind === 'investment-received') label = 'Получена инвестиция';
  else if (kind === 'investment-return') label = 'Возврат инвестиций';
  else if (kind === 'transfer') label = 'Перевод';
  else if (type === 'SERVICE_REVENUE') label = 'Оплата услуги';
  else if (type === 'TIPS') label = 'Чаевые';
  else if (type === 'SERVICE_REFUND') label = 'Возврат услуги';
  else if (type === 'TIPS_REFUND') label = 'Возврат чаевых';
  else if (type === 'REVERSAL') label = 'Отмена операции';
  else if (type === 'LOAN_RECEIVED') label = 'Получен займ';
  else if (type === 'LOAN_REPAYMENT') label = 'Возврат займа';
  else if (type === 'INVESTMENT_RECEIVED') label = 'Получена инвестиция';
  else if (type === 'INVESTMENT_RETURN') label = 'Возврат инвестиций';
  else if (type === 'TRANSFER') label = 'Перевод';
  else if (item?.direction === 'IN') label = 'Доход';
  else if (item?.direction === 'OUT') label = 'Расход';
  return item?.operationStatus === 'cancelled' ? `${label} · Отменена` : label;
}

function walletText(item) {
  return item?.walletName || item?.walletId || '';
}

function personText(item) {
  return [item?.person?.name, item?.person?.surname].filter(Boolean).join(' ').trim();
}

function operationGroupsFromLedger(movements = []) {
  const groups = new Map();
  (Array.isArray(movements) ? movements : []).forEach((item) => {
    const id = String(item?.operationId || '').trim();
    if (!id || item?.operationKind === 'cancel') return;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(item);
  });
  return [...groups.values()];
}

function operationTotal(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const declared = Math.max(0, Number(rows[0]?.operationTotal) || 0);
  if (declared > 0) return declared;
  if (rows[0]?.operationKind === 'transfer') {
    return Math.max(0, ...rows.map((item) => Math.max(0, Number(item?.amount) || 0)));
  }
  return rows.reduce((sum, item) => sum + Math.max(0, Number(item?.amount) || 0), 0);
}

function operationDisplayAmount(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const total = operationTotal(rows);
  if (rows[0]?.operationKind === 'transfer') return formatMoney(total);
  const directions = new Set(rows.map((item) => String(item?.direction || '')).filter(Boolean));
  if (directions.size === 1 && directions.has('OUT')) return formatMoney(-total, { signed: true });
  if (directions.size === 1 && directions.has('IN')) return formatMoney(total, { signed: true });
  return formatMoney(total);
}

function operationListSubtitle(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const first = rows[0] || {};
  const wallets = [...new Set(rows.map((item) => walletText(item)).filter(Boolean))];
  if (first?.operationKind === 'transfer') {
    const from = rows.find((item) => item?.direction === 'OUT');
    const to = rows.find((item) => item?.direction === 'IN');
    return [walletText(from), walletText(to)].filter(Boolean).join(' → ');
  }
  const articles = [...new Set(rows.map((item) => String(item?.articleName || '')).filter(Boolean))];
  return [
    articles.join(', '),
    personText(first),
    first?.workplace || '',
    wallets.join(' + '),
  ].filter(Boolean).join(' · ');
}

function operationListEntry(entries = []) {
  const first = entries[0] || {};
  const id = String(first?.operationId || '');
  return v2ListEntry({
    title: operationName(first),
    subtitle: operationListSubtitle(entries),
    rightTop: operationDisplayAmount(entries),
    rightBottom: operationMoment(first),
    interactive: Boolean(id),
    initial: '',
    data: id ? `data-finance-operation="${id}"` : '',
    aria: id ? `Открыть финансовую операцию ${operationName(first)}` : '',
  });
}

function openCancellationInfo(root) {
  return openNotice({
    title: 'Об отмене операции',
    message: 'Отмена сохраняет исходную операцию в истории и создаёт обратную операцию на выбранную фактическую дату.',
    surface: 'app',
  });
}

function openCancelOperation(root, operationLayer, entries) {
  const first = entries[0] || {};
  const content = `<div class="ui-list-toolbar"><div></div><div class="ui-list-toolbar__actions">${infoUI('', {
    aria: 'Что означает отмена операции',
    data: 'data-finance-cancel-info',
    actionOnly: true,
  })}</div></div>
    <div class="compact-form">
      ${datePicker({ label: 'Фактическая дата отмены', name: 'financeCancelOccurredDate', value: financeLocalDateValue(), required: true, allowClear: false })}
      ${button('Отменить', { variant: 'danger', data: 'data-finance-operation-cancel-confirm' })}
    </div>`;
  const cancelLayer = mountModal(document.body, modal(content, {
    title: 'Отменить операцию',
    variant: 'x',
    className: 'modal--form-sheet',
    surface: 'app',
  }));
  if (!cancelLayer) return;
  initDatePickers(cancelLayer);

  cancelLayer.querySelector('[data-finance-cancel-info] [data-info-trigger]')?.addEventListener('click', () => {
    openCancellationInfo(root);
  });
  cancelLayer.querySelector('[data-finance-operation-cancel-confirm]')?.addEventListener('click', async () => {
    const input = cancelLayer.querySelector('input[name="financeCancelOccurredDate"]');
    if (!input?.value) return;
    try {
      const cancelled = await cancelFinanceOperation(first.operationId, {
        reason: 'incorrect-entry',
        occurredAt: financeOccurredAtForDate(input.value, new Date()),
      });
      if (!cancelled) return;
      cancelLayer.v2Close?.();
      operationLayer.v2Close?.();
      renderDDS(root);
    } catch (error) {
      openNotice({ message: String(error?.message || 'Не удалось отменить операцию') });
    }
  });
}

function openDeleteOperation(root, operationLayer, entries) {
  const first = entries[0] || {};
  const desktop = financeDesktop(root);
  const title = desktop ? 'Удалить?' : 'Удалить операцию?';
  const warning = desktop
    ? 'Операция и все связанные с ней финансовые записи будут полностью удалены из истории. Остатки кошельков будут пересчитаны. Восстановить удалённые данные невозможно. Вы уверены?'
    : 'Операция и связанные с ней финансовые записи будут удалены без возможности восстановления.';
  const remove = button('Удалить', { variant: 'critical', className: desktop ? 'v2-confirmation-destructive' : '', data: 'data-finance-operation-delete-confirm' });
  const closeButton = button('Отмена', { variant: 'secondary', className: desktop ? 'v2-confirmation-safe' : '', data: 'data-finance-operation-delete-close data-modal-autofocus' });
  const content = `<div class="modal-title"><h2>${title}</h2><p>${warning}</p></div>
    <div class="modal-actions">${desktop ? remove + closeButton : closeButton + remove}</div>`;
  const confirmation = mountModal(document.body, modal(content, {
    title,
    variant: 'x',
    className: desktop ? '' : 'modal--form-sheet',
    surface: 'app',
  }));
  if (!confirmation) return;
  if (desktop) confirmation.setAttribute('data-v2-delete-confirmation', 'true');

  const close=confirmation.querySelector('[data-finance-operation-delete-close]');
  const confirm=confirmation.querySelector('[data-finance-operation-delete-confirm]');
  let pending=false;
  close?.addEventListener('click', () => {if(!pending)confirmation.v2Close?.();});
  confirm?.addEventListener('click', async () => {
    if(pending)return;
    pending=true;
    if(confirm)confirm.disabled=true;
    if(close)close.disabled=true;
    try {
      const result=await hardDeleteFinanceOperation(first.operationId);
      if(result==null||result===false)throw new Error('Не удалось удалить операцию');
      confirmation.v2Close?.();
      operationLayer.v2Close?.();
      renderDDS(root);
    } catch (error) {
      openNotice({ message: String(error?.message || 'Не удалось удалить операцию') });
    } finally {
      pending=false;
      if(confirm)confirm.disabled=false;
      if(close)close.disabled=false;
    }
  });
  return confirmation;
}

function correctionWalletOptions() {
  return getWallets().map((item) => ({ value: item.id, label: item.name }));
}

function reopenCorrectedOperation(root, operationLayer, correctionLayer, operationId) {
  correctionLayer?.v2Close?.();
  operationLayer?.v2Close?.();
  renderDDS(root);
  const movements = [...getLedgerEntries()].reverse();
  openFinanceOperation(root, movements, operationId);
}

function openPaymentCorrectionX(root, operationLayer, operation) {
  const data = operation.data || {};
  const initialAllocations = Array.isArray(data.allocations) ? data.allocations : [];
  const serviceAmount = Math.max(0, Number(data.serviceAmount) || 0);
  // This server correction only supports wallet payments. Never silently
  // replace a deposit/personal-account allocation or truncate saved sources.
  if ((Array.isArray(data.depositAllocations) && data.depositAllocations.some(item=>Number(item.amount)>0)) || Number(data.personalAccountAmount)>0) {
    openNotice({message:'Оплату с Депозита или Личного счёта нельзя исправить здесь. Отмените оплату в исходном разделе и проведите её заново.'});
    return null;
  }
  if (!initialAllocations.length || initialAllocations.length > 4 || data.serviceAmount == null) {
    openNotice({message:'Не удалось безопасно восстановить распределение исходной оплаты.'});
    return null;
  }
  const wallets = getWallets();
  if (initialAllocations.some(item=>!wallets.some(wallet=>String(wallet.id)===String(item.walletId)))) {
    openNotice({message:'Один из кошельков исходной оплаты недоступен.'});
    return null;
  }
  const summary = readOnlyReceipt({groups:[[
    {label:'В счёт услуг',value:formatMoney(serviceAmount),strong:true},
  ]]});
  const content = `<div class="compact-form record-payment-entry-x" data-dds-payment-correction>
    ${summary}
    ${paymentMethods({wallets,total:serviceAmount,initialAllocations,showAction:false,showTotal:false})}
    <div data-dds-payment-summary></div>
    ${actionBlock(button('Сохранить',{data:'data-dds-payment-save',disabled:true}))}
  </div>`;
  const layer = mountModal(root,modal(content,{title:'Исправить оплату',variant:'x',surface:'app',className:'modal--form-sheet'}));
  if(!layer)return null;
  const host=layer.querySelector('[data-dds-payment-correction]');
  const method=host.querySelector('[data-payment-methods]');
  const submit=host.querySelector('[data-dds-payment-save]');
  const output=host.querySelector('[data-dds-payment-summary]');
  let state=null, pending=false;
  const cents=value=>Math.round(Number(value||0)*100);
  const fingerprint=rows=>JSON.stringify(rows.map(item=>[String(item.walletId),cents(item.amount)]).sort((a,b)=>a[0].localeCompare(b[0])||a[1]-b[1]));
  const original=fingerprint(initialAllocations);
  const canSave=()=>Boolean(state?.valid && cents(state.received)>=cents(serviceAmount) && fingerprint(state.allocations)!==original);
  const sync=next=>{
    state=next;
    const tipsRow=method.querySelector('[data-payment-tips-row]');
    if(tipsRow)tipsRow.hidden=true;
    const rows=[{label:'Оплата',value:formatMoney(next.received),strong:true}];
    if(cents(next.tips)>0)rows.push({label:'Чаевые',value:formatMoney(next.tips)});
    if(cents(next.received)<cents(serviceAmount))rows.push({label:'Не хватает для исходной оплаты',value:formatMoney(serviceAmount-next.received)});
    output.innerHTML=readOnlyReceipt({groups:[rows]});
    submit.disabled=pending||!canSave();
  };
  initPaymentMethods(method,{onChange:sync});
  submit.addEventListener('click',async()=>{
    if(pending||!canSave())return;
    pending=true;submit.disabled=true;
    try{
      const corrected=await correctFinanceOperation(operation.operationId,{
        allocations:state.allocations,
        serviceAmount,
        tips:Math.max(0,(cents(state.received)-cents(serviceAmount))/100),
        occurredAt:operation.occurredAt,
      });
      if(!corrected)throw new Error('Сервер не подтвердил исправление оплаты.');
      layer.v2Close?.();
      reopenCorrectedOperation(root,operationLayer,null,operation.operationId);
    }catch(error){openNotice({message:String(error?.message||'Не удалось исправить оплату')});}
    finally{pending=false;if(submit.isConnected)submit.disabled=!canSave();}
  });
  return layer;
}

function renderPaymentCorrection(root, operation, { onSaved = null } = {}) {
  const data = operation?.data && typeof operation.data === 'object' ? operation.data : {};
  const allocations = Array.isArray(data.allocations) ? data.allocations.slice(0, 2) : [];
  const wallets = correctionWalletOptions();
  const serviceAmount = Math.max(0, Number(data.serviceAmount) || 0);
  const rows = [0, 1].map((index) => {
    const allocation = allocations[index] || {};
    return `${select({
      label: `Кошелёк ${index + 1}`,
      name: `allocationWallet${index + 1}`,
      value: allocation.walletId || '',
      options: [{ value: '', label: '—' }, ...wallets],
    })}${field({
      label: `Сумма ${index + 1}`,
      name: `allocationAmount${index + 1}`,
      type: 'number',
      inputmode: 'decimal',
      value: allocation.amount || '',
      placeholder: '0',
      data: 'min="0" step="0.01"',
    })}`;
  }).join('');

  root.innerHTML = `${workspaceHeaderContext({
    title: 'Корректировка · Оплата услуги',
  })}
    <form class="compact-form" data-finance-payment-correction-form novalidate>
      <div class="payment-total"><span>Сумма услуг</span><strong>${formatMoney(serviceAmount)}</strong></div>
      ${rows}
    </form>
    ${actionBlock(button('Сохранить', {
      data: 'data-finance-payment-correction-save',
      aria: 'Сохранить корректировку оплаты',
    }))}`;
  root.querySelector('[data-finance-payment-correction-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const validation = formValidationMessage(formElement);
    if (validation) {
      openNotice({ message: validation });
      return;
    }
    const form = new FormData(formElement);
    const walletRows = [1, 2].map((index) => {
      const walletId = String(form.get(`allocationWallet${index}`) || '');
      const amount = Math.max(0, Number(form.get(`allocationAmount${index}`) || 0));
      const wallet = getWallets().find((item) => String(item.id) === walletId);
      return { walletId, walletName: wallet?.name || '', amount };
    }).filter((item) => item.walletId && item.amount > 0);
    const allocated = walletRows.reduce((sum, item) => sum + item.amount, 0);
    if (!walletRows.length || allocated + 0.009 < serviceAmount) {
      openNotice({ message: 'Сумма по кошелькам не может быть меньше суммы услуг.' });
      return;
    }
    const occurredAt = operation?.occurredAt || '';
    try {
      await correctFinanceOperation(operation.operationId, {
        allocations: walletRows,
        serviceAmount,
        tips: Math.max(0, allocated - serviceAmount),
        occurredAt,
      });
      onSaved?.();
    } catch (error) {
      openNotice({ message: String(error?.message || 'Не удалось скорректировать оплату') });
    }
  });
  root.querySelector('[data-finance-payment-correction-save]')?.addEventListener('click', () => {
    root.querySelector('[data-finance-payment-correction-form]')?.requestSubmit();
  });
  financeZSave(root, '[data-finance-payment-correction-save]', 'Корректировка · Оплата услуги');
  return true;
}

function renderRefundCorrection(root, operation, { onSaved = null } = {}) {
  const data = operation?.data && typeof operation.data === 'object' ? operation.data : {};
  const wallets = correctionWalletOptions();
  root.innerHTML = `${workspaceHeaderContext({
    title: 'Корректировка · Возврат',
  })}
    <form class="compact-form" data-finance-refund-correction-form novalidate>
      ${field({
        label: 'Сумма',
        name: 'amount',
        type: 'number',
        inputmode: 'decimal',
        value: data.total || '',
        required: true,
        placeholder: '0',
        data: 'min="0" step="0.01"',
      })}
      ${select({
        label: 'Кошелёк',
        name: 'walletId',
        value: data.walletId || '',
        options: wallets,
      })}
      ${field({
        label: 'Причина',
        name: 'reason',
        value: data.reason || '',
        placeholder: 'Необязательно',
      })}
      ${datePicker({
        label: 'Фактическая дата',
        name: 'occurredDate',
        value: financeLocalDateValue(operation?.occurredAt || new Date()),
        required: true,
        allowClear: false,
      })}
    </form>
    ${actionBlock(button('Сохранить', {
      data: 'data-finance-refund-correction-save',
      aria: 'Сохранить корректировку возврата',
    }))}`;
  initDatePickers(root);

  root.querySelector('[data-finance-refund-correction-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const validation = formValidationMessage(formElement);
    if (validation) {
      openNotice({ message: validation });
      return;
    }
    const form = new FormData(formElement);
    const walletId = String(form.get('walletId') || '');
    const wallet = getWallets().find((item) => String(item.id) === walletId);
    try {
      await correctFinanceOperation(operation.operationId, {
        amount: Number(form.get('amount') || 0),
        walletId,
        walletName: wallet?.name || '',
        reason: String(form.get('reason') || '').trim(),
        occurredAt: financeOccurredAtForDate(String(form.get('occurredDate') || ''), operation?.occurredAt || new Date()),
      });
      onSaved?.();
    } catch (error) {
      openNotice({ message: String(error?.message || 'Не удалось скорректировать возврат') });
    }
  });
  root.querySelector('[data-finance-refund-correction-save]')?.addEventListener('click', () => {
    root.querySelector('[data-finance-refund-correction-form]')?.requestSubmit();
  });
  financeZSave(root, '[data-finance-refund-correction-save]', 'Корректировка · Возврат');
  return true;
}

function openOperationCorrection(root, operationLayer, entries) {
  const first = entries[0] || {};
  const operation = getFinanceOperation(first.operationId);
  if (!operation) {
    openNotice({ message: 'Операция не найдена.' });
    return;
  }
  if (financeDesktop(root) && operation.kind === 'payment') {
    const layer = openPaymentCorrectionX(root, operationLayer, operation);
    if (layer) operationLayer.v2Close?.();
    return layer;
  }
  operationLayer.v2Close?.();
  if (financeDesktop(root) && (operation.kind === 'manual-income' || operation.kind === 'manual-expense')) {
    return openIncomeExpenseQ(root, operation.kind === 'manual-income' ? 'IN' : 'OUT', {
      operation, onSaved: () => reopenCorrectedOperation(root, operationLayer, null, operation.operationId),
    });
  }
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'finance-dds-correction-z' }), { stack: true });
  if (!layer) return;
  const onSaved = () => reopenCorrectedOperation(root, operationLayer, layer, operation.operationId);
  let rendered = false;
  if (operation.kind === 'manual-income') {
    rendered = renderIncomeExpenseOperation(layer, 'IN', { operation, onSaved });
  } else if (operation.kind === 'manual-expense') {
    rendered = renderIncomeExpenseOperation(layer, 'OUT', { operation, onSaved });
  } else if (SPECIAL_FINANCE_ACTIONS.some((item) => item.id === operation.kind)) {
    rendered = renderSpecialFinanceOperation(layer, operation.kind, { operation, onSaved });
  } else if (operation.kind === 'payment') {
    rendered = renderPaymentCorrection(layer, operation, { onSaved });
  } else if (operation.kind === 'refund') {
    rendered = renderRefundCorrection(layer, operation, { onSaved });
  }
  if (!rendered) {
    layer.v2Close?.();
    openNotice({ message: 'Для этой операции корректировка недоступна.' });
  }
}



function openFinanceOperation(root, movements, operationId) {
  const id = String(operationId || '');
  const entries = movements.filter((item) => String(item?.operationId || '') === id);
  if (!entries.length) return;
  const first = entries[0];
  const receipt = financeReceipt(id, operationName(first), { entries });
  const active = first?.operationStatus !== 'cancelled';
  const desktop = financeDesktop(root);
  const correction = active ? { label: desktop ? 'Исправить' : 'Корректировка', variant: desktop ? 'primary' : 'secondary', run: layer => openOperationCorrection(root, layer, entries) } : null;
  const cancel = !desktop && active ? { label: 'Отменить операцию', aria: 'Отменить финансовую операцию с сохранением истории', variant: 'danger', run: layer => openCancelOperation(root, layer, entries) } : null;
  const remove = { label: 'Удалить', variant: 'critical', run: layer => openDeleteOperation(root, layer, entries) };
  return openFinanceReceiptX(root, operationName(first), receipt, desktop ? [remove, correction] : [correction, cancel, remove], { actionLayout: 'dds' });
}

function openArticles(root) {
  return openFinanceArticlesQ(root, {onSaved:()=>renderDDS(root)});
}

function availableDDSSettings() {
  const items = [{ id: 'excel', label: 'Excel' }];
  if (canUseCapability('finance.articles.access')) items.push({ id: 'articles', label: 'Статьи' });
  return items;
}

function openDDSSettings(root, movements) {
  const items = availableDDSSettings();
  if (!items.length) return;
  const content = actionBlock(items.map((item) => button(item.label, {
    variant: 'secondary',
    data: `data-finance-dds-tool="${item.id}"`,
  })).join(''));
  const settings = mountModal(root, modal(content, {
    title: 'Настройки ДДС',
    variant: 'x',
    surface: 'app',
  }));
  if (!settings) return;
  settings.querySelectorAll('[data-finance-dds-tool]').forEach((element) => {
    element.addEventListener('click', () => {
      const id = String(element.dataset.financeDdsTool || '');
      settings.v2Close?.();
      if (id === 'excel') openDDSExcel(root, movements, {onImported:()=>renderDDS(root)});
      else if (id === 'articles') openArticles(root);
    });
  });
}

function renderDDS(root) {
  const movements = [...getLedgerEntries()].reverse();
  const groupedOperations = operationGroupsFromLedger(movements);
  const people = financeDesktop(root) ? getAllPeople() : [];
  const desktop = financeDesktop(root);
  const rows = desktop ? groupedOperations.map(entries => {
    const first = entries[0];
    const transfer = first.operationKind === 'transfer';
    const wallets = [...new Set(entries.map(walletText).filter(Boolean))];
    const articles = [...new Set(entries.map(item => String(item.articleName || '')).filter(Boolean))];
    const directions = new Set(entries.map(item=>item.direction).filter(Boolean));
    const direction = transfer ? 'transfer' : directions.size===1&&directions.has('OUT') ? 'out' : directions.size===1&&directions.has('IN') ? 'in' : 'mixed';
    const contact=financeTableContact(first,people);
    return { id:String(first.operationId), date:operationMoment(first), occurredAt:String(first.occurredAt||first.refundedAt||first.paidAt||''),
      localDate:localDate(first.occurredAt||first.refundedAt||first.paidAt||''), title:operationName(first), ...contact,
      personFilter:[contact.code,contact.person].filter(Boolean).join(' · '), workplace:String(first.workplace||''),
      wallets, wallet:transfer?operationListSubtitle(entries):wallets.join(' + '), articles, article:articles.join(', '),
      direction, status:first.operationStatus==='cancelled'?'Отменена':'Активна',
      value:direction==='out'?-operationTotal(entries):operationTotal(entries), amount:operationDisplayAmount(entries), item:first };
  }) : [];
  const operations = desktop ? '<div data-dds-history>'+walletHistoryBody(true)+'</div>'
    : groupedOperations.length ? v2ListEntries(groupedOperations.map(operationListEntry)) : emptyState('Все операции','Финансовых операций пока нет.');
  const settingsItems = availableDDSSettings();
  const operationGroups = ['income-expense', 'transfer'];
  const headerContext = workspaceHeaderContext({
    title: 'Движения денежных средств',
    v: !financeDesktop(root) && settingsItems.length ? {
      kind: 'settings',
      data: 'data-finance-dds-settings',
      aria: 'Настройки ДДС',
    } : null,
  });

  root.innerHTML = `${headerContext}${operations}`;
  if (desktop) bindWalletHistory(root, {name:'Движения денежных средств'}, rows, {
    dds:true, open:id=>openFinanceOperation(root,movements,id), actions:[
    { label: DATA_EXCHANGE_ICON, className: 'people-desktop-icon', aria: 'Обмен данными', run: (anchor, selectedRows) => {
      const ids=new Set(selectedRows.map(row=>row.id));
      openDDSExcel(root, movements, { anchor, exportMovements:movements.filter(item=>ids.has(String(item.operationId))), onImported: () => renderDDS(root) });
    } },
    canUseCapability('finance.articles.access') ? { label: GROUP_ICON, className: 'people-desktop-icon', aria: 'Статьи', run: () => openArticles(root) } : null,
    financeOperationGroups({ groups: operationGroups }).length ? {
      label: FINANCE_OPERATIONS_ICON, className: 'people-desktop-icon', aria: 'Финансовые операции',
      run: anchor => openFinanceOperations(root, { groups: operationGroups, anchor, onSaved: () => renderDDS(root) }),
    } : null,
  ]});
  else root.querySelector('[data-finance-dds-settings]')?.addEventListener('click', () => openDDSSettings(root, movements));
  root.querySelectorAll('[data-finance-operation]').forEach((element) => {
    element.addEventListener('click', () => openFinanceOperation(root, movements, element.dataset.financeOperation));
  });
}

export { renderDDS };
