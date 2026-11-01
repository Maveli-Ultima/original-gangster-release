import { describe, expect, it } from 'vitest';
import { CLOSE_COMBAT_STAMINA, closeCombatBlow, endCloseCombat, staminaLoss } from '../src/sim/closeCombat';
import { CART } from '../src/sim/data/cart';
import { Rng } from '../src/sim/rng';
import { SKILLS, type Person } from '../src/sim/types';

const person = (role: Person['role'], stars: number): Person => ({
  id: Math.floor(Math.random() * 1e9), role, hp: 100, status: 'active', name: role,
  skills: Object.fromEntries(SKILLS.map(s => [s, stars])),
} as unknown as Person);

// A five-star hood against a half-star hood always lands (closeCombatOdds = 1).
const strong = () => person('hood', 5);
const weak = () => person('hood', .5);

describe('close-combat damage (CloseCombat_ApplyBlow 0x465C20)', () => {
  it('a blow of level d costs rand % d + 1 stamina, level 0 costs none', () => {
    const rng = new Rng(11);
    expect(staminaLoss(rng, 0)).toBe(0);
    for (const d of [1, 2, 3, 4, 5]) {
      const seen = new Set(Array.from({ length: 400 }, () => staminaLoss(rng, d)));
      expect([...seen].sort()).toEqual(Array.from({ length: d }, (_, i) => i + 1));
    }
  });

  it('a fight starts at 15 stamina (0x5614D0) and a landed blow takes 1..level from it, not hit points', () => {
    expect(CLOSE_COMBAT_STAMINA).toBe(15);
    const rng = new Rng(5);
    for (let i = 0; i < 200; i++) {
      const victim = weak();
      const blow = closeCombatBlow(rng, strong(), victim, 'knife', undefined, 0, 1);
      expect(blow.hit).toBe(true);
      const lost = CLOSE_COMBAT_STAMINA - blow.stamina;
      expect(lost).toBeGreaterThanOrEqual(1);
      expect(lost).toBeLessThanOrEqual(blow.entry[4]);
      expect(victim.closeCombat?.stamina).toBe(blow.stamina);
      expect(victim.hp).toBe(100);
    }
  });

  it('level 5 is a 1..5 draw, not instant death', () => {
    const rng = new Rng(9);
    let fives = 0;
    for (let i = 0; i < 600; i++) {
      const victim = weak();
      const blow = closeCombatBlow(rng, strong(), victim, 'knife', undefined, 0, 1);
      if (blow.entry[4] !== 5) continue;
      fives++;
      expect(blow.lethal).toBe(false);
      expect(blow.stamina).toBeGreaterThanOrEqual(10);
      expect(victim.hp).toBe(100);
    }
    expect(fives).toBeGreaterThan(0);
  });

  it('draws the reaction from the hit-from-behind list on a first blow, the hit-from-front list after', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 100; i++) {
      const victim = weak(), attacker = strong();
      const first = closeCombatBlow(rng, attacker, victim, 'bat', undefined, 0, 1);
      expect(CART[first.attack].hitBehind).toContain(first.entry);
      if (first.exhausted) continue;
      const second = closeCombatBlow(rng, attacker, victim, 'bat', undefined, 1, 1);
      expect(CART[second.attack].hitFront).toContain(second.entry);
    }
  });

  it('stamina floors at 0 and ends the fight; armed, the exhausted man is finished off (remake choice)', () => {
    const rng = new Rng(21);
    const fistVictim = weak();
    fistVictim.closeCombat = { posture: 'standing', turnsLost: 0, stamina: 1 };
    const punch = closeCombatBlow(rng, strong(), fistVictim, 'fist', undefined, 0, 1);
    expect(punch.stamina).toBe(0);
    expect(punch.exhausted).toBe(true);
    expect(punch.lethal).toBe(false);
    expect(fistVictim.hp).toBe(100);

    const knifeVictim = weak();
    knifeVictim.closeCombat = { posture: 'standing', turnsLost: 0, stamina: 1 };
    const stab = closeCombatBlow(rng, strong(), knifeVictim, 'knife', undefined, 0, 1);
    expect(stab.exhausted).toBe(true);
    expect(stab.lethal).toBe(true);
    expect(knifeVictim.hp).toBe(0);
  });

  it('never kills in the original city: a gunless Kill is an Assault (0x4D6E40 sets order type 0x18)', () => {
    const rng = new Rng(21);
    for (const weapon of ['knife', 'bat', 'fist'] as const) {
      const victim = weak();
      victim.closeCombat = { posture: 'standing', turnsLost: 0, stamina: 1 };
      const blow = closeCombatBlow(rng, strong(), victim, weapon, undefined, 0, 1, false);
      expect(blow.exhausted).toBe(true);
      expect(blow.lethal).toBe(false);
      expect(victim.hp).toBe(100);
    }
  });

  it('a new fight (a fresh goal 13) starts again at 15', () => {
    const rng = new Rng(8);
    const victim = weak(), attacker = strong();
    closeCombatBlow(rng, attacker, victim, 'fist', undefined, 0, 1);
    expect(victim.closeCombat?.stamina).toBeLessThan(15);
    endCloseCombat(victim);
    const blow = closeCombatBlow(rng, attacker, victim, 'fist', undefined, 30, 1);
    expect(CLOSE_COMBAT_STAMINA - blow.stamina).toBeLessThanOrEqual(blow.entry[4]);
  });
});
