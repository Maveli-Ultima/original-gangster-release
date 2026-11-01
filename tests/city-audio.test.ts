import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const calls: { kind: string; gain: number; pan: number }[] = [];
vi.mock('../src/audio/streetSound', () => ({
  streetSound: {
    shot: (_k: string, gain: number, pan: number) => calls.push({ kind: 'shot', gain, pan }),
    blow: (_h: boolean, gain: number, pan: number) => calls.push({ kind: 'blow', gain, pan }),
    fall: (gain: number, pan: number) => calls.push({ kind: 'fall', gain, pan }),
    explosion: (gain: number, pan: number) => calls.push({ kind: 'explosion', gain, pan }),
    flash: (gain: number, pan: number) => calls.push({ kind: 'flash', gain, pan }),
    horn: () => {}, siren: () => {}, setBeds: () => {},
  },
}));

const { CityAudio } = await import('../src/render/cityAudio');
const { presentAttack, presentBuildingEffect } = await import('../src/sim/presentationEvents');

function setup() {
  const world = { week: 1, minute: 10, people: {} } as never;
  const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, -500, 500);
  camera.position.set(100, 100, 100); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  const audio = new CityAudio();
  const target = new THREE.Vector3(0, 0, 0);
  const run = (fast = false) => audio.update(world, camera, target, 60, 1, .016, true, fast, [], 0);
  run();
  return { world, run };
}
const person = (id: number, x: number, y: number) => ({ id, pos: { x, y } }) as never;

describe('the city heard from the camera', () => {
  it('plays a gunshot near the view loud and one far off quietly or not at all', () => {
    const { world, run } = setup(); calls.length = 0;
    presentAttack(world, person(1, 2, 2), person(2, 4, 4), 'pistol', true);
    presentAttack(world, person(3, 40, 0), person(4, 42, 0), 'pistol', true);
    presentAttack(world, person(5, 400, 400), person(6, 402, 400), 'pistol', true);
    run();
    expect(calls.length).toBe(2);
    expect(calls[0].gain).toBeGreaterThan(calls[1].gain);
  });

  it('places sounds left and right across the screen', () => {
    const { world, run } = setup(); calls.length = 0;
    presentBuildingEffect(world, 'explosion', { x: -30, y: 30 });
    presentBuildingEffect(world, 'explosion', { x: 30, y: -30 });
    run();
    expect(calls.map(c => Math.sign(c.pan)).sort()).toEqual([-1, 1]);
  });

  it('limits a burst and stays silent at the fastest speeds', () => {
    const { world, run } = setup(); calls.length = 0;
    for (let i = 0; i < 20; i++) presentAttack(world, person(i, 1, 1), person(100 + i, 2, 2), undefined, true);
    run();
    expect(calls.length).toBe(6);
    calls.length = 0;
    presentAttack(world, person(50, 1, 1), person(51, 2, 2), 'tommy', true);
    run(true);
    expect(calls.length).toBe(0);
  });
});
