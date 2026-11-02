import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { issueStreetOrder } from '../src/sim/api';
import { fireRate, originalFireOdds, originalFireRoll } from '../src/sim/fireRoll';
import type { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { tickCombat } from '../src/sim/systems/combat';
import { tickStreetOrders } from '../src/sim/systems/street';
import type { Person, WeaponId } from '../src/sim/types';
import type { Firearm } from '../src/sim/weapons';
import { staffFirstCrew } from './helpers/crew';

afterEach(() => vi.restoreAllMocks());

function scene(weapon?: WeaponId) {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 });
  staffFirstCrew(sim);
  const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
  const rival = Object.values(w.gangs).find(g => !g.isPlayer)!;
  const target = w.people[w.teams[rival.teamIds[0]].lieutenantId], actor = w.people[team.lieutenantId];
  for (const p of Object.values(w.people)) p.status = 'jailed';
  for (const owner of [...Object.values(w.gangs), ...Object.values(w.teams)]) {
    for (const key of Object.keys(owner.weapons) as WeaponId[]) owner.weapons[key] = 0;
  }
  if (weapon) team.weapons[weapon] = 1;
  for (const p of [actor, target]) {
    Object.assign(p, { status: 'active', orderId: null, streetOrder: null, buildingId: null, inVehicle: false, dest: null, path: [], hp: 10000 });
    p.pos = { x: 100, y: 100 };
    p.skills.firearms = 3; p.skills.stealth = 3;
  }
  target.pos.x = 105;
  gang.offered[rival.id] = 'war'; rival.offered[gang.id] = 'peace';
  w.phase = 'week'; w.minute = 0; w.messages = []; w.crimes = [];
  return { sim, w, gang, actor, target };
}

describe('the Tommy fires faster than other guns', () => {
  it('gives the Tommy three shots for one of any other gun', () => {
    expect(fireRate('tommy')).toBe(3);
    for (const weapon of ['twinPistols', 'pistol', 'rifle', 'shotgun', undefined] as const) expect(fireRate(weapon)).toBe(1);
  });

  it.each<[WeaponId | undefined, number]>([
    ['tommy', 0.27], ['twinPistols', 0.09], ['pistol', 0.09], ['rifle', 0.09], ['shotgun', 0.09], [undefined, 0.09],
  ])('gang fights open fire at the rate of a %s', (weapon, rate) => {
    const s = scene(weapon);
    if (!weapon) s.target.pos.x = 101; // Fists only reach two metres.
    const chance = vi.spyOn(s.sim.rng, 'chance').mockReturnValue(false);
    tickCombat(s.w, s.sim.rng, 1, []);
    expect(chance.mock.calls[0][0]).toBeCloseTo(rate, 10);
  });
});

describe('several shots in one tick make one roll', () => {
  const person = { role: 'hood', skills: { firearms: 3, stealth: 3 } } as unknown as Person;
  const metres = 5;
  const rolled = (weapon: Firearm, shots?: number) => {
    const chance = vi.fn((_: number) => true);
    originalFireRoll({ chance } as unknown as Rng, person, person, weapon, metres, shots);
    return chance.mock.calls.map(c => c[0]);
  };

  it('leaves a single shot exactly as the original roll', () => {
    const { hit, killGivenHit } = originalFireOdds(person, person, 'rifle', metres);
    expect(rolled('rifle')).toEqual([hit, killGivenHit]);
    expect(rolled('rifle', 1)).toEqual([hit, killGivenHit]);
  });

  it('gives three shots the odds of three independent shots', () => {
    const { hit, killGivenHit } = originalFireOdds(person, person, 'tommy', metres);
    const [anyHit, killIfHit] = rolled('tommy', 3);
    expect(anyHit).toBeCloseTo(1 - (1 - hit) ** 3, 10);
    expect(anyHit * killIfHit).toBeCloseTo(1 - (1 - hit * killGivenHit) ** 3, 10);
  });

  it('cannot hit when the gun is out of reach', () => {
    const chance = vi.fn((_: number) => false);
    const result = originalFireRoll({ chance } as unknown as Rng, person, person, 'pistol', 500, 3);
    expect(result).toEqual({ hit: false, kills: false });
  });

  it.each<[Firearm, number]>([['tommy', 3], ['rifle', 1]])('a street kill with a %s rolls %s shot(s) in one tick', (weapon, shots) => {
    const s = scene(weapon);
    expect(issueStreetOrder(s.w, s.gang.id, [s.actor.id], 'kill', s.target.id, null).ok).toBe(true);
    const chance = vi.spyOn(s.sim.rng, 'chance').mockReturnValue(false);
    s.w.minute++;
    tickStreetOrders(s.w, s.sim.rng, 1);
    const { hit } = originalFireOdds(s.actor, s.target, weapon, 5);
    expect(chance.mock.calls[0][0]).toBeCloseTo(1 - (1 - hit) ** shots, 10);
    // One attempt per tick: a Tommy records one incident, not three.
    expect(s.w.crimes.filter(c => c.kind === 'shootout')).toHaveLength(1);
  });
});
