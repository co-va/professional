const esc=(v='')=>String(v).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const money=v=>v===''||v==null?'':`${Number(v).toLocaleString('ru-RU')} ₽`;

export function costField({name='cost',value={},modes=['amount','from','from-to'],free=true}={}){const mode=value.mode||'amount';return `<div class="cost-field" data-cost-field="${esc(name)}"><span class="cost-field__label">Стоимость</span>${free?`<label class="cost-free"><input type="checkbox" data-cost-free ${value.free?'checked':''}><span>Бесплатно</span></label>`:''}<div class="segment-control cost-modes" data-cost-modes>${modes.map(m=>`<button type="button" data-cost-mode="${m}" class="${mode===m?'is-active':''}">${m==='amount'?'Стоимость':m==='from'?'от':'от–до'}</button>`).join('')}</div><div class="cost-inputs" data-cost-inputs>${renderInputs(mode,value)}</div></div>`}
function renderInputs(mode,v){if(v.free)return '';if(mode==='from-to')return `<div class="cost-range"><label class="field"><span>от</span><input type="number" min="0" step="1" data-cost-from value="${esc(v.from??'')}" inputmode="decimal"></label><label class="field"><span>до</span><input type="number" min="0" step="1" data-cost-to value="${esc(v.to??'')}" inputmode="decimal"></label></div>`;return `<label class="field"><span>${mode==='from'?'от':'Сумма'}</span><input type="number" min="0" step="1" data-cost-amount value="${esc(v.amount??v.from??'')}" inputmode="decimal"></label>`}
export function initCostFields(root){root.querySelectorAll('[data-cost-field]').forEach(host=>{const free=host.querySelector('[data-cost-free]'),modes=host.querySelector('[data-cost-modes]'),inputs=host.querySelector('[data-cost-inputs]');const current=()=>host.querySelector('[data-cost-mode].is-active')?.dataset.costMode||'amount';const redraw=()=>{const old={free:free?.checked,amount:host.querySelector('[data-cost-amount]')?.value,from:host.querySelector('[data-cost-from]')?.value,to:host.querySelector('[data-cost-to]')?.value};inputs.innerHTML=renderInputs(current(),old)};modes?.addEventListener('click',e=>{const b=e.target.closest('[data-cost-mode]');if(!b)return;modes.querySelectorAll('[data-cost-mode]').forEach(x=>x.classList.remove('is-active'));b.classList.add('is-active');redraw()});free?.addEventListener('change',redraw);});}
export function collectCost(root,name='cost'){const host=root.querySelector(`[data-cost-field="${CSS.escape(name)}"]`);if(!host)return {mode:'amount',amount:'',free:false};const free=!!host.querySelector('[data-cost-free]')?.checked;const mode=host.querySelector('[data-cost-mode].is-active')?.dataset.costMode||'amount';if(free)return {mode,free:true,amount:'',from:'',to:''};if(mode==='from-to')return {mode,free:false,from:host.querySelector('[data-cost-from]')?.value||'',to:host.querySelector('[data-cost-to]')?.value||''};const amount=host.querySelector('[data-cost-amount]')?.value||'';return {mode,free:false,amount,from:mode==='from'?amount:'',to:''};}

export function costListParts(cost={}){
  if(cost?.free)return{rightTop:'Бесплатно',rightBottom:''};
  if(cost?.mode==='from-to')return{rightTop:`от ${money(cost.from)}`,rightBottom:`до ${money(cost.to)}`};
  if(cost?.mode==='from')return{rightTop:`от ${money(cost.from??cost.amount)}`,rightBottom:''};
  return{rightTop:money(cost?.amount??cost?.from),rightBottom:''};
}

export function costCardMeta(cost={}){
  if(cost?.free)return[{value:'стоимость'},{value:'Бесплатно'}];
  if(cost?.mode==='from-to')return[{value:`от ${money(cost.from)}`},{value:`до ${money(cost.to)}`}];
  if(cost?.mode==='from')return[{value:'от'},{value:money(cost.from??cost.amount)}];
  return[{value:'стоимость'},{value:money(cost?.amount??cost?.from)||'—'}];
}
