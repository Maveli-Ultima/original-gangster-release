import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { decodeSlot } from '../src/app/save';
import { previewOrder } from '../src/sim/api';
import { WEAPONS } from '../src/sim/constants';
import { Sim } from '../src/sim/sim';
import { capturePeaceFireExclusions, peaceFireOpportunity, tickCombat } from '../src/sim/systems/combat';
import { originalFireOdds } from '../src/sim/fireRoll';
import { allocateWeapons } from '../src/sim/weapons';
import type { Person, WorldState } from '../src/sim/types';
import { staffFirstCrew } from './helpers/crew';

let initial: string;
beforeAll(() => { initial = JSON.stringify(new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 }).world); });
afterEach(() => vi.restoreAllMocks());

function scene() {
  const sim = Sim.fromSave(JSON.parse(initial) as WorldState);
  staffFirstCrew(sim);
  const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
  const rival = Object.values(w.gangs).find(g => !g.isPlayer)!;
  const actor = w.people[team.memberIds[0]];
  const target = w.people[w.teams[rival.teamIds[0]].lieutenantId];
  for (const p of Object.values(w.people)) p.status = 'jailed';
  for (const owner of [...Object.values(w.gangs), ...Object.values(w.teams)]) {
    for (const key of Object.keys(owner.weapons) as (keyof typeof owner.weapons)[]) owner.weapons[key] = 0;
  }
  for (const p of [actor, target]) {
    p.status = 'active'; p.hp = 10000; p.pos = { x: 100, y: 100 };
    p.orderId = null; p.streetOrder = null; p.dest = null; p.path = [];
    p.skills.firearms = 3; p.skills.stealth = 0.5;
  }
  actor.skills.intelligence = 0.5;
  target.pos.x = 110;
  gang.offered[rival.id] = 'peace'; rival.offered[gang.id] = 'peace';
  team.weapons.pistol = 1;
  w.messages = []; w.crimes = [];
  return { sim, w, gang, team, rival, actor, target };
}

function task(s: ReturnType<typeof scene>, type: 'patrol' | 'kill' | 'assault' | 'ambush', priority = false) {
  const order = previewOrder(s.w, s.gang.id, { teamId: s.team.id, type,
    personId: type === 'kill' || type === 'assault' ? s.target.id : null, blockIds: [0], opts: { priority } })!;
  order.id = s.w.nextId++;
  order.state = 'executing'; order.assignedIds = [s.actor.id];
  s.w.orders[order.id] = order; s.actor.orderId = order.id;
}

function opportunityState(s: ReturnType<typeof scene>, probability: number, wanted = true): number {
  for (let state = 1; state < 1_000_000; state++) {
    if (peaceFireOpportunity(state, s.w.week, s.w.minute, s.actor.id, probability) === wanted) return state;
  }
  throw Error('No deterministic peace-fire state found');
}

describe('low-Intelligence peace-fire remake tuning', () => {
  it.each([[0.5, 1, 0.0002], [1.5, 1, 0.0001], [0.5, 3, 0.0006]])(
    'uses one opportunity at Intelligence %s over %s minutes', (intelligence, minutes, probability) => {
      const s = scene(); s.actor.skills.intelligence = intelligence;
      s.sim.rng.state = opportunityState(s, probability);
      const chance = vi.spyOn(s.sim.rng, 'chance').mockReturnValue(true);
      vi.spyOn(s.sim.rng, 'range').mockReturnValue(1);
      tickCombat(s.w, s.sim.rng, minutes, []);
      // One opportunity: the original fire roll's hit draw, then its lethal draw.
      expect(chance).toHaveBeenNthCalledWith(1, originalFireOdds(s.actor, s.target, 'pistol', 10).hit);
      expect(chance).toHaveBeenCalledTimes(2);
      expect(s.target.status).toBe('dead');
      expect(s.team.weapons.pistol).toBe(1);
    },
  );

  it('scales opportunity probability without drawing from the shared stream', () => {
    const s = scene();
    let state = 1;
    while (state < 1_000_000 && !(peaceFireOpportunity(state, s.w.week, s.w.minute, s.actor.id, 0.0006) &&
      !peaceFireOpportunity(state, s.w.week, s.w.minute, s.actor.id, 0.0002))) state++;
    expect(state).toBeLessThan(1_000_000);
    expect(peaceFireOpportunity(state, s.w.week, s.w.minute, s.actor.id, 0.0002)).toBe(false);
    expect(peaceFireOpportunity(state, s.w.week, s.w.minute, s.actor.id, 0.0006)).toBe(true);
    s.sim.rng.state = opportunityState(s, 0.0002, false);
    const before = s.sim.rng.state;
    tickCombat(s.w, s.sim.rng, 1, []);
    expect(s.sim.rng.state).toBe(before);
    expect(s.target.hp).toBe(10000);
  });

  it('does not multiply the opportunity by crowd size and chooses distance then ID', () => {
    const s = scene();
    const others = s.w.teams[s.rival.teamIds[0]].memberIds.slice(0, 2).map(id => s.w.people[id]);
    for (const p of others) { p.status = 'active'; p.pos = { x: 105, y: 100 }; p.hp = 10000; }
    const selected = [...others].sort((a, b) => a.id - b.id)[0];
    s.sim.rng.state = opportunityState(s, 0.0002, false);
    const chance = vi.spyOn(s.sim.rng, 'chance').mockReturnValue(false);
    tickCombat(s.w, s.sim.rng, 1, []);
    expect(chance).not.toHaveBeenCalled();
    s.sim.rng.state = opportunityState(s, 0.0002);
    chance.mockClear().mockReturnValue(true);
    vi.spyOn(s.sim.rng, 'range').mockReturnValue(1);
    tickCombat(s.w, s.sim.rng, 1, []);
    expect(chance).toHaveBeenCalledTimes(2);   // hit, then lethal
    expect(selected.status).toBe('dead');
    expect(s.target.status).toBe('active');
    expect(others.find(p => p.id !== selected.id)!.status).toBe('active');
  });

  it.each(['intelligence', 'unarmed', 'same gang', 'alliance', 'ceasefire', 'inactive actor',
    'inactive target', 'lieutenant', 'out of range', 'priority', 'kill', 'assault', 'ambush',
    'street kill', 'street assault', 'street tail', 'street goTo', 'zero minutes'] as const)(
    'excludes %s without consuming combat randomness', condition => {
      const s = scene();
      switch (condition) {
        case 'intelligence': s.actor.skills.intelligence = 2.5; break;
        case 'unarmed': s.team.weapons.pistol = 0; break;
        case 'same gang': s.target.gangId = s.gang.id; break;
        case 'alliance': s.gang.offered[s.rival.id] = 'alliance'; break;
        case 'ceasefire': s.gang.offered[s.rival.id] = 'ceasefire'; break;
        case 'inactive actor': s.actor.status = 'beaten'; break;
        case 'inactive target': s.target.status = 'beaten'; break;
        case 'lieutenant': s.actor.role = 'lieutenant'; break;
        case 'out of range': s.target.pos.x = 100 + WEAPONS.pistol.range + 0.01; break;
        case 'priority': task(s, 'patrol', true); s.actor.hp = 80; break;
        case 'kill': task(s, 'kill'); break;
        case 'assault': task(s, 'assault'); break;
        case 'ambush': task(s, 'ambush'); break;
        case 'street kill': case 'street assault': case 'street tail': case 'street goTo':
          s.actor.streetOrder = { type: condition.slice(7) as NonNullable<Person['streetOrder']>['type'],
            targetPersonId: s.target.id, pos: null }; break;
      }
      const chance = vi.spyOn(s.sim.rng, 'chance').mockReturnValue(true);
      tickCombat(s.w, s.sim.rng, condition === 'zero minutes' ? 0 : 1, []);
      expect(chance).not.toHaveBeenCalled();
      expect(s.target.hp).toBe(10000);
    },
  );

  it('uses the finite carrier allocation and allows ordinary non-priority work', () => {
    const s = scene();
    const unequipped = s.w.people[s.team.memberIds[1]];
    Object.assign(unequipped, { status: 'active', pos: { ...s.actor.pos }, orderId: null, streetOrder: null });
    unequipped.skills.intelligence = 0.5; unequipped.skills.firearms = 1;
    task(s, 'patrol');
    expect(allocateWeapons(s.w).get(s.actor.id)).toBe('pistol');
    expect(allocateWeapons(s.w).has(unequipped.id)).toBe(false);
    s.sim.rng.state = opportunityState(s, 0.0002);
    const chance = vi.spyOn(s.sim.rng, 'chance').mockReturnValue(true);
    vi.spyOn(s.sim.rng, 'range').mockReturnValue(1);
    tickCombat(s.w, s.sim.rng, 1, []);
    expect(chance).toHaveBeenCalledTimes(2);   // hit, then lethal
    expect(s.target.status).toBe('dead');
  });

  it.each(['street', 'priority', 'kill'] as const)('keeps a completed %s task excluded for its whole minute', type => {
    const s = scene();
    if (type === 'street') s.actor.streetOrder = { type: 'goTo', pos: { ...s.actor.pos }, targetPersonId: null };
    else task(s, type === 'priority' ? 'patrol' : 'kill', type === 'priority');
    const loadout = allocateWeapons(s.w), excluded = capturePeaceFireExclusions(s.w, loadout);
    s.actor.streetOrder = null; s.actor.orderId = null;
    const chance = vi.spyOn(s.sim.rng, 'chance').mockReturnValue(true);
    tickCombat(s.w, s.sim.rng, 1, [], loadout, excluded);
    expect(chance).not.toHaveBeenCalled();
    expect(s.target.hp).toBe(10000);
  });

  it('does not add peace-fire while already in range of an ordinary hostile', () => {
    const s = scene();
    const third = Object.values(s.w.gangs).find(g => g.id !== s.gang.id && g.id !== s.rival.id)!;
    const enemy = s.w.people[s.w.teams[third.teamIds[0]].lieutenantId];
    enemy.status = 'active'; enemy.pos = { x: 109, y: 100 };
    s.gang.offered[third.id] = 'war'; third.offered[s.gang.id] = 'peace';
    const chance = vi.spyOn(s.sim.rng, 'chance').mockReturnValue(false);
    tickCombat(s.w, s.sim.rng, 1, []);
    expect(chance).toHaveBeenCalledExactlyOnceWith(0.09);
    expect(s.target.hp).toBe(10000);
  });

  it('retains ordinary weapon crime reporting on a missed accidental shot', () => {
    const s = scene();
    s.sim.rng.state = opportunityState(s, 0.0002);
    vi.spyOn(s.sim.rng, 'chance').mockReturnValue(false);
    tickCombat(s.w, s.sim.rng, 1, []);
    expect(s.target.hp).toBe(10000);
    expect(s.w.crimes).toHaveLength(1);
    expect(s.w.crimes[0]).toMatchObject({ kind: 'shootout', perpetratorId: s.actor.id, victimId: null });
  });

  it('replays a real stochastic opportunity from a serialized world and RNG state', () => {
    const s = scene();
    let before = 1;
    const hitChance = originalFireOdds(s.actor, s.target, 'pistol', 10).hit;
    while (before < 1_000_000) {
      if (peaceFireOpportunity(before, s.w.week, s.w.minute, s.actor.id, 0.0002)) {
        s.sim.rng.state = before;
        if (s.sim.rng.next() < hitChance) break;
      }
      before++;
    }
    expect(before).toBeLessThan(1_000_000);
    s.sim.rng.state = before; s.w.rngState = before;
    const slot = decodeSlot({ id: 'peace-fire', format: 2, worldJson: JSON.stringify(s.w) });
    expect(slot.error).toBeUndefined();
    const restored = Sim.fromSave(slot.world!);
    tickCombat(s.w, s.sim.rng, 1, []);
    tickCombat(restored.world, restored.rng, 1, []);
    expect(s.sim.rng.state).not.toBe(before);   // the shot drew its hit and lethal rolls
    expect(restored.rng.state).toBe(s.sim.rng.state);
    expect(restored.world).toEqual(s.w);
  });
});
