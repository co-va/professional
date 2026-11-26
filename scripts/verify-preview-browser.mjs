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
        url.pathname.endsWith('/saas-access/me')?{tenantId:'preview-smoke',status:'ACTIVE',commercialMode:'LIVE',capabilities:['profile.access','workplaces.access','journal.day.access','journal.month.access','timetable.access','loyalty.deposit.access','loyalty.personal_account.access'].map(key=>({key,valueType:'BOOLEAN',enabled:true}))}:
        url.pathname.endsWith('/auxiliary-state/loyalty')?{wallets:[],depositPrograms:Array.from({length:4},(_,i)=>({id:'smoke-program-'+i,name:'Тестовый депозит '+(i+1),amount:10000,amountMode:'fixed',status:'active',termMode:'indefinite'}))}:
        url.pathname.endsWith('/loyalty/deposits')?[{depositId:'smoke-issued-1',programId:'smoke-program-0',programName:'Тестовый депозит 1',person:{key:'smoke-person',name:'Тестовый клиент',uei:'T001'},status:'active',balance:10000,nominal:10000,terms:{amount:10000,amountMode:'fixed',termMode:'indefinite'},history:[{id:'smoke-funding',kind:'funding',direction:'in',amount:10000,occurredAt:'2026-01-01T10:00:00Z'}]}]:
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
  await programDetail.locator('[data-deposit-open-row="smoke-issued-1"] [data-table-column="balance"]').click();
  const issuedQ=page.locator('.loyalty-deposit-instance-q');
  await issuedQ.locator('.entity-visual-card').waitFor({timeout:15000});
  await issuedQ.locator('[data-deposit-history-entry]').first().waitFor({timeout:10000});
  assert.equal(await issuedQ.locator('.v2-section__title').filter({hasText:'История'}).count(),1);
  await issuedQ.locator('[data-v2-q-close]').click();
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
  await shell.locator('[data-v2-root-item="journal"]').click({timeout:10000});
  await page.waitForFunction(()=>document.querySelector('.v2-app--workspace')?.dataset.v2DesktopSurface==='journal');
  console.log('PASS: tablet-sized loyalty cards render, overflow controls work, personal-account table and navigation remain responsive');
  const assets=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>new URL(r.name).pathname));
  assert.ok(assets.some(p=>p.startsWith('/assets/')&&p.endsWith('.js')));
  assert.ok(!assets.some(p=>p==='/professional.js'||p==='/professional/workspace.js'||p.startsWith('/core/')));
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS: authenticated workspace shell rendered with synthetic account; no raw module requests');
} finally {await browser.close();}
