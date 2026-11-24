import { apiRequest } from '../auth.js';
import { hydrateDaysFromServer } from '../day/index.js';
import { hydrateCurrentProceduresFromServer } from '../../core/service/procedures/data.js';

let operationalStateRequest = null;
let recordCreationHydrated = false;
let operationalEpoch=0;

function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
async function payload(response,fallback){
  const value=await response.json().catch(()=>null);
  if(!response.ok){
    const message=typeof value?.message==='string' ? value.message.trim() : '';
    throw new Error(message || `${fallback} (HTTP ${response.status})`);
  }
  if(!value || typeof value!=='object' || !Array.isArray(value.procedures)){
    throw new Error('Сервер вернул неполные рабочие данные');
  }
  return value;
}
function hydrateDays(remote={}){hydrateDaysFromServer(Array.isArray(remote.days)?clone(remote.days):[]);}
function hydrateRecordCreation(remote={}){
  hydrateDays(remote);
  hydrateCurrentProceduresFromServer(Array.isArray(remote.procedures)?clone(remote.procedures):[]);
}
function resetOperationalLoad(){
  operationalEpoch+=1;
  operationalStateRequest=null;
  recordCreationHydrated=false;
}
export function requestOperationalState(){
  if(!operationalStateRequest){
    const epoch=operationalEpoch;
    operationalStateRequest=apiRequest('/business-state/operational')
      .then((response)=>payload(response,'Не удалось загрузить рабочие данные'))
      .catch((error)=>{if(epoch===operationalEpoch)resetOperationalLoad();throw error;});
  }
  return operationalStateRequest;
}

if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
  window.addEventListener('professional:auth-logout',resetOperationalLoad);
}

export async function loadRecordCreationOperationalState(){
  const epoch=operationalEpoch;
  const remote=await requestOperationalState();
  if(epoch!==operationalEpoch)return null;
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
  const epoch=operationalEpoch;
  const remote=await requestOperationalState();
  if(epoch!==operationalEpoch)return null;
  hydrateDays(remote);
  return remote;
}
