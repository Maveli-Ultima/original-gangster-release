/**
 * Gang headquarters and starting businesses in the original 40 × 32 city,
 * ported from Gang_PlaceHeadquarters (0x6566A0) and its helpers: the quadrant
 * hangout centroid (0x411FF0), the start jitter (0x60B040), the square-ring
 * spiral (0x60AD60) with the HQ predicate (0x6697D0), and the starting-business
 * predicate (0x657BE0). See docs/audit/2026-09-28/city-grid/phase5-review.md.
 *
 * The original works on a fine grid of 5 × 5 cells per block; the classes used
 * here follow its cell dispatcher: 1 buildable Lot, 3 business, 7 charity,
 * 8 civic, 9 tenement master, 10 house, 2 the gang office; roads, pavements and
 * yards are 0/12. Our parcels map onto the interior 3 × 3 cells of each block.
 */
import { seedOriginalOwnerAttitudes } from './attitudes';
import { blockRect, lotRect } from './cityLayout';
import { ORIGINAL_ECONOMICS } from './data/originalEconomics';
import { originalIncomeGroup } from './data/originalIncomeGroups';
import { ourTypeForOriginalKind } from './data/originalKinds';
import { BUILDING_BY_ID } from './data/buildings';
import { OriginalRng } from './originalCityGen';
import type { Block, Building, ID, Person, WorldState } from './types';

export interface FineCell { cls: number; building: Building; master: boolean; civicSub?: number }
export interface OriginalHeadquarters { blockId: ID; frontBuildingId: ID; fx: number; fy: number; fallback: boolean }

const HANGOUT_KINDS = new Set([57, 91, 124]); // Gym, Pool hall, Docks
const EMPLOYMENT_EXCHANGE = 45;               // civic content; its cells are civic sub-code 2
const PERFUME_STORE = 85;
const FRONT_BY_INCOME_GROUP: Record<number, number> = { 15: 118, 16: 113, 17: 108 }; // Builders, Trade Union, Tattoo Parlor

function cellClass(b: Building, block: Block): number {
  if (block.layout?.use === 'civic') return 8;
  if (b.isHQ) return 2;
  if (b.typeId === 'emptyLand') return 1;
  if (b.cls === 'tenement') return 9;
  if (b.cls === 'residential') return 10;
  if (b.typeId === 'soupKitchen') return 7;
  if (b.cls === 'commercial' || b.cls === 'industrial') return 3;
  return 12;
}

/** The fine-cell view of our parcels: index fy * (5W) + fx. */
export function fineGrid(w: WorldState): { cells: (FineCell | undefined)[]; FW: number; FH: number } {
  const FW = w.gridW * 5, FH = w.gridH * 5, cells: (FineCell | undefined)[] = new Array(FW * FH);
  for (const block of w.blocks) {
    if (block.layout?.mergedInto != null) continue;
    const civic = block.layout?.use === 'civic';
    for (const id of block.lotIds) {
      const lot = w.lots[id], b = w.buildings[lot.buildingId];
      if (!b) continue;
      const cls = cellClass(b, block);
      // A civic estate fills its block's interior; other parcels cover the
      // interior cells their bounds span (the master is the lot index cell).
      const covered: number[] = [];
      if (civic) for (let i = 0; i < 9; i++) covered.push(i);
      else {
        const r = lotRect(lot), br = blockRect(block), cw = br.w / 3, ch = br.h / 3;
        for (let i = 0; i < 9; i++) {
          const cx = br.x + (i % 3 + .5) * cw, cy = br.y + (Math.floor(i / 3) + .5) * ch;
          if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) covered.push(i);
        }
        if (!covered.includes(lot.index)) covered.push(lot.index);
      }
      for (const i of covered) {
        const fx = block.gx * 5 + 1 + i % 3, fy = block.gy * 5 + 1 + Math.floor(i / 3);
        cells[fy * FW + fx] = { cls, building: b, master: i === lot.index,
          ...(civic && block.original?.content === EMPLOYMENT_EXCHANGE ? { civicSub: 2 } : {}) };
      }
    }
  }
  return { cells, FW, FH };
}

/** 0x60AD60: the start cell, then square rings (axis points, edge pairs, corners). */
function spiral(x: number, y: number, FW: number, FH: number, visit: (x: number, y: number) => boolean): boolean {
  if (!visit(x, y)) return true;
  for (let v = 1; ; v++) {
    if (x - v < 0 && x + v >= FW && y + v >= FH && y - v < 0) return false;
    const order: [number, number][] = [[x, y + v], [x, y - v], [x + v, y], [x - v, y]];
    for (let k = 1; k < v; k++) order.push([x + k, y + v], [x + k, y - v], [x - k, y + v], [x - k, y - v],
      [x + v, y + k], [x + v, y - k], [x - v, y + k], [x - v, y - k]);
    order.push([x + v, y + v], [x + v, y - v], [x - v, y + v], [x - v, y - v]);
    for (const [cx, cy] of order) if (!visit(cx, cy)) return true;
  }
}

/**
 * All four headquarters, gang g in quadrant g (the player, gang 0, top left).
 * Converts each front and returns where it is; the caller builds the office.
 */
export function placeOriginalHeadquarters(w: WorldState, seed: number, gangIds: readonly ID[] = [], opponents = 3): OriginalHeadquarters[] {
  const { cells, FW, FH } = fineGrid(w);
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < FW && y < FH ? cells[y * FW + x] : undefined;
  const rng = new OriginalRng((seed ^ 0x5eed0400) >>> 0), r = () => rng.next();
  const W = w.gridW, H = w.gridH, hw = W >> 1, hh = H >> 1;
  const quadrant = (g: number, bx: number, by: number) =>
    (g === 0 || g === 2 ? bx < hw : bx >= hw) && (g === 0 || g === 1 ? by < hh : by >= hh);
  const blockAtFine = (fx: number, fy: number) => w.blocks[Math.floor(fy / 5) * W + Math.floor(fx / 5)];
  const candidate = (b: Block | undefined) => {
    const c = b?.original?.content, lv = b?.original?.landValue ?? 0;
    return c != null && (c <= 3 && lv > 0x30 && lv < 0x3f || c >= 15 && c <= 18 && lv > 0x50 && lv < 0x5f);
  };
  const centreIsLot = (fx: number, fy: number) => at(fx - fx % 5 + 2, fy - fy % 5 + 2)?.cls === 1;
  const result: OriginalHeadquarters[] = [];

  for (let g = 0; g < 4; g++) {
    // Centroid of the gang's quadrant hangouts; with none, the loop's last cell.
    let sx = 0, sy = 0, n = 0;
    for (let fy = 0; fy < FH; fy++) for (let fx = 0; fx < FW; fx++) {
      if (!quadrant(g, Math.floor(fx / 5), Math.floor(fy / 5))) continue;
      const c = at(fx, fy);
      const kind = c?.cls === 3 ? c.building.originalKind : undefined;
      if ((kind != null && HANGOUT_KINDS.has(kind)) || (c?.cls === 8 && c.civicSub === 2)) { sx += fx; sy += fy; n++; }
    }
    let x = n ? Math.floor(sx / n) : FW, y = n ? Math.floor(sy / n) : FH;
    // Jitter onto a building cell (0x60B040).
    let radius = opponents === 2 ? 50 : 20, placed = false;
    while (!placed) {
      for (let tries = 0; tries < 50 && !placed; tries++) {
        const jx = Math.max(0, Math.min(FW - 1, x + r() % (2 * radius) - radius));
        const jy = Math.max(0, Math.min(FH - 1, r() % (2 * radius) + y - radius));
        const c = at(jx, jy);
        if (c && c.cls >= 1 && c.cls <= 11) { x = jx; y = jy; placed = true; }
      }
      radius += 5;
      if (radius > FW + FH) break;
    }
    // Chain of nearest unvisited business or tenement masters until one qualifies.
    const visited = new Set<number>();
    let found: OriginalHeadquarters | null = null;
    for (let step = 0; step < FW * FH && !found; step++) {
      let hit = null as [number, number] | null;
      spiral(x, y, FW, FH, (cx, cy) => {
        const c = at(cx, cy);
        if (!c || visited.has(cy * FW + cx) || !c.master || (c.cls !== 3 && c.cls !== 9)) return true;
        hit = [cx, cy]; return false;
      });
      if (!hit) break;
      [x, y] = hit;
      visited.add(y * FW + x);
      const block = blockAtFine(x, y), c = at(x, y)!;
      if (!quadrant(g, block.gx, block.gy) || !candidate(block) || !centreIsLot(x, y)) continue;
      let kind: number | undefined;
      if (c.cls === 3) {
        const rec = c.building.originalKind != null ? ORIGINAL_ECONOMICS[c.building.originalKind] : undefined;
        const ig = rec ? originalIncomeGroup(block.original!.landValue, rec.profitGroup) : 0;
        kind = FRONT_BY_INCOME_GROUP[ig]; // never happens with the stock table (no 15..17)
      } else kind = PERFUME_STORE;
      if (kind == null) continue;
      convertFront(c.building, kind);
      c.cls = 3;
      const centre = at(x - x % 5 + 2, y - y % 5 + 2)!; centre.cls = 2;
      found = { blockId: block.id, frontBuildingId: c.building.id, fx: x, fy: y, fallback: false };
    }
    if (!found) throw Error(`No original headquarters site in quadrant ${g}.`);
    result.push(found);
    // Shopkeepers' attitudes toward this gang by distance from its HQ.
    if (gangIds[g] != null) {
      const owners: { owner: Person; fx: number; fy: number }[] = [];
      for (let fy = 0; fy < FH; fy++) for (let fx = 0; fx < FW; fx++) {
        const c = cells[fy * FW + fx];
        if (!c?.master || c.cls < 1 || c.cls > 10 || c.building.ownerGangId != null || c.building.ownerPersonId == null) continue;
        const owner = w.people[c.building.ownerPersonId];
        if (owner) owners.push({ owner, fx, fy });
      }
      seedOriginalOwnerAttitudes([{ gangId: gangIds[g], fx: found.fx, fy: found.fy }], owners, r);
    }
  }
  return result;
}

function convertFront(b: Building, kind: number): void {
  const typeId = ourTypeForOriginalKind(ORIGINAL_ECONOMICS[kind]);
  b.typeId = typeId; b.cls = BUILDING_BY_ID[typeId].cls; b.originalKind = kind;
  b.state = 'trading';
}

/**
 * Starting businesses (0x657BE0): business and tenement masters in spiral order
 * from the HQ front, skipping anything already held. The caller takes as many
 * as the game settings allow.
 */
export function originalStartingSites(w: WorldState, hq: OriginalHeadquarters, limit = 60): Building[] {
  const { cells, FW, FH } = fineGrid(w);
  const out: Building[] = [], seen = new Set<ID>();
  spiral(hq.fx, hq.fy, FW, FH, (x, y) => {
    if (out.length >= limit) return false;
    const c = x >= 0 && y >= 0 && x < FW && y < FH ? cells[y * FW + x] : undefined;
    if (c && c.master && (c.cls === 3 || c.cls === 9) && !seen.has(c.building.id) &&
        c.building.ownerGangId == null && !c.building.protection && !c.building.isHQ && c.building.id !== hq.frontBuildingId) {
      seen.add(c.building.id); out.push(c.building);
    }
    return true;
  });
  return out;
}

/** Shopkeepers' starting hostility and fear toward a gang by distance from its
 * HQ in whole blocks (the tail of 0x6566A0): [hostility range, fear base]. */
export function originalAttitudeBand(blocks: number): { hostilityRange: number; fearBase: number } | null {
  const table: [number, number][] = [[50, 100], [60, 90], [70, 90], [80, 80], [90, 80], [100, 70], [100, 70],
    [110, 60], [110, 60], [120, 50], [120, 50]];
  const row = table[blocks];
  return row ? { hostilityRange: row[0], fearBase: row[1] } : null;
}
