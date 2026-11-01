import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILDING_TYPES } from '../src/sim/data/buildings';
import type { Building } from '../src/sim/types';
import { BuildingPickBounds } from '../src/render/buildingPickBounds';
import { storedGoodsGeometry, worksMachineGeometry } from '../src/render/architecture';
import { industrialFixtureFor, industrialFixtureOffsets } from '../src/render/interiorFixtures';
import { profileFor } from '../src/render/profile';

const expected = {
  machine: ['foundry', 'mill', 'cannery'],
  storage: ['warehouse', 'docks', 'railroad'],
};
function building(type: (typeof BUILDING_TYPES)[number], id: number): Building {
  return { id, typeId: type.id, cls: type.cls, state: 'trading', lotId: id, blockId: 0,
    ownerGangId: null, managerId: null, ownerPersonId: null, protection: null, frontId: null, hidesId: null,
    stock: { liquor: 0, stolen: 0, counterfeit: 0 }, lastProfit: 0, repairCost: 0, cover: 0, fbiSuspicion: 0,
    discovered: false, knowledge: {}, guardIds: [], isHQ: false };
}

describe('lowered industrial fixtures', () => {
  it('selects only the six visible industrial site types', () => {
    expect(BUILDING_TYPES).toHaveLength(80);
    for (const type of BUILDING_TYPES) {
      const kit = industrialFixtureFor(type.id);
      if (kit) {
        expect(type.cls).toBe('industrial');
        expect(expected[kit]).toContain(type.id);
      } else expect([...expected.machine, ...expected.storage]).not.toContain(type.id);
      if (type.cls === 'illegal') expect(kit).toBeNull();
    }
  });

  it('keeps each fixture inside its real floor and extends the lowered pick height', () => {
    const geometries = { machine: worksMachineGeometry(), storage: storedGoodsGeometry() };
    try {
      for (const type of BUILDING_TYPES) {
        const kind = industrialFixtureFor(type.id);
        if (!kind) continue;
        const geo = geometries[kind], bounds = geo.boundingBox!;
        for (const id of [7, 404, 938]) {
          const profile = profileFor(building(type, id), type), mass = profile.masses[0];
          const offsets = industrialFixtureOffsets(mass);
          expect(offsets).toHaveLength(3);
          expect(bounds.min.y).toBeGreaterThan(.071);
          for (let i = 1; i < offsets.length; i++)
            expect(offsets[i].z + bounds.min.z).toBeGreaterThan(offsets[i - 1].z + bounds.max.z);
          for (const offset of offsets) {
            expect(offset.x + bounds.min.x).toBeGreaterThan(mass.dx - mass.w / 2 + .1);
            expect(offset.x + bounds.max.x).toBeLessThan(mass.dx + mass.w / 2 - .1);
            expect(offset.z + bounds.min.z).toBeGreaterThan(mass.dz - mass.d / 2 + .1);
            expect(offset.z + bounds.max.z).toBeLessThan(mass.dz + mass.d / 2 - .1);
            for (let turn = 0; turn < 4; turn++) {
              const yaw = turn * Math.PI / 2, world = new THREE.Matrix4().makeRotationY(yaw);
              world.setPosition(offset.x, offset.y + .34, offset.z);
              const pick = new BuildingPickBounds();
              pick.reset(0, 0, yaw);
              pick.include(geo, world);
              pick.includeBody(profile.width + 1.2, profile.depth + 1.2, 0, 1.5);
              const proxy = new THREE.Object3D();
              pick.writeTransform(proxy);
              expect(proxy.position.y + proxy.scale.y).toBeGreaterThan(bounds.max.y + .33);
            }
          }
        }
      }
    } finally { Object.values(geometries).forEach(geometry => geometry.dispose()); }
  });

  it('has visible upward surfaces under FrontSide rendering', () => {
    for (const geometry of [worksMachineGeometry(), storedGoodsGeometry()]) {
      const material = new THREE.MeshBasicMaterial({ vertexColors: true });
      const mesh = new THREE.Mesh(geometry, material);
      const ray = new THREE.Raycaster(new THREE.Vector3(0, 5, geometry.userData.fixtureKind === 'storage' ? -.62 : 0),
        new THREE.Vector3(0, -1, 0));
      expect(ray.intersectObject(mesh).length, geometry.name).toBeGreaterThan(0);
      expect(geometry.getAttribute('position').count).toBeLessThan(1800);
      material.dispose(); geometry.dispose();
    }
  });
});
