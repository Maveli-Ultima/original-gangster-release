import { CLOSE_COMBAT_STAMINA } from '../src/sim/closeCombat';
import { WALK_SPEED } from '../src/sim/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { issueOrder, transferWeapon } from '../src/sim/api';
import { tickOrders } from '../src/sim/execution';
import { Sim } from '../src/sim/sim';
import { tickCombat } from '../src/sim/systems/combat';
import { tickStreetOrders } from '../src/sim/systems/street';
import { allocateWeapons, UNARMED } from '../src/sim/weapons';
import { staffFirstCrew } from './helpers/crew';

afterEach(() => vi.restoreAllMocks());
function scene(count = 1) {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 });
  staffFirstCrew(sim);
  const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
  const rival = Object.values(w.gangs).find(g => !g.isPlayer)!;
  const target = w.people[w.teams[rival.teamIds[0]].lieutenantId];
  const people = [team.lieutenantId, ...team.memberIds].slice(0, count).sort((a, b) => a - b).map(id => w.people[id]);
  for (const p of Object.values(w.people)) p.status = 'jailed';
  for (const owner of [...Object.values(w.gangs), ...Object.values(w.teams)]) {
    for (const key of Object.keys(owner.weapons) as (keyof typeof owner.weapons)[]) owner.weapons[key] = 0;
  }
  for (const p of [...people, target]) {
    p.status = 'active'; p.pos = { x: 100, y: 100 }; p.orderId = null;
    p.dest = null; p.path = []; p.hp = 10000;
    p.skills.firearms = 3; p.skills.fists = 2;
  }
  target.pos.x = 101;
  gang.offered[rival.id] = 'war'; rival.offered[gang.id] = 'peace';
  w.messages = []; w.crimes = [];
  return { sim, w, gang, team, rival, target, people };
}
function forceHits(sim: Sim) {
  vi.spyOn(sim.rng, 'chance').mockReturnValue(true);
  vi.spyOn(sim.rng, 'range').mockReturnValue(1);
}

describe('finite firearm allocation', () => {
  it('leaves an empty or explosives-only crew unarmed', () => {
    const { w, team, people } = scene(3);
    team.weapons.explosives = 20;
    for (const p of people) expect(allocateWeapons(w).has(p.id)).toBe(false);
  });
  it('assigns each mixed-stock firearm to exactly one person without consuming stock', () => {
    const { w, team, people } = scene(4);
    team.weapons.tommy = 1; team.weapons.pistol = 2;
    const before = JSON.stringify(w);
    const loadout = allocateWeapons(w);
    expect(people.map(p => loadout.get(p.id))).toEqual(['tommy', 'pistol', 'pistol', undefined]);
    expect(JSON.stringify(w)).toBe(before);
  });
  it('gives priority work precedence over shooting skill, then equips the best remaining shot', () => {
    const { w, gang, team, people } = scene(3);
    team.weapons.tommy = 1; team.weapons.pistol = 1;
    people[0].skills.firearms = 5; people[1].skills.firearms = 1;
    expect(issueOrder(w, gang.id, { teamId: team.id, type: 'patrol', blockIds: [0], opts: { priority: true } }).ok).toBe(true);
    people[1].orderId = team.orderIds.at(-1)!;
    const loadout = allocateWeapons(w);
    expect(loadout.get(people[1].id)).toBe('tommy');
    expect(loadout.get(people[0].id)).toBe('pistol');
    expect(loadout.has(people[2].id)).toBe(false);
  });
  it('keeps the shared cache separate until equipment is transferred to the crew', () => {
    const { w, gang, team, people } = scene(2);
    gang.weapons.rifle = 1;
    const boss = w.people[gang.bossId]; boss.status = 'active';
    expect(allocateWeapons(w).get(boss.id)).toBe('rifle');
    expect(people.some(p => allocateWeapons(w).has(p.id))).toBe(false);
    expect(transferWeapon(w, gang.id, 'rifle', team.id, true).ok).toBe(true);
    expect(allocateWeapons(w).has(boss.id)).toBe(false);
    expect(allocateWeapons(w).get(people[0].id)).toBe('rifle');
  });
  it('excludes unavailable people and foreign or stale crew references', () => {
    const { w, team, rival, people } = scene(3);
    team.weapons.tommy = 3;
    people[0].status = 'dead';
    people[1].teamId = rival.teamIds[0];
    people[2].teamId = 999999;
    for (const p of people) expect(allocateWeapons(w).has(p.id)).toBe(false);
  });
  it('gives police and FBI their issued firearms independently of gang stock', () => {
    const { w } = scene();
    const police = w.people[w.policeIds[0]];
    police.status = 'active'; police.skills.firearms = 2;
    expect(allocateWeapons(w).get(police.id)).toBe('pistol');
    police.skills.firearms = 5;
    expect(allocateWeapons(w).get(police.id)).toBe('tommy');
    police.role = 'fbi'; police.skills.firearms = 1;
    expect(allocateWeapons(w).get(police.id)).toBe('tommy');
  });
  it('reconstructs identical reservations after save/load and object reordering without RNG', () => {
    const { sim, w, team } = scene(4);
    team.weapons.rifle = 1; team.weapons.shotgun = 1;
    const expected = [...allocateWeapons(w)].sort(([a], [b]) => a - b);
    const rng = sim.rng.state;
    const restored = Sim.fromSave(JSON.parse(JSON.stringify(w)));
    restored.world.people = Object.fromEntries(Object.entries(restored.world.people).reverse());
    expect([...allocateWeapons(restored.world)].sort(([a], [b]) => a - b)).toEqual(expected);
    expect(sim.rng.state).toBe(rng);
  });
  it('does not hand a fallen carrier’s gun to another actor within the same tick', () => {
    const { w, team, people } = scene(2);
    team.weapons.pistol = 1;
    const loadout = allocateWeapons(w);
    people[0].status = 'dead';
    expect(loadout.has(people[1].id)).toBe(false);
    expect(allocateWeapons(w).get(people[1].id)).toBe('pistol');
  });
});

describe('combat uses the assigned weapon', () => {
  it('one upgraded gun produces one gun hit, with the remaining crew using melee', () => {
    const { sim, w, team, target } = scene(3);
    team.weapons.tommy = 1; forceHits(sim);
    tickCombat(w, sim.rng, 1, []);
    // The original fire roll has no hit points: a lethal wound class kills.
    expect(target.status).toBe('dead');
    expect(w.messages.filter(m => m.sound === 'gunshot')).toHaveLength(1);
  });
  it('unarmed actors cannot inflict pistol damage from a distance', () => {
    const { sim, w, target } = scene();
    target.pos.x = 110; forceHits(sim);
    tickCombat(w, sim.rng, 1, []);
    expect(target.hp).toBe(10000);
    expect(w.messages).toHaveLength(0);
  });
  it('melee uses fists rather than firearms and never reports gunshots', () => {
    const { sim, w, people, target } = scene();
    forceHits(sim);
    const chance = vi.mocked(sim.rng.chance);
    tickCombat(w, sim.rng, 1, []);
    const fistChance = chance.mock.calls[1][0];
    people[0].skills.firearms = 5; chance.mockClear();
    tickCombat(w, sim.rng, 1, []);
    expect(chance.mock.calls[1][0]).toBe(fistChance);
    people[0].skills.fists = 5; chance.mockClear();
    tickCombat(w, sim.rng, 1, []);
    expect(chance.mock.calls[1][0]).toBeGreaterThan(fistChance);
    expect(target.hp).toBe(10000 - 3 * UNARMED.damage);
    expect(w.messages.every(m => !/shot|gun/i.test(m.text))).toBe(true);
    expect(w.messages.some(m => m.sound === 'gunshot')).toBe(false);
  });
  it('records a melee death as a killing, not a shootout', () => {
    const { sim, w, target } = scene();
    target.hp = 1; forceHits(sim);
    tickCombat(w, sim.rng, 1, []);
    expect(target.status).toBe('dead');
    expect(w.crimes.some(c => c.kind === 'kill')).toBe(true);
    expect(w.crimes.some(c => c.kind === 'shootout')).toBe(false);
  });
  it('finishes a successful ambush and sends the crew back to headquarters', () => {
    const { sim, w, gang, team, people, target } = scene();
    expect(issueOrder(w, gang.id, { teamId: team.id, type: 'ambush', blockIds: [0] }).ok).toBe(true);
    const order = w.orders[team.orderIds.at(-1)!];
    order.state = 'executing'; order.assignedIds = [people[0].id]; people[0].orderId = order.id;
    // The ambush must be in its assigned block, rather than the scene's old
    // arbitrary coordinates on the other side of town.
    people[0].pos = { x: 20, y: 20 }; target.pos = { x: 21, y: 20 };
    team.weapons.pistol = 1; target.hp = 1; forceHits(sim);
    tickCombat(w, sim.rng, 1, []);
    expect(target.status).toBe('dead');
    expect(order.state).toBe('done');
    expect(order.results.join(' ')).toContain(target.name);
    expect(people[0].orderId).toBeNull();
    expect(people[0].dest).not.toBeNull();
  });
  it.each([false, true])('live Kill orders use real range and damage with armed=%s', armed => {
    const { sim, w, team, people, target } = scene();
    if (armed) team.weapons.pistol = 1;
    people[0].streetOrder = { type: 'kill', targetPersonId: target.id, pos: null };
    target.pos.x = 110; forceHits(sim);
    // A full minute can close this gap before the range check. Use a short
    // tick to isolate the weapon's reach from generated actor walking speed.
    tickStreetOrders(w, sim.rng, .01);
    if (!armed) expect(Math.hypot(people[0].pos.x - target.pos.x, people[0].pos.y - target.pos.y)).toBeGreaterThan(UNARMED.range);
    // Armed: the pistol reaches and the forced lethal wound kills (no gunfire HP).
    if (armed) { expect(target.status).toBe('dead'); return; }
    expect(target.hp).toBe(10000);
    people[0].pos = { x: 109, y: 100 };
    tickStreetOrders(w, sim.rng, .01);
    // Close combat follows 0x465C20: a landed blow costs stamina (1..level), not hit points.
    expect(target.hp).toBe(10000);
    expect(target.closeCombat?.stamina).toBeLessThan(CLOSE_COMBAT_STAMINA);
  });
  it('live Assault closes to melee range even with a gun', () => {
    const { sim, w, team, people, target } = scene();
    team.weapons.tommy = 1; target.pos.x = 125; forceHits(sim);
    people[0].streetOrder = { type: 'assault', targetPersonId: target.id, pos: null };
    tickStreetOrders(w, sim.rng, 1);
    expect(target.hp).toBe(10000);
    for (let i=0;i<5*Math.ceil(10/WALK_SPEED) && people[0].streetOrder;i++) tickStreetOrders(w,sim.rng,1);
    expect(Math.hypot(people[0].pos.x-target.pos.x,people[0].pos.y-target.pos.y)).toBeLessThanOrEqual(UNARMED.range);
    expect(target.status).toBe('beaten');
    expect(w.messages.some(m=>m.sound==='gunshot')).toBe(false);
  });
  it.each(['live', 'planned'] as const)('%s Assault stops the victim\'s previous movement and orders', mode => {
    const { sim, w, gang, team, people, target } = scene();
    target.dest = { x: 130, y: 100 }; target.path = [{ ...target.dest }];
    target.streetOrder = { type: 'goTo', targetPersonId: null, pos: { ...target.dest } };
    vi.spyOn(sim.rng, 'chance').mockImplementation(probability => probability > 0);
    people[0].skills.knives = 1;
    if (mode === 'live') {
      people[0].streetOrder = { type: 'assault', targetPersonId: target.id, pos: null };
      // A first blow lands from behind and need not floor him (0x465C20).
      for (let i = 0; i < 40 && people[0].streetOrder; i++) tickStreetOrders(w, sim.rng, 1);
    } else {
      expect(issueOrder(w, gang.id, { teamId: team.id, type: 'assault', personId: target.id }).ok).toBe(true);
      const order = w.orders[team.orderIds.at(-1)!];
      order.state = 'executing'; order.assignedIds = [people[0].id]; order.workLeft = 0;
      people[0].orderId = order.id;
      tickOrders(w, sim.rng, 1);
      expect(order.state).toBe('done');
    }
    expect(target.status).toBe('beaten');
    expect(target.hp).toBeGreaterThan(0);
    expect(target.dest).toBeNull(); expect(target.path).toEqual([]);
    expect(target.streetOrder).toBeNull(); expect(target.orderId).toBeNull();
  });
  it.each([false, true])('planned Kill resolves with actual equipment, armed=%s', armed => {
    const { sim, w, gang, team, people, target } = scene();
    if (armed) team.weapons.pistol = 1;
    expect(issueOrder(w, gang.id, { teamId: team.id, type: 'kill', personId: target.id }).ok).toBe(true);
    const order = w.orders[team.orderIds.at(-1)!];
    order.state = 'executing'; order.assignedIds = [people[0].id]; order.workLeft = 0;
    people[0].orderId = order.id;
    forceHits(sim);
    tickOrders(w, sim.rng, 1);
    expect(target.status).toBe('dead');
    expect(order.state).toBe('done');
    expect(w.messages.some(m => m.sound === 'gunshot')).toBe(armed);
  });
  it('planned Kill uses fists for unequipped actors and firearms only for equipped actors', () => {
    function attempt(firearms: number, fists: number, armed: boolean) {
      const { sim, w, gang, team, people, target } = scene();
      people[0].skills.firearms = firearms; people[0].skills.fists = fists;
      if (armed) team.weapons.pistol = 1;
      expect(issueOrder(w, gang.id, { teamId: team.id, type: 'kill', personId: target.id }).ok).toBe(true);
      const order = w.orders[team.orderIds.at(-1)!];
      order.state = 'executing'; order.assignedIds = [people[0].id]; order.workLeft = 0;
      const chance = vi.spyOn(sim.rng, 'chance').mockReturnValue(false);
      people[0].orderId = order.id;
      tickOrders(w, sim.rng, 1);
      return chance.mock.calls[0][0];
    }
    expect(attempt(5, 1, false)).toBe(attempt(1, 1, false));
    expect(attempt(1, 5, false)).toBeGreaterThan(attempt(1, 1, false));
    expect(attempt(5, 1, true)).toBeGreaterThan(attempt(1, 1, true));
  });
});
