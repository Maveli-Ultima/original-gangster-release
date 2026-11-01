import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILDING_TYPES } from '../src/sim/data/buildings';
import type { Building } from '../src/sim/types';
import { profileFor } from '../src/render/profile';
import { centreSiteHalfExtent, entryDoorGeometry, frontOf, frontageGeometry, interiorGeometry, massesForView, pitchedRoofGeometry } from '../src/render/architecture';
import { CENTRE_LOT, LOT_SIZE } from '../src/sim/world';
import { hydrantGeometry, lampGlowGeometry, lampPostGeometry, wallShellGeometry } from '../src/render/geometry';

function building(type: (typeof BUILDING_TYPES)[number], id = 404): Building {
  return { id, typeId: type.id, cls: type.cls, state: 'trading', lotId: id, blockId: 0,
    ownerGangId: null, managerId: null, ownerPersonId: null, protection: null, frontId: null, hidesId: null,
    stock: { liquor: 0, stolen: 0, counterfeit: 0 }, lastProfit: 0, repairCost: 0, cover: 0, fbiSuspicion: 0,
    discovered: false, knowledge: {}, guardIds: [], isHQ: false };
}

describe('architecture candidate invariants', () => {
  it('preserves full-view footprint and public frontage when lowered for all 80 types', () => {
    expect(BUILDING_TYPES.length).toBe(80);
    for (const type of BUILDING_TYPES) for (const edge of [false, true]) for (const seed of [1, 404, 938]) {
      const b = building(type, seed), profile = profileFor(b, type);
      const before = structuredClone(profile);
      const full = massesForView(profile, edge, false), lowered = massesForView(profile, edge, true);
      expect(lowered.masses).toEqual(full.masses);
      expect(lowered.extension).toBe(full.extension);
      expect(frontOf(full.masses[0]).z).toBeCloseTo(frontOf(profile.masses[0]).z, 10);
      expect(profile).toEqual(before);
      expect(profileFor(b, type)).toEqual(profile);
      for (const m of full.masses) for (const dimension of [m.w, m.d, m.h]) {
        expect(Number.isFinite(dimension)).toBe(true); expect(dimension).toBeGreaterThan(0);
      }
    }
  });

  it('uses explicit tower types and preserves flat roofs for industrial sawtooths', () => {
    for (const type of BUILDING_TYPES) {
      const profile = profileFor(building(type), type);
      if (['tenementMid', 'tenementRich', 'hospital', 'cityHall', 'courthouse'].includes(type.id))
        expect(profile.masses).toHaveLength(1);
      if (['hotelLarge', 'bankLarge'].includes(type.id)) expect(profile.masses).toHaveLength(3);
      if (profile.sawtooth) expect(profile.roof).toBe('flat');
      if (profile.roof !== 'flat') {
        expect(profile.waterTank).toBe(false);
        expect(profile.roofHeight).toBeGreaterThan(0);
        // The original-reference church study adopted a steeper 3.2 m gable;
        // ordinary pitched roofs retain their existing 3 m envelope.
        expect(profile.roofHeight, type.id).toBeLessThanOrEqual(type.id === 'church' ? 3.2 : 3);
      }
      if (type.id === 'church') expect(profile.roof).toBe('gable');
    }
  });

  it('keeps all eight edge sites and their picking margins clear of rotated centre sites', () => {
    const centreType = BUILDING_TYPES.find(type => type.id === 'moonshineStill')!;
    for (const destroyed of [false, true]) {
      const centre = building(centreType);
      if (destroyed) centre.state = 'destroyed';
      const centreProfile = profileFor(centre, centreType);
      const reservation = centreSiteHalfExtent(centreProfile);
      for (const type of BUILDING_TYPES.filter(type => type.cls !== 'illegal')) for (let index = 0; index < 9; index++) {
        if (index === CENTRE_LOT) continue;
        const x = (index % 3 - 1) * LOT_SIZE, z = (Math.floor(index / 3) - 1) * LOT_SIZE;
        const yaw = Math.abs(x) > Math.abs(z) ? x > 0 ? Math.PI / 2 : -Math.PI / 2 : z > 0 ? 0 : Math.PI;
        const profile = profileFor(building(type), type);
        const { masses, extension } = massesForView(profile, index % 2 === 1, false, reservation);
        const m = masses[0];
        const box = new THREE.Box3(new THREE.Vector3(-profile.width / 2 - .6, 0, -profile.depth / 2 - extension - .6),
          new THREE.Vector3(profile.width / 2 + .6, 1, profile.depth / 2 + .6));
        const matrix = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
        box.applyMatrix4(matrix);
        const body = new THREE.Box3(new THREE.Vector3(m.dx - m.w / 2, 0, m.dz - m.d / 2),
          new THREE.Vector3(m.dx + m.w / 2, 1, m.dz + m.d / 2)).applyMatrix4(matrix);
        expect(box.containsBox(body)).toBe(true);
        for (let turn = 0; turn < 4; turn++) {
          const centreBox = new THREE.Box3(new THREE.Vector3(-centreProfile.width / 2 - .6, 0, -centreProfile.depth / 2 - .6),
            new THREE.Vector3(centreProfile.width / 2 + .6, 1, centreProfile.depth / 2 + .6));
          centreBox.applyMatrix4(new THREE.Matrix4().makeRotationY(turn * Math.PI / 2));
          expect(box.intersectsBox(centreBox)).toBe(false);
        }
        expect(massesForView(profile, index % 2 === 1, true, reservation).masses[0]).toEqual(m);
      }
    }
  });

  it('creates a roofless cutaway shell and an open one-sided frontage', () => {
    const shell = wallShellGeometry(true), front = frontageGeometry();
    expect(shell.getIndex()!.count).toBe(48);
    const normals = shell.getAttribute('normal');
    for (let i = 0; i < normals.count; i++) expect(normals.getY(i)).toBeCloseTo(0, 8);
    expect(shell.groups).toEqual([{ start: 0, count: 48, materialIndex: 0 }]);
    front.computeBoundingBox();
    expect(front.boundingBox!.min.toArray()).toEqual([-.5, 0, 0]);
    expect(front.boundingBox!.max.toArray()).toEqual([.5, 1, 0]);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, .5, 1), new THREE.Vector3(0, 0, -1));
    const mat = new THREE.MeshBasicMaterial();
    expect(ray.intersectObject(new THREE.Mesh(front, mat)).length).toBeGreaterThan(0);
    const cutaway = new THREE.Mesh(shell, mat);
    expect(mat.side).toBe(THREE.FrontSide);
    for (const direction of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)]) {
      const inside = new THREE.Raycaster(new THREE.Vector3(0, .5, 0), direction).intersectObject(cutaway);
      expect(inside.length).toBeGreaterThan(0);
      expect(inside[0].distance).toBeCloseTo(.5);
      expect(inside[0].face!.normal.dot(direction)).toBeCloseTo(-1);
      const outside = new THREE.Raycaster(new THREE.Vector3(0, .5, 0).addScaledVector(direction, 2),
        direction.clone().negate()).intersectObject(cutaway);
      expect(outside[0].distance).toBeCloseTo(1.5);
    }
    expect(new THREE.Raycaster(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, -1, 0)).intersectObject(cutaway)).toHaveLength(0);
    shell.dispose(); front.dispose(); mat.dispose();
  });

  it('provides valid bounded geometry and unobstructed upward cutaway floors', () => {
    for (const geometry of [interiorGeometry(), interiorGeometry(true), pitchedRoofGeometry(), pitchedRoofGeometry(true)]) {
      const pos = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
      expect(pos.count).toBeLessThan(1100);
      expect(pos.count % 3).toBe(0);
      for (let i = 0; i < pos.count; i++) {
        for (const value of [pos.getX(i), pos.getY(i), pos.getZ(i)]) expect(Number.isFinite(value)).toBe(true);
        expect(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i))).toBeCloseTo(1, 5);
      }
      expect(geometry.boundingBox!.min.x).toBeGreaterThanOrEqual(-.501);
      expect(geometry.boundingBox!.max.x).toBeLessThanOrEqual(.501);
      if (geometry.userData.openTop) {
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
        const topDown = new THREE.Raycaster(new THREE.Vector3(.36, 2, .24), new THREE.Vector3(0, -1, 0));
        const hits = topDown.intersectObject(mesh);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].point.y).toBeCloseTo(.071, 4);
        const doorway = new THREE.Raycaster(new THREE.Vector3(-.45, .65, 0), new THREE.Vector3(1, 0, 0), 0, .9);
        expect(doorway.intersectObject(mesh)).toHaveLength(0);
        mesh.material.dispose();
      } else {
        expect(geometry.boundingBox!.max.y).toBeCloseTo(1);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
        const ray = new THREE.Raycaster(new THREE.Vector3(.25, 2, 0), new THREE.Vector3(0, -1, 0));
        expect(ray.intersectObject(mesh)[0].point.y).toBeCloseTo(.5, 2);
        mesh.material.dispose();
      }
      geometry.dispose();
    }
  });

  it('restricts shutter plinths to industrial sites and never adds entry doors to hidden illegal sites', () => {
    for (const type of BUILDING_TYPES) for (let id = 1; id <= 16; id++) {
      const profile = profileFor(building(type, id), type);
      if (profile.base === 'plinth') expect(type.cls).toBe('industrial');
      if (type.cls === 'municipal' || type.cls === 'charity') expect(profile.base).toBe('entry');
      if (type.cls === 'tenement') expect(['shop', 'entry']).toContain(profile.base);
      if (type.cls === 'illegal') expect(profile.base).toBe('none');
      const destroyed = building(type, id); destroyed.state = 'destroyed';
      expect(profileFor(destroyed, type).base).toBe('none');
    }
  });

  it('preserves doorway width and detail height when clipping lowered entrances', () => {
    const full = entryDoorGeometry(), cut = entryDoorGeometry(true);
    const material = new THREE.MeshBasicMaterial();
    const fullMesh = new THREE.Mesh(full, material), cutMesh = new THREE.Mesh(cut, material);
    expect(full.boundingBox!.min.x).toBeCloseTo(-.65);
    expect(full.boundingBox!.max.x).toBeCloseTo(.65);
    expect(full.boundingBox!.max.y).toBeCloseTo(2.82);
    expect(cut.boundingBox!.max.y).toBeCloseTo(1.25);
    expect(cut.boundingBox!.min.x).toBeCloseTo(full.boundingBox!.min.x);
    expect(cut.boundingBox!.max.x).toBeCloseTo(full.boundingBox!.max.x);
    const lowRay = new THREE.Raycaster(new THREE.Vector3(0, .70, 1), new THREE.Vector3(0, 0, -1));
    expect(lowRay.intersectObject(cutMesh)[0].point.z).toBeCloseTo(lowRay.intersectObject(fullMesh)[0].point.z, 6);
    const highRay = new THREE.Raycaster(new THREE.Vector3(0, 2.2, 1), new THREE.Vector3(0, 0, -1));
    expect(highRay.intersectObject(fullMesh).length).toBeGreaterThan(0);
    expect(highRay.intersectObject(cutMesh)).toHaveLength(0);
    for (const geometry of [full, cut]) {
      const normals = geometry.getAttribute('normal');
      for (let i = 0; i < normals.count; i++)
        expect(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i))).toBeCloseTo(1, 5);
      geometry.dispose();
    }
    material.dispose();
  });
  it('keeps lamps at the original’s proportion to people, and hydrants at human scale', () => {
    const lamp = lampPostGeometry(), glow = lampGlowGeometry(), hydrant = hydrantGeometry();
    for (const geometry of [lamp, glow, hydrant]) geometry.computeBoundingBox();
    expect(lamp.boundingBox!.min.y).toBeCloseTo(0, 5);
    // A23: about 1.8 people tall, as the original's corner lamp (3.25 m).
    expect(lamp.boundingBox!.max.y).toBeCloseTo(3.25, 2);
    expect(glow.boundingBox!.max.y).toBeCloseTo(3.25, 2);
    expect(hydrant.boundingBox!.max.y).toBeCloseTo(.78, 4);
    expect(hydrant.boundingBox!.getSize(new THREE.Vector3()).x).toBeLessThanOrEqual(.401);
    for (const geometry of [lamp, glow, hydrant]) geometry.dispose();
  });
});
