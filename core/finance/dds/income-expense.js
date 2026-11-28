import {
  actionBlock,
  button,
  compactButton,
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
import { availableArticleDirectory } from './article-view.js';
import { readArticleOrder, sortArticleDirectory } from './article-order.js';
import { getFinanceArticles, getFinanceArticleCatalog, readFinanceState } from '../data.js';
import { supportsFinancePrepayment, manualWalletAllocation } from '../prepayment-model.js';
import { manualArticleChoices, manualArticleSelection, manualRawArticle, manualDetailTotal, validManualLine } from './manual-entry-model.js';
import { getWallets } from '../cash/data.js';
import { financeLocalDateValue, financeOccurredAtForDate } from '../date.js';
import { getLedgerEntries } from '../read.js';
import { correctFinanceOperation, recordManualFinanceOperation } from '../service.js';

function articleOptions(direction,desktopArticles=false,preserveId='') {
  const all=getFinanceArticles(),canonical=getFinanceArticleCatalog();
  const visible=desktopArticles?desktopAvailableArticles(all,canUseCapability):all;
  const directory=availableArticleDirectory(canonical,visible,canUseCapability);
  return manualArticleChoices(all,Array.isArray(directory)?sortArticleDirectory(directory,readArticleOrder()):null,direction,{preserveId,allowedIds:visible.map(a=>a.articleId),fullCatalogue:canonical,allowEmptySystemValue:supportsFinancePrepayment(canonical)});
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

async function saveManual(root, direction, onSaved, operation = null, articles = [], newContract=false) {
  const form = root.querySelector('[data-finance-manual-form]');
  if (!form) return;
  const validation = formValidationMessage(form);
  if (validation) {
    openNotice({ message: validation });
    return;
  }
  const data = new FormData(form);
  const mode = String(data.get('entryMode') || 'simple');
  const split=form.querySelectorAll('[data-manual-wallet-row]').length>1;
  const walletId = String(split?form.querySelector('[data-manual-wallet-row] [name="splitWalletId"]')?.value||'':data.get('walletId') || '');
  const wallet = getWallets().find((item) => item.id === walletId);
  const occurredAt = financeOccurredAtForDate(
    String(data.get('occurredDate') || ''),
    operation?.occurredAt || (form.manualReference??=new Date()),
  );
  const canonicalArticleId=String(data.get('articleId')||''),articleValueId=String(data.get('articleValueId')||'');
  const articleId=manualRawArticle(articles,canonicalArticleId,articleValueId);
  const article=articles.find(a=>a.value===canonicalArticleId);
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
  if(newContract&&article?.canonical){payload.canonicalArticleId=canonicalArticleId;payload.articleValueId=articleValueId;}
  if(operation?.data?.manualSplit&&!split){openNotice({message:'Для изменения числа документов отмените исходный расчёт и оформите новый.'});return;}
  if(split||newContract&&!operation){
    const total=mode==='detail'?manualDetailTotal(payload.lines):payload.amount;
    const rows=split?readWalletRows(form):[{walletId,walletName:wallet.name,amount:total}];
    const allocations=manualWalletAllocation(rows,total);
    if(!newContract||!allocations){openNotice({message:'Выберите разные кошельки и распределите всю сумму.'});return;}
    payload.allocations=allocations;
    payload.requestId=form.manualRequestId??=crypto.randomUUID();
  }
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

function readWalletRows(root){
 return [...root.querySelectorAll('[data-manual-wallet-row]')].map(row=>{
  const walletId=String(row.querySelector('[name="splitWalletId"]')?.value||'');
  return {walletId,walletName:getWallets().find(w=>w.id===walletId)?.name||'',amount:row.querySelector('[name="splitWalletAmount"]')?.value||''};
 });
}
function walletRowsMarkup(rows,wallets){
 return rows.map((row,index)=>`<div class="array-row" data-manual-wallet-row>
   ${select({label:'Кошелёк',name:'splitWalletId',value:row.walletId,options:wallets,placeholder:'Выберите кошелёк'})}
   ${field({label:'Сумма',name:'splitWalletAmount',type:'number',inputmode:'decimal',value:row.amount??'',data:'min="0.01" step="0.01"'})}
   ${index>0?compactButton({kind:'remove',data:'data-manual-wallet-remove',aria:'Удалить кошелёк'}):''}
 </div>`).join('');
}
function walletEditorMarkup(mode,amount,walletId,rows,wallets,newContract){
 const split=rows.length>1;
 return `<div data-manual-wallet-single${split?' hidden':''}>
   ${split?'':select({label:'Кошелёк',name:'walletId',value:walletId,options:wallets,placeholder:'Выберите кошелёк'})}
 </div>
 <div data-finance-manual-amount>${walletAmountMarkup(mode,amount)}</div>
 <div data-manual-wallet-rows>${split?walletRowsMarkup(rows,wallets):''}</div>
 ${split?'<output data-manual-wallet-remainder aria-live="polite"></output>':''}
 ${newContract?button('+ Добавить кошелёк',{type:'button',variant:'secondary',data:'data-manual-wallet-add'}):''}`;
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
  const newContract=supportsFinancePrepayment(getFinanceArticleCatalog());
  const group=original.manualSplit?readFinanceState().operations.filter(o=>o.source?.type==='manual'&&o.data?.manualGroupId===original.manualGroupId&&o.kind===operation.kind):[];
  if(original.manualSplit&&(!newContract||group.length<2||group.some(o=>o.status!=='completed'))){openNotice({message:'Связанные документы недоступны для корректировки целого расчёта.'});return false;}
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
  const groupedLines=new Map();
  for(const doc of group)for(const line of doc.data?.lines||[])if(Number.isInteger(line.positionIndex))groupedLines.set(line.positionIndex,{...line,total:line.positionTotal,partial:false});
  if(group.length&&!groupedLines.size){openNotice({message:'Исходные позиции расчёта недоступны.'});return false;}
  const lines = group.length?[...groupedLines.entries()].sort((a,b)=>a[0]-b[0]).map(([,line])=>line):Array.isArray(existing.lines)?existing.lines:[];
  const detailed = lines.length > 1 || Boolean(String(lines[0]?.lineName || '').trim());
  const mode = detailed ? 'detail' : 'simple';
  const savedIds=new Set(lines.map(l=>String(l.articleId||existing.articleId||'')).filter(Boolean));
  if(operation&&savedIds.size>1){openNotice({message:'В исходной операции несколько статей или значений. Корректировка такой операции требует отдельной поддержки Core.'});return false;}
  const rawId=String(lines[0]?.articleId||existing.articleId||'');
  const prior=existing.manualArticleClass?{articleId:existing.manualArticleClass.articleId,valueId:existing.manualArticleClass.valueId||''}:manualArticleSelection(articles,rawId);
  if(operation&&rawId&&!prior.articleId){openNotice({message:'Исходная статья недоступна для корректировки.'});return false;}
  const articleId=prior.articleId||'';
  const walletId = String(existing.walletId || '');
  const simpleAmount = Number(group.length?group.reduce((n,o)=>n+Number(o.data.total||0),0):existing.total || lines[0]?.total || lines[0]?.unitPrice || 0) || '';
  const initialWalletRows=group.sort((a,b)=>Number(a.data.manualDocumentIndex)-Number(b.data.manualDocumentIndex)).map(o=>({walletId:o.data.walletId,amount:o.data.total}));
  const canSplit=newContract&&(!operation||group.length>0);

  const qBody = root.querySelector('[data-v2-q-body]');
  const title = manualOperationTitle(direction, operation);
  (qBody || root).innerHTML = `${qBody ? '' : workspaceHeaderContext({ title })}
    <form class="compact-form" data-finance-manual-form novalidate>
      ${select({ label: 'Статья', name: 'articleId', value: articleId, options: articles, placeholder:'Выберите статью' })}
      <div data-finance-manual-value${articles.find(a=>a.value===articleId)?.values.length?'':' hidden'}>${valueMarkup(articles,articleId,prior.valueId)}</div>
      ${select({ label: 'Ввод', name: 'entryMode', value: mode, options: [{ value: 'simple', label: 'Сумма' }, { value: 'detail', label: 'Детально' }] })}
      ${datePicker({ label: 'Фактическая дата', name: 'occurredDate', value: financeLocalDateValue(operation?.occurredAt || new Date()), required: true, allowClear: false })}
      <div data-finance-manual-mode${mode==='simple'?' hidden':''}>${modeMarkup(mode, { lines, direction })}</div>
      <div data-manual-wallet-editor>${walletEditorMarkup(mode,simpleAmount,walletId,initialWalletRows,wallets,canSplit)}</div>
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
  const walletHost=root.querySelector('[data-manual-wallet-editor]');
  const total=()=>activeMode==='detail'?manualDetailTotal(collectLines(root)):Number(root.querySelector('[name="amount"]')?.value||0);
  const syncWalletRemainder=(fill=false)=>{
    syncTotal(root);
    const rows=readWalletRows(root),out=root.querySelector('[data-manual-wallet-remainder]');
    if(!out)return;
    if(fill&&rows.length>1){
      const remaining=Math.round((total()-rows.slice(0,-1).reduce((n,r)=>n+Number(r.amount||0),0))*100)/100;
      const last=[...root.querySelectorAll('[name="splitWalletAmount"]')].at(-1);
      if(last)last.value=remaining>0?String(remaining):'';
    }
    const rest=Math.round((total()-readWalletRows(root).reduce((n,r)=>n+Number(r.amount||0),0))*100)/100;
    out.textContent=rest===0?'':(rest>0?'Осталось распределить: ':'Превышение: ')+Math.abs(rest).toLocaleString('ru-RU')+' ₽';
  };
  syncWalletRemainder();
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
      syncWalletRemainder(true);
    }
  });
  root.addEventListener('input',event=>{
    if(event.target?.closest?.('[data-finance-manual-line]')||event.target?.matches?.('[name="amount"]'))syncWalletRemainder(true);
    if(event.target?.matches?.('[name="splitWalletAmount"]')){const all=[...root.querySelectorAll('[name="splitWalletAmount"]')];syncWalletRemainder(event.target!==all.at(-1));}
  });
  root.addEventListener('click', (event) => {
    if(event.target.closest?.('[data-manual-wallet-add]')){
      const rows=readWalletRows(root),amount=root.querySelector('[name="amount"]')?.value||savedAmount;
      const currentWallet=root.querySelector('[name="walletId"]')?.value||'';
      if(!rows.length)rows.push({walletId:currentWallet,amount:''});
      if(rows.length>=wallets.length)return;
      rows.push({walletId:'',amount:''});
      walletHost.innerHTML=walletEditorMarkup(activeMode,amount,currentWallet,rows,wallets,canSplit);
      syncWalletRemainder(true);return;
    }
    const removeWallet=event.target.closest?.('[data-manual-wallet-remove]');
    if(removeWallet){
      const amount=root.querySelector('[name="amount"]')?.value||savedAmount;
      removeWallet.closest('[data-manual-wallet-row]')?.remove();const rows=readWalletRows(root);
      walletHost.innerHTML=walletEditorMarkup(activeMode,amount,rows[0]?.walletId||'',rows,wallets,canSplit);
      syncWalletRemainder(true);return;
    }
    if (event.target.closest?.('[data-finance-manual-line-add]')) {
      root.querySelector('[data-finance-manual-lines]')?.insertAdjacentHTML('beforeend', detailRow({}, direction));
      syncWalletRemainder(true);
      return;
    }
    const remove = event.target.closest?.('[data-finance-manual-line-remove]');
    if (remove) {
      const rows = root.querySelectorAll('[data-finance-manual-line]');
      if (rows.length > 1) remove.closest('[data-finance-manual-line]')?.remove();
      syncWalletRemainder(true);
    }
  });
  root.querySelector('[data-finance-manual-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveManual(root, direction, onSaved, operation, articles, newContract);
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
