import { describe, expect, it } from 'vitest';
import { defaultGameOptions, newCampaignOptions } from '../src/app/newGame';
import { createWorld } from '../src/sim/citygen';
import { streetLocation, streetName } from '../src/sim/cityLayout';
import { CELL } from '../src/sim/constants';

describe('street location in the original grammar (0x60C590)', () => {
  const w = createWorld({ ...defaultGameOptions(), seed: 11 }).world;

  it('names a crossing as a corner and a stretch between two cross streets', () => {
    expect(streetLocation(w, { x: 3 * CELL + 2, y: 4 * CELL - 3 }))
      .toBe(`On the corner of ${streetName(w, 'ns', 3)} & ${streetName(w, 'ew', 4)}`);
    expect(streetLocation(w, { x: 3 * CELL + 1, y: 4.5 * CELL }))
      .toBe(`On ${streetName(w, 'ns', 3)} between ${streetName(w, 'ew', 4)} & ${streetName(w, 'ew', 5)}`);
    expect(streetLocation(w, { x: 5.4 * CELL, y: 2 * CELL + 1 }))
      .toBe(`On ${streetName(w, 'ew', 2)} between ${streetName(w, 'ns', 5)} & ${streetName(w, 'ns', 6)}`);
  });

  it('uses the river, park and avenue forms in the original city', () => {
    const o = createWorld({ ...newCampaignOptions(), seed: 1928 }).world;
    const at = (use: string) => o.blocks.find(b => b.layout?.use === use && b.layout.mergedInto == null)!;
    const centre = (b: { gx: number; gy: number }) => ({ x: (b.gx + .5) * CELL, y: (b.gy + .5) * CELL });
    expect(streetLocation(o, centre(at('water')))).toBe('On the river');
    expect(streetLocation(o, centre(at('park')))).toMatch(/^In /);
    const avenue = o.blocks.find(b => b.original?.content === 35)!;
    expect(streetLocation(o, centre(avenue))).toBe(
      `On ${streetName(o, 'ns', avenue.gx)} between ${streetName(o, 'ew', avenue.gy)} & ${streetName(o, 'ew', avenue.gy + 1)}`);
  });
});
