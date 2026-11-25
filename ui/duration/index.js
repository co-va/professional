import { modal, mountModal } from '../modals/index.js';
import { wheel, bindTimeWheel } from '../time/index.js';
import { button } from '../buttons/index.js';
import { escapeHtml } from '../utils/escape-html.js';
import { isV2DesktopWorkspace } from '../v2/geometry.js';

export function durationText(minutes=0){const m=Math.max(0,Number(minutes)||0),h=Math.floor(m/60),min=m%60;return h?`${h} ч${min?` ${min} мин`:''}`:`${min} мин`}

export function durationPicker({name='duration',label='Длительность',value=0}={}){return `<div class="duration-picker" data-duration-picker="${escapeHtml(name)}"><span class="duration-picker__label">${escapeHtml(label)}</span><button type="button" class="duration-picker__button" data-duration-open>${durationText(value)}</button><input type="hidden" name="${escapeHtml(name)}" value="${Number(value)||0}" data-duration-value></div>`}
export function initDurationPickers(root){root.querySelectorAll('[data-duration-picker]').forEach(host=>host.querySelector('[data-duration-open]')?.addEventListener('click',()=>open(host)))}

function open(host){
  const hidden=host.querySelector('[data-duration-value]');
  const current=Math.max(0,Number(hidden?.value)||0);
  const currentHours=Math.min(12,Math.floor(current/60));
  const currentMinutes=current%60;
  const hours=Array.from({length:13},(_,i)=>i);
  const minutes=Array.from({length:60},(_,i)=>i);
  const initialHour=hours.includes(currentHours)?currentHours:0;
  const initialMinute=minutes.includes(currentMinutes)?currentMinutes:0;
  const content=`<div class="modal-title"><h2>${escapeHtml(host.querySelector('.duration-picker__label')?.textContent||'Длительность')}</h2></div><div class="time-wheel" data-duration-wheel><div class="time-wheel__column"><span class="time-wheel__label">Часы</span><div class="time-wheel__viewport">${wheel({values:hours,selected:initialHour,type:'duration-hours',formatter:v=>`${v} ч`})}</div></div><div class="time-wheel__column"><span class="time-wheel__label">Минуты</span><div class="time-wheel__viewport">${wheel({values:minutes,selected:initialMinute,type:'duration-minutes',formatter:v=>`${v} мин`})}</div></div></div>${button('Сохранить',{data:'data-duration-save'})}`;
  const trigger=host.querySelector('[data-duration-open]');
  const desktop=isV2DesktopWorkspace(host.closest('[data-v2-app]'));
  const title=host.querySelector('.duration-picker__label')?.textContent||'Длительность';
  // Desktop uses the same anchored picker presentation as the shared selector.
  // Mobile keeps its original sheet, markup and interaction.
  const modalRoot=desktop
    ? mountModal(trigger,modal(content,{title,variant:'x',xRole:'picker',className:'modal--duration-picker-popover'}))
    : mountModal(document.body,modal(content,{title,variant:'x'}));
  if(!modalRoot)return;

  const {syncColumn}=bindTimeWheel(modalRoot, {'duration-hours':initialHour,'duration-minutes':initialMinute});

  modalRoot.querySelector('[data-duration-save]')?.addEventListener('click',()=>{
    modalRoot.querySelectorAll('.time-wheel__viewport').forEach(viewport=>syncColumn(viewport,{recenter:false}));
    const hours=Number(modalRoot.querySelector('[data-time-wheel-type="duration-hours"].is-selected')?.dataset.value)||0;
    const minutes=Number(modalRoot.querySelector('[data-time-wheel-type="duration-minutes"].is-selected')?.dataset.value)||0;
    const total=hours*60+minutes;
    hidden.value=String(total);
    host.querySelector('[data-duration-open]').textContent=durationText(total);
    hidden.dispatchEvent(new Event('change',{bubbles:true}));
    modalRoot.v2Close?.();
  });
}
