import assert from 'node:assert/strict';
import {sortGroupingSection} from '../ui/selection/check-list.js';
import {buildDDSGroups,flattenDDSGroups,walletGroupingIdentity} from '../core/finance/dds/view-order.js';
const markup=sortGroupingSection([{label:'По статьям',checked:true,data:'data-dds-group-articles'},{label:'По значениям',data:'data-dds-group-values'}]);
assert.match(markup,/sort-grouping-section/);
assert.equal((markup.match(/type="checkbox"/g)||[]).length,2);
assert.match(markup,/sort-menu-order-label/);
const catalog=[{articleId:'s',name:'Услуги',values:[{valueId:'a',name:'Оплата'},{valueId:'b',name:'Чаевые'}]},{articleId:'p',name:'Товары',values:[{valueId:'c',name:'Продажа'}]}];
const a={articleId:'s',articleName:'Услуги',valueId:'a',valueName:'Оплата'},b={articleId:'s',articleName:'Услуги',valueId:'b',valueName:'Чаевые'},c={articleId:'p',articleName:'Товары',valueId:'c',valueName:'Продажа'};
const rows=[[a],[a,b],[a,c],[c]].map((classes,i)=>({id:String(i),article:[...new Set(classes.map(x=>x.articleName))].join(' · '),value:100+i,...walletGroupingIdentity(classes,catalog)}));
assert.deepEqual(walletGroupingIdentity([c,a,a],catalog),walletGroupingIdentity([a,c],catalog));
for(const groupArticles of [false,true])for(const groupValues of [false,true]){
 const groups=buildDDSGroups(rows,{groupArticles,groupValues,catalog});
 const visible=groupArticles||groupValues?flattenDDSGroups(groups):rows;
 assert.equal(visible.length,rows.length);
 assert.equal(new Set(visible.map(r=>r.id)).size,rows.length);
 assert.equal(visible.reduce((n,r)=>n+r.value,0),406);
}
console.log('PASS: shared grouping menu, wallet groups preserve one row and original amount per payment');
