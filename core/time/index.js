// Public Time Core contract.
// Manifestations import this facade; internal atoms remain grouped under Time.
export {
  containsRange,
  createTimeRange,
  isValidRange,
  minutesBetween,
  minutesToTime,
  normalizeTime,
  rangesOverlap,
  timeToMinutes,
} from './math.js';
export {
  createTimeGrid,
  getTimeGridMinuteState,
  getTimeGridRangeState,
  listTimeGridAvailableEnds,
  listTimeGridAvailableStarts,
} from './grid.js';
export { buildNaturalBookingTimeRows } from './booking-candidates.js';
export {
  configureSoftTimeUsageReleaseSource,
  configureTimeUsageSource,
  getTimeUsagesForScope,
  getWorkingTimeUsageConflicts,
  normalizeTimeUsage,
  notifyTimeUsageChanged,
  releaseWorkingTimeSoftUsages,
} from './usage.js';
export {
  checkTimeAvailability,
  getAvailabilityGrid,
  getTimeAvailabilityAt,
  listAvailableEndTimes,
  listAvailableStartTimes,
} from './availability.js';

export {
  normalizeWorkplaceTimeZone,
  zonedDateTimeParts,
  zonedDateTimeToDate,
} from './zone.js';
