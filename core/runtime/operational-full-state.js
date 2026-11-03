import { hydrateDaysFromServer } from '../day/index.js';
import { hydrateCurrentProceduresFromServer } from '../../core/service/procedures/data.js';
import { hydrateBookingSettingsFromServer } from '../booking-settings/index.js';
import { requestOperationalState } from './operational-state.js';

let fullOperationalLoad = null;

function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
function hydrateFull(remote={}){
  hydrateDaysFromServer(Array.isArray(remote.days)?clone(remote.days):[]);
  hydrateCurrentProceduresFromServer(Array.isArray(remote.procedures)?clone(remote.procedures):[]);
  hydrateBookingSettingsFromServer(remote.bookingSettings&&typeof remote.bookingSettings==='object'&&!Array.isArray(remote.bookingSettings)?clone(remote.bookingSettings):null);
}
function reset(){fullOperationalLoad=null;}

if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
  window.addEventListener('professional:auth-logout',reset);
}

export function loadFullOperationalState(){
  if(!fullOperationalLoad){
    fullOperationalLoad=requestOperationalState()
      .then((remote)=>{hydrateFull(remote);return remote;})
      .catch((error)=>{fullOperationalLoad=null;throw error;});
  }
  return fullOperationalLoad;
}
