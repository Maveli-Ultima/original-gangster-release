import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { Sim } from '../src/sim/sim';
import { Rng } from '../src/sim/rng';
import { weeklyEconomy } from '../src/sim/systems/economy';

describe('economy and opponent setup controls', () => {
  it.each(['weak', 'normal', 'strong'] as const)('preserves %s economy with every explicit opponent setting through save/restore', economy => {
    for (const opponents of ['passive', 'normal', 'aggressive'] as const) {
      const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, economy, opponents });
      expect(Object.values(sim.world.gangs).filter(g => !g.isPlayer).map(g => g.personality)).toEqual([opponents, opponents, opponents]);
      const restored = Sim.fromSave(structuredClone(sim.world));
      expect(restored.world).toEqual(sim.world);
      expect(restored.world.options).toMatchObject({ economy, opponents });
    }
  });

  it('changes actual legal receipts in the expected direction without changing wages', () => {
    const base = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, startMoney: 100_000 });
    const samples = (['weak', 'normal', 'strong'] as const).map(economy => {
      const sim = Sim.fromSave(structuredClone(base.world));
      sim.world.options.economy = economy;
      weeklyEconomy(sim.world, new Rng(1928));
      return { economy, income: sim.playerGang.lastWeekIncome.legal, wages: sim.playerGang.lastWeekCosts.wages };
    });
    expect(samples[0].income).toBeGreaterThan(0);
    expect(samples[0].income).toBeLessThan(samples[1].income);
    expect(samples[1].income).toBeLessThan(samples[2].income);
    expect(new Set(samples.map(s => s.wages)).size).toBe(1);
  });

  it('draws Random opponents from the three real personalities and preserves the result', () => {
    const observed = new Set<string>();
    for (const seed of [1, 7, 29, 42, 97, 404, 1928, 1931]) {
      const sim = new Sim({ ...defaultGameOptions(), seed, citySize: 10, opponents: 'random' });
      const personalities = Object.values(sim.world.gangs).filter(g => !g.isPlayer).map(g => g.personality);
      personalities.forEach(p => observed.add(p));
      const restored = Sim.fromSave(structuredClone(sim.world));
      expect(Object.values(restored.world.gangs).filter(g => !g.isPlayer).map(g => g.personality)).toEqual(personalities);
    }
    expect([...observed].sort()).toEqual(['aggressive', 'normal', 'passive']);
  });
});
