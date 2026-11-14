import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read=file=>readFileSync(file,'utf8');
const strip=source=>source.replace(/^import[\s\S]*?;\s*/gm,'').replace(/^export\s+/gm,'');
const peopleSource=read('core/people/people.js');
const helperSource=read('core/people/loyalty-filter.js');
const storage=new Map();
const view=runInNewContext(strip(read('core/people/view-state.js'))+'\n({getPeopleFilters,setPeopleFilters})',{
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
});
view.setPeopleFilters({loyaltyMode:'program',loyaltyProgram:'deposit:hand'});
assert.equal(view.getPeopleFilters().loyaltyProgram,'deposit:hand');
view.setPeopleFilters({loyaltyMode:'discount',loyaltyProgram:'deposit:hand'});
assert.equal(view.getPeopleFilters().loyaltyProgram,'','Discount must clear specific program');

const assigned=[
  {person:{key:'program-person'},programId:'hand',status:'active',terms:{termMode:'indefinite'}},
  {person:{key:'expired-person'},programId:'hand',status:'expired'},
];
const choices=[
  {id:'hand',name:'Руки вверх',status:'active'},
  {id:'ended',name:'Завершённая',status:'ended'},
];
const helper=runInNewContext(strip(helperSource)+'\n({peopleHasAssignedDiscount,peopleAssignedPrograms,peopleProgramOptions,refreshPeopleLoyaltyData})',{
  getIdentityMemberKeys:key=>[key],
  getIdentityPeople:key=>[{key}],
  getPersonPriceCondition:person=>({
    sources:person.key==='manual-person'?[{percent:10}]:
      person.key==='program-person'?[{percent:12,type:'program'}]:[],
  }),
  loyaltyNavigationItems:()=>[
    {id:'deposit'},{id:'certificate'},{id:'subscription'},
    {id:'referral'},{id:'bonus'},{id:'personal-account'},
  ],
  getDepositPrograms:()=>choices,getDepositInstances:()=>assigned,
  isActiveDepositAssignment:item=>item.status==='active',
  loadAllDeposits:async()=>assigned,loadDepositPrograms:async()=>choices,
  getCertificateAssignmentsForPerson:()=>[],
  getSubscriptionAssignmentsForPerson:()=>[],
  getReferralAssignmentsForPerson:()=>[],
  getBonusAssignmentsForPerson:()=>[],
});
assert.equal(helper.peopleHasAssignedDiscount({key:'manual-person'}),true);
assert.equal(helper.peopleHasAssignedDiscount({key:'program-person'}),true);
assert.equal(helper.peopleHasAssignedDiscount({key:'other-person'}),false);
assert.equal(helper.peopleAssignedPrograms({key:'program-person'}).has('deposit:hand'),true);
assert.equal(helper.peopleAssignedPrograms({key:'expired-person'}).size,0);
assert.ok(helper.peopleProgramOptions([{key:'program-person'}]).some(x=>
  x.value==='deposit:hand'&&x.label==='Руки вверх'));
assert.ok(!helper.peopleProgramOptions([{key:'expired-person'}]).some(x=>x.value==='deposit:ended'));
assert.ok(!helper.peopleProgramOptions([{key:'program-person'}]).some(x=>x.label==='Личный счёт'));

function sourceBetween(start,end){
  const i=peopleSource.indexOf(start),j=peopleSource.indexOf(end,i+start.length);
  assert.ok(i>=0&&j>i,'Missing People filter section '+start);
  return peopleSource.slice(i,j);
}
const pick=({name='',label='',options=[]})=>
  '<select name="'+name+'" data-label="'+label+'">'+options.map(option=>
    '<option value="'+option.value+'">'+option.label+'</option>').join('')+'</select>';
const peopleUI=runInNewContext(sourceBetween('function peopleProgramSelect(','function openFilterSettings(')
  +'\n({peopleFilterFields})',{
  select:pick, peopleProgramOptions:helper.peopleProgramOptions,
  getPeople:()=>[{key:'program-person'}],tagFilterOptions:()=>[],
  hasCurrentProceduresSnapshot:()=>true,procedureFilterOptions:()=>[],
  workplaceFilterOptions:()=>[],datePicker:()=>'',BIRTH_MONTH_OPTIONS:[],
});
const basic=peopleUI.peopleFilterFields({loyaltyMode:''});
const discounted=peopleUI.peopleFilterFields({loyaltyMode:'discount'});
const specific=peopleUI.peopleFilterFields({loyaltyMode:'program',loyaltyProgram:'deposit:hand'});
assert.match(basic,/name="peopleLoyaltyFilter"/);
for(const label of ['Без фильтра','Скидка','Программа'])assert.ok(basic.includes('>'+label+'</option>'));
assert.ok(!basic.includes('name="peopleLoyaltyProgramFilter"'));
assert.ok(!discounted.includes('name="peopleLoyaltyProgramFilter"'));
assert.match(specific,/name="peopleLoyaltyProgramFilter"/);
assert.ok(specific.includes('>Руки вверх</option>'));

const filterPeople=runInNewContext(sourceBetween('function applyPeopleFilters(','function tagFilterOptions(')
  +'\napplyPeopleFilters',{
    birthMonth:()=>0, recordFilterPersonKeys:()=>null,
    peopleHasAssignedDiscount:helper.peopleHasAssignedDiscount,
    peopleAssignedPrograms:helper.peopleAssignedPrograms,
    getIdentityMemberKeys:key=>[key],
  });
const persons=[
  {key:'manual-person',tags:[],emails:[]},
  {key:'program-person',tags:[],emails:[]},
  {key:'other-person',tags:[],emails:[]},
];
assert.deepEqual(Array.from(filterPeople(persons,{loyaltyMode:'discount'}),p=>p.key),
  ['manual-person','program-person']);
assert.deepEqual(Array.from(filterPeople(persons,{loyaltyMode:'program'}),p=>p.key),
  ['program-person']);
assert.deepEqual(Array.from(filterPeople(persons,{loyaltyMode:'program',loyaltyProgram:'deposit:hand'}),p=>p.key),
  ['program-person']);
await helper.refreshPeopleLoyaltyData();
console.log('People loyalty filter PASS: one selector, conditional program, real assignments and discounts.');
