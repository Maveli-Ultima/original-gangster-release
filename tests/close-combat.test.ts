import { describe, expect, it } from 'vitest';
import { defaultGameOptions, newCampaignOptions } from '../src/app/newGame';
import { cartAttack, closeCombatBlow, closeCombatOdds, postureAfter, spendLostTurn } from '../src/sim/closeCombat';
import { CART } from '../src/sim/data/cart';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { tickStreetOrders } from '../src/sim/systems/street';
import { SKILLS, type Person } from '../src/sim/types';

const person = (role: Person['role'], stars: number, extra: Partial<Person> = {}): Person => ({
  id: Math.floor(Math.random() * 1e9), role, hp: 100, status: 'active', name: role,
  skills: Object.fromEntries(SKILLS.map(s => [s, stars])), ...extra,
} as unknown as Person);

describe('Cart.txt tables', () => {
  it('has 16 attack types with the file’s instant deaths', () => {
    expect(CART).toHaveLength(16);
    expect(CART[4].hitBehind.at(-1)).toEqual([5, 4, 0, 1, 5]);      // throat slashed
    expect(CART[12].hitFront).toEqual([[9, 8, 0, 1, 5]]);            // coup de grâce on the knees
    for (const t of CART) for (const list of [t.missBehind, t.hitBehind, t.missFront, t.hitFront]) expect(list.length).toBeGreaterThan(0);
  });
});

describe('the opposed roll (0x465150)', () => {
  it('is 52 · atk · morale / (100 · def): even fighters land about half their blows', () => {
    const odds = closeCombatOdds(person('hood', 2.5), person('hood', 2.5), 'fist');
    // atk = def: chance 41..61, hit when rand%100+1 < chance → mean ≈ 0.505.
    expect(odds).toBeGreaterThan(.48);
    expect(odds).toBeLessThan(.53);
    expect(closeCombatOdds(person('hood', 5), person('hood', .5), 'fist')).toBe(1);
  });
});

describe('attack selection (0x465330)', () => {
  it('picks the weapon’s attack for each band, the coup de grâce only for a pistol carrier', () => {
    const rng = new Rng(1), seen = (w: 'fist' | 'bat' | 'knife', band: 0 | 1 | 2 | 3, coup: boolean) =>
      new Set(Array.from({ length: 200 }, () => cartAttack(rng, w, band, coup)));
    expect(seen('fist', 0, false)).toEqual(new Set([1, 2]));
    expect(seen('fist', 1, false)).toEqual(new Set([5]));
    expect(seen('bat', 0, false)).toEqual(new Set([0, 3]));
    expect(seen('knife', 1, false)).toEqual(new Set([7]));
    expect(seen('knife', 2, false)).toEqual(new Set([11]));
    expect(seen('knife', 2, true)).toEqual(new Set([11, 12]));
    expect(seen('fist', 3, true)).toEqual(new Set([14, 15]));
    expect(seen('bat', 3, false)).toEqual(new Set([13, 14]));
  });

  it('moves the victim between standing, kneeling and down', () => {
    expect(postureAfter(3, 'standing')).toBe('kneeling');
    expect(postureAfter(5, 'standing')).toBe('down');
    expect(postureAfter(10, 'kneeling')).toBe('standing');
    expect(postureAfter(6, 'down')).toBe('down');
  });

  it('a landed blow costs the victim a turn and stamina; only a spent man in an armed fight dies', () => {
    const rng = new Rng(7);
    const victim = person('citizen', 1);
    let killed = false;
    for (let i = 0; i < 400 && !killed; i++) {
      victim.hp = 100; delete victim.closeCombat;
      let before = 15;
      for (let j = 0; j < 60 && !killed; j++) {
        const blow = closeCombatBlow(rng, person('hood', 5), victim, 'knife', undefined, 0, 1);
        if (blow.hit) expect(before - blow.stamina).toBeLessThanOrEqual(Math.max(0, blow.entry[4]));
        expect(blow.lethal).toBe(blow.hit && blow.stamina === 0);
        before = blow.stamina;
        if (blow.lethal) killed = true;
        else if (blow.hit) spendLostTurn(victim);
      }
    }
    expect(killed).toBe(true);
  });
});

describe('street close combat', () => {
  it('an Assault exchanges blows until the victim is down, then leaves him beaten', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 });
    const w = sim.world, gang = sim.playerGang;
    const hood = Object.values(w.people).find(p => p.gangId === gang.id && p.role === 'hood')!;
    const victim = Object.values(w.people).find(p => p.role === 'citizen' && p.status === 'active')!;
    victim.pos = { ...hood.pos }; victim.dest = null; victim.path = [];
    hood.streetOrder = { type: 'assault', targetPersonId: victim.id, pos: { ...victim.pos } };
    const rng = new Rng(3);
    for (let i = 0; i < 200 && hood.streetOrder; i++) tickStreetOrders(w, rng, 1, new Map());
    expect(hood.streetOrder).toBeNull();
    expect(['beaten', 'dead']).toContain(victim.status);
  });

  it('an unarmed Kill fights it out with the original tables', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 405, citySize: 10 });
    const w = sim.world, gang = sim.playerGang;
    const hood = Object.values(w.people).find(p => p.gangId === gang.id && p.role === 'hood')!;
    const victim = Object.values(w.people).find(p => p.role === 'citizen' && p.status === 'active')!;
    victim.pos = { ...hood.pos }; victim.dest = null; victim.path = [];
    hood.streetOrder = { type: 'kill', targetPersonId: victim.id, pos: { ...victim.pos } };
    const rng = new Rng(4);
    for (let i = 0; i < 400 && hood.streetOrder; i++) tickStreetOrders(w, rng, 1, new Map());
    expect(victim.status).toBe('dead');
    expect(hood.closeCombat).toBeUndefined();
  });

  it('in the original city an unarmed Kill is an Assault (0x4D6E40): it ends with the victim beaten', () => {
    const sim = new Sim({ ...newCampaignOptions(), seed: 404 });
    const w = sim.world, gang = sim.playerGang;
    const hood = Object.values(w.people).find(p => p.gangId === gang.id && p.role === 'hood')!;
    const victim = Object.values(w.people).find(p => p.role === 'citizen' && p.status === 'active')!;
    victim.pos = { ...hood.pos }; victim.dest = null; victim.path = [];
    hood.streetOrder = { type: 'kill', targetPersonId: victim.id, pos: { ...victim.pos } };
    const rng = new Rng(4);
    for (let i = 0; i < 400 && hood.streetOrder; i++) tickStreetOrders(w, rng, 1, new Map());
    expect(hood.streetOrder).toBeNull();
    expect(victim.status).toBe('beaten');
  });
});
