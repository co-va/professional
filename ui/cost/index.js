const esc=(v='')=>String(v).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const money=v=>{if(v===''||v==null)return '';const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?`${n.toLocaleString('ru-RU')} ₽`:''};

export function costField({name='cost',value={},modes=['amount','from','from-to'],free=true}={}){const mode=value.mode||'amount';return `<div class="cost-field" data-cost-field="${esc(name)}"><span class="cost-field__label">Стоимость</span>${free?`<label class="cost-free"><input type="checkbox" data-cost-free ${value.free?'checked':''}><span>Бесплатно</span></label>`:''}<div class="segment-control cost-modes" data-cost-modes>${modes.map(m=>`<button type="button" data-cost-mode="${m}" class="${mode===m?'is-active':''}">${m==='amount'?'Стоимость':m==='from'?'от':'от–до'}</button>`).join('')}</div><div class="cost-inputs" data-cost-inputs>${renderInputs(mode,value)}</div></div>`}
function renderInputs(mode,v){if(v.free)return '';if(mode==='from-to')return `<div class="cost-range"><label class="field"><span>от</span><input type="number" min="0" step="1" data-cost-from value="${esc(v.from??'')}" inputmode="decimal"></label><label class="field"><span>до</span><input type="number" min="0" step="1" data-cost-to value="${esc(v.to??'')}" inputmode="decimal"></label></div>`;return `<label class="field"><span>${mode==='from'?'от':'Сумма'}</span><input type="number" min="0" step="1" data-cost-amount value="${esc(mode==='from'?(v.from!==''&&v.from!=null?v.from:(v.amount??'')):(v.amount!==''&&v.amount!=null?v.amount:(v.from??'')))}" inputmode="decimal"></label>`}
export function initCostFields(root) {
  root.querySelectorAll('[data-cost-field]').forEach((host) => {
    const free = host.querySelector('[data-cost-free]');
    const modes = host.querySelector('[data-cost-modes]');
    const inputs = host.querySelector('[data-cost-inputs]');
    if (!inputs || host.dataset.costReady === 'true') return;
    host.dataset.costReady = 'true';

    // UI-only draft keeps entered numbers while the user switches presentation
    // modes. The canonical value remains collectCost() at form submission.
    const draft = { free: Boolean(free?.checked), amount: '', from: '', to: '' };
    let currentMode = () => host.querySelector('[data-cost-mode].is-active')?.dataset.costMode || 'amount';
    const capture = () => {
      const amount = inputs.querySelector('[data-cost-amount]');
      const from = inputs.querySelector('[data-cost-from]');
      const to = inputs.querySelector('[data-cost-to]');
      if (amount) {
        if (currentMode() === 'from') draft.from = amount.value;
        else draft.amount = amount.value;
      }
      if (from) draft.from = from.value;
      if (to) draft.to = to.value;
    };
    capture();
    const render = () => {
      const mode = currentMode();
      if (mode === 'from' && !draft.from && draft.amount) draft.from = draft.amount;
      if (mode === 'amount' && !draft.amount && draft.from) draft.amount = draft.from;
      inputs.innerHTML = renderInputs(mode, draft);
      // Updated fields are still owned by the same cost-field host.
      host.dispatchEvent(new Event('change', { bubbles: true }));
    };

    inputs.addEventListener('input', capture);
    modes?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-cost-mode]');
      if (!button || button.classList.contains('is-active')) return;
      capture();
      modes.querySelectorAll('[data-cost-mode]').forEach((item) => item.classList.toggle('is-active', item === button));
      render();
    });
    free?.addEventListener('change', () => {
      capture();
      draft.free = free.checked;
      render();
    });
  });
}
export function collectCost(root,name='cost'){const host=root.querySelector(`[data-cost-field="${CSS.escape(name)}"]`);if(!host)return {mode:'amount',amount:'',free:false};const free=!!host.querySelector('[data-cost-free]')?.checked;const mode=host.querySelector('[data-cost-mode].is-active')?.dataset.costMode||'amount';if(free)return {mode,free:true,amount:'',from:'',to:''};if(mode==='from-to')return {mode,free:false,from:host.querySelector('[data-cost-from]')?.value||'',to:host.querySelector('[data-cost-to]')?.value||''};const amount=host.querySelector('[data-cost-amount]')?.value||'';return {mode,free:false,amount,from:mode==='from'?amount:'',to:''};}

export function costListParts(cost={}){
  if(cost?.free)return{rightTop:'Бесплатно',rightBottom:''};
  if(cost?.mode==='from-to'){const from=money(cost.from),to=money(cost.to);return{rightTop:from?`от ${from}`:'',rightBottom:to?`до ${to}`:''}}
  if(cost?.mode==='from'){const from=money(cost.from!==''&&cost.from!=null?cost.from:cost.amount);return{rightTop:from?`от ${from}`:'',rightBottom:''}}
  return{rightTop:money(cost?.amount!==''&&cost?.amount!=null?cost.amount:cost?.from),rightBottom:''};
}

export function costCardMeta(cost={}){
  if(cost?.free)return[{value:'стоимость'},{value:'Бесплатно'}];
  if(cost?.mode==='from-to')return[{value:`от ${money(cost.from)}`},{value:`до ${money(cost.to)}`}];
  if(cost?.mode==='from')return[{value:'от'},{value:money(cost.from??cost.amount)}];
  return[{value:'стоимость'},{value:money(cost?.amount??cost?.from)||'—'}];
}

/** Validate the same price object that collectCost() submits. */
export function validateCostDefinition(cost = {}) {
  if (cost?.free === true) return '';
  const mode = ['amount', 'from', 'from-to'].includes(cost?.mode) ? cost.mode : 'amount';
  const raw = mode === 'from-to' ? [cost.from, cost.to] : [mode === 'from' ? (cost.from ?? cost.amount) : cost.amount];
  if (raw.every((value) => value == null || String(value).trim() === '')) return '';
  if (raw.some((value) => value == null || String(value).trim() === '')) {
    return 'Укажите обе границы диапазона стоимости.';
  }
  const amounts = raw.map((value) => Number(String(value).replace(',', '.')));
  if (amounts.some((value) => !Number.isFinite(value) || value < 0)) {
    return 'Стоимость должна быть неотрицательным числом.';
  }
  if (mode === 'from-to' && amounts[1] < amounts[0]) {
    return 'Стоимость «до» не может быть меньше стоимости «от».';
  }
  return '';
}
