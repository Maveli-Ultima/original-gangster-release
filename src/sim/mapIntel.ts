import type { Block, Building, ID, WorldState } from './types';
import { standingTerritorySite, territorySites } from './territory';

/** The information a gang can put on its map, not the simulation's full truth. */
export function buildingMapIntel(b: Building, viewer: ID | null) {
  const mine = viewer != null && b.ownerGangId === viewer;
  const knowledge = viewer == null ? 0 : b.knowledge[viewer] ?? 0;
  // A public front and the illicit business behind it have separate knowledge.
  // `discovered` belongs to the FBI investigation, not to this gang's scouts.
  const siteKnown = b.cls !== 'illegal' || mine || knowledge >= 3;
  const reportedOwner = viewer != null && b.ownerGangId != null && b.reportedOwners?.[viewer] === b.ownerGangId;
  const ownerGangId = siteKnown && (mine || knowledge >= 2 || reportedOwner) ? b.ownerGangId : null;
  const protectionGangId = siteKnown && (knowledge >= 2 || viewer != null && b.protection?.gangId === viewer)
    ? b.protection?.gangId ?? null : null;
  return {
    siteKnown,
    ownerGangId,
    protectionGangId,
    isHQ: siteKnown && b.isHQ && b.state !== 'destroyed' && ownerGangId != null && (mine || knowledge >= 3),
  };
}

/** Only identified holdings establish visible territory (manual p.12).
 * One discovered shop reveals its block, never that gang's other claims. */
export function knownBlockOwners(w: WorldState, block: Block, viewer: ID | null): ID[] {
  const held = new Set<ID>();
  for (const b of territorySites(w, block)) {
    if (!standingTerritorySite(b)) continue;
    const intel = buildingMapIntel(b, viewer);
    for (const id of [intel.ownerGangId, intel.protectionGangId]) {
      if (id != null && w.gangs[id] && !w.gangs[id].eliminated) held.add(id);
    }
  }
  return [...held].sort((a, b) => a - b);
}
