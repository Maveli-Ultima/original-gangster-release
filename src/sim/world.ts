import {
  BLOCK_SIZE,
  CELL,
  DAY_NAMES,
  DAY_START_HOUR,
  MINUTES_PER_DAY,
  STREET_WIDTH,
  VEHICLES,
  WEAPONS,
} from './constants';
import { BUILDING_BY_ID } from './data/buildings';
import { blockRect, cityBlockAt, streetName, streetRouteNodes } from './cityLayout';
import { claimedTerritoryBlocks } from './territory';
import type {
  Block,
  Building,
  Gang,
  ID,
  Lot,
  Person,
  Skills,
  Team,
  Vec2,
  VehicleId,
  WeaponId,
  WorldState,
} from './types';
import { buildingList } from './entityLists';
import { rint } from './hash';

// ---------------------------------------------------------------- geometry

export function blockOrigin(gx: number, gy: number): Vec2 {
  return { x: gx * CELL + STREET_WIDTH / 2, y: gy * CELL + STREET_WIDTH / 2 };
}

export function blockCenter(gx: number, gy: number): Vec2 {
  const o = blockOrigin(gx, gy);
  return { x: o.x + BLOCK_SIZE / 2, y: o.y + BLOCK_SIZE / 2 };
}

/** Lots are a 3x3 grid inside the block; index 4 is the centre lot. */
export function lotCenter(gx: number, gy: number, index: number): Vec2 {
  const o = blockOrigin(gx, gy);
  const col = index % 3;
  const row = Math.floor(index / 3);
  const s = BLOCK_SIZE / 3;
  return { x: o.x + (col + 0.5) * s, y: o.y + (row + 0.5) * s };
}

export const LOT_SIZE = BLOCK_SIZE / 3;
export const CENTRE_LOT = 4;

/** Nearest street intersection node to a block corner. */
export function nodePos(i: number, j: number): Vec2 {
  return { x: i * CELL, y: j * CELL };
}

export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Route between two points along the street lattice. The grid has no
 * obstacles, so a Manhattan route through intersections is optimal; the
 * `zig` flag varies which axis is walked first so crowds don't overlap.
 */
/**
 * A street route from one point to another that keeps to the right of the
 * carriageway by `lateral` — a walker's pavement, a driver's lane. The lattice
 * runs down the centre lines; each leg is shifted sideways as a whole, so a
 * corner is a short jog from one side street onto the next.
 */
export function routeBetween(from: Vec2, to: Vec2, zig: boolean, lateral = 0, w?: WorldState): Vec2[] {
  const i0 = Math.round(from.x / CELL);
  const j0 = Math.round(from.y / CELL);
  const i1 = Math.round(to.x / CELL);
  const j1 = Math.round(to.y / CELL);

  const nodes: Vec2[] = w?.cityLayout ? streetRouteNodes(w, from, to, zig) : [nodePos(i0, j0)];
  if (!w?.cityLayout && zig) {
    const stepI = Math.sign(i1 - i0);
    for (let i = i0; i !== i1; i += stepI) nodes.push(nodePos(i + stepI, j0));
    const stepJ = Math.sign(j1 - j0);
    for (let j = j0; j !== j1; j += stepJ) nodes.push(nodePos(i1, j + stepJ));
  } else if (!w?.cityLayout) {
    const stepJ = Math.sign(j1 - j0);
    for (let j = j0; j !== j1; j += stepJ) nodes.push(nodePos(i0, j + stepJ));
    const stepI = Math.sign(i1 - i0);
    for (let i = i0; i !== i1; i += stepI) nodes.push(nodePos(i + stepI, j1));
  }

  const path: Vec2[] = [];
  for (let n = 0; n + 1 < nodes.length; n++) {
    const a = nodes[n];
    const b = nodes[n + 1];
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    // To the right of the direction of travel.
    const ox = -dy * lateral;
    const oy = dx * lateral;
    path.push({ x: a.x + ox, y: a.y + oy }, { x: b.x + ox, y: b.y + oy });
  }
  if (!path.length) path.push(nodes[0]);
  path.push({ x: to.x, y: to.y });
  return path;
}

// ---------------------------------------------------------------- lookups

export function getBlock(w: WorldState, id: ID): Block | undefined {
  const b = w.blocks[id];
  return b?.layout?.mergedInto != null ? w.blocks[b.layout.mergedInto] : b;
}

export function blockAt(w: WorldState, gx: number, gy: number): Block | undefined {
  return cityBlockAt(w, gx, gy);
}

export function buildingPos(w: WorldState, b: Building): Vec2 {
  const lot = w.lots[b.lotId];
  return { x: lot.center.x, y: lot.center.y };
}

export type Facing = NonNullable<Lot['facing']>;

/**
 * Which street a building fronts, and so the side its door is drawn on. An
 * explicit lot facing wins. Otherwise a long parcel (a terrace down one column
 * of the original city's 3×3 cells) faces across its short side, so its length
 * runs along the street — sizing and orientation must agree, or a 34 m terrace
 * is laid across the block and out over the road. Square parcels face away
 * from the block centre.
 */
export function lotFacing(lot: Lot, blockCenter: Vec2 | undefined, id: number): Facing {
  if (lot.facing) return lot.facing;
  const ox = blockCenter ? lot.center.x - blockCenter.x : 0, oz = blockCenter ? lot.center.y - blockCenter.y : 0;
  const b = lot.bounds;
  if (b && b.h > b.w * 1.2) return ox < -0.01 ? 'west' : 'east';
  if (b && b.w > b.h * 1.2) return oz < -0.01 ? 'north' : 'south';
  if (Math.abs(ox) > Math.abs(oz)) return ox > 0 ? 'east' : 'west';
  if (Math.abs(oz) > 0.01) return oz > 0 ? 'south' : 'north';
  return (['south', 'east', 'north', 'west'] as const)[rint(id, 41, 4)];
}

/** A point on the pavement just outside a building's door, where hoods actually stand. */
export function buildingDoor(w: WorldState, b: Building): Vec2 {
  // Hidden offices/businesses are reached through their legal street front.
  const entrance = b.frontId != null ? w.buildings[b.frontId] ?? b : b;
  const lot = w.lots[entrance.lotId];
  const blk = w.blocks[entrance.blockId];
  const r = blockRect(blk);
  // The side the renderer draws the door on, so a man comes out of the door
  // rather than through the back wall.
  switch (lotFacing(lot, blk?.center, entrance.id)) {
    case 'north': return { x: lot.center.x, y: r.y - 1.6 };
    case 'south': return { x: lot.center.x, y: r.y + r.h + 1.6 };
    case 'west': return { x: r.x - 1.6, y: lot.center.y };
    case 'east': return { x: r.x + r.w + 1.6, y: lot.center.y };
  }
}

/** A building's name with the street its door is on: 'Pool Hall on Clark Ave'. */
export function placeName(w: WorldState, b: Building): string {
  const lot = w.lots[b.lotId];
  const blk = w.blocks[b.blockId];
  const name = buildingName(w, b.id);
  if (!lot || !blk) return name;
  const col = lot.index % 3;
  const row = Math.floor(lot.index / 3);
  const ave = (i: number) => streetName(w, 'ns', i);
  const st = (j: number) => streetName(w, 'ew', j);
  if (lot.facing) {
    const x = blk.gx + (lot.facing === 'east' ? blk.layout?.spanX ?? 1 : 0);
    const y = blk.gy + (lot.facing === 'south' ? blk.layout?.spanY ?? 1 : 0);
    return `${name} on ${lot.facing === 'east' || lot.facing === 'west' ? ave(x) : st(y)}`;
  }
  // The street the door is on, and the nearest cross street, so two shops of a
  // kind on one street can still be told apart.
  const nearAve = col === 2 ? blk.gx + 1 : blk.gx;
  const nearSt = row === 2 ? blk.gy + 1 : blk.gy;
  if (row === 1 && col !== 1) return `${name} on ${ave(nearAve)} at ${st(nearSt)}`;
  return `${name} on ${st(nearSt)} at ${ave(nearAve)}`;
}

export function buildingsOfBlock(w: WorldState, block: Block): Building[] {
  const out: Building[] = [];
  for (const lotId of block.lotIds) {
    const lot = w.lots[lotId];
    const b = w.buildings[lot.buildingId];
    if (b) out.push(b);
  }
  return out;
}

export function allBuildings(w: WorldState): readonly Building[] {
  return buildingList(w);
}

export function gangOf(w: WorldState, id: ID | null): Gang | undefined {
  return id == null ? undefined : w.gangs[id];
}

export function personName(w: WorldState, id: ID | null): string {
  if (id == null) return 'nobody';
  return w.people[id]?.name ?? 'unknown';
}

export function buildingName(w: WorldState, id: ID | null): string {
  if (id == null) return 'nowhere';
  const b = w.buildings[id];
  if (!b) return 'unknown';
  if (b.cls === 'empty') return 'Empty land';
  return BUILDING_BY_ID[b.typeId]?.name ?? b.typeId;
}

export function typeOf(b: Building) {
  return BUILDING_BY_ID[b.typeId];
}

// ---------------------------------------------------------------- gang queries

export function teamsOf(w: WorldState, gang: Gang): Team[] {
  return gang.teamIds.map((id) => w.teams[id]).filter(Boolean);
}

/** Every living member of a gang: boss, lieutenants, team hoods, pool, specialists. */
export function gangMembers(w: WorldState, gang: Gang): Person[] {
  const out: Person[] = [];
  const push = (id: ID | null) => {
    if (id == null) return;
    const p = w.people[id];
    if (p && p.status !== 'dead') out.push(p);
  };
  push(gang.bossId);
  for (const t of teamsOf(w, gang)) {
    push(t.lieutenantId);
    for (const m of t.memberIds) push(m);
  }
  for (const id of gang.poolIds) push(id);
  push(gang.accountantId);
  push(gang.lawyerId);
  // Hoods running businesses are still on the payroll.
  for (const b of allBuildings(w)) {
    if (b.ownerGangId === gang.id && b.managerId != null) push(b.managerId);
  }
  return out;
}

/** Hoods only (excludes boss/specialists) — the manpower figure. */
export function gangManpower(w: WorldState, gang: Gang): number {
  let n = 0;
  for (const t of teamsOf(w, gang)) {
    const lt = w.people[t.lieutenantId];
    if (lt && lt.status !== 'dead') n++;
    for (const m of t.memberIds) {
      const p = w.people[m];
      if (p && p.status !== 'dead') n++;
    }
  }
  for (const id of gang.poolIds) {
    const p = w.people[id];
    if (p && p.status !== 'dead') n++;
  }
  // Managers running businesses are still on the payroll.
  for (const b of allBuildings(w)) {
    if (b.ownerGangId === gang.id && b.managerId != null) {
      const p = w.people[b.managerId];
      if (p && p.status !== 'dead') n++;
    }
  }
  return n;
}

export function ownedBuildings(w: WorldState, gangId: ID): Building[] {
  return allBuildings(w).filter((b) => b.ownerGangId === gangId && b.state !== 'destroyed');
}

export function protectedBuildings(w: WorldState, gangId: ID): Building[] {
  return allBuildings(w).filter(
    (b) => b.protection?.gangId === gangId && b.state !== 'destroyed',
  );
}

/** Manual p.12: blocks containing at least one owned or protected business. */
export function territoryBlocks(w: WorldState, gangId: ID): Block[] {
  const claims = claimedTerritoryBlocks(w, gangId);
  return w.blocks.filter(block => claims.has(block.id));
}

export function territoryCount(w: WorldState, gangId: ID): number {
  return territoryBlocks(w, gangId).length;
}

/** Assets exclude cash; wealth is their sum (manual p.45). Property appraisals
 * retain the remake's location/damage formula. Equipment uses its half-price
 * resale value. Goods are potential receipts, recognized when sold. Inventory
 * is authoritative: fleet/actor records describe the same vehicles, not extras. */
export function gangHoldings(w: WorldState, gang: Gang) {
  let property = 0, weapons = 0, vehicles = 0;
  for (const b of ownedBuildings(w, gang.id)) {
    const t = BUILDING_BY_ID[b.typeId];
    if (!t) continue;
    const blk = w.blocks[b.blockId];
    // Violence depresses the price paid for a site (buildingValue), and the
    // appraisal with it: a site bought cheap on a violent block was booked at
    // full value, an instant gain toward a Wealth target.
    let v = t.cost * (0.6 + blk.landValue / 100) * (1 - Math.min(0.35, blk.crimeHeat / 260));
    if (b.state === 'damaged') v *= 0.45;
    property += v;
  }
  for (const wid of Object.keys(gang.weapons) as WeaponId[]) {
    weapons += (gang.weapons[wid] ?? 0) * WEAPONS[wid].cost * 0.5;
  }
  for (const id of Object.keys(VEHICLES) as VehicleId[]) vehicles += (gang.vehicles[id] ?? 0) * VEHICLES[id].cost * .5;
  for (const id of Object.values(gang.staffVehicles ?? {})) if (id) vehicles += VEHICLES[id].cost * .5;
  for (const t of teamsOf(w, gang)) {
    for (const wid of Object.keys(t.weapons) as WeaponId[]) {
      weapons += (t.weapons[wid] ?? 0) * WEAPONS[wid].cost * 0.5;
    }
    for (const id of Object.keys(VEHICLES) as VehicleId[]) vehicles += (t.vehicles[id] ?? 0) * VEHICLES[id].cost * .5;
  }
  property = Math.round(property); weapons = Math.round(weapons); vehicles = Math.round(vehicles);
  const assets = property + weapons + vehicles;
  return { cash: gang.cash, property, weapons, vehicles, assets, wealth: gang.cash + assets };
}

export function gangAssets(w: WorldState, gang: Gang): number {
  return gangHoldings(w, gang).assets;
}

export function gangWealth(w: WorldState, gang: Gang): number {
  return gangHoldings(w, gang).wealth;
}

export function gangLoyalty(w: WorldState, gang: Gang): number {
  const members = gangMembers(w, gang).filter((p) => p.role !== 'boss');
  if (!members.length) return 100;
  return Math.round(members.reduce((s, p) => s + p.loyalty, 0) / members.length);
}

export function powerRating(w: WorldState, gang: Gang): number {
  if (gang.eliminated) return 0;
  const wealth = gangWealth(w, gang);
  const terr = territoryCount(w, gang.id);
  const men = gangManpower(w, gang);
  return Math.round(wealth / 1000 + terr * 3 + men * 4);
}

// ---------------------------------------------------------------- skills

export function skillOf(p: Person | undefined, s: keyof Skills): number {
  return p ? p.skills[s] : 1;
}

/** Average of the listed skills, 0.5..5. */
export function skillAvg(p: Person, list: (keyof Skills)[]): number {
  if (!list.length) return 2.5;
  let t = 0;
  for (const s of list) t += p.skills[s];
  return t / list.length;
}

/** Convert a 0.5..5 star rating into a 0..1 success weight. */
export function starFactor(stars: number): number {
  return Math.max(0.05, Math.min(1, (stars - 0.25) / 4.75));
}

export function bestWeapon(team: Team): WeaponId | null {
  const order: WeaponId[] = ['twinPistols', 'tommy', 'rifle', 'shotgun', 'pistol'];
  for (const wid of order) if ((team.weapons[wid] ?? 0) > 0) return wid;
  return null;
}

// ---------------------------------------------------------------- time

export function dayIndex(minute: number): number {
  return Math.min(DAY_NAMES.length - 1, Math.floor(minute / MINUTES_PER_DAY));
}

export function clockLabel(minute: number): string {
  const d = dayIndex(minute);
  const within = minute - d * MINUTES_PER_DAY;
  const hour = DAY_START_HOUR + Math.floor(within / 60);
  const min = Math.floor(within % 60);
  const ampm = hour >= 12 ? 'pm' : 'am';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${DAY_NAMES[d]} ${h12}:${min.toString().padStart(2, '0')}${ampm}`;
}

/** 0..1 through the working day, for the day/night lighting cycle. */
export function dayPhase(minute: number): number {
  const within = minute % MINUTES_PER_DAY;
  return within / MINUTES_PER_DAY;
}

export function money(n: number): string {
  const neg = n < 0;
  const s = Math.abs(Math.round(n)).toLocaleString('en-US');
  return `${neg ? '-' : ''}$${s}`;
}
