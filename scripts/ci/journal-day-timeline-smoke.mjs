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

// A changed/removed WorkPlan must not conceal an existing Record or Event.
const offPlanRecord = { ...record, from: '18:00', to: '19:00' };
const offPlanEvent = { ...event, from: '07:00', to: '08:00' };
const shifted = journalDayTimeline({
  day: '2026-11-15', from: '09:00', to: '18:00',
  usages: [offPlanRecord, offPlanEvent],
});
assert.match(shifted, /data-time-usage="record-1"/);
assert.match(shifted, /data-time-usage="event-1"/);
assert.match(shifted, /data-time-to="19:00"/);
assert.match(shifted, /data-time-from="07:00"/);

const unplanned = journalDayTimeline({
  day: '2026-11-15', from: '07:00', to: '08:00',
  usages: [offPlanEvent], interactiveSlots: false,
});
assert.match(unplanned, /data-time-usage="event-1"/);
assert.doesNotMatch(unplanned, /data-time-slot-from=/, 'A non-working day must have no creation buttons');

const formerWorkplace = journalDayTimeline({ day: '2026-11-15', columns: [
  { workplaceId: 'w1', name: 'One', from: '09:00', to: '18:00', usages: [offPlanRecord] },
  { workplaceId: 'w2', name: 'Two', from: '07:00', to: '08:00', usages: [offPlanEvent], hasWorkPlan: false },
] });
assert.match(formerWorkplace, /data-time-usage="event-1"/);
assert.match(formerWorkplace, /data-time-usage="record-1"/);
assert.match(formerWorkplace, /data-journal-work-field="w1"/);
assert.doesNotMatch(formerWorkplace, /data-journal-work-field="w2"/,
  'Existing events outside an active WorkPlan do not create a fictional work field');

const daySource = readFileSync('journal/день.js', 'utf8');
assert.match(daySource, /const dayUsages = getTimeUsagesForScope\(\{ date: dayDate \}\);/,
  'Time usage may not depend on a current working-day row');
assert.match(daySource, /interactiveSlots: false/,
  'Records on days without a WorkPlan must remain accessible without allowing new slots');
assert.match(daySource, /createTimeGrid\(\{ date, usages \}\)/,
  'Use canonical Time normalization for overnight records, not raw clock arithmetic');

const recordServiceSource = readFileSync('core/record/service.js', 'utf8');
assert.match(recordServiceSource, /if \(scheduleChanged\(current, next\) && !checkRecordTime\(/,
  'Only moving a Record may recheck availability; attendance must remain editable');

const eventViewerSource = readFileSync('journal/event-view.js', 'utf8');
assert.match(eventViewerSource, /if \(from !== current\.from \|\| to !== current\.to\)/,
  'Editing event text must not recheck its original time');

const journalSource = readFileSync('journal/journal.js', 'utf8');
assert.match(journalSource, /label: 'Сумма', value: formatRubles\(total\), strong: true/,
  'Day/Month Z-report keeps its existing receipt layout');
assert.doesNotMatch(journalSource, /label: 'Стоимость услуг и товаров'/,
  'No unapproved receipt group may be introduced');
assert.match(journalSource, /actions: isDayOff && !hasUsage \? \[\] : \[/,
  'Historical records on a day without a WorkPlan must keep the Day report action');
assert.match(journalSource, /dayViewState\.busyWorkplaces\.has\(String\(selectedWorkplaceId \|\| ''\)\)/,
  'A single-workplace report must use its own occupancy, not other workplaces');

const recordFlowSource = readFileSync('core/records/records.js', 'utf8');
assert.match(recordFlowSource, /const unchangedSchedule = existing/,
  'The Record confirmation must allow editing unchanged appointments');
assert.match(recordFlowSource, /source\.kind === 'professional' && !unchangedSchedule/,
  'New and rescheduled Record confirmations must still validate availability');



// A previous-day overnight Record is still visible on today's readonly Day.
const carriedRecord = { ...record, date: '2026-11-14', from: '23:30', to: '00:30' };
const carried = journalDayTimeline({
  day: '2026-11-15', from: '00:00', to: '01:00',
  usages: [carriedRecord], interactiveSlots: false,
});
assert.match(carried, /data-time-usage="record-1"/);
assert.doesNotMatch(carried, /data-time-slot-from=/);

const timeSource = readFileSync('ui/time/journal-day.js', 'utf8');
const css = readFileSync('ui/time/time.css', 'utf8');
assert.equal((timeSource.match(/querySelectorAll\('\[data-time-usage\]'\)/g) || []).length, 1,
  'Single and aggregate Day must share one Record/Event click owner');
assert.match(css, /\.time-timeline__usage\{[^}]*pointer-events:auto/);
assert.match(css, /\.journal-work-field__usage\{[^}]*pointer-events:auto/);
console.log('PASS: Day minute-precision slots, single/aggregate usage hit targets and original half-hour geometry');
