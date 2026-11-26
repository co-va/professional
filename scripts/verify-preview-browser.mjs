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
        url.pathname.endsWith('/saas-access/me')?{tenantId:'preview-smoke',status:'ACTIVE',commercialMode:'LIVE',capabilities:['profile.access','workplaces.access','journal.day.access','journal.month.access','timetable.access'].map(key=>({key,valueType:'BOOLEAN',enabled:true}))}:
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
  const assets=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>new URL(r.name).pathname));
  assert.ok(assets.some(p=>p.startsWith('/assets/')&&p.endsWith('.js')));
  assert.ok(!assets.some(p=>p==='/professional.js'||p==='/professional/workspace.js'||p.startsWith('/core/')));
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS: authenticated workspace shell rendered with synthetic account; no raw module requests');
} finally {await browser.close();}
