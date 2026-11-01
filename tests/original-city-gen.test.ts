import { describe, expect, it } from 'vitest';
import { C, generateOriginalCity, generateOriginalCitySafe, isParkContent, isRiverContent, OriginalCityStuck, OriginalRng,
  type OriginalCityPlan } from '../src/sim/originalCityGen';

const SEEDS = Array.from({ length: 300 }, (_, i) => i * 7919 + 1);
const plans = SEEDS.map(seed => generateOriginalCitySafe({ seed, churches: 2 }));
const at = (p: OriginalCityPlan, x: number, y: number) => p.content[y * p.w + x];
const lv = (p: OriginalCityPlan, x: number, y: number) => p.landValue[y * p.w + x];
const inRange = (v: number, lo: number, hi: number) => v >= lo && v <= hi;

describe('original city generator (0x5330C0 port)', () => {
  it('uses the original MSVC rand() stream', () => {
    const rng = new OriginalRng(1);
    // srand(1) followed by rand() in the MSVC runtime.
    expect([rng.next(), rng.next(), rng.next(), rng.next(), rng.next()]).toEqual([41, 18467, 6334, 26500, 19169]);
  });

  it('re-rolls where the original generator would hang', () => {
    // Seed 625602: the sixth department store has no free site 3+ blocks from
    // the others in its quadrant, so the original's retry loop never ends.
    expect(() => generateOriginalCity({ seed: 625602 })).toThrow(OriginalCityStuck);
    const plan = generateOriginalCitySafe({ seed: 625602 });
    expect(plan.departmentStores).toHaveLength(6);
    expect(plan.notes[0]).toMatch(/department store.*Re-rolled/);
  });

  it('is deterministic for a seed and defined only for 40 × 32', () => {
    expect(generateOriginalCitySafe({ seed: 99 })).toEqual(generateOriginalCitySafe({ seed: 99 }));
    expect(() => generateOriginalCity({ seed: 1, w: 18, h: 18 })).toThrow();
  });

  it('assigns every block and meets every district budget', () => {
    for (const p of plans) {
      expect(p.content.every(c => c !== C.EMPTY)).toBe(true);
      expect(p.districts).toHaveLength(12);
      for (const d of p.districts) expect(d.claimed).toBe(d.budget);
    }
  });

  it('places the 4 + 4 avenues in their recovered bands, clear of the rail line', () => {
    for (const p of plans) {
      const [c0, c1, c2, c3] = p.avenues.cols, [r0, r1, r2, r3] = p.avenues.rows;
      expect(inRange(c0, 4, 7) && inRange(c1, 11, 14) && inRange(c2, 26, 29) && inRange(c3, 35, 38)).toBe(true);
      expect(inRange(r0, 3, 5) && inRange(r1, 10, 12) && inRange(r2, 21, 23) && inRange(r3, 26, 28)).toBe(true);
      for (const c of p.avenues.cols) {
        expect(c).not.toBe(p.railColumn);
        for (let y = 0; y < p.h; y++) expect([C.AVENUE_V, C.AVENUE_CROSSING, C.BRIDGE]).toContain(at(p, c, y));
      }
      for (const r of p.avenues.rows) for (let x = 0; x < p.w; x++)
        expect([C.AVENUE_H, C.AVENUE_CROSSING, C.RAIL_OVER_AVENUE, C.RAIL_BRIDGE, C.BRIDGE]).toContain(at(p, x, r));
    }
  });

  it('rolls the terrain layout with the original 1 : 1 : 18 odds', () => {
    const count = [1, 2, 3].map(l => plans.filter(p => p.layout === l).length);
    expect(count[2]).toBeGreaterThan(240);
    expect(count[0] + count[1]).toBeGreaterThan(0);
  });

  it('runs the elevated rail down one column with a single station', () => {
    for (const p of plans) {
      if (p.layout === 1) { expect(p.railColumn).toBeNull(); continue; }
      const col = p.railColumn!;
      expect(inRange(col, 4, 9) || inRange(col, 30, 35)).toBe(true);
      const cells = Array.from({ length: p.h }, (_, y) => at(p, col, y));
      expect(cells.filter(c => c === C.STATION).length).toBeLessThanOrEqual(1);
      for (const c of cells) expect([C.RAIL, C.RAIL_BRIDGE, C.RAIL_OVER_AVENUE, C.STATION]).toContain(c);
      if (p.river) expect(p.river[col].turned).toBe(false);
    }
  });

  it('meanders the river within its recovered rows and bridges it at avenues', () => {
    for (const p of plans) {
      const river = p.content.map((c, i) => ({ c, y: Math.floor(i / p.w) })).filter(({ c }) => isRiverContent(c) || c === C.BRIDGE || c === C.RAIL_BRIDGE);
      if (p.layout === 2) { expect(river).toHaveLength(0); expect(p.docks).toBeNull(); expect(p.docksRemoved).toBe(true); continue; }
      expect(river.length).toBeGreaterThanOrEqual(p.w);
      for (const { y } of river) expect(inRange(y, 13, 22)).toBe(true);
      // Docks sit on a free slot next to the river in their column.
      const d = p.docks!, rec = p.river![d.x];
      expect([rec.row - d.y, rec.row + rec.delta - d.y].some(v => Math.abs(v) === 1) || p.notes.some(n => n.startsWith('Docks'))).toBe(true);
    }
  });

  it('builds the downtown core: bank, six department stores and six civic institutions', () => {
    for (const p of plans) {
      const { centre: c } = p;
      expect(at(p, c.x, c.y)).toBe(C.BANK_LARGE);
      expect(inRange(lv(p, c.x, c.y), 195, 205)).toBe(true);
      expect(p.departmentStores).toHaveLength(6);
      p.departmentStores.forEach((s, i) => {
        expect(at(p, s.x, s.y)).toBe(C.DEPARTMENT_STORE);
        for (const t of p.departmentStores.slice(0, i)) expect(Math.abs(t.x - s.x) + Math.abs(t.y - s.y)).toBeGreaterThanOrEqual(3);
      });
      const civics = { cityHall: C.CITY_HALL, courthouse: C.COURTHOUSE, fbiHQ: C.FBI_HQ, policeHQ: C.POLICE_HQ, hospital: C.HOSPITAL, fireDept: C.FIRE_DEPT };
      for (const [key, id] of Object.entries(civics)) {
        const s = p.civics[key as keyof typeof civics]!;
        if (!p.notes.some(n => n.startsWith(key))) expect(at(p, s.x, s.y)).toBe(id);
        expect(inRange(s.x, p.avenues.cols[1] + 1, p.avenues.cols[2] - 1) && inRange(s.y, p.avenues.rows[1] + 1, p.avenues.rows[2] - 1)).toBe(true);
      }
      for (const [key, id] of Object.entries({ employment: C.EMPLOYMENT, museum: C.MUSEUM, baths: C.BATHS, usPost: C.US_POST }))
        expect(at(p, p.innerCivics[key as 'museum']!.x, p.innerCivics[key as 'museum']!.y)).toBe(id);
    }
  });

  it('places the ring landmarks, schools, orphanage and the church override', () => {
    for (const p of plans) {
      for (const [list, id] of [[p.premiumCorners, C.PREMIUM], [p.radioStations, C.RADIO], [p.newspapers, C.NEWSPAPER], [p.schools, C.SCHOOL]] as const) {
        expect(list).toHaveLength(4);
        for (const s of list) expect(at(p, s.x, s.y)).toBe(id);
      }
      for (const s of p.premiumCorners) expect(inRange(lv(p, s.x, s.y), 145, 155)).toBe(true);
      expect(at(p, p.orphanage.x, p.orphanage.y)).toBe(C.ORPHANAGE);
      expect(p.churches).toHaveLength(2);
      for (const s of p.churches) expect([C.CHURCH_H, C.CHURCH_V_LOWER, C.CHURCH_V_UPPER]).toContain(at(p, s.x, s.y));
    }
    expect(generateOriginalCitySafe({ seed: 5, churches: 1 }).churches).toHaveLength(1);
    expect(generateOriginalCitySafe({ seed: 5 }).churches).toHaveLength(4);
  });

  it('gives each quadrant a park with the recovered land values', () => {
    for (const p of plans) {
      const big = p.parks.filter(k => k.treeDensity.some(d => d > 0));
      expect(big.length + p.notes.filter(n => n.startsWith('No park')).length).toBe(4);
      for (const k of big) {
        expect(inRange(k.w, 2, 4) && inRange(k.h, 2, 3)).toBe(true);
        for (let x = k.x; x < k.x + k.w; x++) for (let y = k.y; y < k.y + k.h; y++) {
          expect(isParkContent(at(p, x, y))).toBe(true);
          // The residential fill later overwrites park land values with its
          // neighbourhood average (parks never leave the free scratch state).
          expect(p.builds.some(b => b.x === x && b.y === y && b.requested === C.ROWHOUSE_B && b.result === at(p, x, y))).toBe(true);
        }
      }
    }
  });

  it('keeps the industrial district near the docks and residential fill below the row-house cap', () => {
    for (const p of plans) {
      const industrial = p.districts[11];
      expect(industrial.content).toBe(C.SINGLE_BUSINESS);
      expect(inRange(industrial.budget, 46, 55)).toBe(true);
      for (const b of p.builds.filter(b => b.requested === C.ROWHOUSE_B && !isParkContent(b.result))) expect([1, 2, 3]).toContain(b.result);
    }
  });

  it('lets the business phase turn industrial blocks into plazas and mixed blocks into landmarks', () => {
    const p = generateOriginalCitySafe({ seed: 77, builder: { eligibleBusiness: () => false, mixedBusinesses: () => C.HOTEL_LARGE } });
    expect(p.content.filter(c => c >= 11 && c <= 14)).toHaveLength(0);
    expect(p.content.filter(c => c === C.PLAZA).length).toBeGreaterThan(0);
    expect(p.content.filter(c => [15, 17, 18].includes(c))).toHaveLength(0);
    expect(p.content.filter(c => c === C.HOTEL_LARGE).length).toBeGreaterThan(100);
  });

  it('records the final content of every block in its build log', () => {
    for (const p of plans.slice(0, 20)) {
      const last = new Map<number, number>();
      for (const b of p.builds) last.set(b.y * p.w + b.x, b.result);
      for (const [i, c] of last) expect(p.content[i]).toBe(c);
    }
  });
});
