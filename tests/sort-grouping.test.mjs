import assert from 'node:assert/strict';
import {sortGroupingSection} from '../ui/selection/check-list.js';
import {buildDDSGroups,flattenDDSGroups} from '../core/finance/dds/view-order.js';
import {readFileSync} from 'node:fs';
const markup=sortGroupingSection([{label:'По статьям',checked:true,data:'data-dds-group-articles'},{label:'По значениям',data:'data-dds-group-values'}]);
assert.match(markup,/sort-grouping-section/);
assert.equal((markup.match(/type="checkbox"/g)||[]).length,2);
assert.match(markup,/sort-menu-order-label/);
const wallet=readFileSync(new URL('../core/finance/cash/wallet-history.js',import.meta.url),'utf8');
assert.match(wallet,/const grouping=dds\?sortGroupingSection/);
assert.match(wallet,/const groupArticles=dds&&state.groupArticles,groupValues=dds&&state.groupValues/);
const catalog=[{articleId:'s',name:'Услуги',values:[{valueId:'a',name:'Оплата'},{valueId:'b',name:'Чаевые'}]},{articleId:'p',name:'Товары',values:[{valueId:'c',name:'Продажа'}]}];
const rows=[{id:'1',articleId:'s',article:'Услуги',articleValueId:'a',articleValue:'Оплата',value:100},{id:'2',articleId:'s',article:'Услуги',articleValueId:'b',articleValue:'Чаевые',value:200},{id:'3',articleId:'p',article:'Товары',articleValueId:'c',articleValue:'Продажа',value:300}];
for(const groupArticles of [false,true])for(const groupValues of [false,true]){
 const groups=buildDDSGroups(rows,{groupArticles,groupValues,catalog});
 const visible=groupArticles||groupValues?flattenDDSGroups(groups):rows;
 assert.equal(visible.length,rows.length);
 assert.equal(new Set(visible.map(r=>r.id)).size,rows.length);
 assert.equal(visible.reduce((n,r)=>n+r.value,0),600);
}
console.log('PASS: shared grouping menu, grouping only in DDS and not wallet history');
