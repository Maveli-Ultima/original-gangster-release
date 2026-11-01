import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { killPerson } from '../src/sim/execution';
import { Sim } from '../src/sim/sim';

describe('the police chief', () => {
  it('a chief killed is replaced at the end of the week, and the papers report it', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 }), w = sim.world;
    const old = w.people[w.policeChiefId];
    sim.launchWeek();
    killPerson(w, old, 'shot');
    sim.finishWeek();
    const chief = w.people[w.policeChiefId];
    expect(chief.id).not.toBe(old.id);
    expect(chief.role).toBe('policeChief');
    expect(chief.status).toBe('active');
    expect(w.news.some(n => n.headline === 'NEW POLICE CHIEF SWORN IN' && n.body.includes(chief.name) && n.body.includes(old.name))).toBe(true);
    expect(() => Sim.fromSave(structuredClone(w))).not.toThrow();
  });

  it('a chief still in office, or only kidnapped, keeps the post', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 }), w = sim.world;
    const id = w.policeChiefId;
    sim.launchWeek();
    w.people[id].status = 'kidnapped';
    sim.finishWeek();
    expect(w.policeChiefId).toBe(id);
    expect(w.news.some(n => n.headline === 'NEW POLICE CHIEF SWORN IN')).toBe(false);
  });
});
