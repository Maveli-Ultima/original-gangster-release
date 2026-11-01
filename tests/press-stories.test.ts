import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { defaultGameOptions } from '../src/app/newGame';
import { pressStories } from '../src/sim/pressStories';
import { newspaperLead } from '../src/sim/newspaper';
import { weeklyNews } from '../src/sim/systems/news';

describe("the original's gang stories", () => {
  it('prints a milestone once, with the original headline, and leads the paper with it', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404 });
    const w = sim.world, g = sim.playerGang;
    g.cash = 1_200_000;
    weeklyNews(w, sim.rng);
    const week = w.news.filter(n => n.week === w.week);
    expect(week.some(n => n.headline === 'MAKING A MILLION!')).toBe(true);
    expect(newspaperLead(week)?.headline).toBe('MAKING A MILLION!');
    const before = w.news.length;
    pressStories(w);
    expect(w.news.slice(before).some(n => n.headline === 'MAKING A MILLION!')).toBe(false);
  });

  it("reports a boss's death and a private army", () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404 });
    const w = sim.world, rival = Object.values(w.gangs).find(g => !g.isPlayer)!;
    const boss = w.people[rival.bossId]; boss.status = 'dead'; boss.diedWeek = w.week;
    pressStories(w);
    expect(w.news.some(n => n.headline === 'LOCAL WARLORD DEAD!' && n.gangId === rival.id)).toBe(true);
  });

  it('runs a period colour story inside a quiet paper, not on the front', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404 });
    const w = sim.world; w.week = 3;
    for (const g of Object.values(w.gangs)) g.pressMilestones = ['good-life'];
    const before = w.news.length;
    pressStories(w);
    const added = w.news.slice(before);
    expect(added.length).toBe(1);
    expect(added[0].section).not.toBe('front');
  });
});
