import { describe, expect, it } from 'vitest';
import type { Person, Team, VehicleId, WorldState } from '../src/sim/types';
import { vehicleForPerson } from '../src/render/vehicles';

function fixture(vehicles: Partial<Record<VehicleId, number>>, memberIds = [11, 12, 13, 14, 15]) {
  const team = { id: 4, lieutenantId: 10, memberIds,
    vehicles: { coupe: 0, truck: 0, speedster: 0, ...vehicles } } as Team;
  const world = { teams: { 4: team } } as unknown as WorldState;
  const person = (id: number, teamId: number | null = 4) => ({ id, teamId } as Person);
  return { team, world, person };
}

describe('deterministic visual choice among available team vehicle types', () => {
  it.each(['coupe', 'truck', 'speedster'] as const)('uses the sole available %s type for the whole roster', kind => {
    const { world, person } = fixture({ [kind]: 1 });
    expect([10, 11, 12, 13, 14, 15].map(id => vehicleForPerson(world, person(id)))).toEqual(Array(6).fill(kind));
  });

  it('shows all three available types across a mixed roster in stable order', () => {
    const { world, person } = fixture({ coupe: 8, truck: 1, speedster: 2 });
    const expected = ['coupe', 'truck', 'speedster', 'coupe', 'truck', 'speedster'];
    const ids = [10, 11, 12, 13, 14, 15];
    expect(ids.map(id => vehicleForPerson(world, person(id)))).toEqual(expected);
    expect(ids.map(id => vehicleForPerson(world, person(id)))).toEqual(expected);
    // This is representation of available types, not a simulated assignment or fleet ratio.
  });

  it('does not show a type with no positive inventory', () => {
    const { world, person } = fixture({ coupe: 0, truck: 3, speedster: -1 });
    expect([10, 11, 12].map(id => vehicleForPerson(world, person(id)))).toEqual(['truck', 'truck', 'truck']);
  });

  it('deduplicates a lieutenant or member listed twice without shifting later crew slots', () => {
    const { world, person } = fixture({ coupe: 1, truck: 1, speedster: 1 }, [10, 11, 11, 12]);
    expect([10, 11, 12].map(id => vehicleForPerson(world, person(id)))).toEqual(['coupe', 'truck', 'speedster']);
  });

  it('handles huge fleet counts without expanding the roster by vehicle count', () => {
    const { world, person } = fixture({ coupe: Number.MAX_SAFE_INTEGER, truck: 1 });
    expect(vehicleForPerson(world, person(11))).toBe('truck');
  });

  it('uses the first available type for a person absent from the roster', () => {
    const { world, person } = fixture({ truck: 1, speedster: 1 });
    expect(vehicleForPerson(world, person(999))).toBe('truck');
  });

  it('provides a stable fallback for missing team and empty inventory', () => {
    const { world, person } = fixture({});
    expect(vehicleForPerson(world, person(10))).toBe('coupe');
    expect(vehicleForPerson(world, person(10, null))).toBe('coupe');
    expect(vehicleForPerson(world, person(10, 99))).toBe('coupe');
  });

  it('does not change the team, roster, inventory or person when queried', () => {
    const { world, person } = fixture({ coupe: 2, truck: 1, speedster: 1 });
    const driver = person(11);
    const before = JSON.stringify({ world, driver });
    for (let frame = 0; frame < 30; frame++) vehicleForPerson(world, driver);
    expect(JSON.stringify({ world, driver })).toBe(before);
  });
});
