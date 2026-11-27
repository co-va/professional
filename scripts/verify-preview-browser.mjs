import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const target=process.argv[2];
if(!target) throw Error('Preview URL required');
const local=process.argv.includes('--local');
const browser=await chromium.launch({headless:true,args:local?['--host-resolver-rules=MAP professional-volokovykh.msk1.amvera.tech 127.0.0.1','--no-proxy-server']:[]});
try {
  const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1280,height:900}});
  const errors=[];
  const isApi=url=>new URL(url).pathname.startsWith('/api/')||new URL(url).hostname==='api.va-tools.ru';
  page.on('requestfailed',r=>{if(!isApi(r.url()))errors.push(r.url()+' '+r.failure()?.errorText);});
  page.on('response',r=>{if(r.status()>=400&&!isApi(r.url()))errors.push(r.status()+' '+r.url());});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',message=>{if(message.type()==='error')console.log('BROWSER ERROR:',message.text());});
  // Hold the operational response to exercise the initial Desktop render.
  let releaseOperational;
  const operationalReady = new Promise(resolve => { releaseOperational = resolve; });
  // All account calls are synthetic. Never send a real token or mutate Core.
  await page.route('**/*',async r=>{
    const url=new URL(r.request().url());
    if(isApi(url.href)) {
      const body=url.pathname.endsWith('/auth/me')?{account:{id:'preview-smoke',email:'preview@example.invalid'},tenantId:'preview-smoke'}:
        url.pathname.endsWith('/saas-access/me')?{tenantId:'preview-smoke',status:'ACTIVE',commercialMode:'LIVE',capabilities:['profile.access','workplaces.access','journal.day.access','journal.month.access','timetable.access','loyalty.deposit.access','loyalty.personal_account.access','finance.cash.access','finance.income_expense.access'].map(key=>({key,valueType:'BOOLEAN',enabled:true}))}:
        url.pathname.endsWith('/auxiliary-state/loyalty')?{wallets:[],depositPrograms:Array.from({length:4},(_,i)=>({id:'smoke-program-'+i,name:'Тестовый депозит '+(i+1),amount:10000,amountMode:'fixed',status:'active',termMode:'indefinite'}))}:
        url.pathname.endsWith('/loyalty/deposits/smoke-issued-1/settings')?{depositId:'smoke-issued-1',visibleToPersonOverride:r.request().postDataJSON()?.visibleToPerson}:
        url.pathname.endsWith('/loyalty/deposits')?[{depositId:'smoke-issued-1',programId:'smoke-program-0',programName:'Тестовый депозит 1',person:{key:'smoke-person',name:'Тестовый клиент',uei:'T001'},status:'active',balance:10000,fundedAmount:10000,cardSequence:1,fundedAt:'2026-01-01T10:00:00Z',terms:{amount:10000,amountMode:'fixed',termMode:'indefinite'},history:[{operationId:'smoke-funding',kind:'deposit-funding',direction:'in',amount:10000,occurredAt:'2026-01-01T10:00:00Z',recordedAt:'2026-01-02T10:00:00Z',origin:'application',walletName:'Наличные',recordId:'smoke-record'}]},{depositId:'smoke-issued-debt',programId:'smoke-program-0',programName:'Тестовый депозит 1',person:{key:'smoke-debt-person',name:'Долг'},status:'active',balance:20000,fundedAmount:20000,cardSequence:2,fundedAt:'2025-01-01T10:00:00Z',terms:{amount:50000,amountMode:'fixed',termMode:'dated',termStartDate:'2025-01-01',termEndDate:'2099-12-31'},history:[]},{depositId:'smoke-issued-future',programId:'smoke-program-0',programName:'Тестовый депозит 1',person:{key:'smoke-future-person',name:'Будущая карта'},status:'active',balance:20000,fundedAmount:20000,cardSequence:3,fundedAt:'2025-01-01T10:00:00Z',terms:{amount:50000,amountMode:'fixed',termMode:'dated',termStartDate:'2099-01-01',termEndDate:'2099-12-31'},history:[]}]:
        url.pathname.endsWith('/loyalty/personal-accounts')?[{personKey:'smoke-person',hasActivity:true,balance:0,debtTotal:0,movements:[{id:'smoke-event',kind:'funding',amount:100,occurredAt:'2026-01-01T10:00:00Z'}],debts:[]}]:
        url.pathname.endsWith('/business-state/operational')?{procedures:[],days:[]}:
        url.pathname.endsWith('/auth/email-verification/status')?{email:'preview@example.invalid',verified:true}:{};
      if (url.pathname.endsWith('/business-state/operational')) await operationalReady;
      return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    }
    if(url.origin!==new URL(target).origin) return r.abort();
    return r.continue();
  });
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('#app').getByText('Вход в Кабинет',{exact:true}).waitFor({timeout:30000});
  console.log('PASS: preview login rendered');
  await page.evaluate(()=>localStorage.setItem('va-tools.auth.token','preview-smoke-synthetic-token'));
  await page.reload({waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('[data-v2-app].v2-app--workspace').waitFor({timeout:30000});
  await page.locator('[data-v2-workspace-surface]').waitFor({state:'attached',timeout:10000});
  assert.equal(await page.locator('[data-workspace-load-error]').count(),0);
  const shell=page.locator('.v2-app--workspace');
  const sidebar=shell.locator('[data-v2-desktop-calendar]');
  const navigation=shell.locator('[data-v2-fe]');
  await sidebar.locator('.calendar__grid').waitFor({state:'visible'});
  assert.equal(await sidebar.getAttribute('aria-busy'),'true','Dates exist before server response');
  assert.equal(await sidebar.evaluate(node=>node.inert),true,'Loading dates do not accept actions');
  assert.equal(await navigation.isVisible(),false,'F must not appear at an incorrect initial position');
  const separator=await shell.locator('[data-v2-header]').evaluate(node=>({
    start:parseFloat(getComputedStyle(node,'::after').insetInlineStart),
    width:parseFloat(getComputedStyle(node.closest('[data-v2-app]')).getPropertyValue('--v2-desktop-sidebar-width')),
    background:getComputedStyle(node).borderBottomColor,
    end:parseFloat(getComputedStyle(node,'::after').insetInlineEnd),
  }));
  assert.equal(separator.start,separator.width,'Separator starts at F boundary');
  assert.equal(separator.end,0);
  assert.equal(separator.background,'rgba(0, 0, 0, 0)','No full-width header border');
  releaseOperational();
  await navigation.waitFor({state:'visible'});
  assert.equal(await sidebar.getAttribute('aria-busy'),null);
  assert.equal(await sidebar.evaluate(node=>node.inert),false);
  const sidebarBounds=await sidebar.boundingBox();
  const navBounds=await navigation.boundingBox();
  assert.ok(navBounds.y>=sidebarBounds.y+sidebarBounds.height-1,'F follows the fully rendered calendar');
  console.log('PASS: Desktop dates before hydration, stable first F reveal and H-only divider');
  const surface=page.locator('[data-v2-front]>[data-v2-z]');
  const geometry=()=>surface.evaluate(node=>({background:getComputedStyle(node).backgroundColor,radius:getComputedStyle(node).borderTopLeftRadius}));
  await shell.locator('[data-v2-root-item="journal"]').waitFor({state:'attached'});
  assert.equal(await shell.getAttribute('data-v2-desktop-surface'),'journal');
  const journalBody=surface.locator(':scope > [data-v2-z-body]');
  assert.equal(await journalBody.evaluate(node=>getComputedStyle(node).borderTopLeftRadius),'34px','Journal retains full Z body');
  assert.equal((await geometry()).background,'rgb(47, 51, 56)','Journal controls on H');
  assert.equal(await shell.locator('[data-v2-root-item="profile"]').count(),0,'Desktop F excludes Profile');
  // Owner-approved Desktop header; do not restore the retired F entry.
  assert.equal(await shell.locator('[data-v2-root-item="workplaces"]').count(),0,'Desktop F excludes workplaces');
  assert.equal(await shell.locator('[data-desktop-profile]').isVisible(),true,'Profile in right toolbar');
  const workplaces= shell.locator('[data-v2-header] [data-desktop-workplaces]');
  assert.equal(await workplaces.count(),1,'One workplace control in Header');
  assert.equal(await workplaces.isVisible(),true,'Desktop workplaces accessible in Header');
  await workplaces.click();
  await page.waitForFunction(()=>document.querySelector('.v2-app--workspace')?.dataset.v2DesktopSurface==='list');
  assert.deepEqual(await geometry(),{background:'rgb(47, 51, 56)',radius:'0px'},'Desktop profile is on H, not white Z');
  await page.setViewportSize({width:390,height:844});
  assert.equal((await geometry()).radius,'34px','Phone keeps original Z');
  await page.setViewportSize({width:1280,height:900});
  await page.evaluate(()=>{location.hash='journal';});
  await page.waitForFunction(()=>document.querySelector('.v2-app--workspace')?.dataset.v2DesktopSurface==='journal');
  assert.equal(await journalBody.evaluate(node=>getComputedStyle(node).borderTopLeftRadius),'34px','Return to Journal restores Z body');
  console.log('PASS: Journal-only Desktop Z; non-Journal H; Mobile Z preserved');
  await page.setViewportSize({width:1024,height:768});
  await shell.locator('[data-v2-root-item="finance"]').click({timeout:15000});
  const cashTools=surface.locator('[data-v2-z-header] [data-cash-desktop-tools]');
  await cashTools.waitFor({timeout:20000});
  assert.equal(await surface.locator('[data-cash-settings]').count(),0,'Desktop Cash has no legacy V');
  assert.equal(await cashTools.locator('button').count(),2,'Exactly two Cash tools');
  const cashGeometry=await cashTools.locator('button').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();const icon=node.querySelector('svg').getBoundingClientRect();return {width:r.width,height:r.height,y:r.top+r.height/2,iconX:icon.left+icon.width/2-(r.left+r.width/2),iconY:icon.top+icon.height/2-(r.top+r.height/2),text:node.textContent.trim()};}));
  for(const g of cashGeometry){assert.equal(g.width,36);assert.equal(g.height,36);assert.equal(g.text,'');assert.ok(Math.abs(g.iconX)<1&&Math.abs(g.iconY)<1,'Centered H icon');}
  assert.ok(Math.abs(cashGeometry[0].y-cashGeometry[1].y)<0.5,'Shared H axis');
  await cashTools.locator('[data-cash-desktop-view]').click();
  const cashAppearance=page.getByRole('dialog',{name:'Вид',exact:true});
  await cashAppearance.locator('[name="entityCardAppearanceType"]').waitFor({state:'attached'});
  await cashAppearance.locator('[data-v2-q-close]').click();
  await cashTools.locator('[data-cash-desktop-operations]').click();
  const cashOperations=page.getByRole('dialog',{name:'Финансовые операции',exact:true});
  await cashOperations.locator('[data-finance-operation-action="manual-income"]').waitFor();
  await cashOperations.evaluate(node=>node.closest('[data-v2-layer]')?.v2Close?.());
  console.log('PASS: Desktop Cash icon toolbar opens existing appearance and finance operations');
  await shell.locator('[data-v2-root-item="loyalty"]').click({timeout:15000});
  const programs=surface.locator('[data-loyalty-program-section="deposit"]');
  await programs.locator('[data-deposit-program]').first().waitFor({timeout:20000});
  assert.equal(await programs.locator('[data-deposit-program]').count(),4,'All synthetic deposit programs rendered');
  assert.equal(await shell.locator('[data-v2-secondary-item="programs"]').count(),1);
  assert.equal(await surface.locator('[data-h-title]').textContent(),'Программы');
  await surface.locator('[data-program-view]').click({timeout:10000});
  const appearance=page.locator('.desktop-appearance-q');
  await appearance.locator('[name="entityCardAppearanceType"]').waitFor({state:'attached'});
  assert.equal(await appearance.locator('[name="entityCardAppearanceType"]').inputValue(),'deposit');
  const targetSelector=appearance.locator('button[data-entity-card-appearance-target]');
  await targetSelector.click();
  await page.locator('[data-ui-select-option][data-value="smoke-program-1"]').click();
  assert.equal(await appearance.locator('[name="entityCardAppearanceTarget"]').inputValue(),'smoke-program-1');
  assert.match(await appearance.locator('[data-card-preview]').textContent(),/Тестовый депозит 2/);
  const geometryOf=locator=>locator.evaluate(node=>({height:node.getBoundingClientRect().height,border:getComputedStyle(node).borderTopWidth}));
  const typeSelector=appearance.locator('button[data-entity-card-appearance-type]');
  const fieldSelector=appearance.locator('button[data-card-line-field]');
  const line=appearance.locator('[data-card-line-select="0"]');
  const format=appearance.locator('[data-card-tool="italic"]');
  assert.deepEqual(await geometryOf(typeSelector),{height:36,border:'1px'});
  for(const control of [targetSelector,fieldSelector,line,format])assert.deepEqual(await geometryOf(control),await geometryOf(typeSelector));
  assert.equal(await fieldSelector.locator('.ui-select__text').evaluate(node=>getComputedStyle(node).display),'flex');
  const sectionGaps = await appearance.evaluate(node => {
    const rect = selector => node.querySelector(selector).getBoundingClientRect();
    const gap = (above, below) => Math.round(rect(below).top - rect(above).bottom);
    return {
      header: gap('.entity-card-appearance-q__selectors', '.entity-card-editor__preview'),
      preview: gap('.entity-card-editor__preview', '.entity-card-editor__tabs'),
      tabs: gap('.entity-card-editor__tabs', '.entity-card-editor__section--placement'),
      placement: gap('.entity-card-editor__section--placement', '.entity-card-editor__section--data'),
      field: gap('.entity-card-editor__section--data', '.entity-card-editor__section--format'),
    };
  });
  assert.ok(sectionGaps.header >= 24, JSON.stringify(sectionGaps));
  for (const key of ['preview','tabs','placement','field']) {
    assert.equal(sectionGaps[key],24, key + ' must use the common View section gap');
  }
  assert.equal(await appearance.locator('[data-card-q-save]').isVisible(),false);
  await format.click();
  assert.equal(await appearance.locator('[data-v2-q-header] [data-card-q-save]').isVisible(),true);
  await format.click();
  assert.equal(await appearance.locator('[data-card-q-save]').isVisible(),false);
  await appearance.locator('button[data-card-line-field]').click({timeout:10000});
  const fieldOption=page.locator('.people-card-field-selector [data-ui-select-option][data-value="uei"]');
  await fieldOption.waitFor({timeout:10000});
  assert.match(await fieldOption.textContent(),/Код программы/);
  assert.equal(await fieldOption.locator('.ui-selector__option-main').evaluate(node=>getComputedStyle(node).display),'flex');
  await fieldOption.click();
  await appearance.locator('[data-v2-q-close]').click();
  await surface.locator('[data-program-add]').click({timeout:10000});
  await page.locator('[data-program-choice="deposit"]').click({timeout:10000});
  const create=page.locator('[data-deposit-program-form]');
  await create.waitFor({timeout:10000});
  assert.match(await create.textContent(),/Код/);
  assert.doesNotMatch(await create.textContent(),/UEI/);
  assert.equal(await create.locator('input[name="name"]').evaluate(node=>node.getBoundingClientRect().height),46,'Text input retains 46px');
  for(const selector of await create.locator('.ui-select__control:visible').all()){
    assert.equal(await selector.evaluate(node=>node.getBoundingClientRect().height),36,'Shared Desktop form selector is 36px');
  }
  await page.locator('.v2-layer--standard:has([data-deposit-program-form]) [data-v2-q-close]').click();
  await programs.locator('[data-deposit-program]').first().click();
  const programDetail=page.locator('.loyalty-deposit-program-z');
  await programDetail.locator('[data-deposit-program-toolbar]').waitFor({timeout:15000});
  assert.equal(await programDetail.locator('[data-deposit-program-settings]').count(),0,'Desktop program has no V source');
  for(const action of ['code','copy','fund','delete']) assert.equal(await programDetail.locator(`[data-deposit-program-action="${action}"]`).count(),1);
  assert.equal(await programDetail.locator('[data-deposit-program-visible]').count(),0,'Visibility is per issued card, not a Desktop toolbar switch');
  assert.equal(await programDetail.locator('[data-deposit-program-action="delete"] svg').count(),1,'Delete uses trash icon');
  assert.equal(await programDetail.locator('[data-deposit-program-action="delete"]').getAttribute('aria-label'),'Удалить программу');
  assert.equal(await programDetail.locator('.v2-section__title').evaluate(node=>getComputedStyle(node).color),await shell.locator('.v2-desktop-toolbar-context>span').first().evaluate(node=>getComputedStyle(node).color),'Section caption uses H secondary ink');
  const issuedHeaders=programDetail.locator('.ui-data-table th');
  assert.ok(await issuedHeaders.count(),'Synthetic issued deposit table exists');
  assert.equal(await issuedHeaders.first().evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(224, 214, 214)');
  assert.equal(await issuedHeaders.first().evaluate(node=>getComputedStyle(node).textTransform),'uppercase');
  assert.equal(await programDetail.locator('[data-deposit-row-visible]').count(),await programDetail.locator('.ui-data-table tbody tr').count());
  const depositCount=programDetail.locator('[data-deposit-count]');
  assert.equal(await depositCount.textContent(),'3 / 3','Issued / visible count');
  const firstVisibility=programDetail.locator('[data-deposit-row-visible="smoke-issued-1"]');
  await firstVisibility.uncheck();
  await page.waitForFunction(()=>document.querySelector('[data-deposit-count]')?.textContent==='3 / 2');
  await firstVisibility.check();
  await page.waitForFunction(()=>document.querySelector('[data-deposit-count]')?.textContent==='3 / 3');
  assert.equal(await page.locator('[data-v2-q="true"]').count(),0,'Visibility does not open a Q');
  const debtStatus=programDetail.locator('[data-deposit-open-row="smoke-issued-debt"] .deposit-list-status');
  const futureStatus=programDetail.locator('[data-deposit-open-row="smoke-issued-future"] .deposit-list-status');
  assert.equal(await debtStatus.locator('span').first().textContent(),'Задолженность');
  assert.equal(await futureStatus.locator('span').first().textContent(),'К оплате');
  assert.match(await debtStatus.locator('.deposit-list-status__amount').textContent(),/30\s*000/);
  assert.ok(await debtStatus.locator('span').last().evaluate(node=>node.getBoundingClientRect().top>node.previousElementSibling.getBoundingClientRect().top),'Debt amount on a separate line');
  assert.equal(await programDetail.locator('[data-deposit-open-row="smoke-issued-1"] .deposit-list-status').textContent(),'Оплачено');
  await programDetail.locator('[data-deposit-open-row="smoke-issued-1"] [data-table-column="balance"]').click();
  const issuedQ=page.locator('.loyalty-deposit-instance-q');
  await issuedQ.locator('.entity-visual-card').waitFor({timeout:15000});
  await issuedQ.locator('[data-deposit-history-entry]').first().waitFor({timeout:10000});
  assert.equal(await issuedQ.locator('.v2-section__title').filter({hasText:'История'}).count(),1);
  await issuedQ.locator('[data-v2-q-close]').click();
  // Open the same issued deposit through the Mobile rendering path.
  await programDetail.locator('[data-h-back]').click();
  await page.setViewportSize({width:390,height:844});
  await programs.locator('[data-deposit-program]').first().click();
  await programDetail.locator('[data-deposit-instance]').first().click();
  await issuedQ.locator('.entity-visual-card').waitFor({timeout:15000});
  await issuedQ.locator('[data-deposit-history-entry]').first().waitFor({timeout:10000});
  assert.equal(await issuedQ.locator('[data-deposit-card-history]').count(),0,'No second Mobile history Q');
  assert.equal(await issuedQ.locator('[data-deposit-instance-settings]').count(),1,'Mobile V is preserved');
  assert.equal(await page.locator('[data-v2-q="true"]').count(),1,'One Mobile Q for card and history');
  await issuedQ.locator('[data-deposit-summary]').click();
  const summaryS=page.getByRole('dialog',{name:'Оформление депозита',exact:true});
  await summaryS.locator('[data-read-only-sheet]').waitFor({timeout:10000});
  assert.match(await summaryS.textContent(),/Тестовый клиент/);
  assert.equal(await page.locator('[data-v2-q="true"]').count(),1,'Card receipt does not create another Q');
  await summaryS.evaluate(node=>node.closest('[data-v2-layer]')?.v2Close?.());
  await issuedQ.locator('[data-deposit-history-entry]').first().click();
  const historyS=page.getByRole('dialog',{name:'Внесение',exact:true});
  await historyS.locator('[data-read-only-sheet]').waitFor({timeout:10000});
  assert.match(await historyS.textContent(),/Кошелёк/);
  assert.doesNotMatch(await historyS.textContent(),/Связь с Журналом/);
  assert.equal(await historyS.locator('[data-deposit-history-correct]').count(),1,'Same funding correction action on Mobile');
  assert.equal(await page.locator('[data-v2-q="true"]').count(),1,'Operation receipt does not create another Q');
  await historyS.evaluate(node=>node.closest('[data-v2-layer]')?.v2Close?.());
  await page.evaluate(()=>document.querySelector('.loyalty-deposit-instance-q')?.closest('[data-v2-layer]')?.v2Close?.());
  await page.evaluate(()=>document.querySelector('.loyalty-deposit-program-z')?.v2Close?.());
  await page.setViewportSize({width:1024,height:768});
  await programs.locator('[data-deposit-program]').first().click();
  await programDetail.locator('[data-deposit-program-toolbar]').waitFor({timeout:15000});
  await programDetail.locator('[data-deposit-program-action="copy"]').click();
  const copyForm=page.locator('[data-deposit-program-form]');
  await copyForm.waitFor({timeout:10000});
  assert.equal(await copyForm.locator('input[name="name"]').evaluate(node=>node.getBoundingClientRect().height),46);
  for(const selector of await copyForm.locator('.ui-select__control:visible').all()){
    assert.equal(await selector.evaluate(node=>node.getBoundingClientRect().height),36,'Copy uses the shared selector height');
  }
  await page.locator('.v2-layer--standard:has([data-deposit-program-form]) [data-v2-q-close]').click();
  await programDetail.locator('[data-h-back]').click();
  const rail=programs.locator('[data-entity-card-rail]');
  await page.waitForFunction(()=>document.querySelector('[data-loyalty-program-section="deposit"] [data-loyalty-rail-next]')?.disabled===false);
  assert.equal(await rail.evaluate(node=>node.scrollWidth>node.clientWidth),true,'Deposit cards overflow horizontally');
  await programs.locator('[data-loyalty-rail-next]').click({timeout:10000});
  await page.waitForFunction(()=>document.querySelector('[data-loyalty-program-section="deposit"] [data-entity-card-rail]')?.scrollLeft>0);
  // Actual click out of the formerly hanging section, not a forced DOM event.
  await shell.locator('[data-v2-secondary-item="personal-account"]').click({timeout:10000});
  await surface.locator('[data-personal-account-person]').first().waitFor({timeout:15000});
  assert.equal(await surface.locator('[data-personal-account-person]').count(),1,'Paid-off account with history remains visible');
  assert.equal(await surface.locator('[data-personal-account-row-visible]').count(),1,'Per-account visibility control');
  await surface.locator('[data-personal-account-open-row] [data-table-column="balance"]').click();
  const personalQ=page.locator('.loyalty-personal-account-q');
  const personalTools=personalQ.locator('[data-personal-account-desktop-tools]');
  await personalTools.waitFor({timeout:10000});
  for(const selector of ['[data-personal-account-fund]','[data-personal-account-limit]']) assert.equal(await personalTools.locator(selector).count(),1);
  assert.equal(await personalQ.locator('[data-desktop-q-secondary-tools] [data-personal-account-q-visible]').count(),1,'Visibility on second row');
  assert.equal(await personalQ.locator('[data-personal-account-info]').count(),1,'One help button in account Q');
  const helpButton=personalTools.locator('[data-personal-account-info]');
  assert.equal(await helpButton.count(),1,'Help is a direct Q tool alongside settings');
  assert.ok(await helpButton.evaluate(node=>{const a=node.getBoundingClientRect();const b=node.parentElement.querySelector('[data-personal-account-limit]').getBoundingClientRect();return a.right<=b.left && Math.abs((a.top+a.height/2)-(b.top+b.height/2))<2;}),'Help and settings in the same row');
  const compactTools=await personalTools.evaluate(row=>['[data-personal-account-info]','[data-personal-account-limit]'].map(selector=>{const el=row.querySelector(selector);const rect=el.getBoundingClientRect();const style=getComputedStyle(el);return {width:rect.width,height:rect.height,border:style.borderTopWidth,background:style.backgroundColor,color:style.color};}));
  for(const tool of compactTools){assert.equal(tool.width,28,'Q compact width');assert.equal(tool.height,28,'Q compact height');assert.equal(tool.border,'0px','Unframed Q icon');assert.equal(tool.background,'rgba(0, 0, 0, 0)','Transparent Q icon');}
  assert.deepEqual(compactTools[0],compactTools[1],'Help and settings share geometry and style');
  const glyphs=await personalTools.evaluate(row=>['[data-personal-account-info]','[data-personal-account-limit]'].map(selector=>{const el=row.querySelector(selector);const glyph=el.firstElementChild;const a=el.getBoundingClientRect();const b=glyph.getBoundingClientRect();const s=getComputedStyle(glyph);return {width:b.width,height:b.height,dx:(b.left+b.width/2)-(a.left+a.width/2),dy:(b.top+b.height/2)-(a.top+a.height/2),border:parseFloat(s.borderTopWidth),radius:parseFloat(s.borderTopLeftRadius),color:s.color};}));
  assert.equal(glyphs[0].width,20,'Info outline matches visible gear contour');
  assert.equal(glyphs[0].height,20,'Square info outline');
  assert.equal(glyphs[1].width,23,'Existing gear SVG viewport unchanged');
  assert.equal(glyphs[1].height,23,'Existing gear SVG viewport unchanged');
  for(const glyph of glyphs)assert.ok(Math.abs(glyph.dx)<1&&Math.abs(glyph.dy)<1,'Centered glyph');
  assert.ok(glyphs[0].border>0&&glyphs[0].radius>0,'Info rounded outline');
  assert.equal(glyphs[0].color,glyphs[1].color,'Matching glyph color');
  const centerY=await personalTools.evaluate(row=>['[data-personal-account-info] > .small-action-button__info','[data-personal-account-limit] > svg','[data-personal-account-fund]'].map(selector=>{const r=row.querySelector(selector).getBoundingClientRect();return r.top+r.height/2;}));
  assert.ok(Math.max(...centerY)-Math.min(...centerY)<0.5,'Info, gear and top-up share one horizontal center axis');
  await helpButton.click();
  const accountHelp=page.getByRole('dialog',{name:'Как работает Личный счёт',exact:true});
  await accountHelp.waitFor({timeout:10000});
  assert.equal(await accountHelp.evaluate(node=>node.closest('[data-v2-layer]')?.dataset.v2LayerKind),'technical');
  assert.equal(await accountHelp.locator('.modal-title h2').textContent(),'Как работает Личный счёт');
  assert.match(await accountHelp.textContent(),/Пополнение и оплата/);
  assert.match(await accountHelp.textContent(),/Долг за обслуживание/);
  assert.equal(await accountHelp.locator('form,input,textarea,select').count(),0,'Read-only help');
  await accountHelp.getByRole('button',{name:'Закрыть'}).click();
  await accountHelp.waitFor({state:'detached'});
  assert.equal(await personalQ.isVisible(),true,'Closing help preserves account Q');
  assert.equal(await personalTools.locator('[data-personal-account-limit]').evaluate(node=>getComputedStyle(node).borderTopWidth),'0px','Unframed shared settings icon');
  assert.ok(await personalTools.locator('[data-personal-account-limit]').evaluate(node=>node.getBoundingClientRect().left<node.parentElement.querySelector('[data-personal-account-fund]').getBoundingClientRect().left));
  assert.equal(await personalTools.locator('[data-personal-account-withdraw]').count(),0,'Refund never in header');
  assert.equal(await personalQ.locator('[data-personal-account-withdraw]').count(),0,'Zero balance has no refund action');
  assert.equal(await personalQ.locator('[data-personal-account-summary]').count(),1,'Saved visual card in account Q');
  assert.equal(await personalQ.locator('.v2-section__title').filter({hasText:'Задолженности'}).count(),0,'No empty debt section');
  await personalQ.locator('[data-personal-account-summary]').click();
  const accountSummary=page.getByRole('dialog',{name:'Личный счёт',exact:true});
  await accountSummary.locator('.read-only-sheet').waitFor({timeout:10000});
  await accountSummary.evaluate(node=>node.closest('[data-v2-layer]')?.v2Close?.());
  assert.equal(await personalQ.locator('[data-personal-account-actions]').count(),0,'Desktop Q has no V');
  await personalTools.locator('[data-personal-account-limit]').click();
  await page.locator('[data-personal-account-settings-form]').waitFor({timeout:10000});
  const accountSettings=page.locator('[data-personal-account-settings-form]');
  assert.equal(await accountSettings.locator('[data-personal-account-info]').count(),0,'No help hidden inside settings');
  await page.locator('[data-personal-account-settings-form]').evaluate(node=>node.closest('[data-v2-layer]')?.v2Close?.());
  await personalTools.locator('[data-personal-account-fund]').click();
  await page.locator('[data-personal-account-money-form]').waitFor({timeout:10000});
  await page.locator('[data-personal-account-money-form]').evaluate(node=>node.closest('[data-v2-layer]')?.v2Close?.());
  await personalQ.locator('[data-v2-q-close]').click();
  await shell.locator('[data-v2-root-item="journal"]').click({timeout:10000});
  await page.waitForFunction(()=>document.querySelector('.v2-app--workspace')?.dataset.v2DesktopSurface==='journal');
  console.log('PASS: tablet-sized loyalty cards render, overflow controls work, personal-account table and navigation remain responsive');
  const assets=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>new URL(r.name).pathname));
  assert.ok(assets.some(p=>p.startsWith('/assets/')&&p.endsWith('.js')));
  assert.ok(!assets.some(p=>p==='/professional.js'||p==='/professional/workspace.js'||p.startsWith('/core/')));
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS: authenticated workspace shell rendered with synthetic account; no raw module requests');
} finally {await browser.close();}
