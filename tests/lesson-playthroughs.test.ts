import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { applyTutorial, captureTutorialProgress, TUTORIALS } from '../src/app/tutorials';
import { useGame } from '../src/app/store';
import { Sim } from '../src/sim/sim';
import { playLesson } from './helpers/lesson-player';

describe('complete lessons through public game actions', () => {
  it.each(TUTORIALS)('completes $name with a mid-lesson save/load', async tutorial => {
    useGame.getState().startGame(applyTutorial(defaultGameOptions(), tutorial));
    const result = await playLesson({
      sim: () => useGame.getState().sim!,
      changed: async () => { useGame.getState().bump(); },
      visit: async view => { useGame.getState().recordTutorialVisit(view); },
      week: async () => {
        const s = useGame.getState().sim!;
        s.launchWeek(); useGame.getState().bump();
        // Observe the live lesson during the week, as the browser card does.
        // A business opened successfully may be raided before Friday's report.
        while (s.world.phase === 'week') { s.finishWeekSlice(); captureTutorialProgress(s.world); }
        useGame.getState().bump();
      },
      checkpoint: async () => {
        const sim = useGame.getState().sim!;
        const restored = Sim.fromSave(JSON.parse(JSON.stringify(sim.world)));
        useGame.setState({ sim: restored });
      },
    });
    expect(result.completed.slice().sort()).toEqual([0, 1, 2, 3, 4]);
    expect(result.checkpointed).toBe(true);
  }, 180000);
});
