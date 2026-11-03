import { apiRequest } from '../auth.js';
import { hydrateDaysFromServer } from '../day/index.js';
import { hydrateCurrentProceduresFromServer } from '../../core/service/procedures/data.js';
import { consumeJournalBootstrap } from './journal-bootstrap.js';

let operationalStateRequest = null;
let recordCreationHydrated = false;

function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
async function payload(response,fallback){const value=await response.json().catch(()=>({}));if(!response.ok)throw new Error(value?.message||fallback);return value;}
function hydrateDays(remote={}){hydrateDaysFromServer(Array.isArray(remote.days)?clone(remote.days):[]);}
function hydrateRecordCreation(remote={}){
  hydrateDays(remote);
  hydrateCurrentProceduresFromServer(Array.isArray(remote.procedures)?clone(remote.procedures):[]);
}
function resetOperationalLoad(){
  operationalStateRequest=null;
  recordCreationHydrated=false;
}
export function requestOperationalState(){
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
  if(!recordCreationHydrated){
    hydrateRecordCreation(remote);
    recordCreationHydrated=true;
  }
  return remote;
}

export async function loadOperationalState({full=false}={}){
  if(full){
    const {loadFullOperationalState}=await import('./operational-full-state.js');
    return loadFullOperationalState();
  }
  const bootstrap=await consumeJournalBootstrap('operationalContext');
  if(bootstrap){
    hydrateDays(bootstrap);
    return bootstrap;
  }
  const remote=await requestOperationalState();
  hydrateDays(remote);
  return remote;
}
