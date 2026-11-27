import {personDisplay} from './presentation.js';
import {buildPersonVisitIndex} from './metadata.js';
const name=person=>[person?.name,person?.surname].filter(Boolean).join(' ').trim()||'Без имени';
export function sortItems(items, mode, visitIndex = null) {
  const visits = mode.startsWith('last') ? (visitIndex || buildPersonVisitIndex()) : null;
  return [...items].sort((a, b) => {
    if (mode.startsWith('name')) {
      const compared = name(a).localeCompare(name(b), 'ru');
      return mode === 'nameDesc' ? -compared : compared;
    }
    if (mode.startsWith('uei')) {
      const compared = String(personDisplay(a).uei || '').localeCompare(String(personDisplay(b).uei || ''), 'ru', { numeric: true });
      return mode === 'ueiDesc' ? -compared : compared;
    }
    const av = Date.parse(visits?.get(String(a.key))?.lastVisit || '') || 0;
    const bv = Date.parse(visits?.get(String(b.key))?.lastVisit || '') || 0;
    return mode === 'lastDesc' ? bv - av : av - bv;
  });
}
