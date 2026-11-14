import { apiRequest } from '../auth.js';
import { getWallets, hydrateCashEntitiesFromServer, hydrateFinanceFromServer, hydrateWalletsFromServer } from '../finance/index.js';
import { hydrateProductsFromServer } from '../../core/service/products/data.js';
import { hydrateTagsFromServer } from '../../settings/tags/data.js';
import { hydrateCardAppearanceTemplates } from '../card-appearance-templates.js';

let financeStateLoad = null;
let auxiliaryEpoch = 0;
const auxiliaryStateLoads = new Map();

function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
async function payload(response,fallback){const value=await response.json().catch(()=>({}));if(!response.ok)throw new Error(value?.message||fallback);return value;}
function owns(value,key){return Boolean(value&&Object.prototype.hasOwnProperty.call(value,key));}
function hydrateAuxiliary(remote){
  // Do not erase a known wallet catalog on a malformed/partial response.
  if(owns(remote,'wallets') && Array.isArray(remote.wallets)) hydrateWalletsFromServer(clone(remote.wallets));
  if(owns(remote,'investments')||owns(remote,'loans')){
    hydrateCashEntitiesFromServer({
      investments:Array.isArray(remote.investments)?clone(remote.investments):[],
      loans:Array.isArray(remote.loans)?clone(remote.loans):[],
    });
  }
  if(owns(remote,'tags')) hydrateTagsFromServer(Array.isArray(remote.tags)?clone(remote.tags):[]);
  if(owns(remote,'products')||owns(remote,'productHistory')){
    hydrateProductsFromServer({
      products:Array.isArray(remote.products)?clone(remote.products):[],
      productHistory:Array.isArray(remote.productHistory)?clone(remote.productHistory):[],
    });
  }
  if(owns(remote,'cardAppearanceTemplates')) hydrateCardAppearanceTemplates(Array.isArray(remote.cardAppearanceTemplates)?clone(remote.cardAppearanceTemplates):[]);
}

function inferredAuxiliaryScope(){
  const hash=String(globalThis.location?.hash||'').replace(/^#/,'').split('?')[0].trim();
  if(hash==='people')return 'people';
  if(hash==='loyalty')return 'loyalty';
  if(hash==='service')return 'service';
  if(hash==='finance')return 'finance';
  if(hash==='settings')return 'tags';
  return 'all';
}

if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
  window.addEventListener('professional:auth-logout',()=>{
    auxiliaryEpoch += 1;
    financeStateLoad=null;
    auxiliaryStateLoads.clear();
  });
}

export async function loadFinanceState(){
  if(!financeStateLoad){
    const epoch=auxiliaryEpoch;
    financeStateLoad=apiRequest('/finance')
      .then((response)=>payload(response,'Не удалось загрузить Финансы'))
      .then((finance)=>{if(epoch!==auxiliaryEpoch)return null;hydrateFinanceFromServer(finance);return finance;})
      .catch((error)=>{
        if(epoch===auxiliaryEpoch)financeStateLoad=null;

        throw error;
      });
  }
  return financeStateLoad;
}

export async function loadAuxiliaryState(scope=''){
  await Promise.resolve();
  const key=String(scope||inferredAuxiliaryScope()||'all').trim()||'all';
  if(!auxiliaryStateLoads.has(key)){
    const epoch=auxiliaryEpoch;
    const path=key==='all'?'/auxiliary-state':`/auxiliary-state/${encodeURIComponent(key)}`;
    const request=apiRequest(path)
      .then((response)=>payload(response,'Не удалось загрузить связанные данные'))
      .then((remote)=>{
        if(epoch!==auxiliaryEpoch)return null;
        // Finance and loyalty explicitly include the canonical wallet catalog.
        // A malformed response must not become a permanently cached success.
        if((key==='finance'||key==='loyalty')&&!Array.isArray(remote?.wallets)){
          throw new Error('Сервер не вернул список кошельков');
        }
        hydrateAuxiliary(remote);
        return remote;
      })
      .catch((error)=>{if(epoch===auxiliaryEpoch)auxiliaryStateLoads.delete(key);throw error;});
    auxiliaryStateLoads.set(key,request);
  }
  return auxiliaryStateLoads.get(key);
}

// Payment, correction, refund and Finance must enter through this loader,
// never assume a previously opened Cash screen has hydrated the catalog.
export async function loadWalletCatalog(){
  const remote=await loadAuxiliaryState('finance');
  if(!Array.isArray(remote?.wallets))throw new Error('Не удалось загрузить кошельки');
  return getWallets();
}
