import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { runInNewContext } from 'node:vm';

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
// The actual Shared keyboard runtime must retain the same physical shell
// through a transient iOS viewport rebound between two input fields.
const keyboardSource = await readFile('ui/inputs/keyboard-runtime.js', 'utf8');
assert.doesNotMatch(keyboardSource, /scrollTop|scrollIntoView/,
  'Shared keyboard must never force per-field scroll');
const keyboardProps = new Map();
const keyboardClasses = new Set();
let visibleHeight = 844;
let focusedInput = false;
let clock = 0;
const keyboardEvents = new Map();
const testAction = {
  hidden: false,
  hasAttribute() { return false; },
  getBoundingClientRect() { return { top: 394, bottom: 442, height: 48 }; },
};
const testArea = {
  clientHeight: 220,
  scrollHeight: 1600,
  offset: 0,
  getBoundingClientRect() { return { top: 180, bottom: 440, height: 260 }; },
  matches() { return false; },
  closest() { return { querySelectorAll() { return [testAction]; } }; },
  scrollBy({ top }) { this.offset += top; },
};
class TestInput {
  matches() { return true; }
  get isConnected() { return true; }
  closest(selector) { return selector.includes('data-v2-q-body') ? testArea : null; }
  getBoundingClientRect() {
    return { top: 740 - testArea.offset, bottom: 786 - testArea.offset, height: 46 };
  }
}
const rootStyle = {
  getPropertyValue: (key) => keyboardProps.get(key) || '',
  setProperty: (key, value) => keyboardProps.set(key, value),
};
const html = {
  style: rootStyle,
  classList: {
    contains: (key) => keyboardClasses.has(key),
    toggle: (key, enabled) => enabled ? keyboardClasses.add(key) : keyboardClasses.delete(key),
  },
};
const fakeDoc = {
  documentElement: html,
  body: {},
  visibilityState: 'visible',
  get activeElement() { return focusedInput ? new TestInput() : null; },
  addEventListener(event, handler) { keyboardEvents.set(event, handler); },
  querySelectorAll() { return []; },
  querySelector() { return null; },
};
const fakeVisualViewport = {
  get height() { return visibleHeight; },
  width: 390,
  offsetTop: 0,
  offsetLeft: 0,
  addEventListener() {},
};
const fakeWindow = {
  visualViewport: fakeVisualViewport,
  innerWidth: 390,
  innerHeight: 844,
  addEventListener() {},
};
const testRuntime = {
  window: fakeWindow,
  document: fakeDoc,
  HTMLElement: TestInput,
  MutationObserver: class { observe() {} },
  ResizeObserver: undefined,
  requestAnimationFrame() { return 1; },
  performance: { now() { return clock; } },
  getComputedStyle() { return { display: 'grid' }; },
};
runInNewContext(keyboardSource + '\nwindow.__testSync = syncViewport; window.__testFocus = keepFocusedFieldVisible;', testRuntime);
const keyboardState = () => ({
  shell: keyboardProps.get('--app-stable-vh'),
  inset: keyboardProps.get('--ui-keyboard-inset'),
  open: keyboardClasses.has('keyboard-open'),
});
focusedInput = true;
testRuntime.window.__testSync();
visibleHeight = 460;
testRuntime.window.__testSync();
const keyboardBeforeTransition = keyboardState();
assert.equal(keyboardBeforeTransition.inset, '384px');
testArea.offset = 0;
testRuntime.window.__testFocus();
const focusedBox = new TestInput().getBoundingClientRect();
assert.ok(focusedBox.top >= 192 && focusedBox.bottom <= 382,
  'Last input must be visible between fixed Q header and action button');
assert.ok(testArea.offset > 0, 'Only Q scroll body must move to the last input');
focusedInput = false;
visibleHeight = 790; // brief focusout/viewport rebound, keyboard is STILL open
testRuntime.window.__testSync();
assert.deepEqual(keyboardState(), keyboardBeforeTransition,
  'Focusout rebound may not expose H or move Z/Q actions');
focusedInput = true;
visibleHeight = 460;
testRuntime.window.__testSync();
assert.deepEqual(keyboardState(), keyboardBeforeTransition,
  'Last input focus must retain the same Z/Q keyboard inset');
focusedInput = false;
visibleHeight = 844; // even a FULL viewport rebound must not break focus transition
clock = 100;
keyboardEvents.get('focusout')();
assert.deepEqual(keyboardState(), keyboardBeforeTransition,
  'Full focusout rebound may not move Z/Q before the next field focuses');
focusedInput = true;
visibleHeight = 460;
clock = 150;
keyboardEvents.get('focusin')({ target: new TestInput() });
assert.deepEqual(keyboardState(), keyboardBeforeTransition,
  'Focusin after full rebound must retain the keyboard inset');
focusedInput = false;
visibleHeight = 844;
clock = 500;
keyboardEvents.get('focusout')();
clock = 690; // no new focus arrived; native keyboard really closed
// The existing viewport-following frame is responsible for the final reset.
testRuntime.window.__testSync();
assert.equal(keyboardState().inset, '0px', 'Actual keyboard close resets inset');
assert.equal(keyboardState().open, false, 'Actual keyboard close resets class');
assert.equal(keyboardState().shell, '844px',
  'After closing keyboard the physical Z/Q/X shell is still full height');
// Reproduce iOS delayed viewport resize when focus was already lost.
// The old runtime incorrectly set --app-stable-vh to 460px here, making
// ALL keyboard keys appear over the dark H background instead of over Q.
visibleHeight = 460;
clock = 800;
testRuntime.window.__testSync();
assert.equal(keyboardState().shell, '844px',
  'An unfocused keyboard-size viewport must NEVER shorten the Z/Q/X shell');
focusedInput = true;
testRuntime.window.__testSync();
assert.equal(keyboardState().shell, '844px',
  'The last focused field must retain the physical Q bottom');
assert.equal(keyboardState().inset, '384px',
  'The visible field/action area uses keyboard inset, not the outer shell');
focusedInput = false;
visibleHeight = 844;
clock = 900;
keyboardEvents.get('focusout')();
clock = 1100;
testRuntime.window.__testSync();
assert.equal(keyboardState().inset, '0px');


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
          <div data-v2-q-body id="q-body"><div style="height:1300px">Q content</div><div class="modal-actions" style="height:48px"><button id="q-save" style="height:48px">Apply</button></div></div>
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
      x: rect('#x'), save: rect('#save'), qSave: rect('#q-save'),
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
  const nativeBackdrop = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
    htmlImage: getComputedStyle(document.documentElement).backgroundImage,
    bodyImage: getComputedStyle(document.body).backgroundImage,
    shellImage: getComputedStyle(document.querySelector('.app-shell')).backgroundImage,
    q: getComputedStyle(document.querySelector('#q')).backgroundColor,
    h: getComputedStyle(document.querySelector('#h')).backgroundColor,
  }));
  assert.equal(nativeBackdrop.html, 'rgb(245, 245, 243)',
    'Native iOS keyboard fallback stays warm even without gradient rendering');
  assert.equal(nativeBackdrop.body, nativeBackdrop.q,
    'Native keyboard backdrop must match warm Q paper');
  for (const image of [nativeBackdrop.htmlImage, nativeBackdrop.bodyImage, nativeBackdrop.shellImage]) {
    assert.match(image, /linear-gradient/,
      'Native keyboard canvas and app shell must retain H gutter + warm Q paper');
    assert.ok(image.includes('47, 51, 56') || /#2f3338/i.test(image),
      'H gutter must remain graphite inside keyboard backdrop');
  }
  assert.notEqual(nativeBackdrop.h, nativeBackdrop.q,
    'Actual H header keeps its graphite appearance');

  near(after.h.top, before.h.top, 'H top must stay fixed');
  near(after.z.top, before.z.top, 'Z top must stay fixed');
  near(after.q.top, before.q.top, 'Q top must stay fixed');
  assert.ok(after.zBody.height < before.zBody.height, 'Z only shrinks its scrollable interior');
  assert.ok(after.qBody.height < before.qBody.height, 'Q only shrinks its scrollable interior');
  near(after.z.bottom, before.z.bottom, 'Z white surface must keep its bottom');
  near(after.q.bottom, before.q.bottom, 'Q white surface must keep its bottom');
  assert.ok(after.qSave.bottom <= 844 - 390 - 16,
    'Q action must remain above keyboard without moving the white Q surface');
  assert.ok(after.qSave.bottom < before.qSave.bottom,
    'Q action moves into the visible work area when keyboard appears');
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

  console.log('PASS: fixed H/Z/Q right and bottom; X white background extends under keyboard');
  await page.close();
} finally {
  await browser.close();
}
