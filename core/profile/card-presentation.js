import { normalizeEntityCardAppearance, entityCardDefaultRows, hasConfiguredEntityCardAppearance } from '../../ui/ui.js';
import { getCardAppearanceTemplate } from '../../core/card-appearance-templates.js';

function firstOf(value, key) {
  return String(Array.isArray(value?.[key]) ? (value[key][0] || '') : '');
}

function phoneOf(value = {}) {
  return String(value?.phones?.[0] || value?.phone || '');
}

function emailOf(value = {}) {
  return firstOf(value,'emails');
}

function telegramOf(value = {}) {
  return firstOf(value,'telegrams');
}


// Professional shows the saved discount position, not a particular Person's value.
// The User application substitutes the assigned percent or leaves this line empty.
function discountPositionField() {
  return { value:'discount', label:'Скидка', text:'%' };
}

export function profileCardFields(profile = {}, workplaces = []) {
  const supplied=Array.isArray(workplaces)?workplaces:[];
  const values=supplied.length?supplied:(Array.isArray(profile?.workplaces)?profile.workplaces:[]);
  const first=values[0]||{};
  return [
    {value:'workTime',label:'График',text:first.from||first.to?`${first.from||'—'} - ${first.to||'—'}`:''},
    {value:'workplaceName',label:'Рабочее пространство',text:first.name||''},
    {value:'name',label:'Имя и фамилия',text:[profile.name,profile.surname].filter(Boolean).join(' ')},
    {value:'firstName',label:'Имя',text:profile.name||''},
    {value:'surname',label:'Фамилия',text:profile.surname||''},
    {value:'profession',label:'Профессия',text:profile.profession||''},
    discountPositionField(),
    {value:'phone',label:'Телефон',text:phoneOf(profile)},
    {value:'email',label:'Email',text:emailOf(profile)},
    {value:'telegram',label:'Telegram',text:telegramOf(profile)},
    {value:'experience',label:'Опыт',text:profile.experience||''},
    {value:'about',label:'О себе',text:profile.about||''},
    {value:'professionAbout',label:'О профессии',text:profile.professionAbout||''},
    {value:'workplaceCount',label:'Количество пространств',text:String(values.length||'')},
  ];
}

export function workplaceCardFields(workplace = {}, profile = {}) {
  return [
    {value:'workTime',label:'График',text:workplace.from||workplace.to?`${workplace.from||'—'} - ${workplace.to||'—'}`:''},
    {value:'workplaceName',label:'Рабочее пространство',text:workplace.name||''},
    {value:'city',label:'Город',text:workplace.city||''},
    {value:'address',label:'Адрес',text:workplace.address||''},
    {value:'workplacePhone',label:'Телефон пространства',text:workplace.phone||''},
    {value:'currency',label:'Валюта',text:workplace.currency||''},
    {value:'workplaceAbout',label:'О рабочем пространстве',text:workplace.about||''},
    discountPositionField(),
    {value:'profileName',label:'Имя и фамилия',text:[profile.name,profile.surname].filter(Boolean).join(' ')},
    {value:'profileFirstName',label:'Имя',text:profile.name||''},
    {value:'profileSurname',label:'Фамилия',text:profile.surname||''},
    {value:'profession',label:'Профессия',text:profile.profession||''},
    {value:'profilePhone',label:'Телефон профиля',text:phoneOf(profile)},
    {value:'profileEmail',label:'Email',text:emailOf(profile)},
    {value:'profileTelegram',label:'Telegram',text:telegramOf(profile)},
    {value:'profileExperience',label:'Опыт',text:profile.experience||''},
    {value:'profileAbout',label:'О себе',text:profile.about||''},
    {value:'profileProfessionAbout',label:'О профессии',text:profile.professionAbout||''},
  ];
}

export function profileCardAppearance(profile = {}) {
  if(hasConfiguredEntityCardAppearance(profile.cardAppearance)) return normalizeEntityCardAppearance(profile.cardAppearance);
  return normalizeEntityCardAppearance({
    lines:entityCardDefaultRows([
      {row:1,field:'workTime',column:'right',align:'right',size:'m'},
      {row:2,field:'workplaceName',column:'right',align:'right',size:'m'},
      {row:7,field:'name',column:'left',align:'left',size:'l',bold:true},
      {row:8,field:'profession',column:'left',align:'left',size:'m'},
      {row:9,field:'phone',column:'left',align:'left',size:'m'},
    ]),
  });
}

export function workplaceCardAppearance(workplace = {}) {
  if(hasConfiguredEntityCardAppearance(workplace.cardAppearance)) return normalizeEntityCardAppearance(workplace.cardAppearance);
  const template=getCardAppearanceTemplate('workplace');
  if(hasConfiguredEntityCardAppearance(template?.appearance)) return normalizeEntityCardAppearance(template.appearance);
  return normalizeEntityCardAppearance({
    lines:entityCardDefaultRows([
      {row:1,field:'workTime',column:'right',align:'right',size:'m'},
      {row:2,field:'workplaceName',column:'right',align:'right',size:'m'},
      {row:7,field:'profileName',column:'left',align:'left',size:'l',bold:true},
      {row:8,field:'profession',column:'left',align:'left',size:'m'},
      {row:9,field:'profilePhone',column:'left',align:'left',size:'m'},
    ]),
  });
}

export function workplaceCardPhoto(workplace = {}) {
  // Photo belongs to the concrete Workplace, not the common presentation
  // template. Empty means removed; never resurrect it via global fallback.
  return String(workplace.photo || '');
}
