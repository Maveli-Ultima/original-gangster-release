import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { bossName } from '../src/sim/newGameValidation';
import { Sim } from '../src/sim/sim';

describe('the boss\'s nickname (the original\'s third name field)', () => {
  it('prints First "Nick" Last', () => {
    expect(bossName('Johnny Moretti', 'The Fox')).toBe('Johnny "The Fox" Moretti');
    expect(bossName('Mae De Luca', 'Silk')).toBe('Mae "Silk" De Luca');
    expect(bossName('Johnny Moretti', '  ')).toBe('Johnny Moretti');
    expect(bossName('Johnny Moretti')).toBe('Johnny Moretti');
    expect(bossName('Moretti', 'Lucky')).toBe('Moretti "Lucky"');
    expect(bossName('Johnny Moretti', '"Ace"')).toBe('Johnny "Ace" Moretti');
  });

  it('names the player\'s boss in the city', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, playerNickname: 'The Fox' });
    expect(sim.world.people[sim.playerGang.bossId].name).toBe('Johnny "The Fox" Moretti');
  });
});
