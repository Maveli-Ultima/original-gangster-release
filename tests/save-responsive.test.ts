import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import * as saves from '../src/app/save';
import { useGame } from '../src/app/store';
import { Sim } from '../src/sim/sim';
import { validateSaveWorld, validateSaveWorldResponsive } from '../src/sim/saveSchema';
import type { WorldState } from '../src/sim/types';
import * as scheduling from '../src/yieldForInput';

let fixture: WorldState;
beforeAll(() => { fixture = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 }).world; });
afterEach(() => { vi.restoreAllMocks(); });

describe('responsive save validation', () => {
  it.each([undefined, 1, 2])('accepts schema %s without migrating or changing the snapshot', async version => {
    const world = structuredClone(fixture);
    world.schemaVersion = version;
    if (version !== 2) delete (world as Partial<WorldState>).sequences;
    const before = structuredClone(world);
    validateSaveWorld(world);
    expect(await validateSaveWorldResponsive(world)).toBe(world);
    expect(world).toEqual(before);
    const envelope = { id: 'Test', world, savedAt: 1, campaignId: 'test-campaign' };
    expect(await saves.decodeSlot(envelope, true)).toEqual(saves.decodeSlot(envelope));
  });

  const corruptions: [string, (w: WorldState) => void][] = [
    ['position', w => { delete (Object.values(w.people)[0] as Partial<WorldState['people'][number]>).pos; }],
    ['clock', w => { w.minute = NaN; }],
    ['dimensions', w => { w.gridW++; }],
    ['entity IDs', w => { Object.values(w.people)[0].id++; }],
    ['boss', w => { Object.values(w.gangs)[0].bossId = 99999999; }],
    ['roster', w => { Object.values(w.teams)[0].memberIds.push(99999999); }],
    ['city blocks', w => { w.blocks[0].lotIds.push(99999999); }],
    ['building lot', w => { Object.values(w.buildings)[0].lotId = 99999999; }],
    ['person gang', w => { Object.values(w.people)[0].gangId = 99999999; }],
    ['sequence', w => { w.sequences.crime = -1; }],
    ['ID reuse', w => { w.nextId = 1; }],
    ['player count', w => { for (const g of Object.values(w.gangs)) g.isPlayer = false; }],
    ['ending', w => { w.phase = 'gameOver'; delete (w as Partial<WorldState>).outcome; }],
  ];
  it.each(corruptions)('retains the exact %s error and does not publish a damaged world', async (_, change) => {
    const world = structuredClone(fixture);
    change(world);
    const before = structuredClone(world);
    const envelope = { id: 'Damaged', world };
    const expected = saves.decodeSlot(envelope);
    expect(expected.world).toBeNull();
    expect(expected.error).toBeTruthy();
    expect(await saves.decodeSlot(envelope, true)).toEqual(expected);
    expect(world).toEqual(before);
  });

  it.each([null, [], {}, { format: 900 }, { format: 2, worldJson: '{bad' }])('isolates malformed envelopes %j', async raw => {
    const expected = saves.decodeSlot(raw);
    expect(expected.world).toBeNull();
    expect(await saves.decodeSlot(raw, true)).toEqual(expected);
  });

  it('yields within a large collection before making the validated world available', async () => {
    const world = structuredClone(fixture), seen = new Set<number>();
    const people = Object.values(world.people);
    for (const person of people) {
      const id = person.id;
      Object.defineProperty(person, 'id', { enumerable: true, get() { seen.add(id); return id; } });
    }
    let now = 0, settled = false;
    vi.spyOn(performance, 'now').mockImplementation(() => now += 2);
    const partialCounts = new Set<number>();
    vi.spyOn(scheduling, 'yieldForInput').mockImplementation(async () => {
      expect(settled).toBe(false);
      if (seen.size && seen.size < people.length) partialCounts.add(seen.size);
    });
    const result = await validateSaveWorldResponsive(world);
    settled = true;
    expect(result).toBe(world);
    expect(seen.size).toBe(people.length);
    expect(partialCounts.size).toBeGreaterThan(2);
  });
});

describe('overlapping save-list refreshes', () => {
  it.each(['success', 'failure'] as const)('ignores an older %s after a newer result', async outcome => {
    let resolveOld!: (slots: saves.SaveSlot[]) => void;
    let rejectOld!: (error: Error) => void;
    const old = new Promise<saves.SaveSlot[]>((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
    const latest: saves.SaveSlot = { id: 'New', name: 'New', savedAt: 2, week: 1, bossName: 'Boss', world: fixture };
    vi.spyOn(saves, 'loadGame').mockReturnValueOnce(old).mockResolvedValueOnce([latest]);
    const pending = useGame.getState().refreshSaves();
    await useGame.getState().refreshSaves();
    if (outcome === 'success') resolveOld([]); else rejectOld(Error('Stale failure'));
    await pending;
    expect(useGame.getState().saves).toEqual([latest]);
    expect(useGame.getState().savesError).toBeNull();
  });

  it('does not clear a newer read failure when an older read finishes', async () => {
    let resolveOld!: (slots: saves.SaveSlot[]) => void;
    const old = new Promise<saves.SaveSlot[]>(resolve => { resolveOld = resolve; });
    vi.spyOn(saves, 'loadGame').mockReturnValueOnce(old).mockRejectedValueOnce(Error('Read denied'));
    const pending = useGame.getState().refreshSaves();
    await useGame.getState().refreshSaves();
    resolveOld([]);
    await pending;
    expect(useGame.getState().savesError).toContain('could not be read');
  });
});
