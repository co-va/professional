import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const target=process.argv[2];
if(!target) throw Error('Preview URL required');
const local=process.argv.includes('--local');
const browser=await chromium.launch({headless:true,args:local?['--host-resolver-rules=MAP professional-volokovykh.msk1.amvera.tech 127.0.0.1','--no-proxy-server']:[]});
try {
  const page=await browser.newPage({serviceWorkers:'block'});
  const errors=[];
  const isApi=url=>new URL(url).pathname.startsWith('/api/')||new URL(url).hostname==='api.va-tools.ru';
  page.on('requestfailed',r=>{if(!isApi(r.url()))errors.push(r.url()+' '+r.failure()?.errorText);});
  page.on('response',r=>{if(r.status()>=400&&!isApi(r.url()))errors.push(r.status()+' '+r.url());});
  page.on('pageerror',e=>errors.push(e.message));
  // All account calls are synthetic. Never send a real token or mutate Core.
  await page.route('**/*',r=>{
    const url=new URL(r.request().url());
    if(isApi(url.href)) {
      const body=url.pathname.endsWith('/auth/me')?{account:{id:'preview-smoke',email:'preview@example.invalid'},tenantId:'preview-smoke'}:
        url.pathname.endsWith('/saas-access/me')?{tenantId:'preview-smoke',status:'ACTIVE',commercialMode:'LIVE',capabilities:[{key:'profile.access',valueType:'BOOLEAN',enabled:true}]}:{};
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
  const assets=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>new URL(r.name).pathname));
  assert.ok(assets.some(p=>p.startsWith('/assets/')&&p.endsWith('.js')));
  assert.ok(!assets.some(p=>p==='/professional.js'||p==='/professional/workspace.js'||p.startsWith('/core/')));
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS: authenticated workspace shell rendered with synthetic account; no raw module requests');
} finally {await browser.close();}
