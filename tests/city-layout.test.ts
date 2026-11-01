import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { activeBlocks, blockPavement, blockRect, cityBlockAt, lotRect, streetEdgeOpen, streetGraph, streetRouteNodes } from '../src/sim/cityLayout';
import { createWorld } from '../src/sim/citygen';
import { CELL } from '../src/sim/constants';
import { Sim } from '../src/sim/sim';
import { validateSaveWorld } from '../src/sim/saveSchema';
import { carsAt } from '../src/sim/traffic';
import { blockIdAt } from '../src/sim/api';
import { blockAtPos } from '../src/sim/events';
import { walkRoute } from '../src/sim/movement';
import { profileForLot } from '../src/render/profile';
import { BUILDING_BY_ID } from '../src/sim/data/buildings';

const world = (seed = 404, citySize = 14) => createWorld({ ...defaultGameOptions(), seed, citySize }).world;

describe('scarce church landmarks', () => {
  it.each(['varied', 'classic'] as const)('limits churches across city sizes and seeds (%s)', cityLayout => {
    for (const citySize of [8, 10, 12, 14, 18, 20]) for (const seed of [1, 7, 29, 404, 1928]) {
      const w = createWorld({ ...defaultGameOptions(), cityLayout, citySize, seed }).world;
      const churches = Object.values(w.buildings).filter(b => b.typeId === 'church');
      expect(churches.length, `${cityLayout}, size ${citySize}, seed ${seed}`).toBe(citySize >= 14 ? 2 : 1);
      for (const church of churches) {
        expect(w.lots[church.lotId].buildingId).toBe(church.id);
        expect(w.people[church.ownerPersonId!].role).toBe('clergy');
      }
    }
  });
});

describe('varied city layout', () => {
  it('retains four playable starting gangs across small-city seeds', () => {
    for (const seed of [1, 2, 3, 4, 7, 11, 29, 97, 406, 1928, 1931, 1934]) {
      const w = world(seed, 8);
      expect(() => validateSaveWorld(w)).not.toThrow();
      expect(Object.values(w.buildings).filter(b => b.isHQ)).toHaveLength(4);
      for (const hq of Object.values(w.buildings).filter(b => b.isHQ)) {
        expect(['commercial','industrial','tenement','charity']).toContain(w.buildings[hq.frontId!].cls);
      }
      for (const type of ['cityHall', 'courthouse', 'policeHQ', 'hospital', 'church', 'railroad', 'docks'])
        expect(Object.values(w.buildings).some(b => b.typeId === type), `${type}, seed ${seed}`).toBe(true);
      expect(activeBlocks(w).filter(b => b.layout?.use === 'park').length).toBeGreaterThanOrEqual(2);
      expect(Object.values(w.buildings).some(b => BUILDING_BY_ID[b.typeId]?.recruit === 'hood')).toBe(true);
      expect(Object.values(w.buildings).some(b => BUILDING_BY_ID[b.typeId]?.recruit === 'accountant')).toBe(true);
      expect(Object.values(w.buildings).some(b => BUILDING_BY_ID[b.typeId]?.recruit === 'lawyer')).toBe(true);
    }
  });
  it.each([[404, 8], [405, 10], [404, 14], [1928, 20]])('makes coherent parks, parcels and larger sites (%i, %i)', (seed, size) => {
    const w = world(seed, size), active = activeBlocks(w);
    expect(active.length).toBeLessThan(w.blocks.length - 8);
    expect(active.filter(b => b.layout?.use === 'park').length).toBeGreaterThanOrEqual(2);
    expect(active.some(b => b.layout?.landmark === 'church' && b.layout.spanY === 2)).toBe(true);
    expect(active.some(b => b.layout?.use === 'urban' && b.layout.spanX === 2)).toBe(true);
    expect(active.some(b => b.layout?.use === 'urban' && b.layout.spanY === 2)).toBe(true);
    for (const block of active) {
      const r = blockRect(block);
      if (block.layout?.use === 'park') expect(block.lotIds).toEqual([]);
      for (const id of block.lotIds) {
        const lot = w.lots[id], bounds = lotRect(lot), building = w.buildings[lot.buildingId];
        expect(building.blockId).toBe(block.id); expect(lot.blockId).toBe(block.id);
        expect(bounds.x).toBeGreaterThanOrEqual(r.x - .001); expect(bounds.y).toBeGreaterThanOrEqual(r.y - .001);
        expect(bounds.x + bounds.w).toBeLessThanOrEqual(r.x + r.w + .001);
        expect(bounds.y + bounds.h).toBeLessThanOrEqual(r.y + r.h + .001);
      }
    }
    for (const b of w.blocks.filter(b => b.layout?.mergedInto != null)) {
      expect(b.lotIds).toHaveLength(0);
      const root = cityBlockAt(w, b.gx, b.gy)!;
      expect(root.id).toBe(b.layout!.mergedInto);
      const point = { x: (b.gx + .5) * CELL, y: (b.gy + .5) * CELL };
      expect(blockIdAt(w, point)).toBe(root.id); expect(blockAtPos(w, point)).toBe(root.id);
    }
    expect(() => validateSaveWorld(w)).not.toThrow();
    expect(Object.values(w.buildings).filter(b => b.isHQ)).toHaveLength(4);
  });

  it('is deterministic and round-trips without migrating the saved layout', () => {
    const a = world(); expect(a).toEqual(world());
    expect(world(405).blocks).not.toEqual(a.blocks);
    const saved = JSON.parse(JSON.stringify(new Sim({ ...defaultGameOptions(), seed: 404 }).world));
    expect(Sim.fromSave(structuredClone(saved)).world).toEqual(saved);
    const classic = createWorld({ ...defaultGameOptions(), cityLayout: 'classic', seed: 404 }).world;
    expect(classic.cityLayout).toBeUndefined();
    expect(classic.blocks.every(b => b.lotIds.length === 9)).toBe(true);
    const old = JSON.parse(JSON.stringify(classic)); expect(Sim.fromSave(old).world.blocks).toEqual(classic.blocks);
  });

  it('keeps the street graph connected and tram routes entirely on roads', () => {
    const w = world(), graph = streetGraph(w), visited = new Set([0]), queue = [0];
    for (let i = 0; i < queue.length; i++) for (const next of graph.neighbours[queue[i]]) if (!visited.has(next)) { visited.add(next); queue.push(next); }
    expect(visited.size).toBe(graph.neighbours.filter(n => n.length).length);
    for (const line of w.cityLayout!.tramLines) {
      expect(line.stops.length).toBeGreaterThanOrEqual(3);
      line.points.slice(1).forEach((p, i) => expect(streetEdgeOpen(w, line.points[i].x / CELL, line.points[i].y / CELL, p.x / CELL, p.y / CELL)).toBe(true));
    }
    for (const park of activeBlocks(w).filter(b => b.layout?.use === 'park')) {
      const r = blockRect(park), from = { x: r.x - 7, y: r.y - 7 }, to = { x: r.x + r.w + 7, y: r.y + r.h + 7 };
      const nodes = streetRouteNodes(w, from, to);
      nodes.slice(1).forEach((p, i) => expect(streetEdgeOpen(w, nodes[i].x / CELL, nodes[i].y / CELL, p.x / CELL, p.y / CELL)).toBe(true));
      const a = blockPavement(park, 1), b = blockPavement(park, 3);
      const path = [a, ...walkRoute(a, b, 91, w)];
      path.slice(1).forEach((p, i) => {
        for (let t = .1; t < 1; t += .1) {
          const x = path[i].x * (1 - t) + p.x * t, y = path[i].y * (1 - t) + p.y * t;
          expect(x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h, JSON.stringify({ r, path, i, t })).toBe(false);
        }
      });
    }
    for (const time of [0, .5, 45, 144]) for (const car of carsAt(w, time)) {
      const x = car.axisX ? Math.floor(car.s / CELL) : car.line, y = car.axisX ? car.line : Math.floor(car.s / CELL);
      expect(streetEdgeOpen(w, x, y, x + (car.axisX ? 1 : 0), y + (car.axisX ? 0 : 1))).toBe(true);
    }
  });

  it('scales civic buildings to their own parcels and rejects broken joins in saves', () => {
    const w = world(), block = activeBlocks(w).find(b => b.layout?.landmark === 'church' && b.layout.spanY === 2)!;
    const lot = w.lots[block.lotIds[0]], b = w.buildings[lot.buildingId];
    const p = profileForLot(b, BUILDING_BY_ID[b.typeId], lot);
    expect(p.width).toBeGreaterThan(18); expect(p.depth).toBeGreaterThan(30);
    expect(p.width).toBeLessThan(lot.bounds!.w); expect(p.depth).toBeLessThan(lot.bounds!.h);
    const alias = w.blocks.find(b => b.layout?.mergedInto != null)!; alias.layout!.mergedInto = alias.id;
    expect(() => validateSaveWorld(w)).toThrow(/joined blocks|overlapping city sites/);
  });
});
