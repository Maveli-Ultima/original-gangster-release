import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { SCENARIOS, applyScenario } from '../src/app/scenarios';
import { TUTORIALS, applyTutorial } from '../src/app/tutorials';
import { useGame } from '../src/app/store';
import { createWorld } from '../src/sim/citygen';
import { generatedCitySize, potentialTerritoryCapacity, reconcileTerritorySetup,
  territorySetupMaximum, TerritoryTargetError } from '../src/sim/newGameValidation';
import { Sim } from '../src/sim/sim';

const options = () => ({ ...defaultGameOptions(), seed: 404 });

describe('new Territory campaign setup', () => {
  it('has a coherent standard default and preserves explicit scenario/lesson options', () => {
    const defaults = { ...options(), mode: 'territory' as const };
    expect(() => new Sim(defaults)).not.toThrow();
    for (const scenario of SCENARIOS) {
      const selected = applyScenario(options(), scenario);
      const sim = new Sim(selected);
      expect(sim.world.options).toEqual(selected);
      expect(sim.world.options.scenarioId).toBe(scenario.id);
    }
    for (const lesson of TUTORIALS) {
      const selected = applyTutorial(options(), lesson);
      expect(new Sim(selected).world.options).toEqual(selected);
    }
  });

  it.each([10, 11, 12, 13, 14, 15, 16, 17, 18])('reconciles the setup slider for a %i-block edge without changing the input', citySize => {
    const requested = { ...options(), mode: 'territory' as const, citySize, territoryTarget: 400 };
    const adjusted = reconcileTerritorySetup(requested);
    expect(adjusted.territoryTarget).toBeLessThanOrEqual(citySize * citySize);
    expect(adjusted.territoryTarget % 25).toBe(0);
    expect(adjusted.territoryTarget).toBe(territorySetupMaximum({ citySize }));
    expect(requested.territoryTarget).toBe(400);
  });

  it.each([0, -1, 1.5, NaN, Infinity, 197])('rejects invalid or oversized new targets (%s) before installing a world', territoryTarget => {
    const requested = { ...options(), mode: 'territory' as const, territoryTarget };
    useGame.getState().startGame(options());
    const existing = useGame.getState().sim, session = useGame.getState().worldSession;
    expect(() => createWorld(requested)).toThrow(TerritoryTargetError);
    expect(() => useGame.getState().startGame(requested)).toThrow(TerritoryTargetError);
    expect(useGame.getState().sim).toBe(existing);
    expect(useGame.getState().worldSession).toBe(session);
  });

  it.each([[126, 125], [137.5, 150], [149, 150], [61, 100], [99, 100], [176, 175]])(
    'snaps incoming setup target %s to the visible slider value %s without changing its source', (territoryTarget, expected) => {
      const source = { ...options(), mode: 'territory' as const, territoryTarget };
      const adjusted = reconcileTerritorySetup(source);
      expect(adjusted.territoryTarget).toBe(expected);
      expect((adjusted.territoryTarget - 100) % 25).toBe(0);
      expect(source.territoryTarget).toBe(territoryTarget);
    },
  );

  it('keeps a historical off-step objective intact when its separate setup copy is reconciled', () => {
    const sim = new Sim(options());
    sim.world.options.mode = 'territory'; sim.world.options.territoryTarget = 126;
    const saved = JSON.parse(JSON.stringify(sim.world));
    const restored = Sim.fromSave(saved);
    const setup = reconcileTerritorySetup({ ...restored.world.options });
    expect(setup.territoryTarget).toBe(125);
    expect(restored.world.options.territoryTarget).toBe(126);
    expect(saved.options.territoryTarget).toBe(126);
  });

  it('uses normalized generator dimensions rather than a larger requested size', () => {
    expect(generatedCitySize(100)).toBe(20);
    expect(() => new Sim({ ...options(), mode: 'territory', citySize: 100, territoryTarget: 401 })).toThrow('at most 400');
    expect(() => new Sim({ ...options(), citySize: NaN })).toThrow('whole number');
  });

  it('rejects a target that fits the grid but exceeds potential control in the generated city', () => {
    const normal = new Sim({ ...options(), citySize: 10 });
    const maximum = potentialTerritoryCapacity(normal.world);
    expect(maximum).toBeLessThan(normal.world.blocks.length);
    expect(() => new Sim({ ...options(), citySize: 10, mode: 'territory', territoryTarget: maximum + 1 }))
      .toThrow(`at most ${maximum}`);
    const adjusted = reconcileTerritorySetup({ ...options(), citySize: 10, mode: 'territory', territoryTarget: 100 }, maximum);
    expect(() => new Sim(adjusted)).not.toThrow();
  });

  it('needs one claimable business even among municipal neighbours; excludes empty centres', () => {
    const w = new Sim({ ...options(), citySize: 10 }).world;
    const block = w.blocks[0];
    w.blocks = [block];
    const sites = block.lotIds.map(id => w.buildings[w.lots[id].buildingId]);
    for (const b of sites) { b.cls = 'municipal'; b.typeId = 'school'; b.ownerGangId = null; b.protection = null; b.state = 'trading'; b.hidesId = null; }
    const edge = sites.filter(b => w.lots[b.lotId].index !== 4);
    const centre = sites.find(b => w.lots[b.lotId].index === 4)!;
    centre.cls = 'empty'; centre.ownerGangId = 1;
    expect(potentialTerritoryCapacity(w)).toBe(0);
    edge[0].cls = 'commercial'; edge[0].typeId = 'cafe';
    expect(potentialTerritoryCapacity(w)).toBe(1);
    edge[0].cls = 'empty'; edge[0].typeId = 'empty';
    expect(potentialTerritoryCapacity(w)).toBe(1); // that edge plot can host a legal site
  });

  it('preserves an explicit historical target through save loading', async () => {
    const sim = new Sim({ ...options(), citySize: 10 });
    sim.world.options.mode = 'territory'; sim.world.options.territoryTarget = 200;
    const state = JSON.parse(JSON.stringify(sim.world));
    expect(Sim.fromSave(state).world.options.territoryTarget).toBe(200);
    await useGame.getState().loadFromSlot({ id: 'historical', name: 'historical', savedAt: 0,
      week: sim.world.week, bossName: 'test', world: state });
    expect(useGame.getState().sim!.world.options.territoryTarget).toBe(200);
    expect(useGame.getState().screen).toBe('game');
    expect(state.options.territoryTarget).toBe(200);
  });
});
