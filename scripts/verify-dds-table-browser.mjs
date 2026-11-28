import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { dataTable } from '../ui/page/page.js';
import { v2Shell } from '../ui/v2/shell.js';

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
 await page.setContent('<style>'+css+'\n.fixture{position:relative;width:var(--fixture-width)!important;height:300px;overflow:hidden}.fixture [data-dds-history]{width:100%;height:100%}.fixture [data-wallet-history-host]{width:100%;height:230px}.fixture .ui-data-table--compact{max-height:200px}</style><div class="v2-app--workspace" data-v2-desktop-surface="list"><div class="v2-front"><div class="v2-z fixture" style="--fixture-width:670px"><div data-dds-history><div data-wallet-history-host></div></div></div></div></div>');
 const host=page.locator('[data-wallet-history-host]');
 const measure=()=>host.locator('thead th').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.dataset.tableColumn,Math.round(n.getBoundingClientRect().width)])));
 const mount=async keys=>host.evaluate((node,html)=>{node.innerHTML=html;},dataTable({columns:columns(keys),rows,caption:'ДДС',compact:true}));
 const table=host.locator('table');
 const viewport=host.locator('.ui-data-table--compact');
 const geometry=()=>viewport.evaluate(node=>({frame:node.getBoundingClientRect().width,host:node.parentElement.getBoundingClientRect().width,available:node.clientWidth,table:node.querySelector('table').getBoundingClientRect().width,scroll:node.scrollWidth}));
 const check=async keys=>{
   const g=await geometry(),sizes=await measure(),minimum=keys.reduce((sum,key)=>sum+expected[key],0);
   assert.ok(Math.abs(g.frame-g.host)<=1,'DDS frame must fill the working area: '+JSON.stringify(g));
   assert.ok(Math.abs(g.table-Math.max(g.available,minimum))<=1,'DDS must fill the available table width: '+JSON.stringify(g));
   for(const key of keys)assert.ok(Math.abs(sizes[key]-g.table*expected[key]/minimum)<=1,key+' unexpected proportion');
   return sizes;
 };
 await mount(order);
 assert.ok((await geometry()).available<752,'Narrow fixture must actually be narrower than the DDS minimum');
 const narrow=await check(order);
 assert.equal(Math.round((await table.boundingBox()).width),752);
 await host.locator('tbody').evaluate(body=>{const group=body.insertRow(0);group.dataset.tableGroupLevel='group';const td=group.insertCell();td.colSpan=8;td.textContent='Длинная системная группа';for(const row of [...body.rows].slice(1))row.hidden=true;});
 assert.deepEqual(await check(order),narrow,'Collapse must not redistribute columns');
 await host.locator('tbody').evaluate(body=>{for(const row of [...body.rows].slice(1))row.hidden=false;});
 assert.deepEqual(await check(order),narrow);
 await page.locator('.fixture').evaluate(node=>node.style.setProperty('--fixture-width','1000px'));
 assert.ok((await geometry()).available>882,'Wide fixture must actually exceed both DDS minimum widths');
 const wide=await check(order);
 assert.equal(await viewport.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true,'No redundant horizontal scrolling');
 await host.locator('tbody').evaluate(body=>{for(const row of [...body.rows].slice(1))row.hidden=true;});
 assert.deepEqual(await check(order),wide,'Wide table stable when scrollbar disappears');
 await host.locator('tbody').evaluate(body=>{for(const row of [...body.rows].slice(1))row.hidden=false;});
 await page.locator('.fixture').evaluate(node=>node.style.setProperty('--fixture-width','670px'));
 assert.deepEqual(await check(order),narrow);
 const flat=[...order.slice(0,6),'article',...order.slice(6)];
 await mount(flat);await check(flat);
 assert.equal(Math.round((await table.boundingBox()).width),882);
 await page.locator('.fixture').evaluate(node=>node.style.setProperty('--fixture-width','1000px'));
 await check(flat);

 // Exercise the real shell with the actual viewport controller. A laptop
 // browser may become shorter while the search field retains focus.
 const fullCss=(await Promise.all(['css/style.css','ui/page/page.css','ui/v2/v2.css','ui/inputs/keyboard.css'].map(p=>readFile(new URL('../'+p,import.meta.url),'utf8')))).join('\n');
 const keyboardSource=await readFile(new URL('../ui/inputs/keyboard-runtime.js',import.meta.url),'utf8');
 const long='Очень длинное наименование депозита и услуги для проверки переноса строки';
 const richColumns=columns(flat).map(c=>['date','title','person','article'].includes(c.key)?{...c,render:row=>'<div><div class="people-table-person__name">'+row[c.key]+'</div><div class="people-table-person__phone">'+long+'</div></div>'}:c);
 const longRows=rows.map((row,i)=>({...row,title:long,workplace:long,person:long,article:long,code:String(i+1)}));
 const markup=dataTable({columns:richColumns,rows:longRows,caption:'ДДС',compact:true});
 const shell=v2Shell({className:'v2-app--workspace',header:'<header class="v2-header">Кабинет</header>',desktopCalendar:true,deck:'<div>Меню</div>',body:'<section class="v2-workspace-surface" data-v2-workspace-surface><div data-dds-history><section><div class="v2-desktop-tool-row">24</div><div data-wallet-history-host>'+markup+'</div></section></div></section>'});
 const real=await browser.newPage({viewport:{width:1440,height:900}});
 await real.setContent('<!doctype html><style>'+fullCss+'</style><div class="app-shell">'+shell+'</div>');
 await real.evaluate(()=>{document.querySelector('[data-v2-app]').dataset.v2DesktopSurface='list';document.querySelector('[data-h-title]').textContent='Движения денежных средств';document.querySelector('[data-v2-z-header-content]').innerHTML='<section data-people-desktop-toolbar><input type="search" aria-label="Поиск"></section>';document.querySelector('[data-v2-desktop-calendar]').innerHTML='<div style="height:320px">Календарь</div>';});
 await real.addScriptTag({content:keyboardSource});
 const fullGeometry=()=>real.evaluate(()=>{
   const app=document.querySelector('[data-v2-app]'),frame=document.querySelector('[data-wallet-history-host]>.ui-data-table--compact'),last=frame.querySelector('tbody tr:last-child');
   frame.scrollTop=frame.scrollHeight;
   const box=frame.getBoundingClientRect();
   return {viewport:innerHeight,appBottom:app.getBoundingClientRect().bottom,frameBottom:box.bottom,lastBottom:last.getBoundingClientRect().bottom,frameTop:box.top,scrollTop:frame.scrollTop,max:frame.scrollHeight-frame.clientHeight,radius:getComputedStyle(frame).borderBottomLeftRadius,heights:[...frame.querySelectorAll('tbody tr')].map(tr=>tr.getBoundingClientRect().height),widths:[...frame.querySelectorAll('thead th')].map(th=>th.getBoundingClientRect().width)};
 });
 const verifyVertical=g=>{
   assert.ok(g.frameBottom<=g.viewport-20,'Frame must end inside visible H: '+JSON.stringify(g));
   assert.ok(g.appBottom<=g.viewport+1,'App must fit current laptop viewport: '+JSON.stringify(g));
   assert.ok(g.lastBottom<=g.frameBottom+1 && g.lastBottom>g.frameTop,'Last row must be visible at scroll end');
   assert.ok(Math.abs(g.max-g.scrollTop)<=1,'Reach maximum scroll');
   assert.ok(parseFloat(g.radius)>0,'Rounded frame is retained');
   assert.ok(g.heights.every(h=>Math.abs(h-44)<=1),'All data rows must be 44px: '+JSON.stringify(g.heights));
 };
 const tall=await fullGeometry();verifyVertical(tall);
 await real.locator('input[type=search]').focus();
 await real.setViewportSize({width:1440,height:640});
 await real.waitForFunction(()=>getComputedStyle(document.documentElement).getPropertyValue('--app-stable-vh').trim()==='640px');
 const short=await fullGeometry();verifyVertical(short);
 assert.deepEqual(short.widths,tall.widths,'Height-only resize must not change DDS column widths');
 await real.close();
 console.log('PASS: DDS fills work area, stable column proportions across collapse and resize; 44px rows and fully visible rounded frame after laptop resize');
}finally{await browser.close();}
