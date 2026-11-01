import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { recordHallOfFame } from '../src/app/save';
import { useGame } from '../src/app/store';
import { Sim } from '../src/sim/sim';
import { pressStories } from '../src/sim/pressStories';
import { gangManpower } from '../src/sim/world';

const require = createRequire(import.meta.url);
const store = require('../electron/saveStore.cjs') as {
  writeSlot(dir: string, meta: Record<string, unknown>, worldJson: string): Promise<void>;
  listSlots(dir: string): Promise<Record<string, unknown>[]>;
  listHeaders(dir: string): Promise<Record<string, unknown>[]>;
  readSlot(dir: string, id: string): Promise<Record<string, unknown>>;
  fileFor(dir: string, id: string): string;
};
const dirs: string[] = [];
async function dir() { const d = await mkdtemp(path.join(tmpdir(), 'og-sweep-')); dirs.push(d); return d; }
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
const meta = (id: string, savedAt: number) => ({ id, name: id, savedAt, week: 1, bossName: 'Boss' });
const world = (tag: string, size: number) => JSON.stringify({ tag, pad: 'x'.repeat(size) });

describe('desktop saves', () => {
  it('two saves to one slot at once both land, one after the other, and nothing is torn', async () => {
    const d = await dir();
    await store.writeSlot(d, meta('Autosave', 1), world('base', 10));
    const results = await Promise.allSettled([
      store.writeSlot(d, meta('Autosave', 2), world('A', 3_000_000)),
      store.writeSlot(d, meta('Autosave', 3), world('B', 4_000_000)),
    ]);
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
    const [slot] = await store.listSlots(d);
    expect(JSON.parse(slot.worldJson as string).tag).toBe('B');
    expect(JSON.parse((await readFile(store.fileFor(d, 'Autosave') + '.bak', 'utf8')).split('\n')[1]).tag).toBe('A');
  });

  it('a damaged slot that still ends in a brace is caught, and never overwrites its good backup', async () => {
    const d = await dir();
    await store.writeSlot(d, meta('One', 1), world('first', 10));
    await store.writeSlot(d, meta('One', 2), world('second', 10));
    const file = store.fileFor(d, 'One');
    const [header] = (await readFile(file, 'utf8')).split('\n');
    // Interleaved bytes: the right ending, the wrong length.
    await writeFile(file, header + '\n{"tag":"sec}', 'utf8');
    expect(JSON.parse((await store.readSlot(d, 'One')).worldJson as string).tag).toBe('first');
    await store.writeSlot(d, meta('One', 3), world('third', 10));
    expect(await readFile(file + '.bak', 'utf8')).toContain('"first"');
  });

  it('lists slots from their headers alone, and reads a world only when asked', async () => {
    const d = await dir();
    await store.writeSlot(d, { ...meta('Kept', 5), summary: { cash: 1234, blocks: 3, men: 7, seed: 9, finished: false } }, world('kept', 1000));
    const [listed] = await store.listHeaders(d);
    expect(listed).toMatchObject({ id: 'Kept', lazy: true, summary: { cash: 1234 } });
    expect(listed.worldJson).toBeUndefined();
    expect(JSON.parse((await store.readSlot(d, 'Kept')).worldJson as string).tag).toBe('kept');
  });
});

describe('game flow', () => {
  it('a lesson is not entered in the Hall of Fame', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, tutorialId: 4 });
    sim.world.phase = 'gameOver';
    sim.world.outcome = { won: false, reason: 'Killed.', score: 12 };
    expect(recordHallOfFame(sim.world)).toBe(false);
  });

  it('New Game after a lesson starts an ordinary campaign, keeping the boss', () => {
    useGame.setState({ options: { ...defaultGameOptions(), tutorialId: 1, seed: 101, playerName: 'Al Moretti' } });
    useGame.getState().setScreen('newGame');
    const o = useGame.getState().options;
    expect(o.tutorialId).toBeUndefined();
    expect(o.playerName).toBe('Al Moretti');
    useGame.setState({ screen: 'menu' });
  });

  it('prints only the highest milestone a gang jumps to', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404 });
    const w = sim.world, g = sim.playerGang;
    const before = w.news.length;
    // A gang that has grown past 25 and 50 men since the last paper.
    for (const p of Object.values(w.people).filter(p => p.gangId == null && p.role === 'citizen').slice(0, 60)) { p.gangId = g.id; p.role = 'hood'; g.poolIds.push(p.id); }
    expect(gangManpower(w, g)).toBeGreaterThanOrEqual(50);
    pressStories(w);
    expect(w.news.slice(before).filter(n => n.headline === "MOBSTER'S PRIVATE ARMY!" && n.gangId === g.id)).toHaveLength(1);
    expect(g.pressMilestones).toContain('army-25');
  });
});
