import { describe, expect, it } from 'vitest';
import { cutawayRoomLayout, FOOTPRINT, furnitureGeometry, FURNITURE_KINDS, kitFor, WALL } from '../src/render/cutawayRooms';

const opts = { stairs: true, partitions: true, frontDoor: true };

describe('cutaway rooms in the original manner', () => {
  it('is the same every time a building is opened', () => {
    expect(cutawayRoomLayout(42, 12, 18, 1.3, 'home', opts)).toEqual(cutawayRoomLayout(42, 12, 18, 1.3, 'home', opts));
    expect(cutawayRoomLayout(42, 12, 18, 1.3, 'home', opts)).not.toEqual(cutawayRoomLayout(43, 12, 18, 1.3, 'home', opts));
  });

  it('caps every outer wall with broken masonry and plasters the inside', () => {
    const { caps, linings } = cutawayRoomLayout(7, 10, 14, 1.3, 'home', opts);
    const heights = new Set(caps.map(c => c.h.toFixed(2)));
    expect(heights.size).toBeGreaterThan(5);
    for (const side of [-1, 1]) {
      expect(caps.some(c => Math.abs(c.z - side * (7 - WALL / 2)) < 1e-6)).toBe(true);
      expect(caps.some(c => Math.abs(c.x - side * (5 - WALL / 2)) < 1e-6)).toBe(true);
    }
    expect(linings.length).toBeGreaterThanOrEqual(4);
  });

  it('divides a deep building into house-sized rooms with furniture inside the walls, not overlapping', () => {
    for (let id = 1; id < 40; id++) {
      const w = 8 + (id % 7) * 2, d = 10 + (id % 5) * 3;
      const { furniture, linings } = cutawayRoomLayout(id, w, d, 1.3, 'home', opts);
      expect(linings.length).toBeGreaterThan(4);
      const boxes = furniture.map(f => {
        const [fw, fd] = FOOTPRINT[f.kind];
        const turned = Math.abs(Math.sin(f.yaw)) > .5;
        const ex = (turned ? fd : fw) / 2, ez = (turned ? fw : fd) / 2;
        expect(f.x - ex).toBeGreaterThanOrEqual(-w / 2 + WALL - 1e-6);
        expect(f.x + ex).toBeLessThanOrEqual(w / 2 - WALL + 1e-6);
        expect(f.z - ez).toBeGreaterThanOrEqual(-d / 2 + WALL - 1e-6);
        expect(f.z + ez).toBeLessThanOrEqual(d / 2 - WALL + 1e-6);
        return { x0: f.x - ex, x1: f.x + ex, z0: f.z - ez, z1: f.z + ez };
      });
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        expect(a.x1 <= b.x0 || b.x1 <= a.x0 || a.z1 <= b.z0 || b.z1 <= a.z0).toBe(true);
      }
      expect(furniture.filter(f => f.kind !== 'stairs').length).toBeGreaterThan(2);
    }
  });

  it('gives a multi-storey building a staircase', () => {
    let withStairs = 0;
    for (let id = 1; id <= 30; id++) if (cutawayRoomLayout(id, 12, 16, 1.3, 'home', opts).furniture.some(f => f.kind === 'stairs')) withStairs++;
    expect(withStairs).toBeGreaterThanOrEqual(27);
    expect(cutawayRoomLayout(1, 12, 16, 1.3, 'home', { ...opts, stairs: false }).furniture.some(f => f.kind === 'stairs')).toBe(false);
  });

  it('furnishes by trade and never reveals a hidden illegal site', () => {
    expect(kitFor('tenement', 'tenementPoor')).toBe('home');
    expect(kitFor('commercial', 'poolHall')).toBe('poolHall');
    expect(kitFor('commercial', 'bankLarge')).toBe('office');
    expect(kitFor('charity', 'church')).toBe('church');
    expect(kitFor('illegal', 'speakeasy')).toBe('bare');
    const bare = cutawayRoomLayout(5, 12, 16, 1.3, 'bare', { ...opts, stairs: false });
    expect(bare.furniture).toEqual([]);
    const church = cutawayRoomLayout(5, 12, 20, 1.3, 'church', { ...opts, stairs: false });
    expect(church.furniture.filter(f => f.kind === 'pew').length).toBeGreaterThan(3);
  });

  it('builds every piece of furniture as finite, coloured geometry on the floor', () => {
    for (const kind of FURNITURE_KINDS) {
      const g = furnitureGeometry(kind);
      const p = g.getAttribute('position');
      expect(p.count).toBeGreaterThan(0);
      g.computeBoundingBox();
      expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(-1e-6);
      expect(g.getAttribute('color').count).toBe(p.count);
      g.dispose();
    }
  });
});
