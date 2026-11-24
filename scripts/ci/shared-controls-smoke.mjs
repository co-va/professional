import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { field, phoneInput, textareaField } from '../../ui/inputs/index.js';
import { select } from '../../ui/selectors/index.js';
import { compactCheck, checkList } from '../../ui/selection/check-list.js';
import { notificationSettings } from '../../ui/settings/index.js';

const read = path => readFileSync(path, 'utf8');
const styles = [...read('index.html').matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(match => match[1]);
styles.push('ui/booking/booking.css');
const css = [...new Set(styles)].map(read).join('\n');
const option = [{value:'a',label:'A'}];
const inputMarkup = field({name:'name',label:'Имя',value:'Анна'});
const selectMarkup = select({name:'value',label:'Выбор',value:'a',options:option});
const normal = '<div data-test="standard">'+inputMarkup+selectMarkup+phoneInput({value:'+79991234567'})+textareaField({name:'note'})+'</div>';
const auth = '<div class="shared-login-form">'+field({name:'login'})+'</div>';
const booking = '<div class="booking-account">'+field({name:'guest'})+select({name:'guestChoice',value:'a',options:option})+'</div>';
const narrow = '<div class="inventory-editor-measure__control" style="width:120px">'+select({name:'unit',value:'a',options:option})+field({name:'amount',type:'number'})+'</div>';
const checks = '<div data-test="compact">'+compactCheck({label:'Выбрать',checked:true})+'</div>'
  + '<div data-inventory-audit-criteria><div class="field-inline-label">'+compactCheck({checked:true,aria:'Выбрать позицию'})+'<strong>Товар</strong></div></div>'
  + '<div data-inventory-order-review><div class="field-inline-label">'+compactCheck({checked:true,aria:'Выбрать заказ'})+'<strong>Товар</strong></div></div>'
  + checkList([{value:'a',label:'Позиция',checked:true}])
  + notificationSettings([{label:'Email',checked:true,data:'data-email-test'},{label:'Push',disabled:true,data:'data-push-test'}]);
// Inventory of direct checkbox markup outside the shared renderer.
// Report remaining cases instead of silently claiming that all feature paths
// use the component; they must be reviewed before accepting the release.
const files = execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(path=>/\.(js|html)$/.test(path)&&!path.startsWith('scripts/')&&path!=='ui/selection/check-list.js');
const directChecks=[];
for(const path of files){
  const source=read(path);
  const raw = [...source.matchAll(/<input\b[^>]{0,500}\btype\s*=\s*["']checkbox["']/gi)];
  for(const hit of raw) directChecks.push(path+':'+source.slice(0,hit.index).split('\n').length);
}

assert.deepEqual(directChecks, [], 'All checkboxes must use Shared UI');
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage({viewport:{width:390,height:844}});
  await page.setContent('<style>'+css+'</style><main style="width:350px">'+normal+auth+booking+narrow+checks+'</main>');
  const metrics = await page.locator('input:not([type=hidden]):not([type=checkbox]),.ui-select__control').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width>0).map(n=>({name:n.name||n.textContent,height:n.getBoundingClientRect().height,radius:getComputedStyle(n).borderRadius,font:getComputedStyle(n).fontSize})));
  assert.ok(metrics.length>=9, JSON.stringify(metrics));
  for (const m of metrics) {
    assert.equal(m.height,46,JSON.stringify(m));
    assert.equal(m.radius,'0px',JSON.stringify(m));
    assert.equal(m.font,'16px',JSON.stringify(m));
  }
  const marks = await page.locator('.ui-compact-check__mark').evaluateAll(nodes=>nodes.map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height,r:getComputedStyle(n).borderRadius,bg:getComputedStyle(n).backgroundColor,checked:n.previousElementSibling.checked,content:getComputedStyle(n,'::after').content,font:getComputedStyle(n,'::after').fontSize})));
  assert.equal(marks.length,6);
  for (const mark of marks) {
    assert.equal(mark.w,28,JSON.stringify(mark));
    assert.equal(mark.h,28,JSON.stringify(mark));
    assert.equal(mark.r,'8px',JSON.stringify(mark));
    assert.equal(mark.bg,'rgb(255, 255, 255)',JSON.stringify(mark));
    if(mark.checked){assert.equal(mark.content,'"✓"');assert.equal(mark.font,'19px');}
  }
  await page.locator('.app-notification-row').first().click();
  assert.equal(await page.locator('[data-email-test]').isChecked(),false);
  assert.equal(await page.locator('[data-push-test]').isDisabled(),true);
  await page.locator('.app-notification-row').last().evaluate(label=>label.click());
  assert.equal(await page.locator('[data-push-test]').isChecked(),false);
  console.log('PASS: actual shared inputs and selectors 46px/16px, all six checkbox marks 28px and common behavior');
} finally { await browser.close(); }

