import { apiRequest, apiResponseJson as payload } from '../../core/auth.js';
import { hydrateProfileFromServer, setProfileServerReady } from './data.js';
import { hydrateWorkplacesFromServer, setWorkplacesServerReady } from './workplaces/data.js';

let fullProfileStateLoad = null;
let profileLoadEpoch = 0;


function hydrate(remote={}){
  hydrateProfileFromServer(remote?.profile||{},remote?.customProfessions||[],remote?.professionCatalog||[]);
  hydrateWorkplacesFromServer(remote?.workplaces||[],remote?.workplaceReferenceData||{});
}

if(typeof window!=='undefined'){
  window.addEventListener('professional:auth-logout',()=>{
    profileLoadEpoch += 1;
    fullProfileStateLoad=null;
    setProfileServerReady(false);
    setWorkplacesServerReady(false);
  });
}

export async function loadProfileState(){
  if(!fullProfileStateLoad){
    setProfileServerReady(false);
    setWorkplacesServerReady(false);
    const epoch = profileLoadEpoch;
    fullProfileStateLoad=apiRequest('/profile')
      .then((response)=>payload(response,'Не удалось загрузить данные профиля'))
      .then((remote)=>{
        if(epoch !== profileLoadEpoch) return null;
        hydrate(remote);
        setProfileServerReady(true);
        setWorkplacesServerReady(true);
        return remote;
      })
      .catch((error)=>{
        if(epoch===profileLoadEpoch)fullProfileStateLoad=null;
        throw error;
      });
  }
  return fullProfileStateLoad;
}
