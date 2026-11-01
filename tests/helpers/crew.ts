import { moveToTeam } from '../../src/sim/api';
import type { Sim } from '../../src/sim/sim';

/** Larger-job fixtures explicitly allocate their starting reserves in planning. */
export function staffFirstCrew(sim: Sim): void {
  const gang = sim.playerGang;
  for (const id of [...gang.poolIds]) {
    const result = moveToTeam(sim.world, gang.id, id, gang.teamIds[0]);
    if (!result.ok) throw Error(result.error);
  }
}
