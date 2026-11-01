import { describe, expect, it } from 'vitest';
import { CONTACT_DISTANCE, keepContactDistance } from '../src/sim/execution';
import type { Person } from '../src/sim/types';

const person = (id: number, x: number, y: number) => ({ id, pos: { x, y }, inVehicle: false }) as Person;

describe('close-range spacing', () => {
  it('keeps attackers at arm’s length along their approach, never inside the victim', () => {
    const victim = person(1, 10, 10);
    const approaching = person(2, 10.3, 10), onTop = person(3, 10, 10), far = person(4, 14, 10);
    keepContactDistance([approaching, onTop, far], victim);
    expect(Math.hypot(approaching.pos.x - 10, approaching.pos.y - 10)).toBeCloseTo(CONTACT_DISTANCE);
    expect(approaching.pos.x).toBeGreaterThan(10);                 // stays on the side it came from
    expect(Math.hypot(onTop.pos.x - 10, onTop.pos.y - 10)).toBeCloseTo(CONTACT_DISTANCE);
    expect(far.pos).toEqual({ x: 14, y: 10 });                     // already clear: untouched
  });
});
