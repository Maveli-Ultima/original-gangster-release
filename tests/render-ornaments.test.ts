import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILDING_TYPES } from '../src/sim/data/buildings';
import type { Building } from '../src/sim/types';
import { profileFor } from '../src/render/profile';
import { massesForView } from '../src/render/architecture';
import { domeGeometry, spireGeometry, columnGeometry } from '../src/render/geometry';
import { BELFRY, CIVIC_DOME, churchBelfryLayout, civicDomeLayout, ornamentRgb, ORNAMENT_PALETTE, porticoColumnScale } from '../src/render/ornamentLayout';

function profile(typeId: string, id = 5165) {
  const type = BUILDING_TYPES.find(t => t.id === typeId)!;
  return profileFor({ id, typeId, cls: type.cls, state: 'trading' } as Building, type);
}

function box(g: THREE.BufferGeometry) { g.computeBoundingBox(); return g.boundingBox!; }

describe('bounded church and civic ornaments', () => {
  it('creates real belfry openings on four sides and a compact finite silhouette', () => {
    const geometry = spireGeometry(), bounds = box(geometry), mat = new THREE.MeshBasicMaterial(), mesh = new THREE.Mesh(geometry, mat);
    expect(bounds.min.y).toBeCloseTo(0, 5); expect(bounds.max.y).toBeCloseTo(BELFRY.height, 5);
    expect(bounds.getSize(new THREE.Vector3()).x).toBeLessThan(3.1);
    expect(geometry.getAttribute('position').count / 3).toBeLessThan(220);
    const height = (BELFRY.openingBottom + BELFRY.openingTop) / 2;
    for (const axis of [0, 1, 2, 3]) {
      const rotation = new THREE.Matrix4().makeRotationY(axis * Math.PI / 2);
      // Offset bypasses the physical bell and all four corner piers.
      const origin = new THREE.Vector3(.7, height, 3).applyMatrix4(rotation);
      const direction = new THREE.Vector3(0, 0, -1).transformDirection(rotation);
      expect(new THREE.Raycaster(origin, direction, 0, 6).intersectObject(mesh)).toHaveLength(0);
      const pierOrigin = new THREE.Vector3(1.12, height, 3).applyMatrix4(rotation);
      expect(new THREE.Raycaster(pierOrigin, direction, 0, 6).intersectObject(mesh).length).toBeGreaterThan(0);
    }
    geometry.dispose(); mat.dispose();
  });

  it('keeps the tower behind the entrance gable and the steep spire above the nave', () => {
    for (const id of [1, 404, 5165, 938]) for (const edge of [false, true]) {
      const p = profile('church', id), [nave, tower] = massesForView(p, edge, false).masses;
      const layout = churchBelfryLayout(tower);
      expect(p.roof).toBe('gable');
      expect(tower.dz - tower.d / 2).toBeCloseTo(p.masses[0].dz - p.masses[0].d / 2, 4);
      expect(tower.w).toBeLessThan(nave.w);
      expect(layout.baseY).toBeCloseTo(tower.y + tower.h - .08, 5);
      expect(layout.baseY + BELFRY.openingBottom * layout.scaleY).toBeGreaterThan(tower.h + 1);
      expect(layout.top).toBeGreaterThan((nave.h + p.roofHeight) * 1.8);
      expect(layout.top).toBeLessThan((nave.h + p.roofHeight) * 2.2);
      expect(BELFRY.baseWidth * layout.scaleXZ).toBeLessThan(tower.w);
    }
  });

  it('keeps the dome shallow, seated, centred and contained for both civic profiles', () => {
    const geometry = domeGeometry(), bounds = box(geometry);
    expect(bounds.min.y).toBeCloseTo(0, 6); expect(bounds.max.y).toBeCloseTo(CIVIC_DOME.height, 6);
    expect(bounds.getSize(new THREE.Vector3()).x).toBeCloseTo(CIVIC_DOME.width, 6);
    for (const name of ['cityHall', 'courthouse']) for (const edge of [false, true]) {
      const p = profile(name), mass = massesForView(p, edge, false).masses[0], layout = civicDomeLayout(mass);
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(layout.x, layout.baseY, layout.z),
        new THREE.Quaternion(), new THREE.Vector3(layout.scaleXZ, layout.scaleY, layout.scaleXZ));
      const placed = bounds.clone().applyMatrix4(matrix), size = placed.getSize(new THREE.Vector3());
      expect(size.x).toBeGreaterThan(6); expect(size.x).toBeLessThan(7.2);
      expect(size.y).toBeGreaterThan(4); expect(size.y).toBeLessThan(5.1);
      expect(size.y / size.x).toBeCloseTo(.70, 5);
      expect(placed.min.y).toBeCloseTo(mass.y + mass.h - .025, 5);
      expect(placed.max.y).toBeCloseTo(layout.top, 5);
      expect(placed.min.x).toBeGreaterThan(mass.dx - mass.w / 2);
      expect(placed.max.z).toBeLessThan(mass.dz + mass.d / 2);
    }
    geometry.dispose();
  });

  it('reduces municipal column height while preserving original bank column behavior', () => {
    const geometry = columnGeometry(), unitHeight = box(geometry).max.y;
    for (const name of ['cityHall', 'courthouse', 'policeHQ']) {
      const p = profile(name);
      expect(porticoColumnScale(p, true) * unitHeight).toBeCloseTo(4.45, 5);
      expect(porticoColumnScale(p, true) * unitHeight).toBeGreaterThan(2.82);
    }
    for (const name of ['bankSmall', 'bankLarge']) {
      const p = profile(name);
      expect(porticoColumnScale(p, false)).toBeCloseTo(9.24, 5);
    }
    geometry.dispose();
  });

  it('uses explicit sRGB-derived muted ornament colours without non-finite attributes', () => {
    const known = ornamentRgb(ORNAMENT_PALETTE.stone);
    const srgb = ((ORNAMENT_PALETTE.stone >> 16) & 255) / 255;
    expect(known[0]).toBeCloseTo(Math.pow((srgb + .055) / 1.055, 2.4), 6);
    for (const geometry of [spireGeometry(), domeGeometry()]) {
      for (const name of ['position', 'normal', 'color']) for (const v of geometry.getAttribute(name).array) expect(Number.isFinite(v)).toBe(true);
      const colours = geometry.getAttribute('color');
      let brightest = 0;
      for (const value of colours.array) brightest = Math.max(brightest, value);
      expect(brightest).toBeLessThan(.5); // authored stone, not raw-linear white primitives
      geometry.dispose();
    }
  });
});

describe('belfry finial continuity', () => {
  it('keeps the cross stem joined to the steep slate cone without increasing the authored height', () => {
    const geometry = spireGeometry(), material = new THREE.MeshBasicMaterial(), mesh = new THREE.Mesh(geometry, material);
    for (const y of [8.40, 8.41, 8.42, 8.43, 8.44, 8.45])
      expect(new THREE.Raycaster(new THREE.Vector3(0, y, 1), new THREE.Vector3(0, 0, -1)).intersectObject(mesh).length, 'join y=' + y).toBeGreaterThan(0);
    geometry.computeBoundingBox(); expect(geometry.boundingBox!.max.y).toBeCloseTo(BELFRY.height, 5);
    geometry.dispose(); material.dispose();
  });
});
