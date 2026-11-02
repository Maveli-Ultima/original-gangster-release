import { MINUTES_PER_WEEK } from '../src/sim/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { issueOrder, setWaiting } from '../src/sim/api';
import { cityBlockAt } from '../src/sim/cityLayout';
import { tickOrders } from '../src/sim/execution';
import { originalFireOdds } from '../src/sim/fireRoll';
import { Sim, MINUTES_PER_SECOND } from '../src/sim/sim';
import { tickCombat, type TerritoryIndex } from '../src/sim/systems/combat';
import type { DiplomacyLevel } from '../src/sim/types';
import { buildingDoor, dist } from '../src/sim/world';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 });
  const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
  w.orders = {};
  for (const crew of Object.values(w.teams)) { crew.orderIds = []; crew.timeUsed = 0; }
  const rival = Object.values(w.gangs).find(g => !g.isPlayer)!, otherTeam = w.teams[rival.teamIds[0]];
  const actor = w.people[team.memberIds[0]], target = w.people[otherTeam.memberIds[0]];
  const block = w.blocks.find(b => b.lotIds.length >= 3 && b.gx > 0 && b.gx < w.gridW - 1 &&
    (b.layout?.spanX ?? 1) === 1 && (b.layout?.spanY ?? 1) === 1)!;
  for (const p of Object.values(w.people)) p.status = 'jailed';
  for (const p of [actor, target]) {
    p.status = 'active'; p.buildingId = null; p.orderId = null; p.streetOrder = null;
    p.pos = { x: (block.gx + 1) * 54 - 4, y: block.gy * 54 + 20 }; p.dest = null; p.path = []; p.inVehicle = false;
    p.skills.intelligence = 5; p.skills.firearms = 5; p.hp = 100;
  }
  w.people[team.lieutenantId].status = 'onTrial'; // May still give planning orders, but cannot fight in this fixture.
  team.weapons = { pistol: 1, shotgun: 0, rifle: 0, tommy: 0, twinPistols: 0, explosives: 0 };
  otherTeam.weapons = { pistol: 0, shotgun: 0, rifle: 0, tommy: 0, twinPistols: 0, explosives: 0 };
  team.vehicles = { coupe: 0, truck: 0, speedster: 0 };
  target.pos.x += 10; target.hp = 1000;
  gang.offered[rival.id] = 'peace'; rival.offered[gang.id] = 'peace';
  return { sim, w, gang, rival, team, actor, target, block };
}
type Fixture = ReturnType<typeof fixture>;
function ambush(s: Fixture, priority = false) {
  expect(issueOrder(s.w, s.gang.id, { teamId: s.team.id, type: 'ambush', blockIds: [s.block.id],
    opts: { priority, manpower: 1, preferredHoodId: s.actor.id } }).ok).toBe(true);
  const order = s.w.orders[s.team.orderIds.at(-1)!];
  order.state = 'executing'; order.assignedIds = [s.actor.id]; s.actor.orderId = order.id;
  return order;
}
function fire(s: Fixture, territory: TerritoryIndex | undefined = []) {
  vi.spyOn(s.sim.rng, 'chance').mockReturnValue(true);
  vi.spyOn(s.sim.rng, 'range').mockReturnValue(1);
  tickCombat(s.w, s.sim.rng, 1, territory);
}
/** A hit that only staggers: the original roll draws the kill at its exact
 * lethal share of the damage octet, which this refuses. */
function wound(s: Fixture) {
  const lethal = originalFireOdds(s.actor, s.target, 'pistol', dist(s.actor.pos, s.target.pos)).killGivenHit;
  vi.spyOn(s.sim.rng, 'chance').mockImplementation(p => p !== lethal);
  tickCombat(s.w, s.sim.rng, 1, []);
}

describe('diplomacy governs ordinary encounters; Ambush is a deliberate attack in its area', () => {
  it.each([
    ['alliance', false, false], ['peace', false, false], ['ceasefire', false, false],
    ['ceasefire', true, true], ['aggression', false, true], ['war', false, true],
  ] as [DiplomacyLevel, boolean, boolean][])('ordinary %s encounter, own territory=%s, attacks=%s', (level, own, attacks) => {
    const s = fixture(), territory: number[][] = [];
    s.gang.offered[s.rival.id] = level;
    territory[cityBlockAt(s.w, Math.floor(s.target.pos.x / 54), Math.floor(s.target.pos.y / 54))!.id] = [own ? s.gang.id : s.rival.id];
    fire(s, territory);
    expect(s.target.hp < 1000).toBe(attacks);
  });

  it.each((['alliance', 'peace', 'ceasefire', 'aggression', 'war'] as const)
    .flatMap(level => [false, true].map(priority => ({ level, priority }))))(
    'Ambush opens fire under $level with priority=$priority', ({ level, priority }) => {
      const s = fixture();
      s.target.pos.x = s.actor.pos.x + 2; // Same selected city block, inside the pistol's range.
      s.gang.offered[s.rival.id] = level;
      const order = ambush(s, priority);
      // Miss the shot, but an explicit ambush must still attempt to fire now.
      const chance = vi.spyOn(s.sim.rng, 'chance').mockReturnValue(false);
      tickCombat(s.w, s.sim.rng, 1, []);
      expect(chance).toHaveBeenCalled();
      expect(s.w.crimes.some(c => c.perpetratorId === s.actor.id && c.kind === 'shootout')).toBe(true);
      expect(order.ambushTargetId).toBe(s.target.id);
      expect(s.gang.offered[s.rival.id]).toBe('war');
      expect(s.rival.offered[s.gang.id]).toBe('war');
    });

  it('an ambusher with a Tommy gets three shots into each attempt', () => {
    const s = fixture();
    s.team.weapons = { pistol: 0, shotgun: 0, rifle: 0, tommy: 1, twinPistols: 0, explosives: 0 };
    s.target.pos.x = s.actor.pos.x + 2;
    ambush(s);
    const chance = vi.spyOn(s.sim.rng, 'chance').mockReturnValue(false);
    tickCombat(s.w, s.sim.rng, 1, []);
    const { hit } = originalFireOdds(s.actor, s.target, 'tommy', 2);
    expect(chance.mock.calls[0][0]).toBeCloseTo(1 - (1 - hit) ** 3, 10);
    expect(s.w.crimes.filter(c => c.perpetratorId === s.actor.id && c.kind === 'shootout')).toHaveLength(1);
  });

  it.each(['waiting', 'travelling', 'outside area', 'indoors', 'own gang'] as const)(
    'does not initiate an ambush against an invalid opportunity: %s', condition => {
      const s = fixture(), order = ambush(s, true);
      s.target.pos.x = s.actor.pos.x + 2;
      if (condition === 'waiting' || condition === 'travelling') order.state = condition;
      if (condition === 'outside area') s.target.pos.x = s.actor.pos.x + 10;
      if (condition === 'indoors') s.target.buildingId = Object.values(s.w.buildings)[0].id;
      if (condition === 'own gang') s.target.gangId = s.gang.id;
      fire(s);
      expect(s.target.hp).toBe(1000);
      expect(order.ambushTargetId).toBeUndefined();
    });

  it('holds position while engaging a chosen target, then returns after the kill', () => {
    const s = fixture(), order = ambush(s, true);
    s.target.pos.x = s.actor.pos.x + 2; s.actor.dest = { x: s.actor.pos.x + 20, y: s.actor.pos.y }; s.actor.path = [{ ...s.actor.dest }];
    wound(s);
    expect(s.target.status).toBe('active');
    expect(s.actor.dest).toBeNull();
    const position = { ...s.actor.pos };
    tickOrders(s.w, s.sim.rng, 1);
    expect(s.actor.pos).toEqual(position);
    vi.mocked(s.sim.rng.chance).mockReturnValue(true);
    tickCombat(s.w, s.sim.rng, 1, []);
    expect(s.target.status).toBe('dead'); expect(order.state).toBe('done');
    expect(order.completedTargets).toBe(1); expect(s.actor.orderId).toBeNull();
    expect(s.actor.dest).not.toBeNull();
  });

  it('a live pause stops the ambush and a saved Continue resumes its chosen target', () => {
    const s = fixture(), order = ambush(s, true);
    s.target.pos.x = s.actor.pos.x + 2;
    wound(s);
    expect(order.ambushTargetId).toBe(s.target.id);
    expect(setWaiting(s.w, order.id, true).ok).toBe(true);
    const health = s.target.hp;
    tickCombat(s.w, s.sim.rng, 1, []);
    expect(s.target.hp).toBe(health);
    const sim = Sim.fromSave(structuredClone(s.w)), restored = sim.world.orders[order.id];
    expect(restored.ambushTargetId).toBe(s.target.id);
    expect(setWaiting(sim.world, restored.id, false).ok).toBe(true);
    vi.spyOn(sim.rng, 'chance').mockReturnValue(true); vi.spyOn(sim.rng, 'range').mockReturnValue(1);
    tickCombat(sim.world, sim.rng, 1, []);
    expect(sim.world.people[s.target.id].hp).toBeLessThan(health);
  });

  it('travels to a real selected site, engages, restores mid-fight and finishes with real rolls', () => {
    const s = fixture();
    const site = s.w.buildings[s.w.lots[s.block.lotIds[0]].buildingId];
    expect(issueOrder(s.w, s.gang.id, { teamId: s.team.id, type: 'ambush', buildingIds: [site.id],
      opts: { priority: true, manpower: 1, preferredHoodId: s.actor.id } }).ok).toBe(true);
    const order = s.w.orders[s.team.orderIds.at(-1)!];
    s.target.pos = { x: 480, y: 480 }; s.target.halted = true;
    s.sim.launchWeek();
    for (let i = 0; i < MINUTES_PER_WEEK && order.state !== 'executing'; i++) s.sim.advance(1 / MINUTES_PER_SECOND, 1);
    expect(order.state).toBe('executing');
    s.actor.pos = buildingDoor(s.w, site); s.actor.dest = null; s.actor.path = [];
    const door = s.actor.pos, centre = s.block.center, length = dist(door, centre);
    s.target.pos = { x: door.x + (centre.x - door.x) * 5 / length, y: door.y + (centre.y - door.y) * 5 / length };
    s.target.hp = 400;
    // The opening minute engages without a lucky outright kill, so there is a
    // fight to save in the middle of; the rest of it runs on real rolls.
    const opening = vi.spyOn(s.sim.rng, 'chance').mockReturnValue(false);
    s.sim.advance(1 / MINUTES_PER_SECOND, 1);
    opening.mockRestore();
    expect(order.ambushTargetId).toBe(s.target.id);
    const sim = Sim.fromSave(structuredClone(s.w)), savedOrder = sim.world.orders[order.id];
    for (let i = 0; i < MINUTES_PER_WEEK && savedOrder.state === 'executing'; i++) sim.advance(1 / MINUTES_PER_SECOND, 1);
    expect(savedOrder.state, savedOrder.failReason ?? savedOrder.results.join(' ')).toBe('done');
    expect(sim.world.people[s.target.id].status).toBe('dead');
    const actor = sim.world.people[s.actor.id], destination = actor.dest!;
    for (let i = 0; i < MINUTES_PER_WEEK && actor.dest; i++) sim.advance(1 / MINUTES_PER_SECOND, 1);
    expect(dist(actor.pos, destination)).toBeLessThan(1);
  });
});
