import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBDatabase } from 'fake-indexeddb';
import { defaultGameOptions } from '../src/app/newGame';
import { decodeSlot, deleteSave, loadGame, saveGame } from '../src/app/save';
import { useGame } from '../src/app/store';
import { issueOrder, previewOrder, type IssueOrderInput } from '../src/sim/api';
import { isValidAreaTarget } from '../src/sim/execution';
import { MINUTES_PER_WEEK } from '../src/sim/constants';
import { addMessage, recordCrime } from '../src/sim/events';
import { validateSaveWorld } from '../src/sim/saveSchema';
import { Sim } from '../src/sim/sim';
import { weeklyLaw } from '../src/sim/systems/law';
import type { WorldState } from '../src/sim/types';
import { staffFirstCrew } from './helpers/crew';

const fixture = () => {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, startHoods: 8 });
  staffFirstCrew(sim);
  return sim;
};
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('shared job estimates', () => {
  it.each(['patrol', 'extort', 'recruit', 'goTo', 'bribe'] as const)('%s preview matches acceptance without changing the world', type => {
    const sim = fixture(), w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
    const input: IssueOrderInput = { type, teamId: team.id, blockIds: [0, 1], pos: w.blocks[1].center,
      opts: { manpower: 1, priority: true, repeat: true } };
    if (type === 'bribe') input.personId = w.policeChiefId;
    if (type === 'recruit') { input.blockIds = []; input.buildingIds = Object.values(w.buildings).filter(b => isValidAreaTarget(w, gang.id, type, b)).slice(0, 1).map(b => b.id); }
    if (type === 'extort') { input.blockIds = []; input.buildingIds = Object.values(w.buildings).filter(b => isValidAreaTarget(w, gang.id, type, b)).slice(0, 1).map(b => b.id); }
    const before = JSON.stringify(w), rng = sim.rng.state;
    const draft = previewOrder(w, gang.id, input)!;
    expect(JSON.stringify(w)).toBe(before); expect(sim.rng.state).toBe(rng);
    expect(draft.estimatedMinutes).toBeGreaterThan(0);
    const result = issueOrder(w, gang.id, input);
    expect(result).toMatchObject({ ok: true });
    const accepted = Object.values(w.orders).filter(o => o.teamId === team.id).at(-1)!;
    expect(accepted.estimatedMinutes).toBe(draft.estimatedMinutes);
    expect(accepted.targetBuildingIds).toEqual(draft.targetBuildingIds);
    expect(accepted.hunting).toBe(draft.hunting);
  });
  it('uses the same remaining-week boundary and responds to manpower and crew skill', () => {
    const sim = fixture(), w = sim.world, g = sim.playerGang, t = w.teams[g.teamIds[0]];
    const input: IssueOrderInput = { type: 'patrol', teamId: t.id, blockIds: [0, 1, 2], opts: { manpower: 1 } };
    const first = previewOrder(w, g.id, input)!.estimatedMinutes;
    input.opts!.manpower = 3;
    w.people[t.lieutenantId].skills.organization = 5;
    const estimate = previewOrder(w, g.id, input)!.estimatedMinutes;
    expect(estimate).not.toBe(first);
    t.timeUsed = MINUTES_PER_WEEK * 1.02 - estimate + 1;
    expect(issueOrder(w, g.id, input).ok).toBe(false);
    t.timeUsed = MINUTES_PER_WEEK * 1.02 - estimate - 1;
    expect(issueOrder(w, g.id, input).ok).toBe(true);
  });
  it('includes eight-site travel, crew quality and person hunting in the preview', () => {
    const sim = fixture(), w = sim.world, g = sim.playerGang, t = w.teams[g.teamIds[0]];
    const sites = Object.values(w.buildings).filter(b => isValidAreaTarget(w, g.id, 'extort', b)).slice(0, 8).map(b => b.id);
    const input: IssueOrderInput = { type: 'extort', teamId: t.id, buildingIds: sites, opts: { manpower: 1 } };
    const first = previewOrder(w, g.id, input)!;
    expect(first.targetBuildingIds).toHaveLength(8);
    const lt = w.people[t.lieutenantId]; lt.skills.organization = lt.skills.intelligence = 5;
    expect(previewOrder(w, g.id, input)!.estimatedMinutes).toBeLessThan(first.estimatedMinutes);
    // Move far enough to exceed minute rounding even in a fast car.
    const last = w.lots[w.buildings[sites[7]].lotId]; last.center.x += 200;
    const moved = previewOrder(w, g.id, input)!.estimatedMinutes;
    last.center.x -= 200;
    expect(previewOrder(w, g.id, input)!.estimatedMinutes).not.toBe(moved);
    input.opts!.manpower = 2;
    const preview = previewOrder(w, g.id, input)!;
    expect(issueOrder(w, g.id, input)).toMatchObject({ ok: true });
    expect(Object.values(w.orders).find(o => o.teamId === t.id)!.estimatedMinutes).toBe(preview.estimatedMinutes);
    const rival = Object.values(w.gangs).find(x => !x.isPlayer)!;
    const person = w.people[rival.bossId];
    const huntInput: IssueOrderInput = { type: 'bribe', teamId: t.id, personId: person.id };
    g.knownPeople = g.knownPeople.filter(id => id !== person.id);
    const unknown = previewOrder(w, g.id, huntInput)!;
    expect(unknown.hunting).toBe(true);
    g.knownPeople.push(person.id);
    const known = previewOrder(w, g.id, huntInput)!;
    expect(known.hunting).toBeUndefined();
    expect(unknown.estimatedMinutes).toBeGreaterThan(known.estimatedMinutes);
  });
});

function evidence(sim: Sim) {
  const w = sim.world, g = sim.playerGang, p = w.people[w.teams[g.teamIds[0]].lieutenantId];
  addMessage(w, 'police', 'Sequence probe');
  recordCrime(w, sim.rng, { gangId: g.id, perpetratorId: p.id, type: 'streetKill', pos: p.pos });
  p.status = 'arrested';
  weeklyLaw(w, sim.rng);
  w.rngState = sim.rng.state;
}
describe('world-local sequences', () => {
  it('alternating construction, load and advancement preserves all records and RNG', () => {
    const a = fixture(); evidence(a);
    const uninterrupted = Sim.fromSave(clone(a.world));
    const b = fixture(); evidence(b); evidence(b);
    const loadedB = Sim.fromSave(clone(b.world)); evidence(loadedB);
    evidence(a); evidence(uninterrupted);
    a.launchWeek(); uninterrupted.launchWeek();
    for (let i = 0; i < 3; i++) { a.advance(2, 1); loadedB.advance(2, 1); uninterrupted.advance(2, 1); }
    expect(a.world).toEqual(uninterrupted.world);
    expect(a.rng.state).toBe(uninterrupted.rng.state);
    for (const sim of [a, b, loadedB]) {
      for (const records of [sim.world.messages, sim.world.crimes, Object.values(sim.world.cases)])
        expect(new Set(records.map(x => x.id)).size).toBe(records.length);
    }
  });
  it('migrates old counters above existing IDs, and keeps counters after log pruning', () => {
    const sim = fixture(); evidence(sim);
    const old = clone(sim.world); delete (old as Partial<WorldState>).sequences; delete old.schemaVersion;
    const restored = Sim.fromSave(old);
    expect(restored.world.sequences.court).toBeGreaterThan(Math.max(...Object.values(old.cases).map(c => c.id)));
    const saved = clone(restored.world), counters = { ...saved.sequences };
    saved.messages = []; saved.crimes = []; saved.cases = {};
    expect(Sim.fromSave(saved).world.sequences).toEqual(counters);
    const stale = clone(sim.world); stale.sequences = { message: 1, crime: 1, court: 1 };
    const repaired = Sim.fromSave(stale);
    expect(repaired.world.sequences).toEqual(sim.world.sequences);
  });
});

describe('save schema and failure isolation', () => {
  it.each([
    ['missing people', (w: any) => { delete w.people; }],
    ['wrong cash', (w: any) => { Object.values<any>(w.gangs)[0].cash = 'rich'; }],
    ['missing position', (w: any) => { delete Object.values<any>(w.people)[0].pos; }],
    ['non-finite number', (w: any) => { w.minute = NaN; }],
    ['invalid option', (w: any) => { w.options.mode = 'unknown'; }],
    ['missing boss', (w: any) => { Object.values<any>(w.gangs)[0].bossId = 99999999; }],
    ['future version', (w: any) => { w.schemaVersion = 900; }],
    ['bad sequence', (w: any) => { w.sequences.crime = -2; }],
    ['missing current counters', (w: any) => { delete w.sequences; }],
    ['reused entity ID', (w: any) => { w.nextId = 1; }],
    ['duplicate event IDs', (w: any) => { w.messages = [{ id: 1, minute: 0, category: 'police', text: 'one', pos: null, personId: null }, { id: 1, minute: 0, category: 'police', text: 'two', pos: null, personId: null }]; }],
    ['unfinished ending', (w: any) => { w.phase = 'gameOver'; delete w.outcome; }],
  ])('rejects %s before replacing an active world', async (_, change) => {
    const sim = fixture(), bad = clone(sim.world); change(bad);
    expect(() => validateSaveWorld(bad)).toThrow();
    expect(() => Sim.fromSave(bad)).toThrow();
    useGame.setState({ sim });
    await useGame.getState().loadFromSlot({ id: 'bad', name: 'Bad', savedAt: 0, week: 1, bossName: '', world: bad });
    expect(useGame.getState().sim).toBe(sim);
    expect(useGame.getState().toast?.bad).toBe(true);
  });
  it('accepts current, legacy object and JSON saves; isolates malformed slots', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const sim = fixture(), old = clone(sim.world);
    delete old.schemaVersion; delete (old as Partial<WorldState>).sequences;
    for (const g of Object.values(old.gangs)) delete g.finances;
    expect(decodeSlot({ id: 'old', world: old }).error).toBeUndefined();
    expect(Sim.fromSave(old).playerGang.finances?.partial).toBe(true);
    await saveGame('Healthy', sim.world);
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('original-gangster', 1); req.onsuccess = () => resolve(req.result); });
    await new Promise<void>(resolve => { const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put({ id: 'Broken', name: 'Broken', format: 2, worldJson: '{bad' }); tx.oncomplete = () => resolve(); }); db.close();
    const slots = await loadGame();
    expect(slots).toHaveLength(2);
    expect(slots.find(s => s.id === 'Healthy')?.world).toEqual(sim.world);
    expect(slots.find(s => s.id === 'Broken')).toMatchObject({ world: null, error: expect.any(String) });
    expect((await loadGame()).map(s => s.id).sort()).toEqual(['Broken', 'Healthy']);
  });
  it('reports read failures while preserving known slots, and retry recovers', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    await saveGame('Kept', fixture().world); await useGame.getState().refreshSaves();
    const original = indexedDB.open.bind(indexedDB);
    const spy = vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw Error('Read denied'); });
    await expect(loadGame()).rejects.toThrow('Read denied');
    await useGame.getState().refreshSaves();
    expect(useGame.getState().savesError).toContain('could not be read');
    expect(useGame.getState().saves[0].id).toBe('Kept');
    spy.mockImplementation(original); await useGame.getState().refreshSaves();
    expect(useGame.getState().savesError).toBeNull();
  });
  it('rejects aborted reads/deletes and retains the existing slot', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory()); await saveGame('Kept', fixture().world);
    const original = IDBDatabase.prototype.transaction;
    const spy = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args) {
      const tx = original.apply(this, args); queueMicrotask(() => tx.abort()); return tx;
    });
    await expect(loadGame()).rejects.toThrow(); await expect(deleteSave('Kept')).rejects.toThrow();
    spy.mockRestore(); expect((await loadGame())[0].id).toBe('Kept');
  });
});
