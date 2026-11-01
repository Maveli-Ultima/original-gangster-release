import { describe, expect, it } from 'vitest';
import { useGame } from '../src/app/store';
import { defaultGameOptions } from '../src/app/newGame';
import { applyTutorial, captureTutorialProgress, TUTORIALS } from '../src/app/tutorials';
import { Sim } from '../src/sim/sim';
import type { SaveSlot } from '../src/app/save';

function slot(sim: Sim): SaveSlot {
  return { id: 'test', name: 'test', savedAt: 0, week: sim.world.week, bossName: 'test', world: structuredClone(sim.world) };
}

describe('world and tutorial lifecycle', () => {
  it.each(['new', 'load'] as const)('resets transient store and component sessions on %s', async transition => {
    const options = { ...defaultGameOptions(), seed: 404, citySize: 10 };
    useGame.getState().startGame(options);
    const saved = slot(useGame.getState().sim!);
    const session = useGame.getState().worldSession;
    useGame.setState({ helpOpen: true, quitPrompt: true, selectedPersonIds: [999],
      policeAreaBlockIds: [9], cameraRequest: { x: 42, y: 13 }, selectedStreetIds: [1],
      planningView: 'city', finishingWeek: true, messageOverride: true,
      autoLowerRoofs: true, messageFilter: { combat: false, police: true, failed: true, waiting: true } });
    if (transition === 'new') useGame.getState().startGame(options);
    else await useGame.getState().loadFromSlot(saved);
    expect(useGame.getState()).toMatchObject({ helpOpen: false, quitPrompt: false,
      selectedPersonIds: [], policeAreaBlockIds: [], cameraRequest: null,
      selectedStreetIds: [], planningView: 'plan', finishingWeek: false,
      messageOverride: false, autoLowerRoofs: true, messageFilter: { combat: false } });
    expect(useGame.getState().worldSession).toBe(session + 1);
  });

  it('routes a terminal save directly to the ending', async () => {
    const sim = new Sim({ ...defaultGameOptions(), citySize: 10 });
    sim.world.phase = 'gameOver';
    sim.world.outcome = { won: false, reason: 'Test ending', score: 0 };
    await useGame.getState().loadFromSlot(slot(sim));
    expect(useGame.getState().screen).toBe('gameOver');
  });

  it('keeps observed steps across save/load and clears them for a restart or different lesson', async () => {
    const options = applyTutorial(defaultGameOptions(), TUTORIALS[3]);
    useGame.getState().startGame(options);
    const sim = useGame.getState().sim!;
    sim.playerGang.offered[2] = 'war';
    useGame.getState().bump();
    sim.playerGang.offered[2] = 'peace';
    const saved = slot(sim);
    useGame.getState().setScreen('menu');
    await useGame.getState().loadFromSlot(saved);
    expect(useGame.getState().sim!.world.tutorialProgress?.completed).toContain(2);
    useGame.getState().startGame(options);
    expect(useGame.getState().sim!.world.tutorialProgress).toBeUndefined();
    const next = useGame.getState().sim!.world;
    next.tutorialProgress = { lessonId: 4, completed: [0, 1, 2, 3, 4] };
    next.options.tutorialId = 1;
    expect(captureTutorialProgress(next)).toEqual([]);
  });

  it('requires actual page/report visits, and reports from a completed week', () => {
    useGame.getState().startGame(applyTutorial(defaultGameOptions(), TUTORIALS[0]));
    const sim = useGame.getState().sim!;
    const steps = TUTORIALS[0].steps;
    useGame.getState().recordTutorialVisit('reportsViewed');
    expect(steps[4].done(sim.world, sim.playerGang.id)).toBe(false);
    sim.world.week = 2;
    expect(steps[0].done(sim.world, sim.playerGang.id)).toBe(false);
    expect(steps[4].done(sim.world, sim.playerGang.id)).toBe(false);
    useGame.getState().recordTutorialVisit('lieutenantsViewed');
    useGame.getState().recordTutorialVisit('reportsViewed');
    expect(steps[0].done(sim.world, sim.playerGang.id)).toBe(true);
    expect(steps[4].done(sim.world, sim.playerGang.id)).toBe(true);
  });

  it('excludes empty/destroyed sites and requires an available legal front on the centre block', () => {
    const sim = new Sim(applyTutorial(defaultGameOptions(), TUTORIALS[1]));
    const w = sim.world, g = sim.playerGang.id;
    const [ , second, centre] = TUTORIALS[1].steps;
    const plot = Object.values(w.buildings).find(b => w.lots[b.lotId].index === 4 && b.ownerGangId == null)!;
    plot.ownerGangId = g;
    plot.cls = 'empty';
    expect(second.done(w, g)).toBe(false);
    expect(centre.done(w, g)).toBe(false);
    const front = Object.values(w.buildings).find(b => b.blockId === plot.blockId && w.lots[b.lotId].index !== 4)!;
    front.ownerGangId = g; front.cls = 'commercial'; front.state = 'trading'; front.hidesId = null;
    expect(second.done(w, g)).toBe(true);
    expect(centre.done(w, g)).toBe(true);
    front.state = 'destroyed';
    expect(second.done(w, g)).toBe(false);
    expect(centre.done(w, g)).toBe(false);
    front.state = 'trading'; front.hidesId = 999;
    expect(centre.done(w, g)).toBe(false);
    front.hidesId = null; front.ownerGangId = 999;
    expect(centre.done(w, g)).toBe(false);
  });
});
