import { NO_ORIGINAL_CHANNEL, opinionSet } from './attitudes';
import type { ID, Person, WorldState } from './types';

/**
 * Attributed violence hardens the Bureau against the responsible gang.
 * These magnitudes are remake tuning, not numerical rules from the manual.
 * Call once per resolved planned attack or damaging street attack order.
 * The caller owns deduplication; ordinary crime/witness recording stays separate.
 */
export function respondToBureauViolence(w: WorldState, gangId: ID, victim: Person): boolean {
  const gang = w.gangs[gangId];
  if (!gang || (victim.role !== 'fbi' && victim.role !== 'fbiHead')) return false;
  gang.suspicion = Math.min(100, gang.suspicion + 5);
  const responders = new Set([w.fbiHeadId, ...w.fbiIds]);
  for (const id of responders) {
    const official = w.people[id];
    if (!official || official.status === 'dead') continue;
    if (id !== w.fbiHeadId && official.status !== 'active') continue;
    opinionSet(official, gangId, Math.max(-100, Math.min(100, (official.opinion[gangId] ?? 0) - 10)), NO_ORIGINAL_CHANNEL);
  }
  return true;
}
