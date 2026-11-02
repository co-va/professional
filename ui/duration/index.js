import { modal, mountModal } from '../modals/index.js';
import { wheel } from '../time/index.js';
import { button } from '../buttons/index.js';
import { escapeHtml } from '../utils/escape-html.js';

export function durationText(minutes=0){const m=Math.max(0,Number(minutes)||0),h=Math.floor(m/60),min=m%60;return h?`${h} ч${min?` ${min} мин`:''}`:`${min} мин`}
const MIDDLE_CYCLE=2;

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
  const modalRoot=mountModal(document.body,modal(content,{title:host.querySelector('.duration-picker__label')?.textContent||'Длительность',variant:'x'}));
  if(!modalRoot)return;

  const nearestItem=(viewport)=>{
    const items=[...viewport.querySelectorAll('[data-time-wheel-item]')];
    if(!items.length)return null;
    const centerY=viewport.getBoundingClientRect().top+viewport.clientHeight/2;
    let nearest=items[0],distance=Infinity;
    items.forEach(item=>{const rect=item.getBoundingClientRect();const d=Math.abs(rect.top+rect.height/2-centerY);if(d<distance){distance=d;nearest=item;}});
    return nearest;
  };

  const selectOnly=(viewport,item)=>viewport.querySelectorAll('[data-time-wheel-item]').forEach(other=>other.classList.toggle('is-selected',other===item));

  const center=(type,value)=>{
    const item=modalRoot.querySelector(`[data-time-wheel-type="${type}"][data-value="${CSS.escape(String(value))}"][data-cycle="${MIDDLE_CYCLE}"]`);
    const viewport=item?.closest('.time-wheel__viewport');
    if(!item||!viewport)return;
    viewport.scrollTop=item.offsetTop-(viewport.clientHeight-item.offsetHeight)/2;
    selectOnly(viewport,item);
  };

  const syncColumn=(viewport,{recenter=true}={})=>{
    const nearest=nearestItem(viewport);
    if(!nearest)return;
    selectOnly(viewport,nearest);
    if(!recenter)return;
    const cycle=Number(nearest.dataset.cycle);
    if(cycle===MIDDLE_CYCLE)return;
    const type=nearest.dataset.timeWheelType;
    const value=nearest.dataset.value;
    const twin=modalRoot.querySelector(`[data-time-wheel-type="${type}"][data-value="${CSS.escape(value)}"][data-cycle="${MIDDLE_CYCLE}"]`);
    if(!twin)return;
    viewport.scrollTop+=twin.offsetTop-nearest.offsetTop;
    selectOnly(viewport,twin);
  };

  modalRoot.querySelectorAll('.time-wheel__viewport').forEach(viewport=>{
    let frame=0;
    let settle=0;
    viewport.addEventListener('scroll',()=>{
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      frame=requestAnimationFrame(()=>syncColumn(viewport,{recenter:false}));
      settle=setTimeout(()=>syncColumn(viewport,{recenter:true}),90);
    },{passive:true});
  });

  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    center('duration-hours',initialHour);
    center('duration-minutes',initialMinute);
  }));

  modalRoot.querySelectorAll('[data-time-wheel-item]').forEach(item=>item.addEventListener('click',()=>{
    const viewport=item.closest('.time-wheel__viewport');
    if(!viewport)return;
    selectOnly(viewport,item);
    viewport.scrollTo({top:item.offsetTop-(viewport.clientHeight-item.offsetHeight)/2,behavior:'smooth'});
  }));

  modalRoot.querySelector('[data-duration-save]')?.addEventListener('click',()=>{
    modalRoot.querySelectorAll('.time-wheel__viewport').forEach(viewport=>syncColumn(viewport,{recenter:false}));
    const hours=Number(modalRoot.querySelector('[data-time-wheel-type="duration-hours"].is-selected')?.dataset.value)||0;
    const minutes=Number(modalRoot.querySelector('[data-time-wheel-type="duration-minutes"].is-selected')?.dataset.value)||0;
    const total=hours*60+minutes;
    hidden.value=String(total);
    host.querySelector('[data-duration-open]').textContent=durationText(total);
    modalRoot.v2Close?.();
  });
}
