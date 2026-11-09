import { getIdentityMemberKeys, getIdentityPeople, getPersonPriceCondition } from './data.js';
import { loyaltyNavigationItems } from '../loyalty/index.js';
import { getDepositPrograms, getDepositInstances, isActiveDepositAssignment, loadAllDeposits, loadDepositPrograms } from '../loyalty/deposit/data.js';
import { getCertificateAssignmentsForPerson } from '../loyalty/certificate/index.js';
import { getSubscriptionAssignmentsForPerson } from '../loyalty/subscription/index.js';
import { getReferralAssignmentsForPerson } from '../loyalty/referral/index.js';
import { getBonusAssignmentsForPerson } from '../loyalty/bonus/index.js';

const KINDS = Object.freeze({
  deposit:'Депозит', certificate:'Сертификат', subscription:'Абонемент',
  referral:'Реферальная программа', bonus:'Бонусная программа',
});
const text = value => String(value??'').trim();
const activeProgram = program => Boolean(program?.id) && !program?.archivedAt && (!program.status || program.status==='active');
const activeInstance = item => !['closed','ended','expired','cancelled','used'].includes(text(item?.status).toLowerCase());

export async function refreshPeopleLoyaltyData(){
  // Actual server assignments, not sample or automatic Personal Accounts.
  await Promise.all([loadAllDeposits(),loadDepositPrograms()]);
}

export function peopleHasAssignedDiscount(person={}){
  return getIdentityPeople(person.key).some(member => {
    const condition=getPersonPriceCondition(member);
    return Array.isArray(condition?.sources) && condition.sources.some(source=>Number(source?.percent)>0);
  });
}

export function peopleAssignedPrograms(person={}){
  const allowed=new Set(loyaltyNavigationItems().map(item=>item.id));
  const result=new Map();
  const keys=new Set(getIdentityMemberKeys(person.key).map(text).filter(Boolean));
  if(!keys.size)return result;
  const add=(kind,program)=>{
    if(!allowed.has(kind)||!activeProgram(program))return;
    const id=text(program.id);
    if(id)result.set(kind+':'+id,{id:kind+':'+id,name:text(program.name)||KINDS[kind],kind});
  };
  if(allowed.has('deposit')){
    const catalog=new Map(getDepositPrograms().filter(activeProgram).map(program=>[text(program.id),program]));
    for(const item of getDepositInstances()){
      const owner=item?.person||{};
      const key=text(owner.key||owner.personKey||owner.id);
      if(!keys.has(key)||!isActiveDepositAssignment(item))continue;
      const program=catalog.get(text(item.programId));
      if(program)add('deposit',program);
    }
  }
  for(const key of keys){
    if(allowed.has('certificate')){
      for(const {instance,program} of getCertificateAssignmentsForPerson(key,{includeHidden:true})){
        if(activeInstance(instance))add('certificate',program);
      }
    }
    if(allowed.has('subscription')){
      for(const {instance,program} of getSubscriptionAssignmentsForPerson(key,{includeHidden:true})){
        if(activeInstance(instance))add('subscription',program);
      }
    }
    if(allowed.has('referral')){
      for(const {relation,program} of getReferralAssignmentsForPerson(key,{includeHidden:true})){
        // A general eligibility program is not the same as a personal assignment.
        if(relation && activeInstance(relation))add('referral',program);
      }
    }
    if(allowed.has('bonus')){
      for(const {participant,program} of getBonusAssignmentsForPerson(key,{includeHidden:true})){
        if(participant && activeInstance(participant))add('bonus',program);
      }
    }
  }
  return result;
}

export function peopleProgramOptions(people=[]){
  const programs=new Map();
  if(loyaltyNavigationItems().some(item=>item.id==='deposit')){
    for(const program of getDepositPrograms().filter(activeProgram)){
      programs.set('deposit:'+text(program.id),{id:'deposit:'+text(program.id),name:text(program.name)||'Депозит',kind:'deposit'});
    }
  }
  for(const person of Array.isArray(people)?people:[]){
    for(const [id,program] of peopleAssignedPrograms(person))programs.set(id,program);
  }
  const names=new Map();
  for(const program of programs.values())names.set(program.name,(names.get(program.name)||0)+1);
  return [...programs.values()].map(program=>({
    value:program.id,
    label:names.get(program.name)>1?program.name+' · '+KINDS[program.kind]:program.name,
  })).sort((a,b)=>a.label.localeCompare(b.label,'ru'));
}
