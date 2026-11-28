import assert from 'node:assert/strict';
import {manualArticleChoices,manualArticleSelection,manualRawArticle,manualDetailTotal,validManualLine} from '../../core/finance/dds/manual-entry-model.js';
const raw=[{articleId:'s',systemKey:'SERVICE_REVENUE',direction:'IN',economicType:'SERVICE_REVENUE'},{articleId:'t',systemKey:'TIPS',direction:'IN',economicType:'TIPS'},{articleId:'r',systemKey:'REFUND',direction:'OUT',economicType:'REFUND'},{articleId:'c',direction:'OUT',economicType:'OTHER'},{articleId:'cv',direction:'OUT',economicType:'OTHER'},{articleId:'d',systemKey:'DEPOSIT_RECEIVED',direction:'IN',economicType:'DEPOSIT_RECEIVED'}];
const catalog=[{articleId:'mechanism-services',name:'Оказание услуг',values:[{valueId:'payment',name:'Оплата услуг',routes:['SERVICE_REVENUE']},{valueId:'tips',name:'Чаевые',routes:['TIPS']},{valueId:'refund',name:'Возврат',routes:['REFUND']}]},{articleId:'c',name:'Закупки',values:[{valueId:'cv',name:'Продукты',routes:[]}]},{articleId:'mechanism-deposit',name:'Депозит',values:[{valueId:'funding',name:'Пополнение',routes:['DEPOSIT_RECEIVED']}]}];
const income=manualArticleChoices(raw,catalog,'IN');
assert.deepEqual(income.map(a=>a.label),['Оказание услуг']);
assert.deepEqual(income[0].values.map(v=>v.label),['Оплата услуг','Чаевые']);
assert.equal(manualRawArticle(income,'mechanism-services','tips'),'t');
assert.equal(manualRawArticle(income,'mechanism-services',''),'');
assert.deepEqual(manualArticleSelection(income,'s'),{articleId:'mechanism-services',valueId:'payment'});
const expense=manualArticleChoices(raw,catalog,'OUT');
assert.equal(manualRawArticle(expense,'c',''),'c');
assert.equal(manualRawArticle(expense,'c','cv'),'cv');
assert.equal(manualRawArticle(expense,'mechanism-services','refund'),'r');
assert.equal(manualDetailTotal([{quantity:2,unitPrice:10},{quantity:1,unitPrice:40},{quantity:1,unitPrice:60}]),120);
assert.equal(manualDetailTotal([{quantity:1.5,unitPrice:0.03}]),0.05);
assert.equal(validManualLine({name:'Молоко',quantity:1,unitPrice:20}),true);
assert.equal(validManualLine({name:'',quantity:1,unitPrice:20}),false);
console.log('PASS manual article/value mapping, direction and loyalty exclusions, detail totals');

// User-defined articles are not gated by legacy system-route visibility.
// A freshly created custom article is usable even before the catalogue catches up.
const customRaw=[
 {articleId:'legacy-root',systemKey:'OTHER_EXPENSE',direction:'OUT',economicType:'GROUP'},
 {articleId:'custom',name:'Хозяйственные расходы',parentArticleId:'legacy-root',direction:'OUT',economicType:'OPERATING_EXPENSE'},
 {articleId:'child',name:'Продукты',parentArticleId:'custom',direction:'OUT',economicType:'OPERATING_EXPENSE'},
 {articleId:'fresh',name:'Свежая статья',direction:'OUT',economicType:'OPERATING_EXPENSE'},
 {articleId:'archived',name:'Архив',direction:'OUT',economicType:'OPERATING_EXPENSE',archivedAt:'2026-11-28'},
 {articleId:'income',name:'Мой доход',direction:'IN',economicType:'OPERATING_REVENUE'}
];
const customCatalog=[{articleId:'custom',name:'Хозяйственные расходы',values:[{valueId:'child',name:'Продукты',routes:[]}]}];
const customChoices=manualArticleChoices(customRaw,customCatalog,'OUT',{allowedIds:[]});
assert.deepEqual(customChoices.map(a=>a.label),['Хозяйственные расходы','Свежая статья']);
assert.equal(manualRawArticle(customChoices,'custom','child'),'child');
assert.equal(manualRawArticle(customChoices,'fresh',''),'fresh');
assert.deepEqual(manualArticleChoices(customRaw,null,'IN',{allowedIds:[]}).map(a=>a.label),['Мой доход']);
assert.equal(manualArticleChoices(customRaw,[],'OUT',{allowedIds:[],fullCatalogue:customCatalog}).some(a=>a.value==='custom'),false);

const emptySystem=manualArticleChoices(raw,catalog,'IN',{allowEmptySystemValue:true});
assert.equal(manualRawArticle(emptySystem,'mechanism-services',''),'s');
assert.deepEqual(manualArticleSelection(emptySystem,'s'),{articleId:'mechanism-services',valueId:'payment'});
