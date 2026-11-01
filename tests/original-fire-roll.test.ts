import { describe, expect, it } from 'vitest';
import { ORIGINAL_CELL_METRES, originalFireOdds, originalFireReach } from '../src/sim/fireRoll';
import type { Person } from '../src/sim/types';

const person = (role: Person['role'], firearms: number, stealth: number) =>
  ({ role, skills: { firearms, stealth } }) as unknown as Person;

describe('original gunfire roll (0x516860 / 0x6F7490)', () => {
  it('reproduces the formula at equal skill', () => {
    // Equal tiers: chance = (m + 80) · base / 100; pistol base 50 at range 0.
    const a = person('hood', 5, 5), b = person('hood', 5, 5);
    let expected = 0;
    for (let m = 0; m < 40; m++) expected += Math.max(0, Math.trunc((m + 80) * 50 / 100) - 1) / 100;
    expect(originalFireOdds(a, b, 'pistol', 1).hit).toBeCloseTo(expected / 40, 10);
    expect(originalFireOdds(a, b, 'pistol', 1).killGivenHit).toBe(0.5);   // 1 1 2 2 | 3 3 4 4
  });

  it('uses range in original cells and the per-weapon rows', () => {
    const a = person('hood', 5, 0.5), b = person('hood', 0.5, 0.5);
    const cell = ORIGINAL_CELL_METRES;
    expect(originalFireOdds(a, b, 'pistol', 5 * cell + 1).hit).toBe(0);    // pistol row ends at r4
    const even = person('hood', 3, 3);   // rifle row: 34 point-blank, 50 at one to three cells
    expect(originalFireOdds(even, even, 'rifle', 2 * cell).hit).toBeGreaterThan(originalFireOdds(even, even, 'rifle', 0).hit);
    expect(originalFireOdds(a, b, 'shotgun', 1 * cell).hit).toBe(1);       // base 100, skilled attacker
    // Twin pistols: their own Hit row (60 45 30 26 22 20 15 0), the pistol's damage.
    expect(originalFireOdds(even, even, 'twinPistols', cell).hit).toBeGreaterThan(originalFireOdds(even, even, 'pistol', cell).hit);
    expect(originalFireOdds(a, b, 'twinPistols', cell).killGivenHit).toBe(originalFireOdds(a, b, 'pistol', cell).killGivenHit);
    expect(originalFireOdds(a, b, 'twinPistols', 5 * cell + 1).hit).toBeGreaterThan(0);   // pistol is 0 here
    expect(originalFireOdds(a, b, 'twinPistols', 5 * cell + 1).killGivenHit).toBe(0);    // unread damage block
    expect(originalFireReach('twinPistols')).toBeCloseTo(7 * cell);
    expect(originalFireReach('pistol')).toBeCloseTo(5 * cell);
    expect(originalFireReach('rifle')).toBeCloseTo(7 * cell);
  });

  it('lets gang members and police dodge with stealth; civilians roll 1..4', () => {
    const a = person('hood', 3, 3);
    const agile = originalFireOdds(a, person('hood', 1, 5), 'pistol', 1).hit;
    const clumsy = originalFireOdds(a, person('hood', 1, 0.5), 'pistol', 1).hit;
    expect(agile).toBeLessThan(clumsy);
    const citizen = originalFireOdds(a, person('citizen', 1, 5), 'pistol', 1).hit;
    expect(citizen).toBe(originalFireOdds(a, person('citizen', 1, 0.5), 'pistol', 1).hit);
  });
});
