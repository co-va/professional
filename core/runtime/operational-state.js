import { apiRequest } from '../auth.js';
import { hydrateDaysFromServer } from '../day/index.js';
import { hydrateCurrentProceduresFromServer, hydrateProceduresFromServer } from '../../core/service/procedures/data.js';
import { hydrateBookingSettingsFromServer } from '../booking-settings/index.js';
import { consumeJournalBootstrap } from './journal-bootstrap.js';

let operationalStateRequest = null;
let recordCreationHydrated = false;
let fullOperationalHydrated = false;

function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
async function payload(response,fallback){const value=await response.json().catch(()=>({}));if(!response.ok)throw new Error(value?.message||fallback);return value;}
function hydrateDays(remote={}){hydrateDaysFromServer(Array.isArray(remote.days)?clone(remote.days):[]);}
function hydrateRecordCreation(remote={}){
  hydrateDays(remote);
  hydrateCurrentProceduresFromServer(Array.isArray(remote.procedures)?clone(remote.procedures):[]);
}
function hydrateFull(remote={}){
  hydrateDays(remote);
  hydrateProceduresFromServer({
    procedures:Array.isArray(remote.procedures)?clone(remote.procedures):[],
    procedureHistory:Array.isArray(remote.procedureHistory)?clone(remote.procedureHistory):[],
  });
  hydrateBookingSettingsFromServer(remote.bookingSettings&&typeof remote.bookingSettings==='object'&&!Array.isArray(remote.bookingSettings)?clone(remote.bookingSettings):null);
}
function resetOperationalLoad(){
  operationalStateRequest=null;
  recordCreationHydrated=false;
  fullOperationalHydrated=false;
}
function requestOperationalState(){
  if(!operationalStateRequest){
    operationalStateRequest=apiRequest('/business-state/operational')
      .then((response)=>payload(response,'Не удалось загрузить рабочие данные'))
      .catch((error)=>{resetOperationalLoad();throw error;});
  }
  return operationalStateRequest;
}

if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
  window.addEventListener('professional:auth-logout',resetOperationalLoad);
}

export async function loadRecordCreationOperationalState(){
  const remote=await requestOperationalState();
  if(!recordCreationHydrated&&!fullOperationalHydrated){
    hydrateRecordCreation(remote);
    recordCreationHydrated=true;
  }
  return remote;
}

export async function loadOperationalState({full=false}={}){
  if(!full){
    const bootstrap=await consumeJournalBootstrap('operationalContext');
    if(bootstrap){
      hydrateDays(bootstrap);
      return bootstrap;
    }
  }
  const remote=await requestOperationalState();
  if(!fullOperationalHydrated){
    hydrateFull(remote);
    fullOperationalHydrated=true;
    recordCreationHydrated=true;
  }
  return remote;
}
