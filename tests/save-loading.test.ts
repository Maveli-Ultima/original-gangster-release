import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { act, useGame } from '../src/app/store';
import { cloneSavedWorld, cloneSavedWorldResponsive, type SaveSlot } from '../src/app/save';
import { Sim } from '../src/sim/sim';
import type { WorldState } from '../src/sim/types';

const options = { ...defaultGameOptions(), seed: 404, citySize: 10 };
const copy = (world: WorldState): WorldState => JSON.parse(JSON.stringify(world));
function slot(name = 'Saved city'): SaveSlot {
  const world = copy(useGame.getState().sim!.world);
  return { id: name, name, week: world.week, savedAt: 0, bossName: 'Test', world };
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function holdNextRestore(staleFailure = false) {
  const started = gate(), release = gate(), original = Sim.fromSaveResponsive;
  const spy = vi.spyOn(Sim, 'fromSaveResponsive').mockImplementationOnce(async (world, signal) => {
    started.resolve();
    await release.promise;
    if (staleFailure) throw Error('An older request failed');
    return original(world, signal);
  });
  return { started, release, spy };
}

beforeEach(() => useGame.getState().startGame(options));
afterEach(() => { useGame.getState().cancelLoad(); vi.restoreAllMocks(); });

describe('responsive save restoration', () => {
  it.each(['current', 'legacy', 'sparse'])('copies the complete %s snapshot like the synchronous clone', async format => {
    const world = useGame.getState().sim!.world;
    if (format === 'legacy') {
      delete (world as Partial<WorldState>).schemaVersion;
      delete (world as Partial<WorldState>).sequences;
      for (const gang of Object.values(world.gangs)) delete gang.finances;
    }
    if (format === 'sparse') delete world.blocks[0];
    const expected = cloneSavedWorld(world);
    const snapshot = await cloneSavedWorldResponsive(world);
    expect(snapshot).toEqual(expected);
    expect(snapshot).not.toBe(world);
    snapshot.people[Object.values(snapshot.people)[0].id].name = 'Changed only in copy';
    expect(cloneSavedWorld(world)).toEqual(expected);
  });

  it('cancels copying between serialization batches without changing the source', async () => {
    const world = useGame.getState().sim!.world, before = copy(world);
    const controller = new AbortController();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now += 4);
    const pending = cloneSavedWorldResponsive(world, controller.signal);
    queueMicrotask(() => controller.abort());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(world).toEqual(before);
  });

  it.each(['current', 'legacy'])('matches synchronous restoration and continued simulation for %s saves', async format => {
    const world = copy(useGame.getState().sim!.world);
    if (format === 'legacy') {
      delete (world as Partial<WorldState>).schemaVersion;
      delete (world as Partial<WorldState>).sequences;
      for (const gang of Object.values(world.gangs)) delete gang.finances;
    }
    const original = copy(world);
    const synchronous = Sim.fromSave(copy(world));
    const responsive = await Sim.fromSaveResponsive(copy(world));
    expect(responsive.world).toEqual(synchronous.world);
    synchronous.launchWeek(); responsive.launchWeek();
    synchronous.advance(1, 2); responsive.advance(1, 2);
    expect(responsive.world).toEqual(synchronous.world);
    expect(responsive.rng.state).toBe(synchronous.rng.state);
    expect(world).toEqual(original);
  });

  it('aborts between real validation batches without migrating its snapshot', async () => {
    const world = copy(useGame.getState().sim!.world), before = copy(world);
    const controller = new AbortController();
    const pending = Sim.fromSaveResponsive(world, controller.signal);
    queueMicrotask(() => controller.abort());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(world).toEqual(before);
  });

  it('installs independent copies and can reload the same saved world twice', async () => {
    const saved = slot(), original = copy(saved.world!);
    expect(await useGame.getState().loadFromSlot(saved)).toBe(true);
    useGame.getState().sim!.playerGang.cash = 123;
    expect(saved.world).toEqual(original);
    expect(await useGame.getState().loadFromSlot(saved)).toBe(true);
    expect(useGame.getState().sim!.world).toEqual(original);
    expect(useGame.getState().loadingSave).toBeNull();
  });

  it('holds the active clock and preserves pause state when cancelled before validation', async () => {
    const active = useGame.getState().sim!;
    active.launchWeek();
    const saved = slot();
    useGame.getState().setPaused(false);
    const before = copy(active.world);
    const pending = useGame.getState().loadFromSlot(saved);
    expect(useGame.getState().loadingSave).toBe(saved.name);
    useGame.getState().advance(10);
    const mutation = vi.fn();
    expect(act(mutation)).toBeUndefined();
    expect(mutation).not.toHaveBeenCalled();
    expect(active.world).toEqual(before);
    useGame.getState().cancelLoad();
    expect(await pending).toBe(false);
    expect(useGame.getState().sim).toBe(active);
    expect(useGame.getState()).toMatchObject({ loadingSave: null, paused: false, toast: null });
  });

  it('cancels an in-flight restoration without replacing the current world', async () => {
    const active = useGame.getState().sim!, held = holdNextRestore();
    const pending = useGame.getState().loadFromSlot(slot());
    await held.started.promise;
    useGame.getState().cancelLoad();
    held.release.resolve();
    expect(await pending).toBe(false);
    expect(useGame.getState().sim).toBe(active);
    expect(useGame.getState()).toMatchObject({ loadingSave: null, toast: null });
  });

  it.each(['cancel', 'restore'])('holds an End Week run while loading, then handles %s', async action => {
    const active = useGame.getState().sim!, saved = slot(), held = holdNextRestore();
    active.launchWeek();
    const slice = vi.spyOn(active, 'finishWeekSlice').mockImplementation(() => useGame.getState().cancelFinishWeek());
    const skipping = useGame.getState().finishWeek();
    const loading = useGame.getState().loadFromSlot(saved);
    await held.started.promise;
    // Several actual yields allow the already-scheduled End Week loop to run.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(slice).not.toHaveBeenCalled();
    if (action === 'cancel') useGame.getState().cancelLoad();
    held.release.resolve();
    expect(await loading).toBe(action === 'restore');
    await skipping;
    expect(slice).toHaveBeenCalledTimes(action === 'cancel' ? 1 : 0);
    expect(useGame.getState().finishingWeek).toBe(false);
    expect(useGame.getState().loadingSave).toBeNull();
    expect(useGame.getState().sim === active).toBe(action === 'cancel');
  });

  it('keeps the newer request and suppresses an older failure and cleanup', async () => {
    const held = holdNextRestore(true);
    const older = useGame.getState().loadFromSlot(slot('First'));
    await held.started.promise;
    const saved = slot('Second');
    Object.values(saved.world!.gangs).find(g => g.isPlayer)!.cash = 9876;
    const newer = useGame.getState().loadFromSlot(saved);
    held.release.resolve();
    expect(await older).toBe(false);
    expect(useGame.getState().loadingSave).toBe('Second');
    expect(await newer).toBe(true);
    expect(useGame.getState().sim!.playerGang.cash).toBe(9876);
    expect(useGame.getState()).toMatchObject({ loadingSave: null, toast: null });
  });

  it.each(['navigation', 'new game'])('does not publish an older load after %s', async action => {
    const held = holdNextRestore(), active = useGame.getState().sim!;
    const pending = useGame.getState().loadFromSlot(slot());
    await held.started.promise;
    if (action === 'navigation') useGame.getState().setScreen('newGame');
    else useGame.getState().startGame({ ...options, seed: 42 });
    const replacement = useGame.getState().sim;
    held.release.resolve();
    expect(await pending).toBe(false);
    expect(useGame.getState().sim).toBe(replacement);
    expect(useGame.getState().loadingSave).toBeNull();
    if (action === 'navigation') {
      expect(replacement).toBe(active);
      expect(useGame.getState().screen).toBe('newGame');
    } else expect(replacement!.world.options.seed).toBe(42);
  });

  it('rejects a damaged snapshot after yielding and leaves the active world intact', async () => {
    const active = useGame.getState().sim!, damaged = slot();
    Object.values(damaged.world!.gangs).find(g => g.isPlayer)!.bossId = 99999999;
    expect(await useGame.getState().loadFromSlot(damaged)).toBe(false);
    expect(useGame.getState().sim).toBe(active);
    expect(useGame.getState().loadingSave).toBeNull();
    expect(useGame.getState().toast).toMatchObject({ bad: true, text: 'Save has a missing boss or crew.' });
  });
});
