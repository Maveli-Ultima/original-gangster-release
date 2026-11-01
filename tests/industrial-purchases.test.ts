import { describe, expect, it, vi, afterEach } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { BUILDING_BY_ID } from '../src/sim/data/buildings';
import { selectableOrderSite } from '../src/app/orderSelection';
import { defaultOptions, hireRecruit, issueOrder, nearTerritory, quoteBuildingSale, sellBuilding } from '../src/sim/api';
import { beginWeekOrders, buildingValue, tickOrders } from '../src/sim/execution';
import { isExportTerminal } from '../src/sim/exportGoods';
import { planGang } from '../src/sim/ai';
import { MINUTES_PER_SECOND, Sim } from '../src/sim/sim';
import { weeklyPolitics } from '../src/sim/systems/politics';
import type { Order, OrderOptions, OrderType } from '../src/sim/types';
import { staffFirstCrew } from './helpers/crew';

afterEach(() => vi.restoreAllMocks());

function fixture(type: 'tradeUnion' | 'docks' | 'railroad', rival = false) {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, startHoods: 8 });
  if (!rival) staffFirstCrew(sim); // buying fronts and setting up businesses installs multiple managers
  const w = sim.world, g = rival ? Object.values(w.gangs).find(g => !g.isPlayer)! : sim.playerGang;
  const team = w.teams[g.teamIds[0]];
  w.orders = {}; w.news = []; g.cash = 500000;
  for (const t of Object.values(w.teams)) { t.orderIds = []; t.timeUsed = 0; }
  const sites = Object.values(w.buildings);
  const site = sites.find(b => b.typeId === type && b.ownerGangId == null &&
    (type !== 'tradeUnion' || w.blocks[b.blockId].lotIds.some(id => w.lots[id].index === 4 && w.buildings[w.lots[id].buildingId].cls === 'empty')))!;
  expect(site).toBeDefined();
  const block = w.blocks[site.blockId];
  const foothold = sites.find(b => b.id !== site.id && b.cls === 'commercial' &&
    Math.abs(w.blocks[b.blockId].gx - block.gx) <= 1 && Math.abs(w.blocks[b.blockId].gy - block.gy) <= 1)!;
  foothold.ownerGangId = g.id;
  expect(nearTerritory(w, g.id, site.blockId, 2)).toBe(true);
  return { sim, w, g, team, site };
}

function finish(sim: Sim, order: Order) {
  // Each order a week of its own (three in a row overran one week's clock once crews walked to near jobs).
  sim.world.minute = 0;
  beginWeekOrders(sim.world);
  for (let i = 0; i < 2400 && !['done', 'failed'].includes(order.state); i++) {
    sim.world.minute++;
    tickOrders(sim.world, sim.rng, 1);
  }
}

function orderAt(s: ReturnType<typeof fixture>, type: OrderType, id: number, opts: Partial<OrderOptions> = {}) {
  expect(issueOrder(s.w, s.g.id, { teamId: s.team.id, type, buildingIds: [id], opts }).ok).toBe(true);
  const order = s.w.orders[s.team.orderIds.at(-1)!];
  finish(s.sim, order); expect(order.state, order.failReason ?? '').toBe('done');
  // Keep completed actors/managers in place but avoid restarting completed jobs.
  s.team.orderIds = []; s.team.timeUsed = 0;
  return order;
}

describe('industrial businesses with city services', () => {
  it.each(['bankSmall', 'bankLarge', 'newspaper', 'tradeUnion', 'docks', 'railroad'])('can extort and collect from a legal %s despite its special service', type => {
    const s = fixture('tradeUnion'), t = BUILDING_BY_ID[type];
    s.site.typeId = type; s.site.cls = t.cls; s.site.protection = null;
    expect(selectableOrderSite(s.w, s.g.id, { type: 'extort', opts: defaultOptions() }, s.site)).toBe(true);
    vi.spyOn(s.sim.rng, 'chance').mockReturnValue(true);
    orderAt(s, 'extort', s.site.id);
    const protection = s.w.buildings[s.site.id].protection;
    expect(protection?.gangId).toBe(s.g.id);
    const before = s.g.cash, amount = protection!.weekly;
    orderAt(s, 'collectProtection', s.site.id);
    expect(s.g.cash).toBe(before + amount);
  });

  it.each(['destroyed', 'municipal', 'bought', 'already paying'] as const)('does not create or replace protection when a target becomes %s before arrival', change => {
    const s = fixture('tradeUnion');
    expect(issueOrder(s.w, s.g.id, { teamId: s.team.id, type: 'extort', buildingIds: [s.site.id] }).ok).toBe(true);
    if (change === 'destroyed') s.site.state = 'destroyed';
    if (change === 'municipal') { s.site.typeId = 'school'; s.site.cls = 'municipal'; }
    if (change === 'bought') s.site.ownerGangId = s.g.id;
    if (change === 'already paying') s.site.protection = { gangId: 2, base: 100, weekly: 100, grievance: 0, refusing: false };
    const before = structuredClone(s.site.protection);
    vi.spyOn(s.sim.rng, 'chance').mockReturnValue(true);
    finish(s.sim, s.w.orders[s.team.orderIds[0]]);
    expect(s.site.protection).toEqual(before);
    expect(s.w.crimes).toEqual([]);
  });

  it.each(['tradeUnion', 'docks', 'railroad'] as const)('buys, manages, saves and sells %s without losing its service', type => {
    const s = fixture(type), price = buildingValue(s.w, s.site), before = s.g.cash;
    expect(selectableOrderSite(s.w, s.g.id, { type: 'buyPremises', opts: defaultOptions() }, s.site)).toBe(true);
    orderAt(s, 'buyPremises', s.site.id);
    expect(s.g.cash).toBe(before - price); expect(s.site.acquisitionCost).toBe(price);
    expect(s.site.ownerGangId).toBe(s.g.id); expect(s.site.managerId).not.toBeNull();
    expect(s.w.people[s.site.managerId!].buildingId).toBe(s.site.id);
    // Only major purchases reach the business pages; the $12k union is below that threshold.
    expect(s.w.news.filter(n => n.kind === 'purchase' && n.buildingId === s.site.id)).toHaveLength(type === 'tradeUnion' ? 0 : 1);
    const restored = Sim.fromSave(structuredClone(s.w)), b = restored.world.buildings[s.site.id];
    expect(b.ownerGangId).toBe(s.g.id); expect(b.managerId).toBe(s.site.managerId);
    if (type !== 'tradeUnion') expect(isExportTerminal(b)).toBe(true);
    const offer = quoteBuildingSale(restored.world, s.g.id, b.id);
    expect(offer.ok).toBe(true); if (!offer.ok) throw Error(offer.error);
    expect(sellBuilding(restored.world, s.g.id, b.id, offer.value).ok).toBe(true);
    expect(b.typeId).toBe(type); expect(b.ownerGangId).toBeNull(); expect(b.managerId).toBeNull();
    if (type !== 'tradeUnion') expect(isExportTerminal(b)).toBe(true);
  });

  it.each(['destroyed', 'municipal', 'charity', 'rival owned', 'unaffordable'] as const)('does not pay for a purchase invalidated before arrival: %s', change => {
    const s = fixture('tradeUnion');
    expect(issueOrder(s.w, s.g.id, { teamId: s.team.id, type: 'buyPremises', buildingIds: [s.site.id] }).ok).toBe(true);
    if (change === 'destroyed') s.site.state = 'destroyed';
    if (change === 'municipal') { s.site.typeId = 'school'; s.site.cls = 'municipal'; }
    if (change === 'charity') { s.site.typeId = 'church'; s.site.cls = 'charity'; }
    if (change === 'rival owned') s.site.ownerGangId = Object.values(s.w.gangs).find(g => !g.isPlayer)!.id;
    if (change === 'unaffordable') s.g.cash = 0;
    const cash = s.g.cash, owner = s.site.ownerGangId, order = s.w.orders[s.team.orderIds[0]];
    finish(s.sim, order);
    expect(order.state).toBe('failed'); expect(s.g.cash).toBe(cash); expect(s.site.ownerGangId).toBe(owner);
    expect(s.site.managerId).toBeNull(); expect(s.w.news.filter(n => n.kind === 'purchase')).toEqual([]);
  });

  it('builds Teamsters behind a bought union and applies its election bonus after save/restore', () => {
    const s = fixture('tradeUnion');
    orderAt(s, 'buyPremises', s.site.id);
    const land = s.w.blocks[s.site.blockId].lotIds.map(id => s.w.buildings[s.w.lots[id].buildingId])
      .find(b => s.w.lots[b.lotId].index === 4)!;
    orderAt(s, 'buyPremises', land.id);
    orderAt(s, 'setUpBusiness', land.id, { businessTypeId: 'teamsters', frontBuildingId: s.site.id });
    expect(land.frontId).toBe(s.site.id); expect(s.site.hidesId).toBe(land.id); expect(land.cover).toBe(.95);
    expect(land.managerId).not.toBeNull();
    const lawyer = Object.values(s.w.people).find(p => p.role === 'lawyer' && p.gangId == null)!;
    expect(hireRecruit(s.w, s.g.id, lawyer.id, 'pool').ok).toBe(true);
    s.g.popularity = 50; s.g.runningForOffice = true;
    s.w.election = { active: true, weeksLeft: 2, lastResultWeek: 0,
      candidates: [{ id: s.g.bossId, gangId: s.g.id, kind: 'gang', votes: 0 }] };
    const poll = (trading: boolean) => {
      const sim = Sim.fromSave(structuredClone(s.w));
      sim.world.buildings[land.id].state = trading ? 'trading' : 'ceased';
      vi.spyOn(sim.rng, 'range').mockReturnValue(0);
      weeklyPolitics(sim.world, sim.rng);
      // The weekly refresh (0x4BD090) puts two civic principals ahead of the gang.
      return sim.world.election.candidates.find(c => c.gangId === s.g.id)!.votes;
    };
    expect(poll(true)).toBeGreaterThan(poll(false));
  });

  it.each(['tradeUnion', 'docks', 'railroad'] as const)('allows rivals to select and complete a %s purchase', type => {
    const s = fixture(type, true);
    // Isolate one real acquisition opportunity while keeping the target and
    // territorial reach unchanged. Other premises belong to another gang.
    for (const b of Object.values(s.w.buildings)) if (b.id !== s.site.id && b.ownerGangId == null) b.ownerGangId = s.sim.playerGang.id;
    vi.spyOn(s.sim.rng, 'chance').mockReturnValue(true);
    planGang(s.w, s.sim.rng, s.g);
    const order = Object.values(s.w.orders).find(o => o.gangId === s.g.id && o.type === 'buyPremises' && o.targetBuildingIds.includes(s.site.id));
    expect(order).toBeDefined();
    vi.restoreAllMocks();
    s.w.phase = 'week'; beginWeekOrders(s.w);
    // Earlier jobs may send workers home before the purchase can start. Advance
    // the complete simulation so those off-order return journeys also finish.
    for (let i = 0; i < 2400 && !['done', 'failed'].includes(order!.state); i++) s.sim.advance(1 / MINUTES_PER_SECOND, 1);
    expect(order!.state, order!.failReason ?? '').toBe('done');
    expect(s.site.ownerGangId).toBe(s.g.id);
  });
});
