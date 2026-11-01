import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { vehicleScreenDirection, vehicleSpriteRoadPivot } from '../src/render/vehicleSpriteLayer';

function cameraBasis(flipped: boolean): [THREE.Vector3, THREE.Vector3] {
  const side = flipped ? -1 : 1;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 100);
  camera.position.set(side, Math.SQRT2 * Math.tan(Math.PI / 6), side);
  camera.lookAt(0, 0, 0);
  return [
    new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion),
    new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion),
  ];
}

describe('Vehicle sprite facings', () => {
  it('follows road directions when the city camera flips', () => {
    const [right, up] = cameraBasis(false);
    expect([0, -Math.PI / 2, Math.PI, Math.PI / 2].map(yaw =>
      vehicleScreenDirection(yaw, right, up))).toEqual([3, 5, 7, 1]);
    const [flippedRight, flippedUp] = cameraBasis(true);
    expect([0, -Math.PI / 2, Math.PI, Math.PI / 2].map(yaw =>
      vehicleScreenDirection(yaw, flippedRight, flippedUp))).toEqual([7, 1, 3, 5]);
  });

  it('is stable for equivalent yaw angles', () => {
    const [right, up] = cameraBasis(false);
    expect(vehicleScreenDirection(0, right, up)).toBe(vehicleScreenDirection(2 * Math.PI, right, up));
  });

  it('places the bottom painted pixel at road height in world space', () => {
    for (const bottom of [161, 177, 189]) {
      for (const cameraUpY of [0.7, Math.sqrt(3) / 2, 1]) {
        const size = 6;
        const centerY = vehicleSpriteRoadPivot(bottom, 224, size, cameraUpY);
        const pixelLocalY = (.5 - bottom / 224) * size;
        expect(centerY + pixelLocalY * cameraUpY).toBeCloseTo(.08, 6);
      }
    }
  });
});
