/**
 * Turns a Building into a description of what to draw: the stack of masses
 * that makes its silhouette, which wall material it is built from, and which
 * pieces of period dressing hang off it. Everything is derived from the
 * building's id and type, so a given site looks the same every frame.
 */

import type { Building, BuildingType, Lot } from '../sim/types';
import { LOT_SIZE, type Facing } from '../sim/world';
import { STOREY_H, r01, rint } from './util';

export interface Mass {
  /** Offset from the lot centre, in metres. */
  dx: number;
  dz: number;
  /** Height of the underside above the pavement. */
  y: number;
  w: number;
  d: number;
  h: number;
  /** Draw a cornice on top of this mass. */
  cap: boolean;
}

export type BaseKind = 'shop' | 'plinth' | 'entry' | 'none';

export interface Profile {
  masses: Mass[];
  /** Index into FACADE_PALETTES. */
  facade: number;
  base: BaseKind;
  baseHeight: number;
  sign: boolean;
  awning: boolean;
  fireEscapes: number;
  sawtooth: number;
  columns: number;
  pediment: boolean;
  dome: boolean;
  spire: boolean;
  waterTank: boolean;
  roof: 'flat' | 'gable' | 'hip';
  roofHeight: number;
  /** Overall footprint and height, used for the pick box. */
  width: number;
  depth: number;
  height: number;
  ruin: boolean;
}

const FULL = LOT_SIZE * 0.95;

/** Which wall materials suit each class; the id picks one. */
const FACADE_BY_CLASS: Record<string, number[]> = {
  commercial: [0, 1, 2, 3, 2, 0],
  industrial: [1, 1, 0, 4],
  tenement: [0, 1, 2, 4, 3],
  municipal: [3, 3, 2],
  charity: [3, 2],
  illegal: [1, 4],
  empty: [4],
};

const LOW_INDUSTRIAL = new Set(['warehouse', 'garageDepot', 'docks', 'railroad']);
const SAWTOOTH = new Set(['warehouse', 'foundry', 'mill', 'cannery', 'garageDepot']);
// A tall tenement, hospital or civic institution is not automatically a tower.
const SETBACK_TYPES = new Set(['hotelLarge', 'bankLarge', 'departmentStore', 'newspaper']);
const CIVIC_PORTICO: Record<string, number> = { museum: 6, library: 4, usPost: 4, fbiHQ: 4 };
const PITCHED_SHOPS = new Set(['bakers', 'butchers', 'grocers', 'convenienceStore', 'shoeStore', 'tailors',
  'bookStore', 'pawnbroker', 'drugStore', 'plumbers', 'cafe', 'milkBar', 'breakfastBar', 'barbers', 'laundry', 'hardwareStore']);

// Which street a building fronts lives with the simulation, so the door men
// use (buildingDoor) and the door drawn here are on the same side.
export { lotFacing, type Facing } from '../sim/world';
export const FACING_YAW: Record<Facing, number> = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 };

export function profileForLot(b: Building, t: BuildingType | undefined, lot: Lot, facing: Facing | undefined = lot.facing): Profile {
  const p = profileFor(b, t);
  // Neighbouring plots in a block step through their class's wall materials,
  // so a row of shops or tenements is not one repeated facade.
  const pal = [...new Set(FACADE_BY_CLASS[b.cls === 'residential' ? 'tenement' : b.cls] ?? [])];
  if (!p.ruin && pal.length > 1 && t?.special == null) p.facade = pal[(rint(lot.blockId, 77, pal.length) + lot.index) % pal.length];
  if (!lot.bounds) return p;
  const rotated = facing === 'east' || facing === 'west';
  // Ordinary parcels scale the authored footprint, not its bounding box:
  // fitting every body to 95% erased narrow tenements and small back-lot sheds.
  // Large reserved civic grounds still have their deliberately bespoke sizing.
  const civic = b.cls !== 'illegal' && Math.max(lot.bounds.w, lot.bounds.h) > LOT_SIZE * 1.6;
  const sx = lot.footprint ? (rotated ? lot.footprint.h : lot.footprint.w) / p.width
    : (rotated ? lot.bounds.h : lot.bounds.w) / (civic ? p.width / .95 : LOT_SIZE);
  const sz = lot.footprint ? (rotated ? lot.footprint.w : lot.footprint.h) / p.depth
    : (rotated ? lot.bounds.w : lot.bounds.h) / (civic ? p.depth / .95 : LOT_SIZE);
  const sy = lot.footprint && b.cls === 'tenement' ? Math.min(1, STOREY_H * 3 / p.height) : 1;
  const fitted = { ...p, width: p.width * sx, depth: p.depth * sz, height: p.height * sy,
    masses: p.masses.map(m => ({ ...m, dx: m.dx * sx, dz: m.dz * sz, w: m.w * sx, d: m.d * sz, y: m.y * sy, h: m.h * sy })) };
  if (p.spire && !p.ruin) {
    // A larger church needs a longer nave, not a stretched, squat bell tower.
    const nave = fitted.masses[0], height = fitted.depth > 30 ? 9 : 8;
    nave.h = height;
    const tower = fitted.masses[1], width = Math.min(6.5, fitted.width * .33);
    Object.assign(tower, { w: width, d: width, h: height * 1.65, dz: -fitted.depth / 2 + width / 2 });
    fitted.height = height; fitted.roofHeight = Math.min(4.5, fitted.width * .23);
  }
  return fitted;
}

export function profileFor(b: Building, t: BuildingType | undefined): Profile {
  const id = b.id;
  const cls = b.cls;
  const special = t?.special;
  const destroyed = b.state === 'destroyed';
  const illegal = cls === 'illegal';

  // Plain row houses in the original city share the tenement brick.
  const pal = FACADE_BY_CLASS[cls === 'residential' ? 'tenement' : cls] ?? FACADE_BY_CLASS.commercial;
  const facade = special === 'church' ? 5 : pal[rint(id, 3, pal.length)];

  if (destroyed) {
    // A low perimeter shell. The renderer fills it with broken masonry;
    // a second nested rectangular wall made destroyed buildings look intact.
    const w = FULL * 0.9;
    return {
      masses: [
        { dx: 0, dz: 0, y: 0, w, d: w, h: 1.4 + r01(id, 11) * 0.8, cap: false },
      ],
      facade,
      base: 'none',
      baseHeight: 0,
      sign: false,
      awning: false,
      fireEscapes: 0,
      sawtooth: 0,
      columns: 0,
      pediment: false,
      dome: false,
      spire: false,
      waterTank: false,
      roof: 'flat',
      roofHeight: 0,
      width: w,
      depth: w,
      height: 2.2,
      ruin: true,
    };
  }

  // Ordinary shops and tenements vary by a storey either way, so a street's
  // roofline steps rather than running level.
  const rowBuilding = (cls === 'commercial' || cls === 'tenement' || cls === 'residential') && !special;
  const storeys = Math.max(1, (t?.storeys ?? 2) - (cls === 'tenement' ? 1 : 0) + (rowBuilding ? rint(id, 78, 3) - 1 : 0));
  const jitter = 0.94 + r01(id, 1) * 0.16;

  let w = FULL;
  let d = FULL;
  // Keep a modest street skyline; the earlier seven/eight-storey business
  // hints overwhelmed whole neighbouring blocks at the isometric camera.
  let height = Math.min(storeys, cls === 'commercial' ? 5 : storeys) * STOREY_H * jitter;

  if (illegal) {
    // Back-lot sheds and yard buildings, tucked inside the block.
    w = FULL * 0.6;
    d = FULL * 0.52;
    height = STOREY_H * (0.9 + r01(id, 2) * 0.5);
  } else if (cls === 'tenement') {
    // Narrow frontage, deep plan, and tall.
    w = FULL * (0.6 + r01(id, 4) * 0.12);
    d = FULL * 0.94;
    height *= 1.06;
  } else if (special === 'church') {
    w = FULL * 0.62;
    d = FULL * 0.96;
    height = STOREY_H * 2.1;
  } else if (LOW_INDUSTRIAL.has(b.typeId)) {
    w = FULL * 1.0;
    d = FULL * 0.98;
    height = STOREY_H * (1.5 + r01(id, 5) * 0.5);
  } else if (cls === 'industrial') {
    w = FULL * 0.96;
    d = FULL * 0.94;
  } else if (cls === 'municipal' || cls === 'charity') {
    w = FULL * 0.94;
    d = FULL * 0.9;
  }

  // Setbacks: downtown towers step back as they rise.
  const masses: Mass[] = [];
  if (storeys >= 5 && SETBACK_TYPES.has(b.typeId)) {
    const shoulder = storeys >= 7 ? 0.54 : 0.64;
    masses.push({ dx: 0, dz: 0, y: 0, w, d, h: height * shoulder, cap: true });
    const w2 = w * 0.78;
    const d2 = d * 0.78;
    if (storeys >= 7) {
      masses.push({ dx: 0, dz: 0, y: height * shoulder, w: w2, d: d2, h: height * 0.28, cap: true });
      masses.push({
        dx: 0,
        dz: 0,
        y: height * (shoulder + 0.28),
        w: w * 0.52,
        d: d * 0.52,
        h: height * (1 - shoulder - 0.28),
        cap: true,
      });
    } else {
      masses.push({
        dx: 0,
        dz: 0,
        y: height * shoulder,
        w: w2,
        d: d2,
        h: height * (1 - shoulder),
        cap: true,
      });
    }
  } else {
    masses.push({ dx: 0, dz: 0, y: 0, w, d, h: height, cap: !illegal });
  }

  // The square bell tower rises behind the entrance gable of a low nave.
  if (special === 'church') {
    const towerW = w * .56, towerD = w * .60;
    masses.push({ dx: 0, dz: -d / 2 + towerD / 2, y: 0,
      w: towerW, d: towerD, h: height * 1.23, cap: false });
  }

  const roof: Profile['roof'] = special === 'church' ? 'gable'
    // Houses and tenements are mostly hipped grey slate in the original's streets.
    : cls === 'tenement' || cls === 'residential' ? (r01(id, 91) < .45 ? 'hip' : r01(id, 91) < .6 ? 'gable' : 'flat')
    : b.typeId === 'school' || b.typeId === 'orphanage' ? 'hip'
    : PITCHED_SHOPS.has(b.typeId) && storeys <= 3 && r01(id, 91) < .45 ? 'hip'
    : cls === 'commercial' && storeys <= 2 && r01(id, 92) < .3 ? (r01(id, 93) < .5 ? 'hip' : 'gable') : 'flat';
  const roofHeight = roof === 'flat' ? 0 : Math.min(3.2, w * (special === 'church' ? .42 : .22));

  const isShop =
    cls === 'commercial' ||
    (cls === 'tenement' && r01(id, 6) < 0.4) ||
    (cls === 'industrial' && !LOW_INDUSTRIAL.has(b.typeId) && r01(id, 6) < 0.3);

  // The delivered plinth bitmap depicts warehouse shutters, not a generic
  // stone base. Civic/residential fronts continue their facade around a door.
  const base: BaseKind = illegal ? 'none' : isShop ? 'shop' : cls === 'industrial' ? 'plinth' : 'entry';
  const baseHeight = base === 'entry' ? Math.min(height, 3.45)
    : Math.min(height * 0.42, STOREY_H * (base === 'shop' ? 1.02 : 0.85));

  // Classical civic fronts carry a column portico, as in the original's streets.
  const columns =
    special === 'bank' ? 4 : special === 'cityHall' || special === 'courthouse' ? 6 : special === 'policeHQ' ? 4
    : CIVIC_PORTICO[b.typeId] ?? 0;

  return {
    masses,
    facade,
    base,
    baseHeight,
    sign: !illegal && cls !== 'tenement' && cls !== 'residential' && cls !== 'empty' && special !== 'church',
    awning: cls === 'commercial' && base === 'shop' && r01(id, 7) < 0.62,
    fireEscapes: cls === 'tenement' ? Math.min(4, Math.max(2, storeys - 1)) : 0,
    sawtooth: SAWTOOTH.has(b.typeId) ? 4 : 0,
    columns,
    pediment: columns > 0,
    dome: special === 'cityHall' || special === 'courthouse',
    spire: special === 'church',
    waterTank: roof === 'flat' && !illegal && storeys >= 3 && storeys <= 6 && r01(id, 8) < 0.34,
    roof,
    roofHeight,
    width: w,
    depth: d,
    height,
    ruin: false,
  };
}
