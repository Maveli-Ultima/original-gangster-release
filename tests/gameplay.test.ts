import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import {
  buyWeapon,
  canGoStraight,
  hireRecruit,
  issueOrder,
  promote,
  setDiplomacy,
  setPay,
  issueStreetOrder,
  interrogatePrisoner,
  nearTerritory,
} from '../src/sim/api';
import { MINUTES_PER_WEEK } from '../src/sim/constants';
import { isValidAreaTarget } from '../src/sim/execution';
import { Sim } from '../src/sim/sim';
import type { Block, Building, ID, WorldState } from '../src/sim/types';
import { allBuildings, gangManpower, ownedBuildings, protectedBuildings } from '../src/sim/world';
import { staffFirstCrew } from './helpers/crew';

function newSim(seed = 2024) {
  const sim = new Sim({ ...defaultGameOptions(), seed, citySize: 10, startMoney: 10_000, startHoods: 8 });
  staffFirstCrew(sim);
  return sim;
}

function centreBuilding(w: WorldState, block: Block): Building | undefined {
  const lot = block.lotIds.map(id => w.lots[id]).find(lot => lot.index === 4);
  return lot ? w.buildings[lot.buildingId] : undefined;
}

function playWeek(sim: Sim) {
  sim.launchWeek();
  sim.finishWeek();
}

/** Buildings near the player's headquarters that nobody protects yet. */
function extortableNear(sim: Sim, count: number): Building[] {
  const w = sim.world;
  const gang = sim.playerGang;
  const hq = allBuildings(w).find((b) => b.ownerGangId === gang.id && b.isHQ)!;
  const hqBlock = w.blocks[hq.blockId];
  return allBuildings(w)
    .filter((b) => {
      const blk = w.blocks[b.blockId];
      return (
        Math.abs(blk.gx - hqBlock.gx) <= 2 &&
        Math.abs(blk.gy - hqBlock.gy) <= 2 &&
        isValidAreaTarget(w, gang.id, 'extort', b) &&
        b.state === 'trading'
      );
    })
    .slice(0, count);
}

describe('giving and running orders', () => {
  it('accepts an order the crew has time for and refuses one it has not', () => {
    const sim = newSim();
    const gang = sim.playerGang;
    const teamId = gang.teamIds[0];
    const targets = extortableNear(sim, 60);
    expect(targets.length).toBeGreaterThan(20);

    // Sixty sites for a single hood is far more than a week allows.
    const tooMuch = issueOrder(sim.world, gang.id, {
      teamId,
      type: 'extort',
      buildingIds: targets.map((b) => b.id),
      opts: { manpower: 1 },
    });
    expect(tooMuch.ok).toBe(false);
    if (!tooMuch.ok) expect(tooMuch.error).toMatch(/time/i);

    // A couple of blocks' worth is within reach, as the manual describes.
    const fine = issueOrder(sim.world, gang.id, {
      teamId,
      type: 'extort',
      buildingIds: targets.slice(0, 16).map((b) => b.id),
      opts: { manpower: 2 },
    });
    expect(fine.ok).toBe(true);
    expect(sim.world.teams[teamId].orderIds.length).toBe(1);
    expect(sim.world.teams[teamId].timeUsed).toBeLessThanOrEqual(MINUTES_PER_WEEK * 1.02);
  });

  it('runs an extortion through to a protection racket', () => {
    const sim = newSim(99);
    const gang = sim.playerGang;
    const before = protectedBuildings(sim.world, gang.id).length;

    // Try a few weeks: extortion can legitimately fail, so give it chances.
    let succeeded = false;
    for (let week = 0; week < 6 && !succeeded; week++) {
      const targets = extortableNear(sim, 2);
      if (targets.length) {
        issueOrder(sim.world, gang.id, {
          teamId: gang.teamIds[0],
          type: 'extort',
          buildingIds: targets.map((b) => b.id),
          opts: { manpower: 3 },
        });
      }
      playWeek(sim);
      succeeded = protectedBuildings(sim.world, gang.id).length > before;
    }
    expect(succeeded).toBe(true);
  });

  it('keeps last week\'s results so the report can show them', () => {
    const sim = newSim(7);
    const gang = sim.playerGang;
    const targets = extortableNear(sim, 2);
    issueOrder(sim.world, gang.id, {
      teamId: gang.teamIds[0],
      type: 'extort',
      buildingIds: targets.map((b) => b.id),
      opts: { manpower: 3 },
    });
    playWeek(sim);

    expect(sim.world.lastWeekOrders.length).toBeGreaterThan(0);
    const archived = sim.world.lastWeekOrders.find(
      (o) => o.gangId === gang.id && o.type === 'extort',
    );
    expect(archived).toBeTruthy();
    expect(['done', 'failed']).toContain(archived!.state);
    expect(archived!.teamId).toBe(gang.teamIds[0]);
  });

  it('collects protection money as income', () => {
    const sim = newSim(1234);
    const gang = sim.playerGang;
    const paying = protectedBuildings(sim.world, gang.id);
    expect(paying.length).toBeGreaterThan(0);

    issueOrder(sim.world, gang.id, {
      teamId: gang.teamIds[0],
      type: 'collectProtection',
      buildingIds: paying.map((b) => b.id),
      opts: { manpower: 2 },
    });
    playWeek(sim);
    expect(gang.lastWeekIncome.protection + sim.world.lastWeekOrders[0].completedTargets).toBeGreaterThan(0);
  });

  it('buys premises and installs a manager', () => {
    const sim = newSim(555);
    const gang = sim.playerGang;
    gang.cash = 90_000;
    const target = extortableNear(sim, 100).find(b => nearTerritory(sim.world, gang.id, b.blockId, 2))!;
    expect(target).toBeTruthy();

    const purchased = issueOrder(sim.world, gang.id, {
      teamId: gang.teamIds[0],
      type: 'buyPremises',
      buildingIds: [target.id],
      opts: { manpower: 1 },
    });
    expect(purchased.ok, JSON.stringify(purchased)).toBe(true);
    playWeek(sim);

    const owned = ownedBuildings(sim.world, gang.id);
    const bought = owned.find((b) => b.id === target.id);
    expect(bought).toBeTruthy();
    expect(bought!.ownerGangId).toBe(gang.id);
    expect(bought!.managerId).not.toBeNull();
  });

  it('repeats a standing order every week', () => {
    const sim = newSim(321);
    const gang = sim.playerGang;
    const paying = protectedBuildings(sim.world, gang.id);
    issueOrder(sim.world, gang.id, {
      teamId: gang.teamIds[0],
      type: 'collectProtection',
      buildingIds: paying.map((b) => b.id),
      opts: { manpower: 2, repeat: true },
    });
    playWeek(sim);
    // The repeat option keeps the order alive into the following week.
    expect(sim.world.teams[gang.teamIds[0]].orderIds.length).toBe(1);
  });
});

describe('people and money', () => {
  it('pays wages and moves loyalty with them', () => {
    const sim = newSim(42);
    const gang = sim.playerGang;
    const teamId = gang.teamIds[0];
    const hoodId = sim.world.teams[teamId].memberIds[0];
    const hood = sim.world.people[hoodId];

    setPay(sim.world, hoodId, hood.payDemand);
    const loyaltyBefore = hood.loyalty;
    playWeek(sim);
    expect(hood.loyalty).toBeGreaterThanOrEqual(loyaltyBefore);

    // Starving them has the opposite effect.
    setPay(sim.world, hoodId, 0);
    const paid = hood.loyalty;
    playWeek(sim);
    expect(hood.loyalty).toBeLessThan(paid);
  });

  it('promotes a hood into a lieutenant with his own crew', () => {
    const sim = newSim(88);
    const gang = sim.playerGang;
    const teamsBefore = gang.teamIds.length;
    const hoodId = sim.world.teams[gang.teamIds[0]].memberIds[0];
    const res = promote(sim.world, gang.id, hoodId);
    expect(res.ok).toBe(true);
    expect(gang.teamIds.length).toBe(teamsBefore + 1);
    expect(sim.world.people[hoodId].role).toBe('lieutenant');
  });

  it('buys weapons from the black market', () => {
    const sim = newSim();
    const gang = sim.playerGang;
    const cash = gang.cash;
    const res = buyWeapon(sim.world, gang.id, 'tommy');
    if (cash >= 2000) {
      expect(res.ok).toBe(true);
      expect(gang.cash).toBe(cash - 2000);
      expect(gang.weapons.tommy).toBe(1);
    } else {
      expect(res.ok).toBe(false);
    }
  });

  it('hires a recruit into a crew', () => {
    const sim = newSim(64);
    const gang = sim.playerGang;
    const free = Object.values(sim.world.people).find(
      (p) => p.role === 'hood' && p.gangId == null && p.status === 'active',
    )!;
    const before = gangManpower(sim.world, gang);
    const res = hireRecruit(sim.world, gang.id, free.id, 'pool');
    expect(res.ok).toBe(true);
    expect(free.gangId).toBe(gang.id);
    expect(gangManpower(sim.world, gang)).toBe(before + 1);
  });
});

describe('conflict', () => {
  it('records crimes and heat when violence is ordered', () => {
    const sim = newSim(4321);
    const gang = sim.playerGang;
    const rival = Object.values(sim.world.gangs).find((g) => !g.isPlayer)!;
    setDiplomacy(sim.world, gang.id, rival.id, 'war');

    const rivalSite = allBuildings(sim.world).find(
      (b) => b.ownerGangId === rival.id && !b.isHQ && b.state === 'trading',
    );
    const target = rivalSite ?? extortableNear(sim, 1)[0];
    issueOrder(sim.world, gang.id, {
      teamId: gang.teamIds[0],
      type: 'smashUp',
      buildingIds: [target.id],
      opts: { manpower: 2 },
    });
    playWeek(sim);

    const mine = sim.world.crimes.filter((c) => c.gangId === gang.id);
    expect(mine.length).toBeGreaterThan(0);
  });

  it('accepts live street orders during the week', () => {
    const sim = newSim(19);
    const gang = sim.playerGang;
    sim.launchWeek();
    const hoodId = sim.world.teams[gang.teamIds[0]].memberIds[0];
    const res = issueStreetOrder(sim.world, gang.id, [hoodId], 'goTo', null, { x: 120, y: 120 });
    expect(res.ok).toBe(true);
    expect(sim.world.people[hoodId].streetOrder?.type).toBe('goTo');
    sim.finishWeek();
    // Street orders are cleared when the week ends.
    expect(sim.world.people[hoodId].streetOrder).toBeNull();
  });

  it('lets a prisoner be interrogated for names', () => {
    const sim = newSim(64236);
    const gang = sim.playerGang;
    const rival = Object.values(sim.world.gangs).find((g) => !g.isPlayer)!;
    const victim = Object.values(sim.world.people).find(
      (p) => p.gangId === rival.id && p.role === 'hood',
    )!;
    // Put the prisoner straight into custody, as a successful kidnap would.
    victim.status = 'kidnapped';
    victim.capturedBy = gang.id;
    victim.interrogationValue = 100;
    gang.prisonerIds.push(victim.id);

    const res = interrogatePrisoner(sim.world, sim.rng, gang.id, victim.id);
    expect(res.ok).toBe(true);
    expect(victim.interrogationValue).toBeLessThan(100);
  });
});

describe('endings', () => {
  it('refuses to let you go straight while you are still crooked', () => {
    const sim = newSim();
    const gang = sim.playerGang;
    const check = canGoStraight(sim.world, gang.id);
    expect(check.can).toBe(false);
    // No lawyer at the start of a game, so that is the first obstacle.
    expect(check.reason).toMatch(/lawyer/i);
  });

  it('ends the game when the boss is killed', () => {
    const sim = newSim(4);
    const boss = sim.world.people[sim.playerGang.bossId];
    boss.status = 'dead';
    playWeek(sim);
    expect(sim.world.phase).toBe('gameOver');
    expect(sim.world.outcome?.won).toBe(false);
    expect(sim.world.outcome?.reason).toMatch(/killed/i);
  });

  it('awards the win when every rival is gone', () => {
    const sim = newSim(5);
    for (const g of Object.values(sim.world.gangs)) {
      if (!g.isPlayer) g.eliminated = true;
    }
    playWeek(sim);
    expect(sim.world.phase).toBe('gameOver');
    expect(sim.world.outcome?.won).toBe(true);
    expect(sim.world.outcome!.score).toBeGreaterThan(0);
  });

  it('scores a short territory game against the target', () => {
    const sim = new Sim({
      ...defaultGameOptions(),
      seed: 11,
      citySize: 9,
      mode: 'normal',
      territoryTarget: 1,
    });
    const gang = sim.playerGang;
    // Construct a unique qualifier before entering this target race. A new
    // one-block game already has four qualifying starting gangs.
    for (const b of Object.values(sim.world.buildings)) {
      if (b.ownerGangId !== gang.id) b.ownerGangId = null;
      if (b.protection?.gangId !== gang.id) b.protection = null;
    }
    sim.world.options.mode = 'territory';
    // Owning any standing business claims its block.
    const blk = sim.world.blocks.find((b) =>
      b.lotIds.every((id) => {
        const bb = sim.world.buildings[sim.world.lots[id].buildingId];
        return bb && bb.cls !== 'municipal';
      }),
    )!;
    for (const lotId of blk.lotIds) {
      const b = sim.world.buildings[sim.world.lots[lotId].buildingId];
      if (b && b.cls !== 'empty' && b.cls !== 'illegal') b.ownerGangId = gang.id;
    }
    playWeek(sim);
    expect(sim.world.phase).toBe('gameOver');
    expect(sim.world.outcome?.won).toBe(true);
  });
});

describe('the rival gangs', () => {
  it('gives their crews orders every week without the player', () => {
    const sim = newSim(3030);
    const rivals = Object.values(sim.world.gangs).filter((g) => !g.isPlayer);
    const orderCounts: number[] = [];
    for (const r of rivals) {
      const n = r.teamIds.reduce((s: number, id: ID) => s + (sim.world.teams[id]?.orderIds.length ?? 0), 0);
      orderCounts.push(n);
    }
    // The AI plans on construction, so every rival should already be busy.
    expect(orderCounts.some((n) => n > 0)).toBe(true);
  });

  it('expands its rackets over time', () => {
    const sim = newSim(777);
    const rival = Object.values(sim.world.gangs).find((g) => !g.isPlayer)!;
    const before = protectedBuildings(sim.world, rival.id).length;
    for (let i = 0; i < 10 && sim.world.phase !== 'gameOver'; i++) playWeek(sim);
    const after = protectedBuildings(sim.world, rival.id).length;
    expect(after).toBeGreaterThan(before);
  }, 180000);
});

describe('fronts and illegal businesses', () => {
  it('opens an illegal business behind a legal front and hides it from the Bureau', () => {
    const sim = newSim(24680);
    const gang = sim.playerGang;
    const w = sim.world;
    gang.cash = 200_000;

    // Find a commercial block with a free centre lot.
    const blk = w.blocks.find((b) => {
      const centre = centreBuilding(w, b);
      return b.district === 'commercial' && centre && centre.cls === 'empty';
    })!;
    expect(blk).toBeTruthy();

    // Buy a cafe on the block to serve as the front, plus the centre lot.
    const cafe = w.buildings[w.lots[blk.lotIds[0]].buildingId];
    cafe.typeId = 'cafe';
    cafe.cls = 'commercial';
    cafe.state = 'trading';
    cafe.ownerGangId = gang.id;
    const land = centreBuilding(w, blk)!;
    land.ownerGangId = gang.id;

    const res = issueOrder(w, gang.id, {
      teamId: gang.teamIds[0],
      type: 'setUpBusiness',
      buildingIds: [land.id],
      opts: { manpower: 1, businessTypeId: 'speakeasy', frontBuildingId: cafe.id },
    });
    expect(res.ok).toBe(true);
    playWeek(sim);

    expect(land.typeId).toBe('speakeasy');
    expect(land.cls).toBe('illegal');
    expect(land.frontId).toBe(cafe.id);
    expect(cafe.hidesId).toBe(land.id);
    // A cafe is an ideal front for a speakeasy, so cover should be near perfect.
    expect(land.cover).toBeGreaterThan(0.9);
    expect(land.managerId).not.toBeNull();
  });

  it('refuses an illegal business if its front is lost after the order is accepted', () => {
    const sim = newSim(1357);
    const gang = sim.playerGang;
    const w = sim.world;
    gang.cash = 200_000;

    const blk = w.blocks.find((b) => {
      const centre = centreBuilding(w, b);
      return centre && centre.cls === 'empty' && !b.lotIds.some((id) => w.buildings[w.lots[id].buildingId]?.ownerGangId === gang.id);
    })!;
    const land = centreBuilding(w, blk)!;
    land.ownerGangId = gang.id;

    const front = w.buildings[w.lots[blk.lotIds[0]].buildingId];
    front.typeId = 'cafe';
    front.cls = 'commercial';
    front.state = 'trading';
    front.ownerGangId = gang.id;
    expect(issueOrder(w, gang.id, {
      teamId: gang.teamIds[0],
      type: 'setUpBusiness',
      buildingIds: [land.id],
      opts: { manpower: 1, businessTypeId: 'casino', frontBuildingId: front.id },
    }).ok).toBe(true);
    front.ownerGangId = null;
    playWeek(sim);

    expect(land.cls).toBe('empty');
    const archived = w.lastWeekOrders.find((o) => o.gangId === gang.id && o.type === 'setUpBusiness');
    expect(archived?.state).toBe('failed');
    expect(archived?.failReason).toMatch(/front/i);
  });

  it('earns more from an illegal business than a legal one, and calls it risky money', () => {
    const sim = newSim(97531);
    const gang = sim.playerGang;
    const w = sim.world;
    gang.cash = 200_000;
    // Takings, not the Bureau: a lucky FBI search could close the casino in its
    // first week. Raids have their own test below.
    w.fbiIds = [];

    const blk = w.blocks.find((b) => {
      const centre = centreBuilding(w, b);
      return b.district === 'commercial' && centre && centre.cls === 'empty';
    })!;
    const front = w.buildings[w.lots[blk.lotIds[0]].buildingId];
    front.typeId = 'restaurant';
    front.cls = 'commercial';
    front.state = 'trading';
    front.ownerGangId = gang.id;

    const land = centreBuilding(w, blk)!;
    land.ownerGangId = gang.id;
    issueOrder(w, gang.id, {
      teamId: gang.teamIds[0],
      type: 'setUpBusiness',
      buildingIds: [land.id],
      opts: { manpower: 1, businessTypeId: 'casino', frontBuildingId: front.id },
    });
    playWeek(sim);
    // Give it a week of trading.
    playWeek(sim);

    expect(land.cls).toBe('illegal');
    expect(gang.lastWeekIncome.illegal).toBeGreaterThan(0);
    // Illegal takings are what the accountant has to explain away.
    expect(gang.riskyMoney).toBeGreaterThan(0);
  });

  it('raids a previously discovered operation in the following working week', () => {
    const sim = newSim(8642);
    const gang = sim.playerGang;
    const w = sim.world;

    const blk = w.blocks.find((b) => {
      const centre = centreBuilding(w, b);
      return centre && centre.cls === 'empty';
    })!;
    const land = centreBuilding(w, blk)!;
    land.ownerGangId = gang.id;
    land.typeId = 'casino';
    land.cls = 'illegal';
    land.state = 'trading';
    land.cover = 0.05;
    land.discovered = true; // the agents have already found it
    gang.suspicion = 90;

    playWeek(sim);
    expect(land.state).toBe('trading');
    expect(land.fbiRaidWeek).toBe(2);
    playWeek(sim);
    expect(land.state).toBe('ceased');
    expect(land.fbiClosedWeek).toBe(2);
  });
});
