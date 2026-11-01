import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { createWorld } from '../src/sim/citygen';
import { ELECTION_WEEKS } from '../src/sim/constants';
import { Rng } from '../src/sim/rng';
import { weeklyNews } from '../src/sim/systems/news';

const front = (weeksLeft: number) => {
  const w = createWorld({ ...defaultGameOptions(), seed: 21 }).world;
  w.election = { ...w.election, active: true, weeksLeft };
  weeklyNews(w, new Rng(1));
  return w.news.filter(n => n.section === 'front').at(-1)?.headline;
};

describe('election front pages', () => {
  it('does not call a newly called six-week race its final weeks', () => {
    expect(front(ELECTION_WEEKS)).not.toBe('CAMPAIGN ENTERS FINAL WEEKS');
    expect(front(4)).toBe('MAYORAL RACE HEATS UP');
    expect(front(2)).toBe('CAMPAIGN ENTERS FINAL WEEKS');
    expect(front(1)).toBe('CAMPAIGN ENTERS FINAL WEEKS');
  });
});
