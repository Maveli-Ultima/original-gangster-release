import { describe, expect, it } from 'vitest';
import { dockCraneGeometry, stationClockGeometry, trainShedGeometry } from '../src/render/architecture';

describe('Docks and Railroad Terminal dressing (A23, 1 October)', () => {
  it('reaches the crane jib out over the street front (+Z) from a roof-top mast', () => {
    const g = dockCraneGeometry(); g.computeBoundingBox(); const b = g.boundingBox!;
    expect(b.min.y).toBeCloseTo(0, 5);
    expect(b.max.z).toBeGreaterThan(8.5);
    expect(b.max.y).toBeGreaterThan(10);
  });

  it('keeps the train shed inside the unit footprint and height it is scaled by', () => {
    const g = trainShedGeometry(); g.computeBoundingBox(); const b = g.boundingBox!;
    for (const v of [b.min.x, b.min.z]) expect(v).toBeGreaterThanOrEqual(-.52);
    for (const v of [b.max.x, b.max.z]) expect(v).toBeLessThanOrEqual(.52);
    expect(b.min.y).toBeGreaterThanOrEqual(0); expect(b.max.y).toBeLessThanOrEqual(1.05);
  });

  it('faces the station clock dial outward (+Z)', () => {
    const g = stationClockGeometry(); g.computeBoundingBox(); const b = g.boundingBox!;
    expect(b.max.z).toBeGreaterThan(.1); expect(b.min.z).toBeGreaterThan(-.1);
  });
});
