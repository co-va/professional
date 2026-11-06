import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Exercise the real Shared CSS with a fixed-size Z, Q and X fixture.
// This guards geometry invariants; native iOS keyboard behavior still
// requires an actual device check.
const paths = [
  'css/style.css',
  'ui/v2/v2.css',
  'ui/modals/modal.css',
  'ui/inputs/keyboard.css',
];
const css = (await Promise.all(paths.map((path) => readFile(path, 'utf8')))).join('\n');
const content = Array.from({ length: 12 }, (_, index) =>
  `<label style="display:block;height:104px">Field ${index + 1}<input style="width:100%;height:44px"></label>`).join('');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await page.setContent(`<!doctype html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
    <style>${css}
      /* Measure settled layout, not the entry animation's translated frame. */
      .v2-layer--bottom,.v2-layer--standard{animation:none!important;transition:none!important}
    </style></head><body>
    <div class="app-shell">
      <section class="v2-app" data-v2-app>
        <header class="v2-header" data-v2-header id="h">ABCD</header>
        <div class="v2-app__stage">
          <div class="v2-front" data-v2-front>
            <main class="v2-z" data-v2-z id="z">
              <div data-v2-z-header>Journal</div>
              <div data-v2-z-body id="z-body"><div style="height:1300px">Z content</div></div>
            </main>
          </div>
        </div>
      <!-- Q and X are children of the shared app coordinate space. -->
      <div class="v2-layer-portal v2-layer-portal--workspace is-q"
      style="top:0;left:0;width:390px;height:844px;--v2-q-top:72px;--v2-q-left:16px">
      <div class="v2-layer-backdrop v2-layer-backdrop--contained" data-v2-layer data-v2-q="true">
        <section class="v2-layer v2-layer--standard modal-sheet" id="q"
          style="top:72px;left:16px;right:0;bottom:0">
          <div data-v2-q-header>Profile</div>
          <div data-v2-q-body id="q-body"><div style="height:1300px">Q content</div></div>
        </section>
      </div>
    </div>
    <div class="v2-layer-portal v2-layer-portal--workspace"
      style="top:0;left:0;width:390px;height:844px">
      <div class="v2-layer-backdrop v2-layer-backdrop--contained" data-v2-layer data-v2-layer-kind="bottom">
        <section class="v2-layer v2-layer--bottom modal-sheet modal--bottom modal--form-sheet" id="x">
          ${content}
          <div class="modal-actions"><button id="save" style="height:56px">Save</button></div>
        </section>
      </div>
    </div>
      </section>
    </div>
    </body></html>`);

  const snapshot = () => page.evaluate(() => {
    const rect = (selector) => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height };
    };
    return {
      h: rect('#h'), z: rect('#z'), q: rect('#q'),
      zBody: rect('#z-body'), qBody: rect('#q-body'),
      x: rect('#x'), save: rect('#save'),
    };
  });
  const near = (actual, expected, label) =>
    assert.ok(Math.abs(actual - expected) <= 1, `${label}: ${actual} != ${expected}`);

  const before = await snapshot();
  await page.evaluate(() => {
    const html = document.documentElement;
    html.style.setProperty('--app-stable-vh', '844px');
    html.style.setProperty('--ui-keyboard-inset', '390px');
    html.classList.add('keyboard-open');
  });
  const after = await snapshot();

  near(after.h.top, before.h.top, 'H top must stay fixed');
  near(after.z.top, before.z.top, 'Z top must stay fixed');
  near(after.q.top, before.q.top, 'Q top must stay fixed');
  assert.ok(after.zBody.height < before.zBody.height, 'Z only shrinks its scrollable interior');
  assert.ok(after.qBody.height < before.qBody.height, 'Q only shrinks its scrollable interior');
  near(after.z.bottom, before.z.bottom, 'Z white surface must keep its bottom');
  near(after.q.bottom, before.q.bottom, 'Q white surface must keep its bottom');
  near(after.z.right, before.z.right, 'Z white surface must keep its right edge');
  near(after.q.right, before.q.right, 'Q white surface must keep its right edge');
  near(after.x.bottom, before.x.bottom, 'X white background must remain attached to bottom under keyboard');
  near(after.x.right, before.x.right, 'X white background must keep right edge');
  assert.ok(after.x.top >= 11, 'X may not cross its upper stop');
  assert.ok(after.x.height > before.x.height, 'X white background extends under keyboard without moving its bottom');
  assert.ok(after.x.height <= before.x.height + 390 + 1, 'X may grow only by keyboard inset');

  const scroll = await page.evaluate(() => {
    const sheet = document.querySelector('#x');
    sheet.scrollTop = sheet.scrollHeight + 900;
    const save = document.querySelector('#save').getBoundingClientRect();
    const bottom = sheet.getBoundingClientRect().bottom;
    return { scrollTop: sheet.scrollTop, max: sheet.scrollHeight - sheet.clientHeight,
      saveBottom: save.bottom, bottom };
  });
  near(scroll.scrollTop, scroll.max, 'X scroll must stop at its content end');
  assert.ok(scroll.saveBottom <= 844 - 390 - 16,
    'Final action must stay above keyboard while white background stays anchored');

  // Safari pans the *visible* viewport. A compensating change of layout
  // position must retain the SAME on-screen H/Z/Q coordinates.
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--ui-visual-top', '47px');
    document.documentElement.style.setProperty('--ui-visual-left', '19px');
  });
  const moved = await snapshot();
  near(moved.h.top - 47, after.h.top, 'H fixed in visual viewport coordinates');
  near(moved.z.top - 47, after.z.top, 'Z fixed in visual viewport coordinates');
  near(moved.q.top - 47, after.q.top, 'Q fixed in visual viewport coordinates');
  near(moved.z.right - 19, after.z.right, 'Z anchored through horizontal Safari pan');
  near(moved.q.right - 19, after.q.right, 'Q anchored through horizontal Safari pan');
  near(moved.x.right - 19, after.x.right, 'X anchored through horizontal Safari pan');

  // Exercise the real shared controller, not just the CSS. Native iOS
  // animates VisualViewport resize gradually, often 10-30px per frame.
  // Q must keep its physical bottom even when the last field is focused.
  await page.addScriptTag({ content: await readFile('ui/inputs/keyboard-runtime.js', 'utf8') });
  const animation = await page.evaluate(async () => {
    const html = document.documentElement;
    const vv = window.visualViewport;
    const fullHeight = vv.height;
    const firstStable = html.style.getPropertyValue('--app-stable-vh');
    const sheet = document.querySelector('#q');
    const firstBottom = sheet.getBoundingClientRect().bottom;
    const field = document.createElement('input');
    field.type = 'text';
    document.querySelector('#q-body').append(field);
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const heights = [];
    const bottoms = [];
    field.focus({ preventScroll: true });
    for (let delta = 20; delta <= 300; delta += 20) {
      Object.defineProperty(vv, 'height', { configurable: true, value: fullHeight - delta });
      vv.dispatchEvent(new Event('resize'));
      await frame();
      heights.push(html.style.getPropertyValue('--app-stable-vh'));
      bottoms.push(sheet.getBoundingClientRect().bottom);
    }
    field.blur();
    for (let delta = 280; delta >= 0; delta -= 20) {
      Object.defineProperty(vv, 'height', { configurable: true, value: fullHeight - delta });
      vv.dispatchEvent(new Event('resize'));
      await frame();
      heights.push(html.style.getPropertyValue('--app-stable-vh'));
      bottoms.push(sheet.getBoundingClientRect().bottom);
    }
    delete vv.height;
    return { firstStable, firstBottom, heights, bottoms };
  });
  assert.ok(animation.heights.every((value) => value === animation.firstStable),
    'Animated keyboard may not gradually reduce shared shell height: ' + JSON.stringify(animation.heights));
  assert.ok(animation.bottoms.every((value) => Math.abs(value - animation.firstBottom) <= 1),
    'Q white surface must not move its bottom during keyboard animation: ' + JSON.stringify(animation.bottoms));

  // iOS standalone can expose less VisualViewport/innerHeight than the
  // physical screen even with the keyboard CLOSED. The white Q may not stop
  // at that shorter height: its portal must share the full app shell.
  const pwa = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await pwa.setContent(`<!doctype html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
    <style>${css}</style></head><body><div class="app-shell">
      <section class="v2-app" data-v2-app>
        <header class="v2-header" data-v2-header>ABCD</header>
        <div class="v2-app__stage"><div class="v2-front" data-v2-front>
          <main class="v2-z" data-v2-z><div data-v2-z-body>Journal</div></main>
        </div></div>
        <div class="v2-layer-portal v2-layer-portal--workspace is-q"
             style="inset:0;width:100%;height:100%;--v2-q-top:72px;--v2-q-left:16px">
          <div class="v2-layer-backdrop v2-layer-backdrop--contained" data-v2-layer data-v2-q="true">
            <section class="v2-layer v2-layer--standard" id="pwa-q"
                     style="animation:none;top:72px;left:16px;right:0;bottom:0">
              <div data-v2-q-body>Profile</div>
            </section>
          </div>
        </div>
      </section></div></body></html>`);
  await pwa.evaluate(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    Object.defineProperty(screen, 'width', { configurable: true, value: 390 });
    Object.defineProperty(screen, 'height', { configurable: true, value: 900 });
  });
  await pwa.addScriptTag({ content: await readFile('ui/inputs/keyboard-runtime.js', 'utf8') });
  const standalone = await pwa.evaluate(() => ({
    appHeight: document.querySelector('[data-v2-app]').getBoundingClientRect().height,
    whiteBottom: document.querySelector('#pwa-q').getBoundingClientRect().bottom,
    visualHeight: window.visualViewport.height,
    stableHeight: getComputedStyle(document.documentElement).getPropertyValue('--app-stable-vh').trim(),
  }));
  near(standalone.appHeight, 900, 'Standalone app must cover the physical screen rather than the shorter visual viewport');
  near(standalone.whiteBottom, 900, 'Standalone Q white surface must reach the physical screen bottom');
  assert.ok(standalone.visualHeight < standalone.appHeight, 'Fixture must simulate missing standalone bottom band');
  await pwa.close();

  console.log('PASS: anchored Z/Q/X, gradual keyboard animation, and standalone full-screen baseline');
  await page.close();
} finally {
  await browser.close();
}
