import {
  actionBlock,
  button,
  datePicker,
  field,
  formValidationMessage,
  initDatePickers,
  modal,
  mountModal,
  openNotice,
  searchableSelect,
  select,
  textareaField,
  workspaceHeaderContext,
} from '../../../ui/ui.js';
import { financeQSubmit, financeZSave } from '../desktop.js';
import { canUseCapability } from '../../access.js';
import { desktopAvailableArticles, desktopArticleGroups, desktopArticleValues, isLoyaltyCashArticle } from './classification.js';
import { getFinanceArticles, getFinanceArticleCatalog } from '../data.js';
import { registeredRoute, registeredArticle } from './article-view.js';
import { getWallets } from '../cash/data.js';
import { financeLocalDateValue, financeOccurredAtForDate } from '../date.js';
import { getLedgerEntries } from '../read.js';
import { correctFinanceOperation, recordManualFinanceOperation } from '../service.js';

function articleOptions(direction,desktopArticles=false,preserveId='') {
  const all=getFinanceArticles(),canonical=getFinanceArticleCatalog();
  const visible=desktopArticles?desktopAvailableArticles(all,canUseCapability):all;
  if(preserveId&&!visible.some(item=>item.articleId===preserveId)){const prior=all.find(item=>item.articleId===preserveId);if(prior)visible.push(prior);}
  const groups=desktopArticles?desktopArticleGroups(visible):visible;
  if(preserveId&&!groups.some(a=>a.articleId===preserveId)){const prior=all.find(a=>a.articleId===preserveId);if(prior)groups.push(prior);}
  return groups
    .filter((item) => item.direction === direction && item.economicType !== 'GROUP' && (!isLoyaltyCashArticle(item)||item.articleId===preserveId))
    .flatMap(item=>{
      if(!Array.isArray(canonical))return [{value:item.articleId,label:item.name}];
      const a=item.systemKey?registeredRoute(canonical,item.systemKey):registeredArticle(canonical,{articleId:item.articleId});
      if(!a)return item.articleId===preserveId?[{value:item.articleId,label:item.name}]:[];
      return [{value:item.articleId,label:[a.articleName,a.valueName].filter(Boolean).join(' · ')}];
    });
}

function walletOptions() {
  return getWallets().map((item) => ({ value: item.id, label: item.name }));
}

function manualLineOptions(direction, articleId = null) {
  if(articleId!==null)return desktopArticleValues(getFinanceArticles(),articleId).map(a=>({value:a.name,label:a.name}));
  const kind = direction === 'IN' ? 'manual-income' : 'manual-expense';
  return [...new Set(getLedgerEntries()
    .filter((item) => item?.operationKind === kind)
    .map((item) => String(item?.lineName || '').trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ru'))
    .map((value) => ({ value, label: value }));
}

function detailRow(values = {}, direction = 'IN', articleId = null) {
  return `<div class="array-row" data-finance-manual-line>
    ${searchableSelect({
      label: 'Позиция',
      name: 'lineName',
      value: values.name ?? values.lineName ?? '',
      options: manualLineOptions(direction,articleId),
      placeholder: 'Введите или выберите',
    })}
    ${field({
      label: 'Количество',
      name: 'lineQuantity',
      type: 'number',
      inputmode: 'decimal',
      value: values.quantity ?? 1,
      data: 'min="0" step="0.01"',
    })}
    ${field({
      label: 'Цена',
      name: 'linePrice',
      type: 'number',
      inputmode: 'decimal',
      value: values.unitPrice ?? '',
      placeholder: '0',
      data: 'min="0" step="0.01"',
    })}
    <button type="button" class="remove-button" data-finance-manual-line-remove aria-label="Удалить строку">×</button>
  </div>`;
}

function modeMarkup(mode, { amount = '', lines = [], direction = 'IN', articleId = null } = {}) {
  if (mode === 'detail') {
    const rows = (Array.isArray(lines) && lines.length ? lines : [{}])
      .map((item) => detailRow(item, direction,articleId))
      .join('');
    return `<div class="array-group" data-finance-manual-detail>
      <span class="array-label">Позиции</span>
      <div data-finance-manual-lines>${rows}</div>
      ${button('+ Добавить позицию', { type: 'button', variant: 'secondary', data: 'data-finance-manual-line-add' })}
    </div>`;
  }
  return field({
    label: 'Сумма',
    name: 'amount',
    type: 'number',
    inputmode: 'decimal',
    value: amount,
    required: true,
    placeholder: '0',
    data: 'min="0" step="0.01"',
  });
}

function syncMode(root, direction,articleId=null) {
  const mode = String(root.querySelector('input[name="entryMode"]')?.value || 'simple');
  const host = root.querySelector('[data-finance-manual-mode]');
  if (!host) return;
  host.innerHTML = modeMarkup(mode, { direction,articleId });
}

function collectLines(root, articleId='') {
  const values=Array.isArray(getFinanceArticleCatalog())?desktopArticleValues(getFinanceArticles(),articleId):[];
  return [...root.querySelectorAll('[data-finance-manual-line]')].map((row) => ({
    name: String(row.querySelector('[name="lineName"]')?.value || '').trim(),
    quantity: Number(row.querySelector('[name="lineQuantity"]')?.value || 0),
    unitPrice: Number(row.querySelector('[name="linePrice"]')?.value || 0),
  })).filter((row) => row.name && row.quantity > 0 && row.unitPrice > 0).map(row=>{
    const matches=values.filter(v=>v.name===row.name);
    return matches.length===1?{...row,articleId:matches[0].articleId}:row;
  });
}

async function saveManual(root, direction, onSaved, operation = null) {
  const form = root.querySelector('[data-finance-manual-form]');
  if (!form) return;
  const validation = formValidationMessage(form);
  if (validation) {
    openNotice({ message: validation });
    return;
  }
  const data = new FormData(form);
  const mode = String(data.get('entryMode') || 'simple');
  const walletId = String(data.get('walletId') || '');
  const wallet = getWallets().find((item) => item.id === walletId);
  const occurredAt = financeOccurredAtForDate(
    String(data.get('occurredDate') || ''),
    operation?.occurredAt || new Date(),
  );
  const payload = {
    direction,
    articleId: String(data.get('articleId') || ''),
    walletId,
    walletName: wallet?.name || '',
    amount: mode === 'simple' ? Number(data.get('amount') || 0) : null,
    lines: mode === 'detail' ? collectLines(root,String(data.get('articleId')||'')) : [],
    note: String(data.get('note') || '').trim(),
    occurredAt,
  };
  if (!payload.occurredAt) {
    openNotice({ message: 'Укажите фактическую дату операции.' });
    return;
  }
  if (mode === 'detail' && !payload.lines.length) {
    openNotice({ message: 'Добавьте хотя бы одну позицию с названием, количеством и ценой.' });
    return;
  }
  try {
    if (operation?.operationId) await correctFinanceOperation(operation.operationId, payload);
    else await recordManualFinanceOperation(payload);
    onSaved?.();
  } catch (error) {
    openNotice({ message: String(error?.message || 'Не удалось сохранить операцию') });
  }
}

function manualOperationTitle(direction, operation) {
  const title = direction === 'IN' ? 'Доход' : 'Расход';
  return operation ? 'Корректировка · ' + title : title;
}

export function openIncomeExpenseQ(root, direction, { onSaved = null, operation = null } = {}) {
  const layer = mountModal(root, modal('', {
    title: manualOperationTitle(direction, operation), variant: 'q', surface: 'app',
  }));
  if (!layer) return null;
  const rendered = renderIncomeExpenseOperation(layer, direction, {
    operation, desktopArticles:true, onSaved: () => { layer.v2Close?.(); onSaved?.(); },
  });
  if (!rendered) { layer.v2Close?.(); return null; }
  return layer;
}

export function renderIncomeExpenseOperation(root, direction, { onSaved = null, operation = null, desktopArticles = true } = {}) {
  const isIncome = direction === 'IN';
  const original=operation?.data||{};
  const articles=articleOptions(direction,desktopArticles,String(original.articleId||original.lines?.[0]?.articleId||''));
  const wallets = walletOptions();
  if (!articles.length) {
    openNotice({ message: 'Сначала добавьте конечную статью для этого типа операции.' });
    return false;
  }
  if (!wallets.length) {
    openNotice({ message: 'Сначала добавьте кошелёк.' });
    return false;
  }

  const existing = operation?.data && typeof operation.data === 'object' ? operation.data : {};
  const lines = Array.isArray(existing.lines) ? existing.lines : [];
  const detailed = lines.length > 1 || Boolean(String(lines[0]?.lineName || '').trim());
  const mode = detailed ? 'detail' : 'simple';
  const articleId = String(existing.articleId || lines[0]?.articleId || articles[0]?.value || '');
  const walletId = String(existing.walletId || wallets[0]?.value || '');
  const simpleAmount = Number(existing.total || lines[0]?.total || lines[0]?.unitPrice || 0) || '';

  const qBody = root.querySelector('[data-v2-q-body]');
  const title = manualOperationTitle(direction, operation);
  (qBody || root).innerHTML = `${qBody ? '' : workspaceHeaderContext({ title })}
    <form class="compact-form" data-finance-manual-form novalidate>
      ${select({ label: 'Статья', name: 'articleId', value: articleId, options: articles, searchable: true })}
      ${select({ label: 'Кошелёк', name: 'walletId', value: walletId, options: wallets })}
      ${select({ label: 'Ввод', name: 'entryMode', value: mode, options: [{ value: 'simple', label: 'Сумма' }, { value: 'detail', label: 'Детально' }] })}
      ${datePicker({ label: 'Фактическая дата', name: 'occurredDate', value: financeLocalDateValue(operation?.occurredAt || new Date()), required: true, allowClear: false })}
      <div data-finance-manual-mode>${modeMarkup(mode, { amount: simpleAmount, lines, direction,articleId:desktopArticles?articleId:null })}</div>
      ${textareaField({ label: 'Примечание', name: 'note', value: existing.note || '', rows: 3, placeholder: 'Необязательно' })}
      ${qBody ? button('Сохранить', { type: 'submit', data: 'data-finance-manual-save', aria: isIncome ? 'Сохранить доход' : 'Сохранить расход' }) : ''}
    </form>
    ${qBody ? '' : actionBlock(button('Сохранить', {
      data: 'data-finance-manual-save',
      aria: isIncome ? 'Сохранить доход' : 'Сохранить расход',
    }))}`;

  initDatePickers(root);

  const selectedArticle=()=>desktopArticles?String(root.querySelector('[name="articleId"]')?.value||''):null;
  root.addEventListener('change', (event) => {
    if (event.target?.matches?.('input[name="entryMode"]')) syncMode(root,direction,selectedArticle());
    if(desktopArticles&&event.target?.matches?.('[name="articleId"]')){
      // Only refresh available choices. Preserve typed names, quantities and prices.
      for(const row of root.querySelectorAll('[data-finance-manual-line]')){
        const input=row.querySelector('[name="lineName"]'),selectHost=input?.closest('.ui-select');
        if(!selectHost)continue;
        selectHost.outerHTML=searchableSelect({label:'Позиция',name:'lineName',value:input.value,options:manualLineOptions(direction,selectedArticle()),placeholder:'Введите или выберите'});
      }
    }
  });
  root.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-finance-manual-line-add]')) {
      root.querySelector('[data-finance-manual-lines]')?.insertAdjacentHTML('beforeend', detailRow({}, direction,selectedArticle()));
      return;
    }
    const remove = event.target.closest?.('[data-finance-manual-line-remove]');
    if (remove) {
      const rows = root.querySelectorAll('[data-finance-manual-line]');
      if (rows.length > 1) remove.closest('[data-finance-manual-line]')?.remove();
    }
  });
  root.querySelector('[data-finance-manual-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveManual(root, direction, onSaved, operation);
  });
  if (qBody) {
    financeQSubmit(root, root.querySelector('[data-finance-manual-form]'));
  } else {
    root.querySelector('[data-finance-manual-save]')?.addEventListener('click', () => {
      root.querySelector('[data-finance-manual-form]')?.requestSubmit();
    });
    financeZSave(root, '[data-finance-manual-save]', title);
  }
  return true;
}
