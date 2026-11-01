import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { planGang } from '../src/sim/ai';
import { Sim } from '../src/sim/sim';
import { allBuildings, powerRating } from '../src/sim/world';

afterEach(() => vi.restoreAllMocks());
describe('opponent personality, manual p.31', () => {
  it.each(['passive', 'normal', 'aggressive'] as const)('does not let superior wealth turn %s into a different personality', personality => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 });
    const w = sim.world, gang = Object.values(w.gangs).find(g => !g.isPlayer)!;
    const rival = sim.playerGang;
    for (const other of Object.values(w.gangs)) if (other.id !== gang.id && other.id !== rival.id) other.eliminated = true;
    gang.personality = personality; gang.cash = 5_000_000;
    gang.offered[rival.id] = 'peace'; gang.known[rival.id] = 'peace';
    expect(powerRating(w, gang) / powerRating(w, rival)).toBeGreaterThan(10);
    vi.spyOn(sim.rng, 'chance').mockImplementation(chance => chance > 0);
    planGang(w, sim.rng, gang);
    expect(gang.offered[rival.id]).toBe(personality === 'passive' ? 'peace' : 'war');
  });

  it.each(['passive', 'normal', 'aggressive'] as const)('still lets a %s gang retaliate against declared warfare', personality => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 });
    const w = sim.world, gang = Object.values(w.gangs).find(g => !g.isPlayer)!;
    gang.personality = personality;
    gang.offered[sim.playerGang.id] = 'peace'; gang.known[sim.playerGang.id] = 'war';
    vi.spyOn(sim.rng, 'chance').mockReturnValue(false);
    planGang(w, sim.rng, gang);
    expect(gang.offered[sim.playerGang.id]).toBe('war');
  });
});
describe('Aggression encounters versus Gang Warfare plots (manual p.50)', () => {
  it.each(['aggression', 'war'] as const)('only deliberately plans rival hits at %s when diplomacy remains fixed', level => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 });
    const w = sim.world, gang = Object.values(w.gangs).find(g => !g.isPlayer)!;
    gang.cash = 500_000; gang.personality = 'aggressive';
    w.orders = {};
    for (const team of Object.values(w.teams)) { team.orderIds = []; team.timeUsed = 0; }
    for (const other of Object.values(w.gangs)) if (other.id !== gang.id) {
      gang.offered[other.id] = level; gang.known[other.id] = level;
    }
    for (const b of allBuildings(w)) {
      b.protection = null; b.knowledge[gang.id] = 4;
      // Occupied premises remove unrelated Extort work from this policy fixture.
      if (b.ownerGangId == null && b.cls !== 'empty') b.ownerGangId = sim.playerGang.id;
    }
    gang.knownPeople = Object.values(w.people).filter(p => p.gangId != null && p.gangId !== gang.id).map(p => p.id);
    // Hold diplomacy changes off; make available planning opportunities happen.
    vi.spyOn(sim.rng, 'chance').mockImplementation(p => p !== 0.25 && p !== 0.4);
    planGang(w, sim.rng, gang);
    expect(gang.offered[sim.playerGang.id]).toBe(level);
    const plots = Object.values(w.orders).filter(o => o.gangId === gang.id &&
      ['smashUp', 'torch', 'raid', 'bomb', 'kill', 'kidnap'].includes(o.type));
    expect(plots.length > 0).toBe(level === 'war');
  });
});
