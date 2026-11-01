import { describe, expect, it } from 'vitest';
import { defaultGameOptions, newCampaignOptions } from '../src/app/newGame';
import { issueOrder } from '../src/sim/api';
import { isValidAreaTarget } from '../src/sim/execution';
import { MINUTES_PER_WEEK } from '../src/sim/constants';
import { createWorld } from '../src/sim/citygen';
import { blockRect } from '../src/sim/cityLayout';
import { Sim, MINUTES_PER_SECOND } from '../src/sim/sim';
import { allBuildings, buildingDoor, lotFacing } from '../src/sim/world';
import { workingInside } from '../src/render/characterPresentation';

describe('the door a building is drawn with', () => {
  it('is the door its people use, on the street the building fronts', () => {
    const { world: w } = createWorld({ ...newCampaignOptions(), seed: 4032 });
    for (const b of allBuildings(w)) {
      if (b.frontId != null) continue;
      const lot = w.lots[b.lotId], blk = w.blocks[b.blockId], r = blockRect(blk), d = buildingDoor(w, b);
      const side = d.y < r.y ? 'north' : d.y > r.y + r.h ? 'south' : d.x < r.x ? 'west' : 'east';
      expect(side, `building ${b.id}`).toBe(lotFacing(lot, blk.center, b.id));
    }
  });
});

describe('indoor jobs', () => {
  it('an extortion crew goes in at the door while it works and comes back out', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, startMoney: 100_000, startHoods: 8 });
    const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
    w.orders = {};
    for (const crew of Object.values(w.teams)) { crew.orderIds = []; crew.timeUsed = 0; }
    const hq = w.blocks[allBuildings(w).find(b => b.ownerGangId === gang.id && b.isHQ)!.blockId];
    const site = allBuildings(w).find(b => {
      const blk = w.blocks[b.blockId];
      return Math.abs(blk.gx - hq.gx) <= 2 && Math.abs(blk.gy - hq.gy) <= 2 && b.state === 'trading' &&
        isValidAreaTarget(w, gang.id, 'extort', b);
    })!;
    expect(site).toBeDefined();
    const result = issueOrder(w, gang.id, { type: 'extort', teamId: team.id, buildingIds: [site.id], opts: { priority: true, manpower: 1 } });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const order = w.orders[team.orderIds.at(-1)!];
    sim.launchWeek();
    const step = (until: () => boolean) => {
      for (let i = 0; i < MINUTES_PER_WEEK - 1 && !until(); i++) sim.advance(1 / MINUTES_PER_SECOND, 1);
    };
    const crew = () => Object.values(w.people).filter(p => p.orderId === order.id);
    step(() => order.state !== 'travelling' && order.state !== 'queued');
    expect(order.state).toBe('executing');
    expect(crew().length).toBeGreaterThan(0);
    for (const p of crew()) expect(workingInside(w, p)).toBe(p.inVehicle ? false : true);
    const men = crew();
    step(() => order.state === 'done' || order.state === 'failed');
    for (const p of men) expect(workingInside(w, p)).toBe(false);
  });
});
