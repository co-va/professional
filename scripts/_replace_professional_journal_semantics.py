from pathlib import Path
import re


def read(path):
    return Path(path).read_text()


def write(path, text):
    Path(path).write_text(text)


def rep(path, old, new, count=1):
    text = read(path)
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f"{path}: expected {count}, found {actual}: {old[:100]!r}")
    write(path, text.replace(old, new))


def sub1(path, pattern, repl):
    text = read(path)
    next_text, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{path}: regex not matched: {pattern[:120]}")
    write(path, next_text)


write('journal/time-usage-source.js', """import { getEventsForDay } from '../core/event/index.js';
import { getRecordsForDay } from '../core/record/index.js';
import { timeToMinutes } from '../core/time/index.js';

function previousDateKey(value = '') {
  const match = String(value || '').slice(0, 10).match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) - 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function crossesMidnight(item = null) {
  const from = timeToMinutes(item?.from);
  const to = timeToMinutes(item?.to);
  return from != null && to != null && to < from;
}

export function getJournalTimeUsages({ date, workplaceId } = {}) {
  const day = String(date || '').slice(0, 10);
  const workplace = String(workplaceId || '');
  const previousDay = previousDateKey(day);
  const records = [
    ...getRecordsForDay(day, workplace),
    ...(previousDay ? getRecordsForDay(previousDay, workplace).filter(crossesMidnight) : []),
  ].filter((record) => record?.status !== 'cancelled').map((record) => ({
    ...record, type: 'record', sourceId: String(record?.id || ''), from: String(record?.from || ''), to: String(record?.to || ''),
  }));
  const events = [
    ...getEventsForDay(day, workplace),
    ...(previousDay ? getEventsForDay(previousDay, workplace).filter(crossesMidnight) : []),
  ].map((item) => ({
    ...item, type: 'event', sourceId: String(item?.id || ''), from: String(item?.from || ''), to: String(item?.to || ''),
  }));
  return [...records, ...events];
}
""")

write('core/time/usage.js', """// Neutral occupancy contract between business owners and Professional time mechanisms.
// Every Record/Event is strict occupied time. There is no soft usage and no silent release.
import { containsRange, isValidRange, timeToMinutes } from './math.js';

let timeUsageSource = () => [];

export function configureTimeUsageSource(source) {
  timeUsageSource = typeof source === 'function' ? source : () => [];
}

export function normalizeTimeUsage(usage = {}) {
  const from = String(usage?.from || '');
  const to = String(usage?.to || '');
  const start = timeToMinutes(from);
  const end = timeToMinutes(to);
  if (start == null || end == null || start === end) return null;
  return {
    ...usage,
    type: String(usage?.type || 'usage'),
    sourceId: String(usage?.sourceId ?? usage?.id ?? ''),
    from,
    to,
  };
}

export function getTimeUsagesForScope(options = {}) {
  const values = timeUsageSource(options);
  return (Array.isArray(values) ? values : []).map(normalizeTimeUsage).filter(Boolean);
}

export function getWorkingTimeUsageConflicts({ operation = 'resize', from, to, ...scope } = {}) {
  const usages = getTimeUsagesForScope(scope);
  if (operation === 'remove') return usages;
  if (!isValidRange(from, to)) return [];
  return usages.filter((usage) => !containsRange(from, to, usage.from, usage.to));
}

export function notifyTimeUsageChanged(detail = {}) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('professional:time-usage-changed', { detail }));
}
""")

write('core/time/grid.js', """// Neutral minute-resolution Professional time grid.
// Every usage is strict occupied time.
import { isValidRange, timeToMinutes, minutesToTime } from './math.js';

const DAY_MINUTES = 24 * 60;
function normalizeDate(value) { return String(value || '').slice(0, 10); }
function dateOrdinal(value) {
  const match = normalizeDate(value).match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
  if (!match) return null;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
}
function normalizeUsage(usage = {}, gridDate = '') {
  const from = String(usage?.from || '');
  const to = String(usage?.to || '');
  const start = timeToMinutes(from);
  const rawEnd = timeToMinutes(to);
  if (start == null || rawEnd == null || start === rawEnd) return null;
  const usageDay = dateOrdinal(usage?.date || gridDate);
  const visibleDay = dateOrdinal(gridDate);
  const offset = usageDay != null && visibleDay != null ? (usageDay - visibleDay) * DAY_MINUTES : 0;
  const absoluteStart = start + offset;
  const absoluteEnd = (rawEnd > start ? rawEnd : rawEnd + DAY_MINUTES) + offset;
  const gridStart = Math.max(0, absoluteStart);
  const gridEnd = Math.min(DAY_MINUTES, absoluteEnd);
  if (gridEnd <= gridStart) return null;
  return { ...usage, sourceId: String(usage?.sourceId ?? usage?.id ?? ''), type: String(usage?.type || 'usage'), from, to, gridStart, gridEnd };
}
function normalizePlan(plan = null) { if (!plan || !isValidRange(plan?.from, plan?.to)) return null; return { from: String(plan.from), to: String(plan.to) }; }

export function createTimeGrid({ date = '', workplaceId = '', plan = null, usages = [] } = {}) {
  const day = normalizeDate(date);
  return Object.freeze({ date: day, workplaceId: String(workplaceId || ''), plan: normalizePlan(plan), usages: Object.freeze((Array.isArray(usages) ? usages : []).map((usage) => normalizeUsage(usage, day)).filter(Boolean)) });
}
export function getTimeGridMinuteState(grid, time, { excludeId = '' } = {}) {
  const minute = timeToMinutes(time), planStart = timeToMinutes(grid?.plan?.from), planEnd = timeToMinutes(grid?.plan?.to);
  if (minute == null || planStart == null || planEnd == null || minute < planStart || minute >= planEnd) return { state: 'outside-plan', usage: null };
  const excluded = String(excludeId || '');
  const usage = (Array.isArray(grid?.usages) ? grid.usages : []).find((item) => (!excluded || String(item?.sourceId || '') !== excluded) && item.gridStart <= minute && minute < item.gridEnd) || null;
  return usage ? { state: 'occupied', usage } : { state: 'free', usage: null };
}
export function getTimeGridRangeState(grid, { from, to, excludeId = '' } = {}) {
  if (!isValidRange(from, to)) return { ok: false, reason: 'invalid-time', conflicts: [] };
  const planStart = timeToMinutes(grid?.plan?.from), planEnd = timeToMinutes(grid?.plan?.to), start = timeToMinutes(from), end = timeToMinutes(to);
  if (planStart == null || planEnd == null) return { ok: false, reason: 'day-not-working', conflicts: [] };
  if (start == null || end == null || start < planStart || end > planEnd) return { ok: false, reason: 'outside-working-time', conflicts: [] };
  const excluded = String(excludeId || '');
  const conflicts = (Array.isArray(grid?.usages) ? grid.usages : []).filter((usage) => (!excluded || String(usage?.sourceId || '') !== excluded) && start < usage.gridEnd && usage.gridStart < end);
  return conflicts.length ? { ok: false, reason: 'occupied', conflicts } : { ok: true, reason: '', conflicts: [] };
}
export function listTimeGridAvailableStarts(grid, { duration = 0, step = 5, from = '', to = '', excludeId = '' } = {}) {
  const minutes = Math.max(1, Number(duration) || 0), increment = Math.max(1, Number(step) || 1);
  const planStart = timeToMinutes(grid?.plan?.from), planEnd = timeToMinutes(grid?.plan?.to), windowStart = timeToMinutes(from), windowEnd = timeToMinutes(to);
  if (planStart == null || planEnd == null) return [];
  const start = Math.max(planStart, windowStart == null ? planStart : windowStart), end = Math.min(planEnd, windowEnd == null ? planEnd : windowEnd), values = [];
  for (let minute = Math.ceil(start / increment) * increment; minute + minutes <= end; minute += increment) { const candidateFrom = minutesToTime(minute), candidateTo = minutesToTime(minute + minutes); if (!candidateFrom || !candidateTo) continue; if (getTimeGridRangeState(grid, { from: candidateFrom, to: candidateTo, excludeId }).ok) values.push(candidateFrom); }
  return values;
}
export function listTimeGridAvailableEnds(grid, { from, step = 5, to = '', excludeId = '' } = {}) {
  const start = timeToMinutes(from), planEnd = timeToMinutes(grid?.plan?.to), windowEnd = timeToMinutes(to), increment = Math.max(1, Number(step) || 1);
  if (start == null || planEnd == null) return [];
  const end = Math.min(planEnd, windowEnd == null ? planEnd : windowEnd), values = [];
  for (let minute = start + increment; minute <= end; minute += increment) { const candidateTo = minutesToTime(minute); if (!candidateTo) continue; if (getTimeGridRangeState(grid, { from, to: candidateTo, excludeId }).ok) values.push(candidateTo); }
  return values;
}
""")

rep('core/time/index.js', "  configureSoftTimeUsageReleaseSource,\n", "")
rep('core/time/index.js', "  releaseWorkingTimeSoftUsages,\n", "")
rep('core/day/service.js', ", releaseWorkingTimeSoftUsages } from '../time/index.js';", " } from '../time/index.js';")
sub1('core/day/service.js', r"\n  const nextIds = new Set\(next\.map\(dayIdentity\)\);.*?\n  return blocked\.length", "\n  replaceDayRows(next);\n\n  return blocked.length")
rep('professional.js', "import { getJournalTimeUsages, releaseJournalSoftTimeUsages } from './journal/time-usage-source.js';", "import { getJournalTimeUsages } from './journal/time-usage-source.js';")
rep('professional.js', "import { configureTimeUsageSource, configureSoftTimeUsageReleaseSource } from './core/time/index.js';", "import { configureTimeUsageSource } from './core/time/index.js';")
rep('professional.js', "configureSoftTimeUsageReleaseSource(releaseJournalSoftTimeUsages);\n", "")

rep('journal/journal.js', "import { getActiveDayWorkplaces } from '../core/day/index.js';", "import { getActiveDayWorkplaces, getDayRemovalConflicts } from '../core/day/index.js';")
rep('journal/journal.js', "if (getActiveRecordCountForDay(day, selectedWorkplaceId) > 0) return;", "if (getDayRemovalConflicts(selectedWorkplaceId, day).length > 0) return;")
rep('journal/journal.js', "&& getActiveRecordCountForDay(day, selectedWorkplaceId) === 0;", "&& getDayRemovalConflicts(selectedWorkplaceId, day).length === 0;")
rep('timetable/day-editor.js', "function usageLabel(usage) {\n  return usage?.type === 'break' ? 'Перерыв' : 'Запись';\n}", "function usageLabel(usage) {\n  return usage?.type === 'event' ? 'Событие' : 'Запись';\n}")
rep('timetable/timetable.js', "function occupiedLabel(item) { return item?.type === 'break' ? 'Перерыв' : 'Запись'; }", "function occupiedLabel(item) { return item?.type === 'event' ? 'Событие' : 'Запись'; }")

p = 'journal/event-create.js'
text = read(p)
text = text.replace("eventActions = null, ", "")
text = text.replace("  const customActions = eventActions && typeof eventActions.create === 'function' ? eventActions : null;\n", "")
text, n = re.subn(r"\n    if \(!customActions\) \{.*?\n    return true;\n  \};", """
    const availability = checkTimeAvailability({
      date: state.date,
      workplaceId: state.workplaceId,
      from,
      to,
    });
    if (!availability.ok) {
      openNotice({ title: 'Событие', message: availabilityMessage(availability.reason) });
      return false;
    }
    return true;
  };""", text, count=1, flags=re.S)
if n != 1:
    raise SystemExit('event-create validate branch not replaced')
text, n = re.subn(r"\n      if \(customActions\) \{.*?\n        return;\n      \}\n\n      const created = createEvent", "\n\n      const created = createEvent", text, count=1, flags=re.S)
if n != 1:
    raise SystemExit('event-create custom create branch not replaced')
if re.search(r'customActions|eventActions', text):
    raise SystemExit('event-create retired branch remains')
write(p, text)

p = 'journal/event-view.js'
text = read(p)
text = text.replace("eventActions = null } = {})", "} = {})")
text, n = re.subn(r"  const customActions = eventActions.*?\n  const readCurrent = \(\) => customActions \? customActions\.read\(eventId\) : readEvent\(eventId\);", "  const readCurrent = () => readEvent(eventId);", text, count=1, flags=re.S)
if n != 1:
    raise SystemExit('event-view owner declaration not replaced')
text = text.replace("    if (customActions?.supportsNotes === false) return;\n", "")
text = re.sub(r"    const notesAvailable = customActions\?\.supportsNotes === false\n      \? false\n      : hasNotesForTarget\('event', current\.id\);", "    const notesAvailable = hasNotesForTarget('event', current.id);", text, count=1)
text, n = re.subn(r"\n        if \(customActions\) \{.*?\n          return;\n        \}\n\n        const snapshot", "\n\n        const snapshot", text, count=1, flags=re.S)
if n != 1:
    raise SystemExit('event-view delete custom branch not replaced')
text, n = re.subn(r"\n    if \(customActions\) \{.*?\n      return true;\n    \}\n\n    const availability", "\n\n    const availability", text, count=1, flags=re.S)
if n != 1:
    raise SystemExit('event-view validate custom branch not replaced')
text, n = re.subn(r"\n      if \(customActions\) \{.*?\n        return;\n      \}\n\n      updateEvent", "\n\n      updateEvent", text, count=1, flags=re.S)
if n != 1:
    raise SystemExit('event-view update custom branch not replaced')
if re.search(r'customActions|eventActions', text):
    raise SystemExit('event-view retired branch remains')
write(p, text)

p = 'journal/note-target.js'
text = read(p)
text = re.sub(r"function recordsForDay\(date, source = null\) \{.*?\n\}", "function recordsForDay(date) {\n  return getRecordsForDay(date, '');\n}", text, count=1, flags=re.S)
text = re.sub(r"function eventsForDay\(date, source = null\) \{.*?\n\}", "function eventsForDay(date) {\n  return getEventsForDay(date, '');\n}", text, count=1, flags=re.S)
text = text.replace("function liveTarget(type = '', id = '', source = null) {", "function liveTarget(type = '', id = '') {")
text = text.replace("    const record = typeof source?.readRecord === 'function' ? source.readRecord(id) : getRecord(id);", "    const record = getRecord(id);")
text = text.replace("    const event = typeof source?.readEvent === 'function' ? source.readEvent(id) : readEvent(id);", "    const event = readEvent(id);")
text = text.replace("export function noteTargetSnapshot(targetType = '', targetId = '', { source = null } = {}) {\n  return targetSnapshot(liveTarget(targetType, targetId, source));\n}", "export function noteTargetSnapshot(targetType = '', targetId = '') {\n  return targetSnapshot(liveTarget(targetType, targetId));\n}")
text = text.replace("export function noteContextWithTarget(context = {}, targetType = '', targetId = '', { source = null } = {}) {", "export function noteContextWithTarget(context = {}, targetType = '', targetId = '') {")
text = text.replace("  const snapshot = noteTargetSnapshot(type, id, { source });", "  const snapshot = noteTargetSnapshot(type, id);")
text = text.replace("export function noteTargetOptions(date, { includeNote = null, source = null } = {}) {", "export function noteTargetOptions(date, { includeNote = null } = {}) {")
text = text.replace("recordsForDay(date, source)", "recordsForDay(date)")
text = text.replace("eventsForDay(date, source)", "eventsForDay(date)")
text = text.replace("resolveNoteTarget(includeNote || {}, { source })", "resolveNoteTarget(includeNote || {})")
text = text.replace("export function resolveNoteTarget(note = {}, { source = null } = {}) {", "export function resolveNoteTarget(note = {}) {")
text = text.replace("liveTarget(type, id, source)", "liveTarget(type, id)")
text = text.replace("export function noteTargetLabel(note = {}, { source = null } = {}) {\n  const target = resolveNoteTarget(note, { source });", "export function noteTargetLabel(note = {}) {\n  const target = resolveNoteTarget(note);")
if re.search(r'\bsource\?\.|\{ source\b|source = null|, source\)', text):
    raise SystemExit('note-target source injection remains')
write(p, text)

p = 'journal/note-create.js'
text = read(p)
text = text.replace("function normalizeTargetForDate(state, targetSource = null) {", "function normalizeTargetForDate(state) {")
text = text.replace("noteTargetOptions(state.date, { source: targetSource })", "noteTargetOptions(state.date)")
text = text.replace("  noteActions = null,\n  targetSource = null,\n", "")
text = text.replace("  const customActions = noteActions && typeof noteActions.create === 'function' ? noteActions : null;\n", "")
text = text.replace("normalizeTargetForDate(state, targetSource)", "normalizeTargetForDate(state)")
text = text.replace("{ scope: customActions ? 'account' : 'professional' }", "{ scope: 'professional' }")
text = text.replace(",\n          { source: targetSource },", ",")
text, n = re.subn(r"\n      if \(customActions\) \{.*?\n        return;\n      \}\n\n      const ownerId", "\n\n      const ownerId", text, count=1, flags=re.S)
if n != 1:
    raise SystemExit('note-create custom branch not replaced')
if re.search(r'customActions|noteActions|targetSource|scope:\s*[\'\"]account[\'\"]', text):
    raise SystemExit('note-create retired branch remains')
write(p, text)

p = 'journal/note-view.js'
text = read(p)
text = text.replace("function normalizeTargetForDate(state, targetSource = null) {", "function normalizeTargetForDate(state) {")
text = text.replace("resolveNoteTarget(state, { source: targetSource })", "resolveNoteTarget(state)")
text = text.replace("noteTargetOptions(state.date, { source: targetSource })", "noteTargetOptions(state.date)")
text = text.replace("  noteActions = null,\n  targetSource = null,\n", "")
text, n = re.subn(r"  const customActions = noteActions.*?\n    : null;\n", "", text, count=1, flags=re.S)
if n != 1:
    raise SystemExit('note-view custom owner declaration not replaced')
text = text.replace("  const readCurrent = () => customActions ? customActions.read(noteId) : readNote(noteId);", "  const readCurrent = () => readNote(noteId);")
text = text.replace("noteTargetLabel(current, { source: targetSource })", "noteTargetLabel(current)")
text = text.replace("normalizeTargetForDate(state, targetSource)", "normalizeTargetForDate(state)")
text = text.replace("noteTargetOptions(state.date, { includeNote: state, source: targetSource })", "noteTargetOptions(state.date, { includeNote: state })")
text = text.replace("noteContextWithTarget(state.context, state.targetType, state.targetId, { source: targetSource })", "noteContextWithTarget(state.context, state.targetType, state.targetId)")
text, n = re.subn(r"\n        if \(customActions\) \{.*?\n          return;\n        \}\n\n        const updated = updateNote", "\n\n        const updated = updateNote", text, count=1, flags=re.S)
if n != 1:
    raise SystemExit('note-view update custom branch not replaced')
text, n = re.subn(r"\n        if \(customActions\) \{.*?\n          return;\n        \}\n\n        if \(!removeNote", "\n\n        if (!removeNote", text, count=1, flags=re.S)
if n != 1:
    raise SystemExit('note-view delete custom branch not replaced')
if re.search(r'customActions|noteActions|targetSource', text):
    raise SystemExit('note-view retired branch remains')
write(p, text)

p = 'scripts/audit-professional-clean.mjs'
text = read(p)
old = "if (/data-account|cova:account|accountMode|context:\\s*['\"]account['\"]|core\\/(?:note|event)\\/account-owner|calendar-sync\\/account/.test(text)) {"
new = "if (/data-account|cova:account|accountMode|context:\\s*['\"]account['\"]|scope:\\s*['\"]account['\"]|eventActions|noteActions|targetSource|core\\/(?:note|event)\\/account-owner|calendar-sync\\/account/.test(text)) {"
if old not in text:
    raise SystemExit('clean audit anchor not found')
write(p, text.replace(old, new, 1))
