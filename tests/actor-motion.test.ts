import { describe, expect, it } from 'vitest';
import { ActorMotion } from '../src/render/actorLayer';
import { ACTOR_STRIDE_METRES } from '../src/render/actors';

const circle = Math.PI * 2;
const quarterStride = ACTOR_STRIDE_METRES / 4;
const expectedQuarterPhase = (phase: number) => (phase + Math.PI / 2) % circle;

describe('distance-driven actor gait', () => {
  it.each([
    ['east', 1, 0], ['west', -1, 0], ['south', 0, 1], ['north', 0, -1],
    ['south-east', Math.SQRT1_2, Math.SQRT1_2], ['south-west', -Math.SQRT1_2, Math.SQRT1_2],
    ['north-east', Math.SQRT1_2, -Math.SQRT1_2], ['north-west', -Math.SQRT1_2, -Math.SQRT1_2],
  ] as const)('advances the same gait distance when travelling %s', (_name, dx, dz) => {
    const motion = new ActorMotion();
    const start = { ...motion.sample(17, 100, 100, true, 0) };
    const facing = Math.atan2(dx, dz);
    const moved = motion.sample(17, 100 + dx * quarterStride, 100 + dz * quarterStride, true, facing);
    expect(moved.phase).toBeCloseTo(expectedQuarterPhase(start.phase), 10);
    expect(moved.facing).toBe(facing);
  });

  it('one full travelled stride closes the cycle even when the route turns', () => {
    const motion = new ActorMotion();
    const initialPhase = motion.sample(5, 0, 0, true, 0).phase;
    motion.sample(5, quarterStride, 0, true, Math.PI / 2);
    motion.sample(5, quarterStride, quarterStride, true, 0);
    motion.sample(5, 0, quarterStride, true, -Math.PI / 2);
    const final = motion.sample(5, 0, 0, true, Math.PI);
    expect(final.phase).toBeCloseTo(initialPhase, 10);
    expect(final.facing).toBe(Math.PI);
  });

  it('repeated frames at unchanged coordinates keep the pose phase still', () => {
    const motion = new ActorMotion();
    const start = { ...motion.sample(11, 20, 30, true, Math.PI / 2) };
    for (let frame = 0; frame < 120; frame++) {
      const same = motion.sample(11, 20, 30, true, Math.PI / 2);
      expect(same.phase).toBe(start.phase);
      expect(same.facing).toBe(start.facing);
    }
  });

  it('an idle frame preserves the last travelled facing and excludes idle relocation from later gait', () => {
    const motion = new ActorMotion();
    const start = { ...motion.sample(11, 0, 0, true, Math.PI / 2) };
    const idle = { ...motion.sample(11, 100, 100, false, -1) };
    expect(idle.phase).toBe(start.phase);
    expect(idle.facing).toBe(start.facing);
    const resumed = motion.sample(11, 100 + quarterStride, 100, true, Math.PI / 2);
    expect(resumed.phase).toBeCloseTo(expectedQuarterPhase(start.phase), 10);
  });

  it.each([12, 30, 1000])('skips a %s metre teleport and resumes from the new position', distance => {
    const motion = new ActorMotion();
    const start = { ...motion.sample(2, 0, 0, true, 0) };
    const relocated = { ...motion.sample(2, distance, 0, true, Math.PI / 2) };
    expect(relocated.phase).toBe(start.phase);
    expect(relocated.facing).toBe(Math.PI / 2);
    const resumed = motion.sample(2, distance + quarterStride, 0, true, Math.PI / 2);
    expect(resumed.phase).toBeCloseTo(expectedQuarterPhase(start.phase), 10);
  });

  it('retains visible histories and restarts discarded histories without an unseen journey', () => {
    const motion = new ActorMotion();
    const seedOne = motion.sample(1, 0, 0, true, 0).phase;
    const seedTwo = motion.sample(2, 0, 0, true, 0).phase;
    const movedOne = { ...motion.sample(1, quarterStride, 0, true, 1) };
    motion.sample(2, quarterStride, 0, true, 2);
    expect(movedOne.phase).not.toBe(seedOne);
    motion.retain(new Set([1]));
    const retained = motion.sample(1, quarterStride, 0, false, 9);
    expect(retained.phase).toBe(movedOne.phase);
    expect(retained.facing).toBe(movedOne.facing);
    const reappeared = motion.sample(2, 500, 600, true, 3);
    expect(reappeared.phase).toBe(seedTwo);
    expect(reappeared.facing).toBe(3);
  });

  it('clear starts fresh histories for a replacement world', () => {
    const motion = new ActorMotion();
    const original = motion.sample(7, 0, 0, true, 0).phase;
    motion.sample(7, quarterStride, 0, true, 1);
    motion.clear();
    expect(motion.sample(7, 9, 9, false, 2)).toMatchObject({ phase: original, facing: 2 });
  });

  it('interleaving another actor does not change an existing history', () => {
    const alone = new ActorMotion(), shared = new ActorMotion();
    alone.sample(1, 0, 0, true, 0); shared.sample(1, 0, 0, true, 0);
    shared.sample(99, 700, 300, true, 2);
    shared.sample(99, 700, 300 + quarterStride, true, 2);
    expect(shared.sample(1, quarterStride, 0, true, 1)).toEqual(alone.sample(1, quarterStride, 0, true, 1));
  });
});
