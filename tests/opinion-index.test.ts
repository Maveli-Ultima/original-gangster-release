import { expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { localOpinionShifter, shiftLocalOpinion } from '../src/sim/events';
import { Sim } from '../src/sim/sim';

it('indexed settlement influence matches the full scan exactly, including edges and repeated clamping', () => {
  const original = new Sim({ ...defaultGameOptions(), seed: 101, citySize: 10 }).world;
  const indexed = structuredClone(original);
  const shift = localOpinionShifter(indexed);
  const gangs = Object.values(original.gangs);
  for (let i = 0; i < 80; i++) {
    const pos = { x: (i * 71) % 650 - 55, y: (i * 103) % 650 - 55 };
    const radius = [45, 100, 110, 150][i % 4];
    const delta = [200, -200, 3.5, -1.7][i % 4];
    const gang = gangs[i % gangs.length];
    shiftLocalOpinion(original, pos, radius, gang.id, delta);
    shift(pos, radius, gang.id, delta);
  }
  expect(JSON.stringify(indexed)).toBe(JSON.stringify(original));
});
