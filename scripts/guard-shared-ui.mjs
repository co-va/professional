import fs from 'node:fs';
import path from 'node:path';
import { compactButton, compactAddButton, compactRemoveButton, smallActionButton } from '../ui/buttons/index.js';

const ROOT = process.cwd();
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const assert = (condition, message) => {
  if (!condition) {
    console.error(`Shared UI FAILED: ${message}`);
    process.exitCode = 1;
  }
};
const count = (source, marker) => source.split(marker).length - 1;

function rootSelectorCount(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (source.match(new RegExp(`(^|\\n)${escaped}\\{`, 'g')) || []).length;
}

function walk(dir) {
  const base = path.join(ROOT, dir);
  if (!fs.existsSync(base)) return [];
  const out = [];
  const stack = [base];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else out.push(path.relative(ROOT, full).replaceAll('\\', '/'));
    }
  }
  return out.sort();
}

const v2 = read('ui/v2/v2.css');
const zLayout = read('ui/v2/z-layout.js');
const zHeaderCss = read('ui/v2/surface-header.css');
const geometry = read('ui/v2/geometry.js');
const header = read('ui/v2/header.js');
const zStack = read('ui/v2/z-stack.js');
const sharedSwipe = read('ui/v2/swipe.js');
const horizontalAffordance = read('ui/v2/horizontal-affordance.js');
const miniMarkup = read('ui/cards/mini-card.js');
const dateCalendar = read('ui/calendar/calendar.js');
const dateCalendarCss = read('ui/calendar/calendar.css');
const modalPortal = read('ui/v2/modal-portal.js');
const keyboardRuntime = read('ui/inputs/keyboard-runtime.js');
const keyboardStyle = read('ui/inputs/keyboard.css');
const shellStyle = read('css/style.css');
const selectorsStyle = read('ui/selectors/selectors.css');
const bookingStyle = read('ui/booking/booking.css');
const modalStyle = read('ui/modals/modal.css');
const vHost = read('ui/v2/v-host.js');
const entity = read('ui/cards/entity-card-constructor.css');
const mini = read('ui/cards/mini-card.css');
const list = read('ui/lists/list-entry.css');
const documentCss = read('ui/documents/document.css');
const buttons = read('ui/buttons/buttons.css');
const inputs = read('ui/inputs/inputs.css');

// Canonical shell geometry has one Shared owner.
assert(v2.includes('--v2-z-radius:34px'), 'Shared Z radius changed');
assert(v2.includes('--v2-z-layer-offset:12px'), 'Shared Z layer offset changed');
assert(v2.includes('--v2-edge:16px'), 'Shared Z edge changed');
assert(v2.includes('height:72px;') && v2.includes('flex:0 0 72px'), 'Shared H height changed');
assert(v2.includes('padding:0 18px calc(24px + env(safe-area-inset-bottom))'), 'Shared Z padding changed');
assert(rootSelectorCount(v2, '.v2-header') === 1, 'Shared H geometry must have one owner');
assert(rootSelectorCount(v2, '.v2-z') === 1, 'Shared Z geometry must have one owner');
assert(read('ui/v2/root-app.js').includes('export function rootApp(') && ['header-state.js','v-host.js','workspace-navigation.js','y.js'].every(file => read('ui/v2/' + file).includes("from './root-app.js'")), 'Shared V2 app root lookup must have one owner');
assert(!['header-state.js','v-host.js','workspace-navigation.js','y.js'].some(file => read('ui/v2/' + file).includes('function rootApp(')), 'Per-component duplicate root helpers are forbidden');
assert(!zStack.includes('padding-top:0'), 'Nested Z must not override Shared top padding');
assert(zLayout.includes("const SURFACE_HEADER_SPACING = '12px'"), 'Z/Q Header must share one 12px token');
assert(v2.includes('.v2-q-title,.v2-z-title{box-sizing:border-box;display:flex;align-items:center;width:100%;min-width:0;height:46px;min-height:46px;max-height:46px;'), 'Z/Q text header must be fixed at 46px');
assert(v2.includes('--v2-inner-surface:#F5F5F3;') && v2.includes('background:var(--v2-inner-surface);color:var(--v2-ink);box-shadow:-6px 2px 18px rgba(0,0,0,.10)'), 'Z must use one warm inner surface');
assert(zLayout.includes("'background:var(--v2-inner-surface,#F5F5F3)'") && zHeaderCss.includes('background:var(--v2-inner-surface,#F5F5F3)!important;'), 'Z/Q Header must use warm inner surface');
assert(v2.includes('padding-top:0;background:var(--v2-inner-surface)}'), 'Q surface must be warm with no extra top gap');
assert(v2.includes('.v2-layer{position:absolute;box-sizing:border-box;overflow:auto;background:var(--v2-inner-surface);') &&
       v2.includes('.v2-layer--technical{') && v2.includes('background:var(--v2-white,#fff);') && v2.includes('.v2-layer--technical>.v2-layer__technical-body{') && v2.includes('overflow-y:auto;overscroll-behavior:contain;') && v2.includes('.v2-layer--technical>.v2-layer__close{') && modalPortal.includes('class="v2-layer__technical-body"'), 'Technical modal must be a fixed white paper with independently scrolling content and fixed close button');
assert(modalStyle.includes('.modal-sheet.modal--surface-app:not(.modal--technical){background:var(--v2-inner-surface,#F5F5F3)}') &&
       modalStyle.includes('background:var(--v2-inner-surface,#F5F5F3);overflow:') &&
       !modalStyle.split('\n').filter(line=>line.includes('.modal-sheet.modal--bottom.modal--')).some(line=>line.includes('background:var(--white)')), 'X/S shells and all X sheets must be warm');
assert(read('ui/time/time.css').includes('.time-timeline{position:relative;display:grid;gap:0;background:var(--white)'), 'White striped Journal timeline must not inherit warm Z surface');
assert(shellStyle.includes('--ui-field-height:46px;') && shellStyle.includes('--ui-control-height:48px;'), 'Fixed fields 46px and unchanged buttons 48px require separate tokens');
assert(inputs.includes('height:var(--ui-field-height);min-height:var(--ui-field-height);max-height:var(--ui-field-height)'), 'Shared one-line inputs must be exactly 46px');
assert(['.ui-select__control{','.ui-selector__search{','.ui-selector__option{'].every(c=>{const q=selectorsStyle.split(c)[1]?.split('}')[0]||'';return q.includes('height:var(--ui-selector-control-height);min-height:var(--ui-selector-control-height);max-height:var(--ui-selector-control-height)')}), 'Selector rows, search and trigger must be exactly 46px');
assert(!bookingStyle.includes('min-height:52px'), 'Booking account editor cannot use 52px controls');
assert(bookingStyle.includes('--booking-control-radius:0px'), 'Booking text controls must match Shared square fields');
assert(count(inputs, '.password-field__control{') === 1 && count(inputs, '.password-field__toggle{') === 1, 'Repeated password field CSS must have a single owner');
assert(count(inputs, '.phone-input{') === 1, 'Shared phone field geometry must not have redundant breakpoint clones');
assert(zLayout.includes('const SURFACE_HEADER_STYLE = [') && !zLayout.includes('Q_HEADER_STYLE'), 'Z/Q must have one Header geometry owner');
assert(zLayout.includes("'padding-top:var(--v2-surface-header-spacing)'")
  && zLayout.includes("'padding-bottom:var(--v2-surface-header-spacing)'"), 'Z/Q Header top and bottom gaps must be identical');
assert(zLayout.includes("'gap:var(--v2-surface-header-spacing)'"), 'Header content items must use the same gap');
assert(zLayout.includes("'grid-template-columns:24px minmax(0,1fr)'")
  && zLayout.includes("'align-items:center'"), 'Z/Q arrow must be centred in the content row');
assert(!zLayout.includes('Q_HEADER_BODY_GAP') && !zLayout.includes('topGap'), 'No additional Q Header/Body gap');
assert(!zHeaderCss.includes('margin-bottom:8px') && !zHeaderCss.includes('padding-bottom:0!important'), 'No per-surface Header spacing overrides');
assert(zHeaderCss.includes('.ui-search-divider{display:none!important}'), 'No separator inside any Z/Q Header');
assert(zHeaderCss.includes('.ui-search-field{padding:0}') && zHeaderCss.includes('.segment-control{margin:0}'), 'Controls cannot own outer Header gaps');
assert(v2.includes('bottom:0;padding-top:0;background:var(--v2-inner-surface)}'), 'Q layer must not add a hidden top gap');
const zArrow = read('ui/v2/z-affordance.js');
assert(["'margin:0'", "'position:absolute'", "'top:50%'", "'transform:translateY(-50%)'"].every(marker => zArrow.includes(marker)), 'Z/Q arrow must use the centered Shared position');
assert(zLayout.includes("'min-height:36px'") && zLayout.includes("'grid-column:2'") && zLayout.includes("'min-height:12px'"), 'Z/Q compact Header must match approved Shared geometry');
assert((zHeaderCss.match(/min-height:36px!important/g) || []).length === 2, 'Empty Z/Q headers must match approved 36px floor');
assert(read('ui/cards/entity-card-constructor.css').includes('gap:var(--v2-surface-header-spacing)'), 'Q card selector gap is not shared');
assert(!read('core/inventory/inventory.js').includes('people-search-divider ui-search-divider'), 'Stock Header must contain only search');
assert(!read('core/people/people.js').includes('people-search-divider ui-search-divider'), 'Contacts and History Headers must contain only search');
// Q geometry and modal lifecycle remain centralized.
assert(geometry.includes('export function v2QModalPortalGeometry'), 'Shared Q geometry missing');
assert(count(geometry, 'export function v2QModalPortalGeometry') === 1, 'Q geometry must have one owner');
assert(modalPortal.includes("new CustomEvent('va-tools:v2-context-changed')"), 'Modal portal must publish neutral Shared context event');
assert(vHost.includes("addEventListener('va-tools:v2-context-changed'"), 'V host must consume neutral Shared context event');

// Shared keyboard geometry is one owner; never add per-field scroll handlers.
assert(keyboardRuntime.includes('let keyboardSession = false;'), 'Shared keyboard session owner missing');
assert(!keyboardRuntime.includes('scrollTop') && !keyboardRuntime.includes('scrollIntoView'), 'Keyboard controller must never scroll fields on a frame or focus event');
assert(keyboardRuntime.includes("setRootPixel('--ui-visual-left', visualLeft)"), 'Horizontal Safari viewport compensation missing');
assert(shellStyle.includes('transform:translateX(var(--ui-visual-left,0px))'), 'Shared application root must compensate Safari horizontal pan');
assert(keyboardStyle.includes('.v2-layer--bottom{\\n  bottom:0;'.replace('\\n', '\n')), 'X inner surface must stay attached to bottom under keyboard');
assert(keyboardStyle.includes('padding-bottom:calc(20px + var(--ui-keyboard-inset))'), 'X contents must remain above keyboard');
assert(!modalPortal.includes('node.contains(document.activeElement)'), 'Per-modal focus blur override is forbidden');
assert(horizontalAffordance.includes('export function isV2HorizontalGestureTarget(') && (sharedSwipe.match(/isV2HorizontalGestureTarget\(event.target\)/g) || []).length >= 3, 'Horizontal rails must own gestures instead of triggering Z/Q dismissal');

// Canonical Shared components keep one geometry owner.
assert(entity.includes('width:min(338px,100%)'), 'EntityCard width changed');
assert(entity.includes('aspect-ratio:338/213'), 'EntityCard aspect ratio changed');
assert(!entity.includes('.entity-card-editor__data .ui-select__control{min-height:44px}'), 'Card editor must use exact Shared selector 46px height');
assert(!documentCss.includes('.v2-layer--technical.document-viewer-sheet') && !documentCss.includes('.document-viewer-backdrop{') && documentCss.includes('.document-viewer__content:has(.document-viewer__pdf)'), 'Document viewer must inherit the one Shared technical sheet and H backdrop');
assert(!bookingStyle.includes('.booking-technical-modal{overflow-y:auto'), 'Guest technical modal must not become a second scrolling outer sheet');
assert(entity.includes('grid-template-rows:repeat(9,minmax(0,1fr))'), 'EntityCard row geometry changed');
assert(rootSelectorCount(entity, '.entity-visual-card') === 1, 'EntityCard geometry must have one owner');

// The approved 2026-11-09 «Вид» UI is implemented by this same Shared
// constructor. These assertions protect its core design rules; do not build
// a second UI registry or copy the layout into individual feature modules.
const cardView = read('ui/cards/entity-card-constructor.js');
assert(cardView.includes('export const ENTITY_CARD_LINE_COUNT = 9;'), 'Card View: nine rows required');
assert(cardView.includes("const COLUMNS = ['left','center','right'];"), 'Card View: three independent columns required');
assert(cardView.includes("[['photo','Фото'],['background','Фон'],['card','Карта']]"), 'Card View: Photo / Background / Card navigation changed');
assert(entity.includes('.entity-card-editor__photo>.ui-button:only-child{grid-column:1/-1}'), 'Card View: single photo button must fill row');
assert(entity.includes('white-space:nowrap;'), 'Card View: photo button text must not wrap');
assert(entity.includes('--entity-card-control-height:calc((100cqw - 8 * var(--entity-card-control-gap)) / 9)'), 'Card View: unified editor control height changed');
assert(entity.includes('grid-template-columns:repeat(3,minmax(0,1fr)) 10px repeat(4,minmax(0,1fr))'), 'Card View: 3+4 formatting tool groups changed');
assert(cardView.includes('openColorPickerAction({') && !cardView.includes('<span>Выбрать</span>'), 'Card View: one swatch-only color chooser required');


assert(mini.includes('.mini-card{--mini-card-width:290px;--mini-card-height:200px;'), 'Every MiniCard must use the approved 290×200 paper');
assert(mini.includes('grid-template-rows:auto minmax(0,1fr) auto'), 'MiniCard must have fixed top/bottom and scrolling center');
assert(mini.includes('.mini-card__record-center{min-height:0;min-width:0;overflow-y:auto'), 'MiniCard center must own vertical scrolling');
assert(!/238px|144px|176px/.test(mini), 'Obsolete MiniCard geometry cannot return');
assert(miniMarkup.includes('function cardShell(') && miniMarkup.includes('data-mini-card-ui=\\"shared\\"'.replaceAll('\\','')), 'All MiniCard variants must render through one shell');
assert(miniMarkup.includes('return recordMarkup(recordLayout, { className, aria, interactive, data });'), 'Record MiniCard must preserve opt-in click behavior');
assert(rootSelectorCount(mini, '.mini-card') === 1, 'MiniCard geometry must have one owner');
assert(!mini.includes('.mini-card:has(>.mini-card__rows)'), 'Do not override User MiniCard base geometry in Professional');


// Shared MiniCard has one rounded geometry contract (co-va/user/staging).
// No feature card may flatten the MiniCard's corners or create a local clone.
const miniGeometry = [
  [/\.mini-card\{[^}]*border-radius:16px;/, 'MiniCard outer radius must be 16px'],
  [/\.mini-card__media\{[^}]*border-radius:10px;/, 'MiniCard media radius must be 10px'],
  [/\.mini-card__context-action\{[^}]*border-radius:10px;/, 'MiniCard context radius must be 10px'],
  [/\.mini-card__compact-action\{[^}]*position:absolute;top:10px;right:10px;z-index:2/, 'MiniCard compact action position must remain unchanged'],
];
for (const [rule, message] of miniGeometry) assert(rule.test(mini), message);


// Header-level "+" controls are not full-size action buttons. Their owner is
// the Shared repeated-fields / links layout, so they must never inherit
// the auto margins that center primary action buttons.
const compactFactory = read('ui/buttons/index.js');
assert(buttons.includes('--ui-compact-size:28px') && buttons.includes('.ui-compact-button{box-sizing:border-box;'), 'Compact must own one fixed 28px geometry');
assert(['add','remove','info','copy'].every(kind => compactFactory.includes("kind = '" + kind + "'") || compactFactory.includes("kind: '" + kind + "'") || compactFactory.includes("'" + kind + "'")), 'Compact must support add/remove/info/copy variants');
assert(compactFactory.includes('export function compactButton(') && compactFactory.includes('export function compactRemoveButton('), 'Shared Compact factory missing');
assert(!inputs.includes('.ui-links--compact .link-row .remove-button') && !inputs.includes('.array-row__add{width:40px'), 'Feature styles must not own Compact geometry');
assert(!read('ui/repeated-fields/index.js').includes("button('+',"), 'Repeated-field add must not use the full-size action factory');
assert(!read('ui/links/index.js').includes("button('+',"), 'Links add must not use the full-size action factory');
assert(read('ui/buttons/index.js').includes('export function compactAddButton('), 'Compact add control factory missing');
const compactVariants = ['add', 'remove', 'info', 'copy', 'settings', 'repeat', 'card', 'previous', 'next'];
for (const kind of compactVariants) {
  const markup = compactButton({ kind, data: 'data-compact-smoke', aria: 'Тест' });
  assert(markup.includes('class="ui-compact-button ui-compact-button--' + kind)
    && markup.includes('data-compact-smoke')
    && markup.includes('aria-label="Тест"')
    && !markup.includes('class="ui-button'), 'Compact ' + kind + ' must reuse single geometry and preserve callbacks');
}
assert(compactAddButton().includes('ui-compact-button--add') && compactRemoveButton().includes('ui-compact-button--remove')
  && smallActionButton({ icon: 'info' }).includes('ui-compact-button--info')
  && smallActionButton({ icon: 'copy' }).includes('ui-compact-button--copy'), 'All legacy Compact call paths must delegate to one renderer');
assert(miniMarkup.includes("import { compactButton } from '../buttons/index.js'") && miniMarkup.includes("return compactButton({")
  && miniMarkup.includes("kind: 'card'") && miniMarkup.includes("const kind = action.icon === 'settings'"),
  'MiniCard corner and record controls must use the shared Compact factory');
assert(miniMarkup.includes("action.icon === 'settings' ? 'settings'") && miniMarkup.includes("action.label === '↻' ? 'repeat'"),
  'MiniCard must preserve gray settings and black repeat actions');
assert(!mini.includes('.mini-card__compact-action{position:absolute;top:10px;right:10px;z-index:2;width:')
  && !mini.includes('.mini-card__record-action{border:0')
  && buttons.includes('.ui-compact-button--settings{') && buttons.includes('.ui-compact-button--repeat{'),
  'MiniCard must not duplicate button geometry or visuals');
assert(dateCalendar.includes("compactButton({ kind: 'previous'") && dateCalendar.includes("compactButton({ kind: 'next'")
  && dateCalendarCss.includes('grid-template-columns:var(--ui-compact-size) minmax(0,1fr) var(--ui-compact-size)')
  && !dateCalendarCss.includes('.calendar__month-button{box-sizing:border-box;width:36px'),
  'Calendar month/day navigation must use single Compact 28px buttons');
assert(count(buttons, '.ui-compact-button{') === 1
  && !buttons.includes('.small-action-button{box-sizing:border-box')
  && !buttons.includes('.array-row__add,.ui-links__add{display:block'), 'Compact must have exactly one geometry owner');
assert(['repeated-fields/index.js','links/index.js','tags/index.js','workplaces/index.js','payment/index.js','receipt/index.js'].every(file => read('ui/' + file).includes('compactRemoveButton(')),
  'All known small removal actions must use the Compact renderer');
assert(['repeated-fields/index.js','links/index.js','tags/index.js','workplaces/index.js','payment/index.js'].every(file => !read('ui/' + file).includes('class="remove-button"')),
  'No inline form row may create a second small delete button');

assert(inputs.includes('.array-group[data-repeated-add-placement="header"] .array-group__header{display:flex;align-items:center;justify-content:space-between'), 'Repeated-field add buttons must remain right-aligned');
assert(list.includes('min-height:78px'), 'V2 list entry geometry changed');
assert(count(list, '.list-entry{') === 1, 'V2 list entry geometry must have one owner');

assert(header.includes("kind === 'chat'"), 'Shared D chat control missing');
assert(v2.includes('.v2-header__slot--d .v2-header__control--chat'), 'Shared D chat geometry missing');

// Feature contours do not own CSS. Isolated invite entry and fundamental css/style.css are explicit exceptions.
const allowedCss = new Set(['css/style.css', 'invite/invite.css']);
const cssFiles = [
  ...walk('core'), ...walk('journal'), ...walk('timetable'), ...walk('settings'),
  ...walk('chat'), ...walk('online-booking'), ...walk('invite'), ...walk('css'),
].filter((file) => file.endsWith('.css'));
for (const file of cssFiles) {
  assert(file.startsWith('ui/') || allowedCss.has(file), `Feature CSS owner is forbidden: ${file}`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log('Shared UI PASS: canonical geometry/components have one owner and feature contours do not create a second CSS world.');
