import { ORDERS } from '../sim/constants';
import { specialistTargetEligible } from '../sim/specialistJobs';
import type { ID, SpecialistJob, WorldState } from '../sim/types';
import { peopleList, buildingList } from '../sim/entityLists';

export function specialistPeopleBySite(w: WorldState, gangId: ID, type: SpecialistJob['type']): Map<ID, ID> {
  const sites = new Map<ID, ID>();
  for (const p of peopleList(w)) if (p.buildingId != null && specialistTargetEligible(w, gangId, type, p)) sites.set(p.buildingId, p.id);
  for (const b of buildingList(w)) for (const id of [b.managerId, b.ownerPersonId]) {
    if (id != null && w.people[id] && specialistTargetEligible(w, gangId, type, w.people[id])) sites.set(b.id, id);
  }
  return sites;
}

export function plannedCrimeBlocks(w: WorldState, gangId: ID): Set<ID> {
  const blocks = new Set<ID>();
  for (const o of Object.values(w.orders)) if (o.gangId === gangId && o.state === 'queued' && ORDERS[o.type].severity > 0) {
    for (const id of o.targetBlockIds) blocks.add(w.blocks[id]?.layout?.mergedInto ?? id);
    for (const id of o.targetBuildingIds) if (w.buildings[id]) blocks.add(w.buildings[id].blockId);
    if (o.targetPersonId != null) {
      const p = w.people[o.targetPersonId], b = p?.buildingId == null ? null : w.buildings[p.buildingId];
      if (b) blocks.add(b.blockId);
    }
  }
  return blocks;
}
