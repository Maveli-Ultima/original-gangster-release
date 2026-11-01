import { describe, expect, it } from 'vitest';
import { WALK_SPEED } from '../src/sim/constants';
import { PURSUIT_PACE, runningCivilian, transportSpeed } from '../src/sim/transport';
import type { Person } from '../src/sim/types';

const citizen = (id: number, x: number, y: number) =>
  ({ id, role: 'citizen', inVehicle: false, streetOrder: null, dest: { x, y } }) as unknown as Person;

describe('civilian errand legs (POP §4.1: 1 in 64 run)', () => {
  it('runs about one leg in 64, the same way every time for the same leg', () => {
    let runs = 0, n = 0;
    for (let id = 1; id <= 400; id++) for (let k = 0; k < 40; k++) { n++; if (runningCivilian(citizen(id, k * 7.3, id * 1.9))) runs++; }
    expect(runs / n).toBeGreaterThan(1 / 80);
    expect(runs / n).toBeLessThan(1 / 50);
    const leg = citizen(17, 120.5, 88.25);
    expect(runningCivilian(leg)).toBe(runningCivilian({ ...leg, dest: { ...leg.dest! } } as Person));
  });

  it('a running leg moves at the pursuit pace; other people and stationary civilians do not run', () => {
    let runner: Person | undefined;
    for (let k = 0; !runner && k < 5000; k++) { const p = citizen(3, k, 2); if (runningCivilian(p)) runner = p; }
    expect(transportSpeed(runner!)).toBeCloseTo(WALK_SPEED * PURSUIT_PACE);
    expect(runningCivilian({ ...runner!, dest: null } as Person)).toBe(false);
    expect(runningCivilian({ ...runner!, role: 'hood' } as Person)).toBe(false);
  });
});
