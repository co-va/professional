import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const entry = read('professional.js');
const workspace = read('professional/workspace.js');
const access = read('core/access.js');
const serverSync = read('core/runtime/server-sync.js');
assert.match(entry, /import\('\.\/professional\/workspace\.js'\)/);
assert.match(entry, /await getCurrentAccount\(\)/);
assert.match(entry, /from '\.\/ui\/viewport\/index\.js'/);
assert.match(workspace, /from '\.\.\/ui\/viewport\/index\.js'/);
assert.doesNotMatch(entry + workspace, /function syncViewport\(/);
assert.match(entry, /await login\(/);
assert.doesNotMatch(entry, /loadBusinessState|loadFinanceState|loadOperationalState|loadProfileState|startProfessionalServerSync|from ['"]\.\/ui\/ui\.js/);
assert.match(workspace, /export async function renderAuthenticated/);
const start = workspace.slice(workspace.indexOf('export async function renderAuthenticated'), workspace.indexOf("window.addEventListener('professional:auth-logout'"));
assert.match(start, /await loadAccess\(\)/);
assert.doesNotMatch(start.slice(0, start.indexOf('renderWorkspace();')), /loadBusinessState\(|loadFinanceState\(|loadOperationalState\(|loadProfileState\(|ensureServerSync\(/);
assert.match(workspace, /async function ensureWorkspaceState/);
assert.match(workspace, /await ensureWorkspaceState\(section\);\s*ensureServerSync\(\)/);
assert.match(serverSync, /getActiveScopes/);
assert.match(serverSync, /snapshots\.clear\(\)/);
assert.doesNotMatch(read('core/profile/runtime.js'), /if\(!full&&/);
assert.doesNotMatch(serverSync, /const refreshAll = \(\) => void pull\(ALL_SCOPES\)/);
for(const path of ['core/access.js', 'core/runtime/business-state.js', 'core/runtime/operational-state.js', 'core/runtime/auxiliary-state.js', 'core/profile/runtime.js']) {
  assert.doesNotMatch(read(path), /consumeJournalBootstrap|journal-bootstrap/);
}
assert.equal(existsSync(new URL('../core/runtime/journal-bootstrap.js', import.meta.url)), false);

// Platform owns the F (root) / E (secondary) capability catalog.
// Authentication changes must not introduce a local entitlement list.
assert.match(access, /apiRequest\('\/saas-access\/me'\)/);
assert.match(access, /capabilityMap = new Map/);
assert.match(access, /getCapability\(key\)/);
assert.match(access, /capability\.enabled === true/);
assert.match(workspace, /function allowedRootItems\(\)\s*\{[\s\S]*?\.filter\(\(item\) => sectionAllowed\(item\.id\)\)/);
assert.match(workspace, /function sectionAllowed\(section\)/);
assert.match(workspace, /canUseCapability\(item\.capability\)/);
assert.match(workspace, /if \(section === 'finance'\) return financeNavigationItems\(\)/);
assert.match(workspace, /if \(section === 'inventory'\) return inventoryNavigationItems\(\)/);
assert.match(workspace, /if \(section === 'loyalty'\) return loyaltyNavigationItems\(\)/);
assert.match(workspace, /if \(section === 'settings'\) return settingsNavigationItems\(\)/);
assert.match(workspace, /onAccessChanged: async \(\) => \{\s*await loadAccess\(\)/);
for (const path of ['core/finance/finance.js', 'core/inventory/index.js', 'core/loyalty/index.js', 'settings/settings.js']) {
  assert.match(read(path), /canUseCapability\(/);
}
assert.doesNotMatch(workspace, /function renderLogin\(|await login\(/);

console.log('Professional lightweight entry and section-only loading: PASS');
