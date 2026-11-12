import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const entry = readFileSync('online-booking/booking-entry.js', 'utf8');
const access = readFileSync('online-booking/access.js', 'utf8');
const css = readFileSync('ui/booking/booking.css', 'utf8');

// The existing human-readable public-route slug is passed through the guest
// entry and confirmed by Core. Legacy query links do not get that capability.
assert.match(entry, /routeProfileSlug: workplaceSlug \? profileSlug : ''/);
assert.match(entry, /routeWorkplaceSlug: workplaceSlug/);
assert.match(access, /params\.set\('profileSlug', state\.directRoute\.profileSlug\)/);
assert.match(access, /params\.set\('workplaceSlug', state\.directRoute\.workplaceSlug\)/);
assert.match(access, /directRoute: state\.directRoute/);
assert.match(access, /directRoute: \{ profileSlug: text\(routeProfileSlug\), workplaceSlug: text\(routeWorkplaceSlug\) \}/);
assert.match(css, /\.booking-entry__card\{[^}]*border-radius:0\}/);
assert.match(css, /\.booking-entry \.ui-button\{[^}]*border-radius:0\}/);
assert.doesNotMatch(css, /\.booking-entry__card\{[^}]*border-radius:24px\}/);
console.log('PASS: rectangular entry and server-validated individual workplace link propagation');
