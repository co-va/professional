// Public WorkPlan Day Core contract.
// Manifestations import this facade; storage stays internal to the Day owner.
export { hydrateDaysFromServer } from './data.js';
export { getDay, getDayTime, getDays, getDaysForDate } from './read.js';
export {
  dayDate,
  getDayDraftScheduleConflicts,
  getScheduleConflictsForDays as getScheduleConflicts,
  hasScheduleConflictForDays as hasScheduleConflict,
  findSuggestedDayInterval as findSuggestedInterval,
  resolveDayTime,
  totalDayMinutes,
} from './rules.js';
export {
  createDay,
  getDayRemovalConflicts,
  removeDay,
  saveDays,
  updateDayTime,
} from './service.js';
export { getActiveDayWorkplaces, getAvailableDayWorkplaces } from './workplaces.js';
