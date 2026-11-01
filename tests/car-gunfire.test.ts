import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { presentAttack } from '../src/sim/presentationEvents';
import { CAR_GUN_SECONDS, CarGunfire, carGunFlash, carGunPlace } from '../src/render/carGunfire';
import type { Person, WorldState } from '../src/sim/types';

function fixture() {
  const gunman = { id: 1, pos: { x: 10, y: 20 }, status: 'active', inVehicle: true } as Person;
  const target = { id: 2, pos: { x: 10, y: 30 }, status: 'active' } as Person;
  const world = { week: 1, minute: 10, people: { 1: gunman, 2: target }, rngState: 87 } as unknown as WorldState;
  return { gunman, target, world };
}

describe('shots fired from a car', () => {
  it('put the gun out of the window on the side he shoots, and flash for every round', () => {
    const place = carGunPlace({ x: 10, y: 20 }, { x: 10, y: 30 });
    expect(place.z).toBeGreaterThan(20);
    expect(place.x).toBeCloseTo(10);
    expect(carGunFlash('pistol', 0)).toBe(1);
    expect(carGunFlash('pistol', .2)).toBe(0);
    const tommy = Array.from({ length: 40 }, (_, i) => carGunFlash('tommy', i * .01) > 0);
    // A burst: on, off, on again.
    expect(tommy.filter((on, i) => on && !tommy[i - 1]).length).toBeGreaterThanOrEqual(4);
  });

  it('show the gunman at the window for a moment, then not', () => {
    const { gunman, target, world } = fixture(), scene = new THREE.Scene(), fire = new CarGunfire(scene);
    fire.update(world, 0, () => gunman.pos, () => 0);
    presentAttack(world, gunman, target, 'tommy', true);
    fire.update(world, .01, () => gunman.pos, () => 0);
    expect(fire.showing).toBe(1);
    fire.update(world, CAR_GUN_SECONDS + .1, () => gunman.pos, () => 0);
    expect(fire.showing).toBe(0);
    // A man on foot is drawn with his own gun; nothing at a window.
    gunman.inVehicle = false;
    presentAttack(world, gunman, target, 'pistol', false);
    fire.update(world, .01, () => gunman.pos, () => 0);
    expect(fire.showing).toBe(0);
    fire.dispose();
  });
});
