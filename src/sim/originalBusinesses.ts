/**
 * Business seeding for the original city, ported from the recovered placers:
 * Block_PlaceEligibleBusiness (0x54D3E0), Block_PlaceMixedBusinesses (0x54D850),
 * Block_PlaceSingleBusiness (0x54E450), the side builder (0x552910) and the kind
 * builder (0x552170). It runs inside the generator's build order through the
 * builder hooks, tracking Number Present in the original's units of 64.
 *
 * Output is per block: the use of each of the 3 × 3 interior cells and the
 * businesses (original economics kinds) occupying them. Cell index = (row−1)·3 + (col−1).
 */
import { ORIGINAL_ECONOMICS, ORIGINAL_GROUP_COUNT, ORIGINAL_GROUP_START } from './data/originalEconomics';
import { C, type OriginalBlockBuilder, type OriginalCityPlan } from './originalCityGen';

export type CellUse =
  | { use: 'business'; business: number }
  | { use: 'soupKitchen' }
  | { use: 'lot' }      // buildable empty land
  | { use: 'yard' }     // template-12 yard
  | { use: 'paving' }   // plain decorative ground
  | { use: 'tenement' } // the row-house block's interactive tenement
  | { use: 'house' }    // plain row houses or shop-strip frontage
  | { use: 'rail' };    // under the elevated railway: no building

export interface OriginalBusiness { kind: number; cells: number[]; master: number }
export interface OriginalBlockFill { cells: (CellUse | null)[]; businesses: OriginalBusiness[] }

/** Ring positions 0..7 around the centre, as (col, row) in 1..3. */
const RING: readonly (readonly [number, number])[] = [[1, 1], [2, 1], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [1, 2]];
export const cellIndex = (col: number, row: number) => (row - 1) * 3 + (col - 1);
const ringCell = (p: number) => { const [c, r] = RING[p & 7]; return cellIndex(c, r); };
const CENTRE = cellIndex(2, 2);

const K = { DEPARTMENT_STORE: 31, BANK_LARGE: 67, HOTEL_LARGE: 68, BANK: 102, DOCKS: 124, NEWSPAPER: 139,
  RADIO: 142, RESIDENTIAL: 151, SOUP_KITCHEN: 153, TENEMENT: 170, CAB_COMPANY: 15, REMOVALS: 95 } as const;

export class OriginalEconomy {
  readonly np = new Array(ORIGINAL_ECONOMICS.length).fill(0);
  private docksErased = false;
  cc(k: number) { return this.docksErased && k === K.DOCKS ? 0 : ORIGINAL_ECONOMICS[k].cityCapacity; }
  ccMax(k: number) { return this.docksErased && k === K.DOCKS ? 0 : ORIGINAL_ECONOMICS[k].ccMax; }
  /** Record 124 is erased from the economy on maps without a river. */
  eraseDocks() { this.docksErased = true; }
  place(k: number) { this.np[k] += 64; }
  /** Spare capacity, or a random-capacity row still under its maximum. */
  spare(k: number) {
    const cc = this.cc(k), need = this.np[k] + 64;
    return need <= cc || (cc === 0 && this.ccMax(k) >= need);
  }
}

export interface OriginalBusinessSeeding {
  economy: OriginalEconomy;
  fills: Map<number, OriginalBlockFill>;
  builder: OriginalBlockBuilder;
}

export function createOriginalBusinessSeeding(): OriginalBusinessSeeding {
  const economy = new OriginalEconomy();
  const fills = new Map<number, OriginalBlockFill>();
  const fillOf = (plan: OriginalCityPlan, x: number, y: number) => {
    const i = y * plan.w + x;
    let f = fills.get(i);
    if (!f) { f = { cells: new Array(9).fill(null), businesses: [] }; fills.set(i, f); }
    return f;
  };
  const addBusiness = (f: OriginalBlockFill, kind: number, cells: number[], master = cells[0]) => {
    f.businesses.push({ kind, cells, master });
    for (const c of cells) f.cells[c] = { use: 'business', business: f.businesses.length - 1 };
    economy.place(kind);
  };
  const wholeBlock = (plan: OriginalCityPlan, x: number, y: number, kind: number) => {
    const f = fillOf(plan, x, y);
    f.cells.fill(null); f.businesses.length = 0;
    addBusiness(f, kind, [0, 1, 2, 3, 4, 5, 6, 7, 8], ringCell(1));
  };
  /** Kinds present on business cells of the 3 × 3 neighbouring blocks. */
  const neighbourKinds = (plan: OriginalCityPlan, x: number, y: number) => {
    const kinds = new Set<number>();
    for (let ny = y - 1; ny <= y + 1; ny++) for (let nx = x - 1; nx <= x + 1; nx++) {
      if (nx < 0 || ny < 0 || nx >= plan.w || ny >= plan.h) continue;
      for (const b of fills.get(ny * plan.w + nx)?.businesses ?? []) kinds.add(b.kind);
    }
    return kinds;
  };
  const landValue = (plan: OriginalCityPlan, x: number, y: number) => plan.landValue[y * plan.w + x];
  const inWindow = (k: number, lv: number) => ORIGINAL_ECONOMICS[k].lvMin <= lv && ORIGINAL_ECONOMICS[k].lvMax >= lv;
  const commercial = () => {
    const s = ORIGINAL_GROUP_START[0];
    return Array.from({ length: ORIGINAL_GROUP_COUNT[0] }, (_, i) => s + i);
  };
  const industrial = () => {
    const s = ORIGINAL_GROUP_START[1];
    return Array.from({ length: ORIGINAL_GROUP_COUNT[1] }, (_, i) => s + i);
  };
  const emptyLots = (f: OriginalBlockFill) => {
    for (let i = 0; i < 9; i++) if (i !== CENTRE && !f.cells[i]) f.cells[i] = { use: 'lot' };
  };

  /** Ring placement shared by the mixed and premium placers. Returns 55 for a hotel ring. */
  const placeRing = (f: OriginalBlockFill, picks: number[], start: number, d: number): number | undefined => {
    let p = start, occupied = 0, h = 0, landmark: number | undefined;
    do {
      const kind = picks[h], size = ORIGINAL_ECONOMICS[kind].size;
      if (size === 1) {
        addBusiness(f, kind, [ringCell(p)]); p += d; occupied++; h++;
      } else if (size !== 3) {
        if (size === 8 && occupied === 0) {
          const ring = Array.from({ length: 8 }, (_, k) => ringCell(p + k * d));
          addBusiness(f, kind, [...ring, CENTRE], ring[1]);
          if (kind === K.HOTEL_LARGE) landmark = C.HOTEL_LARGE;
          else if (kind === K.DEPARTMENT_STORE) landmark = C.DEPARTMENT_STORE;
          else if (kind === K.BANK_LARGE) landmark = C.BANK_LARGE;
          occupied += 8; h++;
        }
        h++;
      } else if ((p & 1) === 0) {
        if (occupied <= 5) {
          const cells = [ringCell(p), ringCell(p + d), ringCell(p + 2 * d)];
          const master = kind === K.CAB_COMPANY || kind === K.REMOVALS ? cells[0] : cells[1];
          addBusiness(f, kind, cells, master); occupied += 3; p += 3 * d;
        }
        h++;
      } else if (occupied < 5) { p += d; occupied++; } // skip a cell; retry this kind at a corner
      else h++;
    } while (occupied < 8 && h < picks.length);
    return landmark;
  };

  const builder: OriginalBlockBuilder = {
    // 0x54D3E0: one industrial business, else a plaza.
    eligibleBusiness(plan, x, y, rng) {
      rng(); rng(); // 0xDD, 0xDE
      const lv = landValue(plan, x, y);
      let list = industrial().filter(k => economy.np[k] + 64 <= economy.cc(k) && inWindow(k, lv));
      if (!list.length) list = industrial().filter(k => economy.cc(k) === 0 && economy.np[k] + 64 <= economy.ccMax(k) && inWindow(k, lv));
      if (!list.length) return false;
      const near = neighbourKinds(plan, x, y);
      list = list.filter(k => !near.has(k));
      if (!list.length) return false;
      wholeBlock(plan, x, y, list[rng() % list.length]); // 0xDF
      return true;
    },

    // 0x54D850: up to eight commercial kinds around the ring.
    mixedBusinesses(plan, x, y, rng) {
      const p = rng() & 6, d = (rng() & 1) ? 1 : -1; // 0xE1, 0xE2
      const f = fillOf(plan, x, y);
      f.cells[CENTRE] = { use: 'lot' }; // the case-15 centre Lot, built before the placer
      const lv = landValue(plan, x, y), excluded = (k: number) => k === K.BANK || k === K.DEPARTMENT_STORE || k === K.BANK_LARGE;
      const kinds: number[] = [], tiers: number[] = [];
      for (const k of commercial()) if (economy.spare(k) && inWindow(k, lv) && !excluded(k)) { kinds.push(k); tiers.push(0); }
      if (kinds.length < 8) {
        // QUIRK: tiers 1 and 2 record their tier one slot late; the first entry
        // keeps an uninitialised value (taken as 0 here).
        let first = true, anyTier1 = false;
        for (const k of commercial()) if (economy.spare(k) && lv <= ORIGINAL_ECONOMICS[k].lvMax && !excluded(k)) {
          kinds.push(k); tiers.push(first ? 0 : 1); first = false; anyTier1 = true;
        }
        if (kinds.length < 8) {
          first = true;
          for (const k of commercial()) if (economy.spare(k) && lv >= ORIGINAL_ECONOMICS[k].lvMin && !excluded(k)) {
            kinds.push(k); tiers.push(first ? (anyTier1 ? 1 : 0) : 2); first = false;
          }
        }
        if (!kinds.length) { emptyLots(f); return undefined; }
      }
      if (kinds.length > 8) { // QUIRK: neighbours only filter a list longer than eight
        const near = neighbourKinds(plan, x, y);
        for (let i = kinds.length - 1; i >= 0; i--) if (near.has(kinds[i])) { kinds.splice(i, 1); tiers.splice(i, 1); }
      }
      if (!kinds.length) { emptyLots(f); return undefined; }
      const picks: number[] = [], pickTiers: number[] = [];
      while (picks.length < 8 && kinds.length) {
        const i = rng() % kinds.length; // 0xE3
        picks.push(kinds.splice(i, 1)[0]); pickTiers.push(tiers.splice(i, 1)[0]);
      }
      // Larger kinds from better tiers go first.
      for (let a = 0; a < picks.length - 1; a++) for (let b = a + 1; b < picks.length; b++) {
        if (ORIGINAL_ECONOMICS[picks[b]].size > ORIGINAL_ECONOMICS[picks[a]].size && pickTiers[b] < pickTiers[a]) {
          [picks[a], picks[b]] = [picks[b], picks[a]]; [pickTiers[a], pickTiers[b]] = [pickTiers[b], pickTiers[a]];
        }
      }
      const landmark = placeRing(f, picks, p, d);
      if (landmark != null) return landmark;
      // Leftover cells: first non-corner becomes a yard, first qualifying empty cell a soup kitchen.
      let yard = false, soup = false;
      for (let row = 1; row <= 3; row++) for (let col = 1; col <= 3; col++) {
        const i = cellIndex(col, row);
        if (f.cells[i]) continue;
        const corner = col !== 2 && row !== 2;
        if (!corner && !yard) { f.cells[i] = { use: 'yard' }; yard = true; continue; }
        if (!soup) { f.cells[i] = { use: 'soupKitchen' }; soup = true; economy.place(K.SOUP_KITCHEN); }
        else f.cells[i] = { use: 'paving' };
      }
      return undefined;
    },

    // 0x54E450: a Bank on one side plus smaller kinds from the premium band.
    premiumBusinesses(plan, x, y, rng) {
      const p = rng() & 6, d = (rng() & 1) ? 1 : -1; // 0xE5, 0xE6
      const f = fillOf(plan, x, y);
      f.cells[CENTRE] = { use: 'lot' };
      const lv = landValue(plan, x, y);
      let kinds = commercial().filter(k => economy.spare(k) && inWindow(k, lv) && ORIGINAL_ECONOMICS[k].size <= 3 && k !== K.BANK);
      if (!kinds.length) { emptyLots(f); return; }
      const near = neighbourKinds(plan, x, y);
      kinds = kinds.filter(k => !near.has(k));
      if (!kinds.length) { emptyLots(f); return; }
      const picks = [K.BANK as number];
      while (picks.length < 8 && kinds.length) picks.push(kinds.splice(rng() % kinds.length, 1)[0]); // 0xE7
      for (let a = 1; a < picks.length - 1; a++) for (let b = a + 1; b < picks.length; b++)
        if (ORIGINAL_ECONOMICS[picks[a]].size < ORIGINAL_ECONOMICS[picks[b]].size) [picks[a], picks[b]] = [picks[b], picks[a]];
      placeRing(f, picks, p, d);
      let yard = false, soup = false;
      for (let row = 1; row <= 3; row++) for (let col = 1; col <= 3; col++) {
        const i = cellIndex(col, row);
        if (f.cells[i]) continue;
        let v = yard ? (soup ? 2 : 1) : soup ? 0 : rng() & 1; // 0xEA
        if (!v && col !== 2 && row !== 2) v = soup ? 2 : 1;
        if (v === 1) { f.cells[i] = { use: 'soupKitchen' }; soup = true; economy.place(K.SOUP_KITCHEN); }
        else if (v === 2) f.cells[i] = { use: 'lot' };
        else { f.cells[i] = { use: 'yard' }; yard = true; }
      }
    },

    onBuild(plan, x, y, requested, result, rng) {
      const f = () => fillOf(plan, x, y);
      if (requested === C.NEWSPAPER && result === C.NEWSPAPER) wholeBlock(plan, x, y, K.NEWSPAPER);
      else if (requested === C.RADIO && result === C.RADIO) wholeBlock(plan, x, y, K.RADIO);
      else if (requested === C.DOCKS && result === C.DOCKS) wholeBlock(plan, x, y, K.DOCKS);
      else if (requested === C.DEPARTMENT_STORE && result === C.DEPARTMENT_STORE) wholeBlock(plan, x, y, K.DEPARTMENT_STORE);
      else if (requested === C.BANK_LARGE && result === C.BANK_LARGE) wholeBlock(plan, x, y, K.BANK_LARGE);
      else if (requested <= 3 || requested === C.RAIL) {
        // Residential strips: a row-house block holds one tenement (0xD9 picks its
        // row); a shop strip adds to the plain Residential record.
        const rowHouse = result >= 1 && result <= 3 || (result === C.RAIL && plan.landValue[y * plan.w + x] <= 0x42);
        if (result === 0) {
          const fill = f(); for (let i = 0; i < 9; i++) fill.cells[i] = { use: 'house' };
          economy.place(K.RESIDENTIAL);
        } else if (rowHouse) {
          const row = 2 * (rng() & 1) + 1, fill = f();
          for (let i = 0; i < 9; i++) fill.cells[i] = { use: 'house' };
          // The strip builder puts a buildable Lot in the centre first (0x54C090)
          // and the tenement master (Variant9) at the middle of row 1 or 3.
          fill.cells[cellIndex(2, row)] = { use: 'tenement' }; fill.cells[CENTRE] = { use: 'lot' };
          economy.place(K.TENEMENT);
          // Block_BuildContent(39) then flags the middle column (cells 10..14) as
          // elevated and puts rail pieces on cells 11 and 13, overwriting the
          // tenement; the centre Lot (12) stays buildable under the track.
          // QUIRK: the Tenement count keeps the 64 the strip builder added.
          if (result === C.RAIL) for (const r of [1, 3]) fill.cells[cellIndex(2, r)] = { use: 'rail' };
        }
      }
    },

    onDocksErased() { economy.eraseDocks(); },
  };
  return { economy, fills, builder };
}
