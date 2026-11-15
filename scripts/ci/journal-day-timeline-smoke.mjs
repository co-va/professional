import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { journalDayTimeline } from '../../ui/time/journal-day.js';

// Protect the already-approved Day geometry while exercising minute-precision
// WorkPlan boundaries. This is an opt-in smoke, not a new CI workflow.
const slots = (html) => [...html.matchAll(/data-time-slot-from="([^"]+)" data-time-slot-to="([^"]+)"/g)]
  .map((match) => [match[1], match[2]]);
const partial = journalDayTimeline({ from: '09:15', to: '10:15', day: '2026-11-15' });
assert.deepEqual(slots(partial), [
  ['09:15', '09:30'],
  ['09:30', '10:00'],
  ['10:00', '10:15'],
]);
assert.match(partial, /style="height:15px;min-height:15px" data-time-slot-from="09:15"/);
assert.match(partial, /style="height:15px;min-height:15px" data-time-slot-from="10:00"/);

const oneMinute = journalDayTimeline({ from: '08:59', to: '09:01', day: '2026-11-15' });
assert.deepEqual(slots(oneMinute), [['08:59', '09:00'], ['09:00', '09:01']]);

const aligned = journalDayTimeline({ from: '09:00', to: '10:00', day: '2026-11-15' });
assert.deepEqual(slots(aligned), [['09:00', '09:30'], ['09:30', '10:00']]);
assert.doesNotMatch(aligned, /style="height:30px;/, 'Standard half-hour row keeps original geometry');

const record = { id: 'record-1', sourceId: 'record-1', type: 'record',
  from: '09:15', to: '09:45', date: '2026-11-15',
  person: { name: 'Тест' }, procedures: [{ name: 'Стрижка' }], financialTotal: 2400 };
const event = { id: 'event-1', sourceId: 'event-1', type: 'event',
  from: '09:45', to: '10:00', date: '2026-11-15', title: 'Событие' };
const single = journalDayTimeline({ from: '09:15', to: '10:15',
  day: '2026-11-15', usages: [record, event], clipUsagesToWorkRange: true });
assert.equal((single.match(/data-time-usage="record-1"/g) || []).length, 1);
assert.equal((single.match(/data-time-usage="event-1"/g) || []).length, 1);
assert.match(single, /data-journal-usage="record-1"/);
assert.match(single, /data-journal-usage="event-1"/);
const aggregate = journalDayTimeline({ day: '2026-11-15', columns: [
  { workplaceId: 'w1', name: 'Первое', from: '09:15', to: '10:15', usages: [record] },
  { workplaceId: 'w2', name: 'Второе', from: '09:00', to: '10:00', usages: [event] },
] });
assert.equal((aggregate.match(/data-time-usage="record-1"/g) || []).length, 1);
assert.equal((aggregate.match(/data-time-usage="event-1"/g) || []).length, 1);
assert.match(aggregate, /data-journal-work-field="w1"/);
assert.match(aggregate, /data-journal-work-field="w2"/);

const timeSource = readFileSync('ui/time/journal-day.js', 'utf8');
const css = readFileSync('ui/time/time.css', 'utf8');
assert.equal((timeSource.match(/querySelectorAll\('\[data-time-usage\]'\)/g) || []).length, 1,
  'Single and aggregate Day must share one Record/Event click owner');
assert.match(css, /\.time-timeline__usage\{[^}]*pointer-events:auto/);
assert.match(css, /\.journal-work-field__usage\{[^}]*pointer-events:auto/);
console.log('PASS: Day minute-precision slots, single/aggregate usage hit targets and original half-hour geometry');
