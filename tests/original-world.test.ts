import { describe, expect, it } from 'vitest';
import { newCampaignOptions } from '../src/app/newGame';
import { createWorld } from '../src/sim/citygen';
import { blockRect, streetEdgeOpen, streetGraph } from '../src/sim/cityLayout';
import { carsAt } from '../src/sim/traffic';
import { ORIGINAL_ECONOMICS } from '../src/sim/data/originalEconomics';
import { ORIGINAL_KIND_TYPES } from '../src/sim/data/originalKinds';
import { isValidAreaTarget } from '../src/sim/execution';
import { createOriginalBusinessSeeding } from '../src/sim/originalBusinesses';
import { C, generateOriginalCitySafe } from '../src/sim/originalCityGen';
import { purchasablePremisesType } from '../src/sim/premises';
import { validateSaveWorld } from '../src/sim/saveSchema';
import { Sim } from '../src/sim/sim';
import { BUILDING_BY_ID } from '../src/sim/data/buildings';
import { recruitQuota, replenishOriginalRecruits } from '../src/sim/recruitPool';
import { Rng } from '../src/sim/rng';

const worlds = [1928, 404, 77].map(seed => createWorld({ ...newCampaignOptions(), seed }).world);
const buildings = (w: (typeof worlds)[number]) => Object.values(w.buildings);

describe('original 40 × 32 world from the ported generator', () => {
  it('seeds businesses within each original kind’s city capacity', () => {
    for (const seed of [1928, 404, 77, 5150, 31337]) {
      const s = createOriginalBusinessSeeding();
      generateOriginalCitySafe({ seed, churches: 2, builder: s.builder });
      const placed = new Map<number, number>();
      for (const f of s.fills.values()) for (const b of f.businesses) placed.set(b.kind, (placed.get(b.kind) ?? 0) + 1);
      for (const [kind, n] of placed) {
        const r = ORIGINAL_ECONOMICS[kind], cap = r.cityCapacity || r.ccMax;
        expect(n * 64, r.name).toBeLessThanOrEqual(cap);
      }
      expect(s.economy.np[31] / 64).toBe(6); // six department stores
    }
  });

  it('builds the original civic set and landmark counts', () => {
    for (const w of worlds) {
      const n = (t: string) => buildings(w).filter(b => b.typeId === t).length;
      for (const t of ['cityHall', 'courthouse', 'policeHQ', 'hospital', 'fbiHQ', 'museum', 'publicBaths', 'usPost',
        'labourExchange', 'firehouse', 'orphanage', 'bankLarge']) expect(n(t), t).toBe(1);
      expect(n('newspaper')).toBe(4);
      expect(new Set(buildings(w).filter(b => b.typeId === 'newspaper').map(b => b.paperName)).size).toBe(4);
      expect(n('church')).toBe(2);
      expect(n('school')).toBe(4);
      expect(n('radioStation')).toBe(4);
      expect(n('departmentStore')).toBe(6);
      // Recruitment sites follow the original capacities, not the fallback mapping.
      expect(n('gym')).toBeLessThanOrEqual(18);
      expect(n('poolHall')).toBeLessThanOrEqual(24);
      const layout = w.cityLayout!.original!;
      expect(n('docks')).toBe(layout.docks ? 1 : 0);
      expect(n('railroad')).toBe(layout.station ? 1 : 0);
    }
  });

  it('keeps the density of the original rather than nine buildings per block', () => {
    for (const w of worlds) {
      expect(buildings(w).length).toBeGreaterThan(3000);
      expect(buildings(w).length).toBeLessThan(6000);
      const businesses = buildings(w).filter(b => b.originalKind != null && ORIGINAL_ECONOMICS[b.originalKind].group <= 1);
      expect(businesses.length).toBeGreaterThan(900);
      expect(businesses.length).toBeLessThan(2000);
    }
  });

  it('lays parcels on the original 3 × 3 cells, with no parcels on roads, water, plazas or parks', () => {
    for (const w of worlds) {
      for (const block of w.blocks) {
        const use = block.layout!.use, lots = block.lotIds.map(id => w.lots[id]);
        if (['avenue', 'water', 'plaza', 'park'].includes(use) || block.layout!.mergedInto != null) { expect(lots).toHaveLength(0); continue; }
        expect(new Set(lots.map(l => l.index)).size).toBe(lots.length);
        const r = blockRect(block);
        for (const l of lots) {
          expect(l.bounds!.x).toBeGreaterThanOrEqual(r.x - 1e-6);
          expect(l.bounds!.y).toBeGreaterThanOrEqual(r.y - 1e-6);
          expect(l.bounds!.x + l.bounds!.w).toBeLessThanOrEqual(r.x + r.w + 1e-6);
          expect(l.bounds!.y + l.bounds!.h).toBeLessThanOrEqual(r.y + r.h + 1e-6);
        }
        const content = block.original!.content;
        if ([15, 16, 17, 18].includes(content)) expect(lots.some(l => l.index === 4)).toBe(true);
      }
      const civic = w.blocks.filter(b => b.layout!.use === 'civic' && b.layout!.mergedInto == null);
      for (const b of civic) expect(b.lotIds).toHaveLength(1);
    }
  });

  it('crosses the river only at bridges and keeps the street network connected', () => {
    for (const w of worlds) {
      const water = (x: number, y: number) => w.blocks[y * w.gridW + x]?.layout?.use === 'water';
      for (let y = 0; y < w.gridH; y++) for (let x = 0; x <= w.gridW; x++) {
        const left = x > 0 && water(x - 1, y), right = x < w.gridW && water(x, y);
        if ((left || x === 0) && (right || x === w.gridW) && (left || right)) expect(streetEdgeOpen(w, x, y, x, y + 1)).toBe(false);
      }
      const g = streetGraph(w), seen = new Set<number>();
      const start = g.neighbours.findIndex(n => n.length);
      const queue = [start]; seen.add(start);
      for (let i = 0; i < queue.length; i++) for (const n of g.neighbours[queue[i]]) if (!seen.has(n)) { seen.add(n); queue.push(n); }
      expect(seen.size).toBe(g.neighbours.filter(n => n.length).length);
      for (const car of carsAt(w, 600)) expect(Number.isFinite(car.x) && Number.isFinite(car.y)).toBe(true);
    }
  });

  it('builds nothing under the elevated railway and no tenement beneath it', () => {
    for (const w of worlds) {
      const col = w.cityLayout!.original!.railColumn;
      if (col == null) continue;
      for (const block of w.blocks.filter(b => b.original!.content === C.RAIL)) {
        const bs = block.lotIds.map(id => w.buildings[w.lots[id].buildingId]);
        expect(bs.filter(b => b.cls === 'tenement')).toHaveLength(0);
        const r = blockRect(block), third = r.w / 3;
        for (const id of block.lotIds) {
          // The centre lot stays buildable under the track (cell 12 keeps its Lot).
          if (w.lots[id].index === 4) continue;
          const l = w.lots[id].bounds!;
          expect(l.x + l.w <= r.x + third + 1e-6 || l.x >= r.x + 2 * third - 1e-6).toBe(true);
        }
      }
    }
  });

  it('gives each row-house block one tenement and treats plain houses as city fabric', () => {
    for (const w of worlds) {
      for (const block of w.blocks.filter(b => [1, 2, 3].includes(b.original!.content) && b.layout!.use === 'urban')) {
        const bs = block.lotIds.map(id => w.buildings[w.lots[id].buildingId]);
        // A gang HQ block's tenement became its Perfume Store front.
        expect(bs.filter(b => b.cls === 'tenement')).toHaveLength(bs.some(b => b.isHQ) ? 0 : 1);
      }
      for (const b of buildings(w).filter(b => b.cls === 'residential')) {
        expect(purchasablePremisesType(b)).toBe(false);
        expect(isValidAreaTarget(w, 1, 'extort', b)).toBe(false);
        expect(b.protection).toBeNull();
        expect(b.ownerPersonId).toBeNull();
      }
    }
  });

  it('records every business’s original kind with a known gameplay type', () => {
    for (const k of ORIGINAL_KIND_TYPES) expect(BUILDING_BY_ID[k.typeId] ?? (k.typeId === 'emptyLand' ? {} : undefined), k.name).toBeDefined();
    for (const w of worlds) for (const b of buildings(w)) {
      if (b.originalKind == null || b.cls === 'illegal') continue;
      // The single original tenement kind plays our poor or middling block by land value.
      if (b.originalKind === 170) expect(['tenementPoor', 'tenementMid']).toContain(b.typeId);
      else expect(b.typeId).toBe(ORIGINAL_KIND_TYPES[b.originalKind].typeId);
    }
  });

  it('places four gang headquarters with legal fronts and saves the whole world', () => {
    for (const w of worlds) {
      const hqs = buildings(w).filter(b => b.isHQ);
      expect(hqs).toHaveLength(4);
      for (const hq of hqs) expect(['commercial', 'industrial', 'tenement', 'charity']).toContain(w.buildings[hq.frontId!].cls);
      expect(() => validateSaveWorld(JSON.parse(JSON.stringify(w)))).not.toThrow();
    }
  });

  it('places each HQ as the original does: gang g in quadrant g, fronted by a converted row-house tenement', () => {
    for (const w of worlds) {
      const hqs = buildings(w).filter(b => b.isHQ).sort((a, b) => a.ownerGangId! - b.ownerGangId!);
      expect(w.gangs[hqs[0].ownerGangId!].isPlayer).toBe(true);
      hqs.forEach((hq, g) => {
        const block = w.blocks[hq.blockId], front = w.buildings[hq.frontId!];
        expect(block.gx < 20, `gang ${g} x`).toBe(g === 0 || g === 2);
        expect(block.gy < 16, `gang ${g} y`).toBe(g === 0 || g === 1);
        expect([0, 1, 2, 3]).toContain(block.original!.content);
        expect(block.original!.landValue).toBeGreaterThan(48);
        expect(block.original!.landValue).toBeLessThan(63);
        expect(w.lots[hq.lotId].index).toBe(4);
        expect(front.originalKind).toBe(85);
        expect(front.blockId).toBe(block.id);
        expect(front.ownerGangId).toBe(hq.ownerGangId);
        // Starting rackets are the nearest businesses or tenements around the front.
        const rackets = buildings(w).filter(b => b.protection?.gangId === hq.ownerGangId);
        expect(rackets.length).toBe(Math.min(10, newCampaignOptions().startBusinesses) - 1);
        for (const b of rackets) {
          expect(['commercial', 'industrial', 'tenement']).toContain(b.cls);
          const rb = w.blocks[b.blockId];
          expect(Math.max(Math.abs(rb.gx - block.gx), Math.abs(rb.gy - block.gy))).toBeLessThanOrEqual(2);
        }
      });
    }
  });

  it('stocks recruitment sites to the original weekly quotas and tops them up', () => {
    for (const w of worlds) {
      const free = (id: number, role: string) => Object.values(w.people).filter(p => p.gangId == null && p.status === 'active' && p.buildingId === id && p.role === role);
      const sites = buildings(w).filter(b => recruitQuota(b) && b.state === 'trading');
      expect(sites.some(b => b.typeId === 'labourExchange')).toBe(true);
      for (const b of sites) {
        const q = recruitQuota(b)!;
        expect(free(b.id, q.role).length, b.typeId).toBe(q.count);
      }
      const hoods = Object.values(w.people).filter(p => p.role === 'hood' && p.gangId == null);
      expect(hoods.length).toBeLessThan(150);
      // After a site loses its people the weekly step restores exactly the shortfall.
      const copy = JSON.parse(JSON.stringify(w)) as typeof w, gym = sites.find(b => b.originalKind === 57)!;
      for (const p of Object.values(copy.people)) if (p.buildingId === gym.id && p.role === 'hood' && p.gangId == null) p.gangId = 1;
      expect(replenishOriginalRecruits(copy, new Rng(1))).toBe(2);
      expect(replenishOriginalRecruits(copy, new Rng(1))).toBe(0);
    }
  });

  it('is deterministic for a seed', () => {
    const a = createWorld({ ...newCampaignOptions(), seed: 1928 }).world;
    expect(JSON.stringify(a.blocks)).toBe(JSON.stringify(worlds[0].blocks));
    expect(Object.keys(a.buildings).length).toBe(Object.keys(worlds[0].buildings).length);
  });

  it('plays a week in the generated original city and restores it', () => {
    const sim = new Sim({ ...newCampaignOptions(), seed: 404 });
    sim.launchWeek();
    sim.finishWeek();
    const restored = Sim.fromSave(JSON.parse(JSON.stringify(sim.world)));
    expect(restored.world.blocks.filter(b => b.layout!.use === 'water').length).toBe(sim.world.blocks.filter(b => b.layout!.use === 'water').length);
    restored.launchWeek();
    restored.finishWeek();
    expect(restored.world.week).toBe(sim.world.week + 1);
  }, 900000);
});
