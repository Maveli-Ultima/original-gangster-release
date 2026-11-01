import type { Mass } from './profile';

export type IndustrialFixture = 'machine' | 'storage';

/** Public building identity chooses a deterministic cutaway prop kit. */
export function industrialFixtureFor(typeId: string): IndustrialFixture | null {
  if (typeId === 'warehouse' || typeId === 'docks' || typeId === 'railroad') return 'storage';
  if (typeId === 'foundry' || typeId === 'mill' || typeId === 'cannery') return 'machine';
  return null;
}

/** Keep the central prop in the larger room, away from the interior partition. */
export function industrialFixtureOffsets(mass: Mass): { x: number; y: number; z: number }[] {
  const x = mass.dx + Math.min(mass.w * .15, 1.6);
  const spread = Math.min(mass.d * .24, 2.7);
  return [-spread, 0, spread].map(z => ({ x, y: mass.y, z: mass.dz + z }));
}
