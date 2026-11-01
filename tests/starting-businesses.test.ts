import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { createWorld } from '../src/sim/citygen';
import { issueOrder } from '../src/sim/api';
import { Sim, MINUTES_PER_SECOND } from '../src/sim/sim';
import { protectedBuildings } from '../src/sim/world';

describe('manual p.31 starting businesses', () => {
  it.each(['varied', 'classic'] as const)('delivers the front plus distinct pre-extorted premises for every 1–10 setting (%s)', cityLayout => {
    for (const seed of [11, 404, 1931]) for (let startBusinesses = 1; startBusinesses <= 10; startBusinesses++) {
      const w = createWorld({ ...defaultGameOptions(), seed, citySize: 10, cityLayout, startBusinesses }).world;
      for (const gang of Object.values(w.gangs)) {
        const hq = Object.values(w.buildings).find(b => b.isHQ && b.ownerGangId === gang.id)!;
        const front = w.buildings[hq.frontId!];
        const racket = protectedBuildings(w, gang.id);
        const label = `${cityLayout}, seed ${seed}, ${startBusinesses} sites, gang ${gang.id}`;
        expect(racket, label).toHaveLength(startBusinesses - 1);
        expect(new Set([front.id, ...racket.map(b => b.id)]).size, label).toBe(startBusinesses);
        expect(front.protection, label).toBeNull();
        for (const other of Object.values(w.gangs)) if (other.id !== gang.id)
          expect(front.knowledge[other.id], `${label}, rival ${other.id}`).toBe(0);
        for (const b of racket) {
          expect(b.ownerGangId, `${label}, site ${b.id}`).toBeNull();
          expect(b.state, label).toBe('trading');
          expect(['commercial', 'industrial', 'tenement'], label).toContain(b.cls);
          expect(b.protection!.weekly, label).toBeGreaterThan(0);
          expect(b.knowledge[gang.id], label).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it.each([8, 9, 10, 12, 14, 16, 18, 20])('can allocate all ten starting businesses with a %i-block city edge', citySize => {
    for (const cityLayout of ['varied', 'classic'] as const) for (const seed of [42, 1928]) {
      const w = createWorld({ ...defaultGameOptions(), seed, citySize, cityLayout, startBusinesses: 10 }).world;
      for (const gang of Object.values(w.gangs)) {
        const racket = protectedBuildings(w, gang.id);
        expect(racket).toHaveLength(9);
        expect(racket.every(b => b.ownerGangId == null)).toBe(true);
      }
    }
  });

  it('the advertised starting racket accepts and pays a real Collect Protection order', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 11, citySize: 10, startBusinesses: 10 });
    const w = sim.world, g = sim.playerGang, team = w.teams[g.teamIds[0]];
    // Keep this an isolated dispatch/payment check, not a full rivalry campaign.
    w.orders = {};
    for (const t of Object.values(w.teams)) { t.orderIds = []; t.timeUsed = 0; }
    const site = protectedBuildings(w, g.id)[0], amount = site.protection!.weekly;
    const before = g.cash;
    expect(issueOrder(w, g.id, { teamId: team.id, type: 'collectProtection', buildingIds: [site.id], opts: { manpower: 1 } }).ok).toBe(true);
    const order = w.orders[team.orderIds[0]];
    sim.launchWeek();
    for (let minute = 0; minute < 1000 && order.state !== 'done' && order.state !== 'failed'; minute++) sim.advance(1 / MINUTES_PER_SECOND, 1);
    expect(order.state).toBe('done');
    const takings = w.personTakings![team.lieutenantId];
    expect(takings.gross).toBe(amount);
    expect(takings.declared).toBeGreaterThan(0);
    expect(g.lastWeekIncome.protection).toBe(takings.declared);
    expect(g.cash).toBe(before + takings.declared);
    expect(site.protection?.gangId).toBe(g.id);
    expect(site.ownerGangId).toBeNull();
  });

  it('retains generated starting holdings through normal planning and save/restore', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, startBusinesses: 10 });
    const restored = Sim.fromSave(structuredClone(sim.world));
    expect(restored.world).toEqual(sim.world);
    for (const gang of Object.values(restored.world.gangs)) expect(protectedBuildings(restored.world, gang.id)).toHaveLength(9);
  });
});
