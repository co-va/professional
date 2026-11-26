import {
  actionBlock,
  button,
  compactButton,
  dataTable,
  setV2ZHeaderRows,
  datePicker,
  emptyState,
  entityCardStack,
  escapeHtml,
  field,
  formValidationMessage,
  initDatePickers,
  miniCard,
  miniCardRail,
  modal,
  mountModal,
  openNotice,
  page,
  select,
  shortDateTime,
  v2ListEntries,
  v2ListEntry,
  v2Section,
} from '../../../ui/ui.js';
import { isV2DesktopWorkspace } from '../../../ui/v2/geometry.js';
import { compactCheck } from '../../../ui/selection/check-list.js';
import { readOnlyReceipt } from '../../../ui/receipt/index.js';
import { personDisplay } from '../../people/presentation.js';
import { openLoyaltyAppearanceQ } from '../shared.js';
import { getWallets } from '../../finance/index.js';
import {
  availablePeople,
  bindViewSettings,
  formObject,
  loyaltyCardFields,
  loyaltyHeader,
  loyaltyVisualCard,
  money,
  notifyLoyaltyContext,
  openLoyaltySettingsMenu,
  personLabel,
} from '../shared.js';
import {
  fundPersonalAccount,
  getCachedPersonalAccount,
  loadPersonalAccount,
  loadPersonalAccounts,
  settlePersonalAccountDebt,
  updatePersonalAccountSettings,
  withdrawPersonalAccount,
} from './data.js';

function personKey(person = {}) {
  return String(person?.key || person?.id || '').trim();
}

function accountPerson(account = {}, people = []) {
  const keys = new Set([
    String(account?.personKey || ''),
    ...(Array.isArray(account?.memberKeys) ? account.memberKeys.map((value) => String(value || '')) : []),
  ].filter(Boolean));
  return people.find((person) => keys.has(personKey(person))) || { key: String(account?.personKey || ''), name: 'Без имени' };
}

function movementTitle(item = {}) {
  const kind = String(item?.kind || '');
  if (kind === 'funding') return 'Пополнение';
  if (kind === 'withdrawal') return 'Возврат денег';
  if (kind === 'payment') return 'Оплата';
  if (kind === 'refund') return 'Возврат оплаты';
  return String(item?.direction || '').toUpperCase() === 'IN' ? 'Пополнение' : 'Списание';
}

function movementSource(item = {}) {
  const data = item?.data && typeof item.data === 'object' ? item.data : {};
  if (data?.note) return String(data.note);
  if (data?.reason) return String(data.reason);
  if (item?.sourceType === 'record') return 'Запись';
  if (item?.sourceType === 'sale') return 'Продажа';
  if (item?.sourceType === 'order') return 'Заказ';
  return 'Операция';
}

function walletOptions() {
  return [
    { value: '', label: 'Выберите кошелёк' },
    ...getWallets().map((wallet) => ({ value: String(wallet?.id || ''), label: String(wallet?.name || '') })),
  ];
}

function selectedWallet(walletId = '') {
  return getWallets().find((wallet) => String(wallet?.id || '') === String(walletId || '')) || null;
}

export function personalAccountCardFields({ person = null, title = '', balance = 0, debt = 0 } = {}) {
  const resolvedBalance = Math.max(0, Number(balance) || 0);
  const resolvedDebt = Math.max(0, Number(debt) || 0);
  return loyaltyCardFields({
    title: title || personLabel(person || {}),
    subtitle: 'Личный счёт',
    status: resolvedDebt > 0.009 ? 'Есть задолженность' : resolvedBalance > 0.009 ? 'Есть остаток' : 'Нулевой остаток',
  }).filter((field) => field.value !== 'metaLeft' && field.value !== 'metaRight').concat([
    { value: 'amountLabel', label: 'Какой показатель на карте', text: resolvedDebt > 0.009 ? 'Задолженность' : 'Денежный остаток' },
    { value: 'currentAmount', label: 'Остаток или долг (автоматически)', text: money(resolvedDebt > 0.009 ? resolvedDebt : resolvedBalance) },
    { value: 'balance', label: 'Денежный остаток', text: money(resolvedBalance) },
    { value: 'debt', label: 'Задолженность', text: money(resolvedDebt) },
  ]);
}

export function personalAccountVisualCard({
  person = null,
  title = '',
  balance = 0,
  debt = 0,
  data = '',
  aria = '',
  interactive = true,
} = {}) {
  return loyaltyVisualCard('personal-account', personalAccountCardFields({ person, title, balance, debt }), {
    data,
    aria,
    interactive,
  });
}

function movementHistory(account = {}) {
  return Array.isArray(account?.movements) ? account.movements : [];
}

function historyRail(account = {}) {
  const items = movementHistory(account);
  if (!items.length) return emptyState('Истории пока нет', 'Движения появятся после использования Личного счёта.');
  return miniCardRail(items.map((item, index) => {
    const incoming = String(item?.direction || '').toUpperCase() === 'IN';
    return miniCard({
      title: movementTitle(item),
      value: `${incoming ? '+' : '−'}${money(item?.amount)}`,
      subtitle: shortDateTime(item?.occurredAt, '—'),
      rows: [
        { label: 'Источник', value: movementSource(item) },
        { label: 'Остаток', value: money(item?.balanceAfter) },
      ],
      interactive: true,
      data: `data-personal-account-history-entry="${index}"`,
      aria: `Открыть ${movementTitle(item).toLowerCase()}`,
    });
  }));
}

function settlementRows(item = {}) {
  const data = item?.data && typeof item.data === 'object' ? item.data : {};
  const settlement = data?.settlement && typeof data.settlement === 'object' ? data.settlement : null;
  const items = Array.isArray(settlement?.items) ? settlement.items : [];
  return items.map((entry) => ({
    label: String(entry?.name || (String(entry?.sourceType || '') === 'product' ? 'Товар' : 'Услуга')),
    value: money(entry?.planAmount ?? entry?.correctedPrice ?? entry?.price),
  }));
}

function movementEventMarkup(item = {}) {
  const incoming = String(item?.direction || '').toUpperCase() === 'IN';
  const data = item?.data && typeof item.data === 'object' ? item.data : {};
  const rows = [{ label: 'Дата', value: shortDateTime(item?.occurredAt, '—') }];
  const settlement = settlementRows(item);
  if (String(item?.kind || '') === 'payment' && settlement.length) {
    rows.push(...settlement);
    rows.push({ label: 'Итого', value: `−${money(item?.amount)}` });
  } else {
    rows.push({ label: 'Сумма', value: `${incoming ? '+' : '−'}${money(item?.amount)}` });
    const wallet = String(item?.walletName || data?.walletName || '').trim();
    if (wallet) rows.push({ label: 'Кошелёк', value: wallet });
    const source = movementSource(item);
    if (source && source !== 'Операция') rows.push({ label: 'Источник', value: source });
  }
  rows.push({ label: 'Остаток', value: money(item?.balanceAfter) });
  rows.push({ label: 'Дата формирования', value: shortDateTime(item?.recordedAt || item?.createdAt || item?.occurredAt, '—') });
  return readOnlyReceipt({ groups: [rows] });
}

function openMovementEventS(root, item = {}) {
  return mountModal(root, modal(movementEventMarkup(item), {
    variant: 's',
    surface: 'app',
    title: movementTitle(item),
  }));
}

function outstandingDebts(account = {}) {
  return (Array.isArray(account?.debts) ? account.debts : []).filter(item => Number(item?.outstandingAmount || 0) > 0.009);
}

function debtList(items = []) {
  return v2ListEntries(items.map((item) => {
    const outstanding = Math.max(0, Number(item?.outstandingAmount || 0));
    return v2ListEntry({
      title: outstanding > 0.009 ? 'Задолженность' : 'Погашено',
      subtitle: shortDateTime(item?.occurredAt, '—'),
      rightTop: money(outstanding),
      rightBottom: outstanding > 0.009 ? 'Открыта' : 'Закрыта',
      interactive: outstanding > 0.009,
      data: outstanding > 0.009 ? `data-personal-account-debt="${escapeHtml(String(item?.id || ''))}"` : '',
      aria: outstanding > 0.009 ? 'Погасить задолженность' : 'Погашенная задолженность',
    });
  }));
}

function accountInfo(person = {}, account = {}) {
  return readOnlyReceipt({ groups: [[
    { label: 'Контакт', value: personLabel(person) },
    { label: 'Денежный остаток', value: money(account?.balance) },
    { label: 'Задолженность', value: money(account?.debtTotal) },
    { label: 'Лимит оплаты', value: `${Math.max(0, Math.min(100, Number(account?.spendLimitPercent ?? 100) || 0))}%` },
    { label: 'Показать', value: account?.visibleToEndUser === false ? 'Нет' : 'Да' },
  ]] });
}

function openSettingsX(root, person, account, onSaved, { desktop = false } = {}) {
  const layer = mountModal(root, modal(`<form class="form-grid" data-personal-account-settings-form>
    ${field({ label: 'Лимит оплаты, %', name: 'spendLimitPercent', type: 'number', min: '0', max: '100', step: '1', inputmode: 'decimal', value: account?.spendLimitPercent ?? 100, required: true })}
    ${button('Сохранить', { type: 'submit' })}
    <div class="form-error" data-personal-account-settings-error></div>
  </form>`, { title: desktop ? 'Лимит оплаты' : 'Настройки Личного счёта', variant: 'x', surface: 'app' }));
  const form = layer?.querySelector?.('[data-personal-account-settings-form]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorNode = layer.querySelector('[data-personal-account-settings-error]');
    const validationError = formValidationMessage(form);
    if (validationError) {
      if (errorNode) errorNode.textContent = validationError;
      return;
    }
    const values = formObject(form);
    try {
      const saved = await updatePersonalAccountSettings(personKey(person), {
        spendLimitPercent: Number(values.spendLimitPercent),
        visibleToEndUser: account?.visibleToEndUser !== false,
      });
      layer.v2Close?.();
      await onSaved?.(saved);
    } catch (error) {
      if (errorNode) errorNode.textContent = error instanceof Error ? error.message : 'Не удалось сохранить настройки';
    }
  });
  return layer;
}

function openMoneyX(root, person, account, mode, onSaved, { desktop = false } = {}) {
  const funding = mode === 'fund';
  const title = funding ? 'Пополнить Личный счёт' : desktop ? 'Возврат' : 'Вернуть деньги';
  const layer = mountModal(root, modal(`<form class="form-grid" data-personal-account-money-form>
    ${field({ label: 'Сумма', name: 'amount', type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal', value: '', required: true })}
    ${select({ label: funding ? 'Кошелёк приёма денег' : 'Кошелёк возврата', name: 'walletId', value: '', options: walletOptions() })}
    ${datePicker({ label: 'Дата операции', name: 'occurredAt', value: new Date().toISOString().slice(0, 10), showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false })}
    ${field({ label: funding ? 'Комментарий' : 'Причина', name: funding ? 'note' : 'reason', value: '' })}
    ${button(funding ? 'Пополнить' : desktop ? 'Возврат' : 'Вернуть', { type: 'submit' })}
    <div class="form-error" data-personal-account-money-error></div>
  </form>`, { title, variant: 'x', surface: 'app' }));
  if (!layer) return null;
  initDatePickers(layer);
  const form = layer.querySelector('[data-personal-account-money-form]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorNode = layer.querySelector('[data-personal-account-money-error]');
    const validationError = formValidationMessage(form);
    if (validationError) {
      if (errorNode) errorNode.textContent = validationError;
      return;
    }
    const values = formObject(form);
    const wallet = selectedWallet(values.walletId);
    const amount = Math.max(0, Number(String(values.amount || '0').replace(',', '.')) || 0);
    if (!wallet || amount <= 0) {
      if (errorNode) errorNode.textContent = 'Укажите сумму и кошелёк';
      return;
    }
    if (!funding && amount > Number(account?.balance || 0) + 0.009) {
      if (errorNode) errorNode.textContent = 'Сумма возврата превышает остаток Личного счёта';
      return;
    }
    try {
      const saved = funding
        ? await fundPersonalAccount(personKey(person), { amount, walletId: wallet.id, walletName: wallet.name, note: values.note, occurredAt: values.occurredAt })
        : await withdrawPersonalAccount(personKey(person), { amount, walletId: wallet.id, walletName: wallet.name, reason: values.reason, occurredAt: values.occurredAt });
      layer.v2Close?.();
      await onSaved?.(saved);
    } catch (error) {
      if (errorNode) errorNode.textContent = error instanceof Error ? error.message : 'Не удалось выполнить операцию';
    }
  });
  return layer;
}

function openDebtSettleX(root, debt, onSaved) {
  const outstanding = Math.max(0, Number(debt?.outstandingAmount || 0));
  const layer = mountModal(root, modal(`<form class="form-grid" data-personal-account-debt-form>
    ${field({ label: 'Задолженность', name: 'debtAmount', value: money(outstanding), disabled: true })}
    ${field({ label: 'Сумма оплаты', name: 'amount', type: 'number', min: '0.01', max: String(outstanding), step: '0.01', inputmode: 'decimal', value: outstanding, required: true })}
    ${select({ label: 'Кошелёк', name: 'walletId', value: '', options: walletOptions() })}
    ${datePicker({ label: 'Дата оплаты', name: 'occurredAt', value: new Date().toISOString().slice(0, 10), showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false })}
    ${button('Погасить', { type: 'submit' })}
    <div class="form-error" data-personal-account-debt-error></div>
  </form>`, { title: 'Погасить задолженность', variant: 'x', surface: 'app' }));
  if (!layer) return null;
  initDatePickers(layer);
  const form = layer.querySelector('[data-personal-account-debt-form]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorNode = layer.querySelector('[data-personal-account-debt-error]');
    const validationError = formValidationMessage(form);
    if (validationError) {
      if (errorNode) errorNode.textContent = validationError;
      return;
    }
    const values = formObject(form);
    const wallet = selectedWallet(values.walletId);
    const amount = Math.max(0, Number(String(values.amount || '0').replace(',', '.')) || 0);
    if (!wallet || amount <= 0 || amount > outstanding + 0.009) {
      if (errorNode) errorNode.textContent = 'Укажите корректную сумму и кошелёк';
      return;
    }
    try {
      const saved = await settlePersonalAccountDebt(debt?.id, {
        amount,
        walletId: wallet.id,
        walletName: wallet.name,
        occurredAt: values.occurredAt,
      });
      layer.v2Close?.();
      await onSaved?.(saved);
    } catch (error) {
      if (errorNode) errorNode.textContent = error instanceof Error ? error.message : 'Не удалось погасить задолженность';
    }
  });
  return layer;
}

function bindAccountVisibility(control, person, onSaved = () => {}) {
  control?.addEventListener('change', async () => {
    const requested = Boolean(control.checked);
    control.disabled = true;
    let saved;
    try {
      // Partial settings update: do not overwrite the existing payment limit.
      saved = await updatePersonalAccountSettings(personKey(person), { visibleToEndUser: requested });
      if (!saved?.personKey) throw new Error('Сохранение видимости не подтверждено');
      if (control.isConnected) control.checked = saved.visibleToEndUser !== false;
    } catch (error) {
      if (control.isConnected) control.checked = !requested;
      openNotice({ title: 'Показать карту', message: error instanceof Error ? error.message : 'Не удалось сохранить видимость.' });
      return;
    } finally {
      if (control.isConnected) control.disabled = false;
    }
    try { await onSaved(saved); }
    catch { openNotice({ title: 'Настройки сохранены', message: 'Не удалось обновить данные. Откройте счёт заново.' }); }
  });
}

function bindDesktopAccountTools(layer, person, account, refresh) {
  const header = layer.querySelector('[data-v2-q-header-content]');
  if (!header) return;
  header.closest('.v2-layer--standard')?.classList.add('desktop-q-fixed-tools');
  header.innerHTML = `<div class="desktop-q-heading"><h2 class="v2-q-title">${escapeHtml(personLabel(person))}</h2></div>
    <div class="desktop-q-toolbar" data-personal-account-desktop-tools data-v2-layer-gesture-ignore>
      ${compactCheck({ label: 'Показать', checked: account?.visibleToEndUser !== false, data: 'data-personal-account-q-visible', aria: 'Показать карту клиенту' })}
      ${compactButton({ kind: 'settings', className: 'desktop-q-action-slot', data: 'data-personal-account-limit title="Лимит оплаты"', aria: 'Лимит оплаты' })}
      ${button('Пополнить', { className: 'desktop-q-action-slot', data: 'data-personal-account-fund' })}
    </div>`;
  bindAccountVisibility(header.querySelector('[data-personal-account-q-visible]'), person, refresh);
  header.querySelector('[data-personal-account-fund]')?.addEventListener('click', () => openMoneyX(layer, person, account, 'fund', refresh, { desktop: true }));
  header.querySelector('[data-personal-account-limit]')?.addEventListener('click', () => openSettingsX(layer, person, account, refresh, { desktop: true }));
}

function renderDetail(layer, root, person, account, onChanged = () => {}) {
  const host = layer.querySelector('[data-personal-account-q-host]') || layer;
  const desktop = isV2DesktopWorkspace(layer.closest('[data-v2-app]'));
  const header = layer.querySelector('[data-v2-q-header-content]');
  if (!desktop && header?.querySelector('.desktop-q-toolbar')) {
    header.innerHTML = `<h2 class="v2-q-title">${escapeHtml(personLabel(person))}</h2>`;
    header.closest('.v2-layer--standard')?.classList.remove('desktop-q-fixed-tools');
  }
  const debts = outstandingDebts(account);
  host.innerHTML = page([
    loyaltyHeader(personLabel(person), { settings: !desktop, settingsData: 'data-personal-account-actions' }),
    personalAccountVisualCard({
      person, balance: account?.balance, debt: account?.debtTotal,
      data: 'data-personal-account-summary', aria: 'Информация о личном счёте',
    }),
    debts.length ? v2Section('Задолженности', debtList(debts)) : '',
    v2Section('История', historyRail(account || {})),
    desktop && Number(account?.balance || 0) > 0.009 ? actionBlock(button('Возврат', {
      variant: 'danger', data: 'data-personal-account-withdraw data-ui-keyboard-action="auxiliary"',
    })) : '',
  ]);
  const refresh = async (saved = null) => {
    const next = saved?.personKey ? saved : await loadPersonalAccount(personKey(person));
    renderDetail(layer, root, person, next || {}, onChanged);
    await onChanged();
  };
  host.querySelector('[data-personal-account-summary]')?.addEventListener('click', () => {
    mountModal(layer, modal(accountInfo(person, account), { variant: 's', surface: 'app', title: 'Личный счёт' }));
  });
  if (desktop) {
    bindDesktopAccountTools(layer, person, account, refresh);
    host.querySelector('[data-personal-account-withdraw]')?.addEventListener('click', () => openMoneyX(layer, person, account, 'withdraw', refresh, { desktop: true }));
  } else host.querySelector('[data-personal-account-actions]')?.addEventListener('click', () => {
    const actions = [
      { id: 'fund', label: 'Пополнить', onSelect: () => openMoneyX(root, person, account, 'fund', refresh) },
      { id: 'withdraw', label: 'Вернуть деньги', onSelect: () => openMoneyX(root, person, account, 'withdraw', refresh) },
      { id: 'settings', label: 'Настройки', onSelect: () => openSettingsX(root, person, account, refresh) },
    ];
    openLoyaltySettingsMenu({
      title: 'Личный счёт',
      checked: account?.visibleToEndUser !== false,
      onToggle: async (value) => {
        const saved = await updatePersonalAccountSettings(personKey(person), {
          spendLimitPercent: account?.spendLimitPercent ?? 100,
          visibleToEndUser: value,
        });
        await refresh(saved);
        return saved?.visibleToEndUser !== false;
      },
      actions,
    });
  });
  host.querySelectorAll('[data-personal-account-debt]').forEach((node) => {
    node.addEventListener('click', () => {
      const debt = (Array.isArray(account?.debts) ? account.debts : []).find((item) => String(item?.id || '') === String(node.dataset.personalAccountDebt || ''));
      if (debt) openDebtSettleX(root, debt, refresh);
    });
  });
  const movements = movementHistory(account);
  host.querySelectorAll('[data-personal-account-history-entry]').forEach((node) => {
    node.addEventListener('click', () => {
      const item = movements[Number(node.dataset.personalAccountHistoryEntry)];
      if (item) openMovementEventS(layer, item);
    });
  });
  notifyLoyaltyContext();
}

export async function openPersonalAccountForPerson(root, person = {}, snapshot = null, onChanged = () => {}) {
  const layer = mountModal(root, modal('<div data-personal-account-q-host></div>', {
    variant: 'q',
    surface: 'app',
    title: personLabel(person),
    className: 'loyalty-personal-account-q',
  }));
  if (!layer) return null;
  const account = snapshot || await loadPersonalAccount(personKey(person));
  if (layer.isConnected) renderDetail(layer, root, person, account || {}, onChanged);
  return layer;
}


export function getPersonLoyaltyCards(person = {}, { refresh = true } = {}) {
  const key = personKey(person);
  const account = key ? getCachedPersonalAccount(key) : null;
  return {
    cards: account ? [{
      key: 'personal-account',
      markup: personalAccountVisualCard({
        person, balance: account.balance || 0, debt: account.debtTotal || 0,
        data: 'data-person-program="personal-account"',
        aria: 'Открыть Личный счёт',
      }),
      detail: {
        title: 'Личный счёт',
        open: (root, currentPerson) => openPersonalAccountForPerson(root, currentPerson),
      },
    }] : [],
    refreshPromise: refresh && key ? loadPersonalAccount(key) : null,
  };
}
export async function renderPersonalAccount(root) {
  const people = availablePeople([]);
  let accounts = [];
  try {
    accounts = await loadPersonalAccounts();
  } catch (error) {
    root.innerHTML = page([
      loyaltyHeader('Личный счёт', { settings: true }),
      emptyState('Не удалось загрузить Личные счета', String(error?.message || 'Повторите попытку.')),
    ]);
    notifyLoyaltyContext();
    return;
  }

  if (!root.isConnected) return;
  const desktop = isV2DesktopWorkspace(root.closest('[data-v2-app]'));
  const values = accounts
    .filter(account => desktop
      ? account.hasActivity === true || Boolean(account.movements?.length || account.debts?.length) || Number(account.balance || 0) > 0.009 || Number(account.debtTotal || 0) > 0.009
      : Number(account?.balance || 0) > 0.009 || Number(account?.debtTotal || 0) > 0.009)
    .map((account) => ({ account, person: accountPerson(account, people) }));
  if (desktop) {
    const rows = values.map(({ account, person }) => {
      const display = personDisplay(person);
      return { id: personKey(person), code: display.uei, name: display.name, phone: display.phone, balance: money(account.balance), debt: money(account.debtTotal), visible: account.visibleToEndUser !== false };
    }).sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
    const table = rows.length ? dataTable({
      compact: true, caption: 'Личные счета',
      columns: [
        { key: 'code', label: 'Код', sortable: false },
        { key: 'name', label: 'Клиент', sortable: false, render: row => '<button type="button" data-personal-account-person="' + escapeHtml(row.id) + '"><span class="people-table-person"><span class="people-table-person__name">' + escapeHtml(row.name) + '</span>' + (row.phone ? '<span class="people-table-person__phone">' + escapeHtml(row.phone) + '</span>' : '') + '</span></button>' },
        { key: 'balance', label: 'Остаток', sortable: false },
        { key: 'debt', label: 'Задолженность', sortable: false },
        { key: 'visible', label: 'Показать', sortable: false, narrow: true, render: row => compactCheck({
          checked: row.visible, data: `data-personal-account-row-visible="${escapeHtml(row.id)}"`, aria: `Показать карту клиенту ${row.name}`,
        }) },
      ], rows,
    }) : emptyState('Личных счетов с движениями пока нет', 'Здесь появятся клиенты после операций по личному счёту.');
    root.innerHTML = page([loyaltyHeader('Личный счёт'), `<div data-personal-account-list-host>${table}</div>`]);
    const [toolbar] = setV2ZHeaderRows(root, ['<div class="v2-desktop-tool-row"><div class="v2-desktop-tool-actions">' + button('Вид', { variant: 'secondary', data: 'data-personal-account-view' }) + '</div></div>'], { desktopTitle: 'Личный счёт' });
    toolbar?.querySelector('[data-personal-account-view]')?.addEventListener('click', () => {
      const first = values[0];
      openLoyaltyAppearanceQ(root, { type: 'personal-account', fields: () => personalAccountCardFields({ person: first?.person || people[0] || {}, balance: first?.account?.balance || 0, debt: first?.account?.debtTotal || 0 }), onSaved: () => renderPersonalAccount(root) });
    });
    root.querySelectorAll('[data-personal-account-row-visible]').forEach(control => {
      const item = values.find(({ person }) => personKey(person) === control.dataset.personalAccountRowVisible);
      if (item) bindAccountVisibility(control, item.person, saved => { item.account = saved; });
    });
    let openingAccount = false;
    root.querySelectorAll('[data-personal-account-person]').forEach(node => {
      const row = node.closest('tr');
      const open = async () => {
        if (openingAccount) return;
        const item = values.find(({ person }) => personKey(person) === node.dataset.personalAccountPerson);
        if (!item) return;
        openingAccount = true;
        try {
          const detail = await openPersonalAccountForPerson(root, item.person, item.account, () => renderPersonalAccount(root));
          if (!detail) openNotice({ title: 'Личный счёт', message: 'Не удалось открыть Личный счёт.' });
        } catch (error) {
          openNotice({ title: 'Личный счёт', message: error instanceof Error ? error.message : 'Не удалось открыть Личный счёт.' });
        } finally { openingAccount = false; }
      };
      if (row) {
        row.dataset.personalAccountOpenRow = node.dataset.personalAccountPerson;
        row.addEventListener('click', event => {
          if (event.target.closest('[data-table-column="visible"]')) return;
          void open();
        });
      } else node.addEventListener('click', open);
    });
    notifyLoyaltyContext();
    return;
  }
  const cards = values.length
    ? entityCardStack(values.map(({ account, person }) => personalAccountVisualCard({
        person,
        balance: account.balance,
        debt: account.debtTotal,
        data: `data-personal-account-person="${personKey(person)}"`,
        aria: `Открыть Личный счёт ${personLabel(person)}`,
      })))
    : emptyState('Активных Личных счетов пока нет', 'Здесь появятся контакты с денежным остатком или задолженностью.');

  root.innerHTML = page([
    loyaltyHeader('Личный счёт', { settings: true }),
    cards,
  ]);

  bindViewSettings(root, 'Личный счёт', {
    type: 'personal-account',
    fields: () => {
      const first = values[0];
      return personalAccountCardFields({
        person: first?.person || people[0] || {},
        balance: first?.account?.balance || 0,
        debt: first?.account?.debtTotal || 0,
      });
    },
    onSaved: () => renderPersonalAccount(root),
  });
  root.querySelectorAll('[data-personal-account-person]').forEach((node) => {
    node.addEventListener('click', () => {
      const item = values.find(({ person }) => personKey(person) === String(node.dataset.personalAccountPerson || ''));
      if (item) openPersonalAccountForPerson(root, item.person, item.account);
    });
  });
  notifyLoyaltyContext();
}

export { renderPersonalAccount as render };
