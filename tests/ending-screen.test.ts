import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { act, useGame } from '../src/app/store';
import { killPerson } from '../src/sim/execution';

vi.mock('../src/yieldForPaint', () => ({ yieldForPaint: vi.fn(async () => {}) }));
const autosave = useGame.getState().autosave;
beforeEach(() => {
  useGame.getState().startGame({ ...defaultGameOptions(), seed: 404, citySize: 10 });
  useGame.setState({ autosave: vi.fn(async () => true) });
});
afterEach(() => { useGame.setState({ autosave }); vi.restoreAllMocks(); });

describe('ending screen follows the simulation outcome', () => {
  it.each(['mutation', 'clock', 'skip', 'launch'] as const)('routes a %s ending and releases obsolete editor/loading controls', async route => {
    const state = useGame.getState(), sim = state.sim!;
    state.setTab('lawyer');
    state.beginOrder('extort', sim.playerGang.teamIds[0]);
    state.setSheet({ kind: 'hoods' });
    const die = () => killPerson(sim.world, sim.world.people[sim.playerGang.bossId], 'ending screen fixture');
    if (route === 'mutation') act(die);
    else if (route === 'launch') { die(); await state.launchWeek(); }
    else {
      die(); sim.launchWeek();
      useGame.setState({ paused: true });
      if (route === 'clock') state.advance(0);
      else await state.finishWeek();
    }
    expect(sim.world.phase).toBe('gameOver');
    expect(useGame.getState()).toMatchObject({ screen: 'gameOver', streetLoading: false, finishingWeek: false,
      organizerTab: 'lawyer', jobCard: null, specialistCard: null, sheet: null, pickMode: null });
    expect(sim.world.week).toBe(1); expect(sim.world.minute).toBe(0);
    expect(act(() => { sim.playerGang.cash++; })).toBeUndefined();
  });

  it('routes a qualifying initial target directly to its ending', () => {
    useGame.getState().startGame({ ...defaultGameOptions(), seed: 404, citySize: 10, mode: 'wealth', wealthTarget: 1 });
    expect(useGame.getState().sim!.world.phase).toBe('gameOver');
    expect(useGame.getState().screen).toBe('gameOver');
  });

  it('does not pull the user back out of the menu for an old terminal world', () => {
    const sim = useGame.getState().sim!;
    killPerson(sim.world, sim.world.people[sim.playerGang.bossId], 'ending screen fixture');
    sim.resolveImmediateOutcome();
    useGame.getState().setScreen('menu'); useGame.getState().bump();
    useGame.getState().advance(0);
    expect(useGame.getState().screen).toBe('menu');
  });
});
