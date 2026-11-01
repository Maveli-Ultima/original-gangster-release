import type { ID, WorldState } from './types';
import { canonicalAreaBlocks, claimedTerritoryBlocks } from './territory';
export { canonicalAreaBlocks } from './territory';

/** The same choices drive API guards, box gestures, Find and map highlights. */
export function lieutenantAreaChoices(w: WorldState, gangId: ID, teamId: ID) {
  const gang = w.gangs[gangId], team = w.teams[teamId];
  const selected = new Set<ID>(), other = new Set<ID>(), available = new Set<ID>();
  if (!gang || !team || team.gangId !== gangId || !gang.teamIds.includes(teamId)) return { selected, other, available };
  for (const id of canonicalAreaBlocks(w, team.allocatedBlockIds)) selected.add(id);
  for (const id of gang.teamIds) {
    if (id === teamId) continue;
    for (const block of canonicalAreaBlocks(w, w.teams[id]?.allocatedBlockIds ?? [])) other.add(block);
  }
  for (const id of claimedTerritoryBlocks(w, gangId)) if (!other.has(id)) available.add(id);
  // Old or subsequently lost areas remain removable; this does not permit
  // adding them back after explicit release. Existing duplicates can be cleared.
  for (const id of selected) available.add(id);
  return { selected, other, available };
}
