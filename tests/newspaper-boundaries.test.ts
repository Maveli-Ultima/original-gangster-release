import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { defaultGameOptions } from '../src/app/newGame';
import { SCENARIOS, applyScenario } from '../src/app/scenarios';
import { useGame } from '../src/app/store';
import { applyTutorial, TUTORIALS } from '../src/app/tutorials';
import { MINUTES_PER_WEEK } from '../src/sim/constants';
import { MINUTES_PER_SECOND } from '../src/sim/sim';

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const fresh = () => useGame.getState().startGame({ ...defaultGameOptions(), seed: 404, citySize: 10 });

async function settle(route: 'clock' | 'skip') {
  const sim = useGame.getState().sim!;
  sim.launchWeek(); sim.world.minute = MINUTES_PER_WEEK - 1;
  if (route === 'skip') await useGame.getState().finishWeek();
  else {
    useGame.getState().advance(1 / MINUTES_PER_SECOND);
    for (let step = 0; step < 100 && sim.world.phase === 'week'; step++) useGame.getState().advance(0);
    expect(sim.world.phase).not.toBe('week');
    await vi.waitFor(() => expect(useGame.getState().savingSnapshot).toBe(false));
  }
}

describe('newspaper planning boundaries', () => {
  it('opens the crew page for standard, scenario and lesson starts', () => {
    fresh(); expect(useGame.getState().organizerTab).toBe('lieutenants');
    useGame.getState().startGame(applyScenario(defaultGameOptions(), SCENARIOS[0]));
    expect(useGame.getState().organizerTab).toBe('lieutenants');
    for (const lesson of TUTORIALS) {
      useGame.getState().startGame(applyTutorial(defaultGameOptions(), lesson));
      expect(useGame.getState().organizerTab).toBe('lieutenants');
      expect(useGame.getState().sim!.world.tutorialActions?.lieutenantsViewed).toBeUndefined();
    }
  });

  it.each(['clock', 'skip'] as const)('opens news after %s settlement and clears hidden editor modes', async route => {
    fresh();
    const state = useGame.getState();
    state.setTab('accountant'); state.setSheet({ kind: 'hoods' });
    state.setOrganizerCollapsed(true); state.setPickMode({ kind: 'policeArea' });
    await settle(route);
    expect(useGame.getState().sim!.world.phase).toBe('planning');
    expect(useGame.getState()).toMatchObject({ organizerTab: 'newspaper', screen: 'game', sheet: null,
      pickMode: null, organizerCollapsed: false, jobCard: null });
  });

  it.each(['clock', 'skip'] as const)('keeps %s terminal outcomes on the ending screen', async route => {
    fresh();
    const sim = useGame.getState().sim!;
    sim.world.people[sim.playerGang.bossId].status = 'dead';
    useGame.getState().setTab('lawyer');
    await settle(route);
    expect(sim.world.phase).toBe('gameOver');
    expect(useGame.getState().screen).toBe('gameOver');
    expect(useGame.getState().organizerTab).toBe('lawyer');
  });

  it('does not reinterpret loading as a new campaign or alter its target', async () => {
    fresh();
    const sim = useGame.getState().sim!;
    const world = JSON.parse(JSON.stringify(sim.world));
    world.options.mode = 'territory'; world.options.territoryTarget = 200;
    await useGame.getState().loadFromSlot({ id: 'old', name: 'old', savedAt: 0, week: world.week, bossName: 'test', world });
    expect(useGame.getState().organizerTab).toBe('lieutenants');
    expect(useGame.getState().sim!.world.options.territoryTarget).toBe(200);
  });
});
