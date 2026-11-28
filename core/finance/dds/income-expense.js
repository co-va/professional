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
import { desktopAvailableArticles } from './classification.js';
import { getFinanceArticles, getFinanceArticleCatalog } from '../data.js';
import { manualArticleChoices, manualArticleSelection, manualRawArticle, manualDetailTotal, validManualLine } from './manual-entry-model.js';
import { getWallets } from '../cash/data.js';
import { financeLocalDateValue, financeOccurredAtForDate } from '../date.js';
import { getLedgerEntries } from '../read.js';
import { correctFinanceOperation, recordManualFinanceOperation } from '../service.js';

function articleOptions(direction,desktopArticles=false,preserveId='') {
  const all=getFinanceArticles(),canonical=getFinanceArticleCatalog();
  const visible=desktopArticles?desktopAvailableArticles(all,canUseCapability):all;
  return manualArticleChoices(all,canonical,direction,{preserveId,allowedIds:visible.map(a=>a.articleId)});
}
function valueMarkup(articles,articleId,valueId='') {
  const article=articles.find(a=>a.value===articleId);
  if(!article||!article.values.length)return '';
  const options=article.rawId?[{value:'',label:'Без значения'},...article.values]:article.values;
  const selected=options.some(v=>v.value===valueId)?valueId:options[0].value;
  return select({label:'Значение',name:'articleValueId',value:selected,options});
}

function walletOptions() {
  return getWallets().map((item) => ({ value: item.id, label: item.name }));
}

function manualLineOptions(direction) {
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
      options: manualLineOptions(direction),
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
  return '';
}
function walletAmountMarkup(mode,amount=''){
 return mode==='detail'
   ? '<div class="field"><span>Сумма</span><output data-finance-manual-total aria-live="polite">0 ₽</output></div>'
   : field({label:'Сумма',name:'amount',type:'number',inputmode:'decimal',value:amount,required:true,placeholder:'0',data:'min="0.01" step="0.01"'});
}
function collectLines(root) {
  return [...root.querySelectorAll('[data-finance-manual-line]')].map(row=>({
    name: String(row.querySelector('[name="lineName"]')?.value || '').trim(),
    quantity: Number(row.querySelector('[name="lineQuantity"]')?.value || 0),
    unitPrice: Number(row.querySelector('[name="linePrice"]')?.value || 0),
  }));
}
function syncTotal(root){
 const out=root.querySelector('[data-finance-manual-total]');
 if(out)out.textContent=new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(manualDetailTotal(collectLines(root)))+' ₽';
}

async function saveManual(root, direction, onSaved, operation = null, articles = []) {
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
  const articleId=manualRawArticle(articles,String(data.get('articleId')||''),String(data.get('articleValueId')||''));
  if(!articleId||!wallet){openNotice({message:'Выберите статью, доступное значение и кошелёк.'});return;}
  const payload = {
    direction,
    articleId,
    walletId,
    walletName: wallet?.name || '',
    amount: mode === 'simple' ? Number(data.get('amount') || 0) : null,
    lines: mode === 'detail' ? collectLines(root) : [],
    note: String(data.get('note') || '').trim(),
    occurredAt,
  };
  if (!payload.occurredAt) {
    openNotice({ message: 'Укажите фактическую дату операции.' });
    return;
  }
  if (mode === 'detail' && (!payload.lines.length||!payload.lines.every(validManualLine))) {
    openNotice({ message: 'Добавьте хотя бы одну позицию с названием, количеством и ценой.' });
    return;
  }
  if(mode==='simple'&&(!Number.isFinite(payload.amount)||payload.amount<=0)){openNotice({message:'Введите сумму больше нуля.'});return;}
  if(form.dataset.saving==='true')return;
  form.dataset.saving='true';
  try {
    if (operation?.operationId) await correctFinanceOperation(operation.operationId, payload);
    else await recordManualFinanceOperation(payload);
    onSaved?.();
  } catch (error) {
    openNotice({ message: String(error?.message || 'Не удалось сохранить операцию') });
  } finally { form.dataset.saving='false'; }
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
    openNotice({ message: 'Нет доступных статей для этого типа операции. Проверьте загрузку справочника статей.' });
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
  const savedIds=new Set(lines.map(l=>String(l.articleId||existing.articleId||'')).filter(Boolean));
  if(operation&&savedIds.size>1){openNotice({message:'В исходной операции несколько статей или значений. Корректировка такой операции требует отдельной поддержки Core.'});return false;}
  const rawId=String(lines[0]?.articleId||existing.articleId||'');
  const prior=manualArticleSelection(articles,rawId);
  if(operation&&rawId&&!prior.articleId){openNotice({message:'Исходная статья недоступна для корректировки.'});return false;}
  const articleId=prior.articleId||'';
  const walletId = String(existing.walletId || '');
  const simpleAmount = Number(existing.total || lines[0]?.total || lines[0]?.unitPrice || 0) || '';

  const qBody = root.querySelector('[data-v2-q-body]');
  const title = manualOperationTitle(direction, operation);
  (qBody || root).innerHTML = `${qBody ? '' : workspaceHeaderContext({ title })}
    <form class="compact-form" data-finance-manual-form novalidate>
      ${select({ label: 'Статья', name: 'articleId', value: articleId, options: articles, searchable: true, placeholder:'Выберите статью' })}
      <div data-finance-manual-value${articles.find(a=>a.value===articleId)?.values.length?'':' hidden'}>${valueMarkup(articles,articleId,prior.valueId)}</div>
      ${select({ label: 'Ввод', name: 'entryMode', value: mode, options: [{ value: 'simple', label: 'Сумма' }, { value: 'detail', label: 'Детально' }] })}
      ${datePicker({ label: 'Фактическая дата', name: 'occurredDate', value: financeLocalDateValue(operation?.occurredAt || new Date()), required: true, allowClear: false })}
      <div data-finance-manual-mode${mode==='simple'?' hidden':''}>${modeMarkup(mode, { lines, direction })}</div>
      ${select({ label: 'Кошелёк', name: 'walletId', value: walletId, options: wallets, placeholder:'Выберите кошелёк' })}
      <div data-finance-manual-amount>${walletAmountMarkup(mode,simpleAmount)}</div>
      ${textareaField({ label: 'Примечание', name: 'note', value: existing.note || '', rows: 3, placeholder: 'Необязательно' })}
      ${qBody ? button('Сохранить', { type: 'submit', data: 'data-finance-manual-save', aria: isIncome ? 'Сохранить доход' : 'Сохранить расход' }) : ''}
    </form>
    ${qBody ? '' : actionBlock(button('Сохранить', {
      data: 'data-finance-manual-save',
      aria: isIncome ? 'Сохранить доход' : 'Сохранить расход',
    }))}`;

  initDatePickers(root);

  const selectedArticle=()=>String(root.querySelector('[name="articleId"]')?.value||'');
  let savedLines=detailed?lines:[];
  let savedAmount=simpleAmount;
  let activeMode=mode;
  syncTotal(root);
  root.addEventListener('change', (event) => {
    if(event.target?.matches?.('[name="articleId"]')){
      const valueHost=root.querySelector('[data-finance-manual-value]');
      valueHost.innerHTML=valueMarkup(articles,selectedArticle());valueHost.hidden=!valueHost.innerHTML;
    }
    if(event.target?.matches?.('[name="entryMode"]')){
      const next=event.target.value;
      if(next===activeMode)return;
      if(activeMode==='detail')savedLines=collectLines(root);
      else savedAmount=root.querySelector('[name="amount"]')?.value||'';
      activeMode=next;
      const modeHost=root.querySelector('[data-finance-manual-mode]');
      modeHost.innerHTML=modeMarkup(next,{lines:savedLines,direction});modeHost.hidden=next==='simple';
      root.querySelector('[data-finance-manual-amount]').innerHTML=walletAmountMarkup(next,savedAmount);
      syncTotal(root);
    }
  });
  root.addEventListener('input',event=>{
    if(event.target?.closest?.('[data-finance-manual-line]'))syncTotal(root);
  });
  root.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-finance-manual-line-add]')) {
      root.querySelector('[data-finance-manual-lines]')?.insertAdjacentHTML('beforeend', detailRow({}, direction));
      syncTotal(root);
      return;
    }
    const remove = event.target.closest?.('[data-finance-manual-line-remove]');
    if (remove) {
      const rows = root.querySelectorAll('[data-finance-manual-line]');
      if (rows.length > 1) remove.closest('[data-finance-manual-line]')?.remove();
      syncTotal(root);
    }
  });
  root.querySelector('[data-finance-manual-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveManual(root, direction, onSaved, operation, articles);
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
