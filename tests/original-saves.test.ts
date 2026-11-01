import { describe, expect, it } from 'vitest';
import { defaultGameOptions, newCampaignOptions } from '../src/app/newGame';
import { killPerson } from '../src/sim/execution';
import { validateSaveWorld } from '../src/sim/saveSchema';
import { Sim } from '../src/sim/sim';
import type { WorldState } from '../src/sim/types';

const copy = (w: WorldState) => JSON.parse(JSON.stringify(w)) as WorldState;

describe('saves of the original 40 × 32 city', () => {
  const sim = new Sim({ ...newCampaignOptions(), seed: 1928 });
  const w = sim.world;

  it('round-trips the original layout, attitudes and a mid-week election', () => {
    const shopkeeper = Object.values(w.people).find(p => p.hostility && Object.keys(p.hostility).length)!;
    expect(shopkeeper).toBeDefined();
    const s = copy(w);
    killPerson(s, s.people[s.mayorId], 'test');
    expect(s.election.beganInWeek).toBe(true);
    const restored = Sim.fromSave(copy(s)).world;
    expect(restored.gridW).toBe(40);
    expect(restored.cityLayout!.original!.avenues).toEqual(w.cityLayout!.original!.avenues);
    expect(restored.people[shopkeeper.id].hostility).toEqual(shopkeeper.hostility);
    expect(restored.election.candidates).toEqual(s.election.candidates);
  });

  it('rejects damaged original data', () => {
    const bad: [string, (s: WorldState) => void][] = [
      ['wrong size', s => { s.gridH = 31; }],
      ['block data', s => { s.blocks[5].original!.landValue = 300; }],
      ['avenues', s => { s.cityLayout!.original!.avenues.cols.push(3); }],
      ['orphan original data', s => { delete s.cityLayout!.original; }],
      ['attitude byte', s => { Object.values(s.people)[0].fear = { [Object.keys(s.gangs)[0]]: 256 }; }],
      ['attitude gang', s => { Object.values(s.people)[0].hostility = { 9999: 10 }; }],
      ['election guard', s => { s.election.beganInWeek = true; s.election.active = false; }],
    ];
    for (const [name, damage] of bad) {
      const s = copy(w);
      damage(s);
      expect(() => validateSaveWorld(s), name).toThrow();
    }
  });

  it('leaves compact saves on their own geometry without original data or attitudes', () => {
    const compact = new Sim({ ...defaultGameOptions(), seed: 7 }).world;
    const restored = Sim.fromSave(copy(compact)).world;
    expect(restored.gridW).toBe(compact.gridW);
    expect(restored.cityLayout?.original).toBeUndefined();
    expect(restored.blocks.some(b => b.original)).toBe(false);
  });
});
