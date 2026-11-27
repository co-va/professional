import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { dataTable } from '../ui/page/page.js';

const css=(await Promise.all(['ui/page/page.css','ui/v2/v2.css'].map(p=>readFile(new URL('../'+p,import.meta.url),'utf8')))).join('\n');
const expected={"select":32,"date":84,"title":108,"code":56,"person":160,"workplace":120,"article":130,"amount":96,"bonus":96};
const order=['select','date','title','code','person','workplace','amount','bonus'];
const labels={select:'',date:'Дата',title:'Операция',code:'Код',person:'Клиент / контрагент',workplace:'Рабочее пространство',article:'Статья',amount:'Сумма',bonus:'Бонусы'};
const headings={date:['Дата','Время'],title:['Операция','Источник'],person:['Клиент / контрагент','Контакт'],workplace:['Рабочее','пространство']};
const columns=keys=>keys.map(key=>({key,label:labels[key],sortable:false,narrow:['select','date','code','amount','bonus'].includes(key),...(headings[key]?{header:()=>headings[key].map(v=>'<div>'+v+'</div>').join('')}:{} )}));
const rows=Array.from({length:24},(_,i)=>({select:'',date:'27.11.2026',title:i?'Приход':'Транзакция с длинным источником',code:'0001',person:i?'Иван':'Очень длинное имя клиента для проверки ширины',workplace:'Рабочее пространство',article:'Оплата услуг',amount:'50 000 ₽',bonus:'2 000'}));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 await page.setContent('<style>'+css+'\n.fixture{position:relative;width:var(--fixture-width);height:300px;overflow:hidden}.fixture [data-dds-history]{width:100%;height:100%}.fixture [data-wallet-history-host]{width:100%;height:230px}.fixture .ui-data-table--compact{max-height:200px}</style><div class="v2-app--workspace" data-v2-desktop-surface="list"><div class="v2-front"><div class="v2-z fixture" style="--fixture-width:670px"><div data-dds-history><div data-wallet-history-host></div></div></div></div></div>');
 const host=page.locator('[data-wallet-history-host]');
 const measure=()=>host.locator('thead th').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.dataset.tableColumn,Math.round(n.getBoundingClientRect().width)])));
 const mount=async keys=>host.evaluate((node,html)=>{node.innerHTML=html;},dataTable({columns:columns(keys),rows,caption:'ДДС',compact:true}));
 const check=async keys=>{const sizes=await measure();for(const key of keys)assert.equal(sizes[key],expected[key],key+' changed width');};
 await mount(order);await check(order);
 const table=host.locator('table');
 assert.equal(Math.round((await table.boundingBox()).width),752);
 await host.locator('tbody').evaluate(body=>{const group=body.insertRow(0);group.dataset.tableGroupLevel='group';const td=group.insertCell();td.colSpan=8;td.textContent='Длинная системная группа';for(const row of [...body.rows].slice(1))row.hidden=true;});
 await check(order);
 await host.locator('tbody').evaluate(body=>{for(const row of [...body.rows].slice(1))row.hidden=false;});
 await check(order);
 await page.locator('.fixture').evaluate(node=>node.style.setProperty('--fixture-width','1000px'));
 await check(order);
 assert.equal(await host.locator('.ui-data-table--compact').evaluate(node=>node.scrollWidth<=node.clientWidth),true,'No redundant horizontal scrolling');
 await page.locator('.fixture').evaluate(node=>node.style.setProperty('--fixture-width','670px'));
 await check(order);
 const flat=[...order.slice(0,6),'article',...order.slice(6)];
 await mount(flat);await check(flat);
 assert.equal(Math.round((await table.boundingBox()).width),882);
 console.log('PASS: DDS exact widths across collapse, resize, grouped and flat table');
}finally{await browser.close();}
