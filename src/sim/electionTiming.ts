import { ELECTION_WEEKS, MAYOR_ELECTION_CYCLE, MAYOR_INITIAL_TERM_WEEKS } from './constants';
import type { WorldState } from './types';

/** The retail mayor owns a saved counter, independent of the last poll result.
 * 0x4C2E20 initializes it to four; 0x4C2F50/90 load/save that same dword.
 * Old remake saves lack it: seed once from available history without changing
 * their ballot, remaining campaign weeks, RNG or cash. This fallback cannot
 * recover whether an earlier election returned the same mayor. */
export function restoreElectionTiming(w: WorldState): void {
  if (w.election.mayorTerm || !w.people[w.mayorId]) return;
  const completed = w.week - 1 + (w.settlementStage != null && w.settlementStage > 8 && w.settlementStage <= 16 ? 1 : 0);
  const elapsed = w.election.active
    ? Math.max(0, ELECTION_WEEKS - w.election.weeksLeft)
    : MAYOR_INITIAL_TERM_WEEKS + Math.max(0, completed - w.election.lastResultWeek);
  w.election.mayorTerm = { personId: w.mayorId, weeks: Math.min(MAYOR_ELECTION_CYCLE - 1, elapsed) };
}
