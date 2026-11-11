import fs from 'node:fs';
import path from 'node:path';

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
const geometry = read('ui/v2/geometry.js');
const header = read('ui/v2/header.js');
const zStack = read('ui/v2/z-stack.js');
const modalPortal = read('ui/v2/modal-portal.js');
const keyboardRuntime = read('ui/inputs/keyboard-runtime.js');
const keyboardStyle = read('ui/inputs/keyboard.css');
const shellStyle = read('css/style.css');
const vHost = read('ui/v2/v-host.js');
const entity = read('ui/cards/entity-card-constructor.css');
const mini = read('ui/cards/mini-card.css');
const list = read('ui/lists/list-entry.css');

// Canonical shell geometry has one Shared owner.
assert(v2.includes('--v2-z-radius:34px'), 'Shared Z radius changed');
assert(v2.includes('--v2-z-layer-offset:12px'), 'Shared Z layer offset changed');
assert(v2.includes('--v2-edge:16px'), 'Shared Z edge changed');
assert(v2.includes('height:72px;') && v2.includes('flex:0 0 72px'), 'Shared H height changed');
assert(v2.includes('padding:22px 18px calc(24px + env(safe-area-inset-bottom))'), 'Shared Z padding changed');
assert(rootSelectorCount(v2, '.v2-header') === 1, 'Shared H geometry must have one owner');
assert(rootSelectorCount(v2, '.v2-z') === 1, 'Shared Z geometry must have one owner');
assert(!zStack.includes('padding-top:0'), 'Nested Z must not override Shared top padding');

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
assert(keyboardStyle.includes('.v2-layer--bottom{\\n  bottom:0;'.replace('\\n', '\n')), 'X white surface must stay attached to bottom under keyboard');
assert(keyboardStyle.includes('padding-bottom:calc(20px + var(--ui-keyboard-inset))'), 'X contents must remain above keyboard');
assert(!modalPortal.includes('node.contains(document.activeElement)'), 'Per-modal focus blur override is forbidden');

// Canonical Shared components keep one geometry owner.
assert(entity.includes('width:min(338px,100%)'), 'EntityCard width changed');
assert(entity.includes('aspect-ratio:338/213'), 'EntityCard aspect ratio changed');
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


assert(mini.includes('--mini-card-width:238px'), 'MiniCard width changed');
assert(rootSelectorCount(mini, '.mini-card') === 1, 'MiniCard geometry must have one owner');
assert(!mini.includes('.mini-card:has(>.mini-card__rows)'), 'Do not override User MiniCard base geometry in Professional');


// Shared MiniCard has one rounded geometry contract (co-va/user/staging).
// No feature card may flatten the MiniCard's corners or create a local clone.
const miniGeometry = [
  [/\.mini-card\{[^}]*border-radius:16px;/, 'MiniCard outer radius must be 16px'],
  [/\.mini-card__media\{[^}]*border-radius:10px;/, 'MiniCard media radius must be 10px'],
  [/\.mini-card__context-action\{[^}]*border-radius:10px;/, 'MiniCard context radius must be 10px'],
  [/\.mini-card__compact-action\{[^}]*border-radius:9px;/, 'MiniCard compact action radius must be 9px'],
];
for (const [rule, message] of miniGeometry) assert(rule.test(mini), message);


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
