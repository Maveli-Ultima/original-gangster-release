import { BLOCK_SIZE, CELL, PAVEMENT_OFFSET } from './constants';
import type { PersonRole, Vec2, WorldState } from './types';
import { peopleList } from './entityLists';

/** A stable position on one of the block's four pavements; consumes no RNG. */
export function pavementSpawn(center: Vec2, id: number): Vec2 {
  const ring = CELL / 2 - PAVEMENT_OFFSET;
  const along = ((id * 13) % 41) / 40 * BLOCK_SIZE - BLOCK_SIZE / 2;
  switch (id % 4) {
    case 0: return { x: center.x + along, y: center.y - ring };
    case 1: return { x: center.x + ring, y: center.y + along };
    case 2: return { x: center.x + along, y: center.y + ring };
    default: return { x: center.x - ring, y: center.y + along };
  }
}

const legacyCentreRoles = new Set<PersonRole>([
  'police', 'snitch', 'fbi', 'policeChief', 'fbiHead', 'mayor', 'judge', 'da',
]);

/** Older cities placed idle street NPCs in the exact centre of empty lots.
 * Repair only that spawn signature, preserving travel, orders and occupants. */
export function repairLegacyStreetSpawns(w: WorldState): void {
  if (w.cityLayout) return;
  for (const p of peopleList(w)) {
    if (!legacyCentreRoles.has(p.role) || p.status !== 'active' || p.gangId != null ||
        p.buildingId != null || p.orderId != null || p.streetOrder != null ||
        p.dest || p.path.length || p.inVehicle || p.halted) continue;
    const gx = Math.floor(p.pos.x / CELL), gy = Math.floor(p.pos.y / CELL);
    if (gx < 0 || gy < 0 || gx >= w.gridW || gy >= w.gridH) continue;
    const block = w.blocks[gy * w.gridW + gx];
    if (!block || p.pos.x !== block.center.x || p.pos.y !== block.center.y) continue;
    const lot = w.lots[block.lotIds[4]];
    if (!lot || w.buildings[lot.buildingId]?.state !== 'empty') continue;
    p.pos = pavementSpawn(block.center, p.id);
  }
}
