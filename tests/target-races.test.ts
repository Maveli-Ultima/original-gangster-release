import { afterEach, describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { act, useGame } from '../src/app/store';
import { buyWeapon, issueOrder, nearTerritory, repairBuilding, sellVehicle, sellWeapon } from '../src/sim/api';
import { MINUTES_PER_WEEK, WEAPONS } from '../src/sim/constants';
import { buildingValue } from '../src/sim/execution';
import { payCash, receiveCash } from '../src/sim/finances';
import { validateSaveWorld, validateSaveWorldResponsive } from '../src/sim/saveSchema';
import { Sim, MINUTES_PER_SECOND } from '../src/sim/sim';
import { observeTargetRace } from '../src/sim/targetRace';
import { gangWealth, territoryCount, territoryBlocks, typeOf } from '../src/sim/world';
import type { Gang, Order, WorldState } from '../src/sim/types';

function fixture(mode: 'wealth' | 'territory' = 'wealth', seed = 404) {
  const sim = new Sim({ ...defaultGameOptions(), seed, citySize: 10, mode,
    startMoney: 100_000, wealthTarget: 500_000, territoryTarget: 50 });
  const w = sim.world, player = sim.playerGang, rival = Object.values(w.gangs).find(g => !g.isPlayer)!;
  w.orders = {};
  for (const team of Object.values(w.teams)) { team.orderIds = []; team.timeUsed = 0; team.vehicles = { coupe: 0, truck: 0, speedster: 0 }; }
  return { sim, w, player, rival };
}
function reachWealth(w: WorldState, g: Gang, extra = 0) {
  receiveCash(w, g, 'other', w.options.wealthTarget - gangWealth(w, g) + extra);
}
function queued(w: WorldState, g: Gang, type: Order['type'], buildingId: number): Order {
  const t = w.teams[g.teamIds[0]], result = issueOrder(w, g.id, { teamId: t.id, type, buildingIds: [buildingId] });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return w.orders[t.orderIds.at(-1)!];
}
function untilEnded(sim: Sim, limit = MINUTES_PER_WEEK) {
  for (let i = 0; i < limit && sim.world.phase === 'week'; i++) sim.advance(1 / MINUTES_PER_SECOND, 1);
  expect(sim.world.phase).toBe('gameOver');
}
afterEach(() => useGame.setState({ sim: null }));

describe('first completed target event wins', () => {
  it.each([true, false])('keeps the first wealth crossing, even after an overtake and loss (player first=%s)', playerFirst => {
    const { sim, w, player, rival } = fixture();
    sim.launchWeek(); w.minute = 137;
    const first = playerFirst ? player : rival, later = playerFirst ? rival : player;
    reachWealth(w, first);
    const recorded = structuredClone(w.targetRace);
    reachWealth(w, later, 100_000);
    payCash(w, first, 'purchases', 100_000);
    expect(w.targetRace).toEqual(recorded);
    expect(recorded).toMatchObject({ gangId: first.id, minute: 137, week: 1, value: 500_000, basis: 'event' });
    expect(gangWealth(w, first)).toBeLessThan(w.options.wealthTarget);
    const restored = Sim.fromSave(structuredClone(w));
    expect(restored.world.phase).toBe('gameOver'); expect(restored.world.outcome?.won).toBe(playerFirst);
    expect(restored.world.minute).toBe(137);
    const finished = structuredClone(restored.world);
    restored.finishWeek(); restored.advance(100, 60);
    expect(restored.world).toEqual(finished);
    expect(Sim.fromSave(structuredClone(finished)).world).toEqual(finished);
  });

  it('stops a real collection race on the rival receipt, before Friday or the slower player order', () => {
    const { sim, w, player, rival } = fixture();
    const orders = [player, rival].map(g => {
      const site = Object.values(w.buildings).find(b => b.protection?.gangId === g.id)!;
      site.protection!.weekly = 1000;
      const lt = w.people[w.teams[g.teamIds[0]].lieutenantId]; lt.loyalty = 100; lt.skills.organization = 5;
      g.cash += w.options.wealthTarget - gangWealth(w, g) - 500;
      return queued(w, g, 'collectProtection', site.id);
    });
    sim.launchWeek();
    // Both couriers have already arrived. Resolve real collection work in the
    // next tick; the rival finishes first despite the player being iterated first.
    orders[0].state = orders[1].state = 'executing';
    orders[0].workLeft = 2; orders[1].workLeft = 1;
    const playerCash = player.cash;
    sim.advance(1 / MINUTES_PER_SECOND, 1);
    expect(w.phase).toBe('gameOver'); expect(w.minute).toBe(1);
    expect(w.outcome?.won).toBe(false); expect(w.targetRace?.gangId).toBe(rival.id);
    expect(player.cash).toBe(playerCash); expect(orders[0].workLeft).toBe(1);
    expect(orders[1].results.some(r => r.startsWith('Collected'))).toBe(true);
  });

  it.each([true, false])('ends on an actual completed property purchase (player=%s)', playerWins => {
    const { sim, w, player, rival } = fixture('territory'), g = playerWins ? player : rival;
    const existing = new Set(territoryBlocks(w, g.id).map(b => b.id));
    const site = Object.values(w.buildings).find(b => b.cls === 'commercial' && b.ownerGangId == null &&
      !existing.has(w.blocks[b.blockId].layout?.mergedInto ?? b.blockId) && nearTerritory(w, g.id, b.blockId, 2))!;
    expect(site).toBeDefined();
    // Keep other gangs below this fixture's race threshold.
    for (const b of Object.values(w.buildings)) {
      if (b.ownerGangId != null && b.ownerGangId !== g.id) b.ownerGangId = null;
      if (b.protection?.gangId !== g.id) b.protection = null;
    }
    w.options.territoryTarget = territoryCount(w, g.id) + 1;
    const order = queued(w, g, 'buyPremises', site.id);
    sim.launchWeek(); untilEnded(sim);
    expect(site.ownerGangId).toBe(g.id); expect(order.state).toBe('done');
    expect(w.targetRace).toMatchObject({ gangId: g.id, mode: 'territory', basis: 'event' });
    expect(w.outcome?.won).toBe(playerWins); expect(w.minute).toBeLessThan(MINUTES_PER_WEEK);
    expect(territoryCount(w, g.id)).toBe(w.options.territoryTarget);
  });

  it('counts a purchase only after payment and ownership both complete', () => {
    const { sim, w, player } = fixture();
    const site = Object.values(w.buildings).find(b => b.cls === 'commercial' && b.ownerGangId == null && nearTerritory(w, player.id, b.blockId, 2))!;
    const before = gangWealth(w, player), cost = buildingValue(w, site);
    site.ownerGangId = player.id;
    const propertyValue = gangWealth(w, player) - before; site.ownerGangId = null;
    expect(propertyValue).toBeGreaterThan(cost);
    w.options.wealthTarget = before + Math.ceil((propertyValue - cost) / 2);
    // The race is the player's alone (a rival that keeps its money is over this low target).
    for (const g of Object.values(w.gangs)) if (!g.isPlayer) g.cash = 0;
    queued(w, player, 'buyPremises', site.id); sim.launchWeek(); untilEnded(sim);
    expect(w.targetRace?.value).toBe(before + propertyValue - cost);
    expect(w.outcome?.won).toBe(true);
  });

  it('ends on newly extorted territory through real travel, work and the seeded success roll', () => {
    // The roll is a real chance (at most 97%); seed 405 is one whose roll succeeds
    // with the October traffic (404's stream now reaches the roll at a failure).
    const { sim, w, player } = fixture('territory', 405);
    for (const b of Object.values(w.buildings)) {
      if (b.ownerGangId != null && b.ownerGangId !== player.id) b.ownerGangId = null;
      if (b.protection?.gangId !== player.id) b.protection = null;
    }
    const existing = new Set(territoryBlocks(w, player.id).map(b => b.id));
    const site = Object.values(w.buildings).find(b => b.cls === 'commercial' && b.ownerGangId == null && !b.protection &&
      !existing.has(w.blocks[b.blockId].layout?.mergedInto ?? b.blockId) && nearTerritory(w, player.id, b.blockId, 2))!;
    const team = w.teams[player.teamIds[0]];
    for (const id of [team.lieutenantId, ...team.memberIds]) {
      w.people[id].skills.intimidation = 5; w.people[id].skills.intelligence = 5;
      w.people[id].skills.stealth = 5;
    }
    w.options.territoryTarget = existing.size + 1;
    const order = queued(w, player, 'extort', site.id);
    sim.launchWeek(); untilEnded(sim);
    expect(order.state).toBe('done'); expect(site.protection?.gangId).toBe(player.id);
    expect(w.targetRace?.gangId).toBe(player.id); expect(w.targetRace?.basis).toBe('event');
    expect(w.outcome?.won).toBe(true);
  });

  it('ends on repair appreciation in the planning UI mutation boundary', () => {
    const { sim, w, player } = fixture();
    const site = Object.values(w.buildings).find(b => b.ownerGangId === player.id && !b.isHQ && b.cls !== 'illegal')!;
    site.state = 'damaged'; site.repairCost = 10;
    w.options.wealthTarget = gangWealth(w, player) + 100;
    for (const g of Object.values(w.gangs)) if (!g.isPlayer) g.cash = 0;
    useGame.setState({ sim, loadingSave: null, savingSnapshot: false, streetLoading: false });
    expect(act(s => repairBuilding(s.world, player.id, site.id))?.ok).toBe(true);
    expect(w.phase).toBe('gameOver'); expect(w.outcome?.won).toBe(true);
    expect(w.targetRace?.basis).toBe('event'); expect(w.minute).toBe(0);
  });

  it('ends during weekly income before wages can erase a legitimate crossing', () => {
    const { sim, w, player } = fixture();
    const earning = Object.values(w.buildings).find(b => b.ownerGangId === player.id && (typeOf(b)?.profit ?? 0) > 0)!;
    for (const b of Object.values(w.buildings)) if (b.ownerGangId != null) b.state = 'ceased';
    earning.state = 'trading'; player.cash += w.options.wealthTarget - gangWealth(w, player) - 1;
    w.phase = 'week'; w.minute = MINUTES_PER_WEEK; w.settlementStage = 1;
    sim.finishWeekSlice(0);
    expect(w.phase).toBe('gameOver'); expect(w.outcome?.won).toBe(true);
    expect(w.targetRace?.basis).toBe('event'); expect(w.settlementStage).toBeUndefined();
    expect(player.lastFinanceReport!.costs.wages).toBe(0);
  });

  it('does not manufacture a wealth win while selling, transferring or buying equipment', () => {
    const { sim, w, player } = fixture();
    player.weapons.tommy = 1; player.vehicles.truck = 1;
    w.options.wealthTarget = gangWealth(w, player) + 1;
    for (const g of Object.values(w.gangs)) if (!g.isPlayer) g.cash = 0;
    const before = gangWealth(w, player);
    expect(sellWeapon(w, player.id, 'tommy').ok).toBe(true);
    expect(gangWealth(w, player)).toBe(before); expect(w.targetRace).toBeUndefined();
    expect(sellVehicle(w, player.id, 'truck').ok).toBe(true);
    expect(gangWealth(w, player)).toBe(before); expect(w.targetRace).toBeUndefined();
    expect(buyWeapon(w, player.id, 'tommy').ok).toBe(true);
    expect(gangWealth(w, player)).toBe(before - WEAPONS.tommy.cost / 2);
    sim.launchWeek(); expect(w.phase).toBe('week'); expect(w.targetRace).toBeUndefined();
  });
});

describe('ties, legacy saves and race validation', () => {
  it('resolves simultaneous initial targets by a deterministic seeded draw without RNG consumption or player preference', () => {
    const winners = new Set<number>();
    for (let seed = 1; seed <= 8; seed++) {
      const s = fixture(), before = s.w.rngState;
      s.w.options.seed = seed;
      for (const g of Object.values(s.w.gangs)) g.cash = 500_000;
      const a = structuredClone(s.w), b = structuredClone(s.w);
      observeTargetRace(a, Object.keys(a.gangs).map(Number), 'initial');
      observeTargetRace(b, Object.keys(b.gangs).map(Number).reverse(), 'initial');
      expect(a.targetRace).toEqual(b.targetRace); expect(a.rngState).toBe(before);
      expect(a.targetRace!.tiedGangIds).toHaveLength(4); winners.add(a.targetRace!.gangId);
      const oldPlayer = Object.values(b.gangs).find(g => g.isPlayer)!;
      oldPlayer.isPlayer = false; b.gangs[oldPlayer.id === 1 ? 2 : 1].isPlayer = true;
      delete b.targetRace; observeTargetRace(b, undefined, 'initial');
      expect(b.targetRace!.gangId).toBe(a.targetRace!.gangId);
    }
    expect(winners.size).toBeGreaterThan(1);
  });

  it('handles a custom initial target immediately and preserves a finished historical outcome', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, mode: 'territory', territoryTarget: 1 });
    expect(sim.world.phase).toBe('gameOver'); expect(sim.world.targetRace?.basis).toBe('initial');
    const legacy = structuredClone(sim.world); delete legacy.targetRace;
    expect(Sim.fromSave(legacy).world.outcome).toEqual(sim.world.outcome);
    expect(legacy.targetRace).toBeUndefined();
  });

  it('does not invent the earlier winner when a legacy save already has several qualifiers', async () => {
    const { w } = fixture();
    for (const g of Object.values(w.gangs)) g.cash = 500_000;
    const saved = structuredClone(w), restored = await Sim.fromSaveResponsive(saved);
    expect(restored.world.targetRace?.basis).toBe('legacy');
    expect(restored.world.targetRace?.tiedGangIds).toHaveLength(4);
    expect(restored.world.outcome?.reason).toContain('tie-break');
    expect(w.targetRace).toBeUndefined();
  });

  it('does not enter a race in Full or Power games or admit eliminated/dead bosses', () => {
    for (const mode of ['normal', 'power'] as const) {
      const { w, player } = fixture(); w.options.mode = mode; reachWealth(w, player);
      expect(w.targetRace).toBeUndefined();
    }
    const { w } = fixture();
    for (const g of Object.values(w.gangs)) {
      g.cash = 500_000;
      if (g.isPlayer) w.people[g.bossId].status = 'dead'; else g.eliminated = true;
    }
    observeTargetRace(w); expect(w.targetRace).toBeUndefined();
  });

  it('validates race references, target, time and ties through both save readers', async () => {
    const { w, rival } = fixture(); reachWealth(w, rival);
    const mutations: Array<(race: NonNullable<WorldState['targetRace']>) => void> = [
      r => { r.gangId = 999999; }, r => { r.target++; }, r => { r.value = r.target - 1; },
      r => { r.week++; }, r => { r.minute = MINUTES_PER_WEEK + 1; }, r => { r.minute = 1; },
      r => { r.tiedGangIds = []; }, r => { r.tiedGangIds.push(r.gangId); }, r => { r.tiedGangIds.push(999999); },
      r => { r.mode = 'territory'; },
    ];
    for (const mutate of mutations) {
      const saved = structuredClone(w); mutate(saved.targetRace!);
      expect(() => validateSaveWorld(saved)).toThrow(/target-race/);
      await expect(validateSaveWorldResponsive(saved)).rejects.toThrow(/target-race/);
    }
    expect(() => validateSaveWorld(w)).not.toThrow();
  });
});
