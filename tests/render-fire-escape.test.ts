import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CityRenderer } from '../src/render/scene';
import { BuildingPickBounds } from '../src/render/buildingPickBounds';
import { InstancePool } from '../src/render/pool';
import { columnGeometry, pedimentGeometry, spireGeometry, domeGeometry, fireEscapeGeometry, slabGeometry, wallShellGeometry } from '../src/render/geometry';
import { massesForView, sectionMasses } from '../src/render/architecture';
import { profileFor } from '../src/render/profile';
import { FIRE_ESCAPE, fireEscapeLevels } from '../src/render/fireEscapeLayout';
import { STOREY_H, TILE_STOREYS } from '../src/render/util';
import { BUILDING_BY_ID } from '../src/sim/data/buildings';
import type { Building, WorldState as World } from '../src/sim/types';
import { LOT_SIZE } from '../src/sim/world';
import { BLOCK_SIZE, CELL, STREET_WIDTH } from '../src/sim/constants';

const TARGET = 5165, CENTRE = 989;
const cleanup: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });
function building(typeId: string, id: number, lotId: number): Building {
  return { id, typeId, cls: BUILDING_BY_ID[typeId].cls, state: 'trading', lotId, blockId: 0,
    ownerGangId: null, managerId: null, ownerPersonId: null, protection: null, frontId: null, hidesId: null,
    stock: { liquor: 0, stolen: 0, counterfeit: 0 }, lastProfit: 0, repairCost: 0, cover: 0, fbiSuspicion: 0,
    discovered: false, knowledge: {}, guardIds: [], isHQ: false };
}
function fixture(typeId = 'bankSmall', index = 7, withCentre = false) {
  // Captured gallery block coordinates: exercise actual world-scale Float32
  // instance matrices, rather than only easy geometry around the origin.
  const cx = 15 * CELL + STREET_WIDTH / 2 + BLOCK_SIZE / 2;
  const cz = 13 * CELL + STREET_WIDTH / 2 + BLOCK_SIZE / 2;
  const lots = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i, { id: i, index: i, blockId: 0,
    center: { x: cx + (i % 3 - 1) * LOT_SIZE, y: cz + (Math.floor(i / 3) - 1) * LOT_SIZE },
    buildingId: i === index ? TARGET : i === 4 && withCentre ? CENTRE : 100 + i }]));
  const target = building(typeId, TARGET, index);
  const buildings: Record<number, Building> = { [TARGET]: target };
  if (withCentre) buildings[CENTRE] = building('moonshineStill', CENTRE, 4);
  // A renderer-only fixture: these are exactly the World fields used by
  // refreshBuildings/pick, with real lot centres and no simulation claims.
  const world = { gridW: 18, gridH: 18, buildings, lots, gangs: {},
    blocks: [{ id: 0, gx: 15, gy: 13, center: { x: cx, y: cz }, lotIds: Array.from({ length: 9 }, (_, i) => i) }] } as unknown as World;
  const pool = (geometry = slabGeometry()) => new InstancePool(geometry, new THREE.MeshBasicMaterial(), 64, { color: true });
  const wallPools = Array.from({ length: 8 }, () => pool(wallShellGeometry()));
  const cutawayWalls = Array.from({ length: 8 }, () => pool(wallShellGeometry(true)));
  const names = ['interiorRooms', 'interiorWorks', 'entryDoors', 'cutawayDoors', 'gableRoofs', 'hipRoofs',
    'cornice', 'shopBase', 'plinthBase', 'signs', 'banners', 'awnings', 'fireEscapes', 'sawteeth', 'tanks',
    'chimneys', 'bulkheads', 'columns', 'pediments', 'spires', 'domes', 'picks'];
  const pools = Object.fromEntries(names.map(name => [name, pool(name === 'columns' ? columnGeometry()
    : name === 'pediments' ? pedimentGeometry() : name === 'spires' ? spireGeometry()
    : name === 'domes' ? domeGeometry() : name === 'fireEscapes' ? fireEscapeGeometry() : slabGeometry())]));
  pools.picks.makePickable(); pools.picks.mesh.visible = false;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), new THREE.MeshBasicMaterial());
  ground.rotation.x = -Math.PI / 2; ground.updateMatrixWorld(true);
  const agentMesh = new THREE.InstancedMesh(slabGeometry(), new THREE.MeshBasicMaterial(), 1);
  agentMesh.count = 0;
  const camera = new THREE.OrthographicCamera(-30, 30, 30, -30, .1, 300);
  const state: Record<string, unknown> = { world, tex: { signs: { index: {} } }, hiddenRoofs: false,
    planningAvailable: new Set(), planningSelected: new Set(), planningCrimes: new Set(),
    buildingViews: new Map(), buildingViewMeshes: new Map(), foregroundCutaways: new Set(),
    overlays: [], overlayGang: null, footprints: new Map(), buildingPickBounds: new BuildingPickBounds(),
    dummy: new THREE.Object3D(), colorScratch: new THREE.Color(), tintScratch: new THREE.Color(), uvScratch: new THREE.Vector4(),
    wallPools, cutawayWalls, decor: Object.values(pools), ...pools,
    camera, raycaster: new THREE.Raycaster(), pointer: new THREE.Vector2(), ground, streetsOpen: false, agentMesh, agentIds: [777] };
  const renderer = Object.setPrototypeOf(state, CityRenderer.prototype) as unknown as CityRenderer;
  // `ground`: the target stands between the camera and its focus, so it opens
  // at the pavement; otherwise an opened building shows its top storey.
  const refresh = (lowered = false, ground = true) => {
    state.hiddenRoofs = lowered; state.foregroundCutaways = new Set(lowered && ground ? [TARGET] : []);
    renderer.refreshBuildings();
  };
  // getMatrixAt writes into its argument and returns void.
  const matrixFor = (name: string, slot = 0) => {
    const matrix = new THREE.Matrix4(); pools[name].mesh.getMatrixAt(slot, matrix); return matrix;
  };
  const proxy = (id = TARGET) => {
    const slot = (state.buildingIds as number[]).indexOf(id), matrix = new THREE.Matrix4();
    expect(slot).toBeGreaterThanOrEqual(0); pools.picks.mesh.getMatrixAt(slot, matrix);
    return new THREE.Box3().setFromBufferAttribute(pools.picks.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).applyMatrix4(matrix);
  };
  const pickRay = (origin: THREE.Vector3, point: THREE.Vector3, actor = false) => {
    camera.position.copy(origin); camera.up.set(0, Math.abs(origin.y - point.y) > 20 ? 0 : 1, Math.abs(origin.y - point.y) > 20 ? -1 : 0);
    camera.lookAt(point); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    state.streetsOpen = actor;
    return renderer.pick(500, 500, { left: 0, top: 0, width: 1000, height: 1000 } as DOMRect);
  };
  const geometryHits = (name: string, origin: THREE.Vector3, point: THREE.Vector3) => {
    const ray = new THREE.Raycaster(origin, point.clone().sub(origin).normalize());
    const hits: THREE.Intersection[] = [];
    THREE.InstancedMesh.prototype.raycast.call(pools[name].mesh, ray, hits);
    return hits;
  };
  cleanup.push(() => {
    for (const p of [...wallPools, ...cutawayWalls, ...Object.values(pools)]) p.dispose();
    ground.geometry.dispose(); ground.material.dispose(); agentMesh.geometry.dispose();
    (agentMesh.material as THREE.Material).dispose(); agentMesh.dispose();
  });
  return { renderer, state, world, target, pools, agentMesh, refresh, matrixFor, proxy, pickRay, geometryHits };
}



describe('open fire escape geometry and facade-floor placement', () => {
  it('leaves real holes between landing bars and between stair treads', () => {
    const g = fireEscapeGeometry(), m = new THREE.MeshBasicMaterial(), mesh = new THREE.Mesh(g, m);
    cleanup.push(() => { g.dispose(); m.dispose(); });
    // Landing support at x=0; adjacent grating opening at x=.23. Stair is further out in Z.
    expect(new THREE.Raycaster(new THREE.Vector3(0, .3, .5), new THREE.Vector3(0, -1, 0), 0, .5).intersectObject(mesh).length).toBeGreaterThan(0);
    expect(new THREE.Raycaster(new THREE.Vector3(.23, .3, .5), new THREE.Vector3(0, -1, 0), 0, .5).intersectObject(mesh)).toHaveLength(0);
    // Vertical front ray through the centre of a tread, then through the open riser above it.
    const y = -FIRE_ESCAPE.rise / 2;
    expect(new THREE.Raycaster(new THREE.Vector3(0, y - .02, 3), new THREE.Vector3(0, 0, -1), 0, 2).intersectObject(mesh).length).toBeGreaterThan(0);
    expect(new THREE.Raycaster(new THREE.Vector3(0, y + .15, 3), new THREE.Vector3(0, 0, -1), 0, 2).intersectObject(mesh)).toHaveLength(0);
  });

  it('joins both physical ends of a 4.2m flight and keeps every tread level', () => {
    const g = fireEscapeGeometry(), m = new THREE.MeshBasicMaterial(), mesh = new THREE.Mesh(g, m);
    cleanup.push(() => { g.dispose(); m.dispose(); });
    for (let step = 0; step <= FIRE_ESCAPE.steps; step++) {
      const t = step / FIRE_ESCAPE.steps, x = -FIRE_ESCAPE.flightRun / 2 + t * FIRE_ESCAPE.flightRun;
      const y = -FIRE_ESCAPE.rise + t * FIRE_ESCAPE.rise;
      const hit = new THREE.Raycaster(new THREE.Vector3(x, y + .1, FIRE_ESCAPE.flightCentreZ), new THREE.Vector3(0, -1, 0), 0, .2).intersectObject(mesh)[0];
      expect(hit, 'tread ' + step).toBeDefined(); expect(hit.point.y).toBeCloseTo(y, 5);
      expect(hit.face!.normal.y).toBeCloseTo(1, 6);
    }
    g.computeBoundingBox(); expect(g.boundingBox!.max.y).toBeLessThan(1.04);
    expect(g.boundingBox!.min.y).toBeGreaterThan(-STOREY_H - .06);
    expect(g.getAttribute('position').count / 3).toBeLessThanOrEqual(720);
  });

  it('uses explicit dark sRGB iron and finite non-degenerate geometry', () => {
    const g = fireEscapeGeometry(); cleanup.push(() => g.dispose());
    const position = g.getAttribute('position'), normal = g.getAttribute('normal'), colours = g.getAttribute('color');
    const expected = new THREE.Color(0x424640);
    expect(colours.getX(0)).toBeCloseTo(expected.r, 7); expect(colours.getY(0)).toBeCloseTo(expected.g, 7);
    for (const attribute of [position, normal, colours]) for (const value of attribute.array) expect(Number.isFinite(value)).toBe(true);
    for (let i = 0; i < position.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(position, i), b = new THREE.Vector3().fromBufferAttribute(position, i + 1), c = new THREE.Vector3().fromBufferAttribute(position, i + 2);
      expect(b.sub(a).cross(c.sub(a)).lengthSq()).toBeGreaterThan(1e-12);
    }
  });

  it('aligns floor intervals with unshifted facade UVs and caps every top rail below the mass roof', () => {
    for (const type of ['tenementPoor', 'tenementMid', 'tenementRich']) for (const id of [1, 404, 5165, 938]) {
      const b = building(type, id, 7), p = profileFor(b, BUILDING_BY_ID[type]);
      const mass = massesForView(p, true, false).masses[0], levels = fireEscapeLevels(p, mass);
      expect(levels.length).toBeGreaterThan(0);
      for (let i = 0; i < levels.length; i++) {
        expect(levels[i] - mass.y).toBeCloseTo((i + 1) * STOREY_H, 10);
        const shellV = (levels[i] - mass.y) / mass.h;
        const facadeV = shellV * mass.h / (TILE_STOREYS * STOREY_H);
        expect(facadeV * TILE_STOREYS).toBeCloseTo(i + 1, 10);
        expect(levels[i] + FIRE_ESCAPE.railHeight + FIRE_ESCAPE.railThickness / 2).toBeLessThanOrEqual(mass.y + mass.h - .10);
      }
      expect(fireEscapeLevels({ ...p, baseHeight: p.baseHeight + 2 }, mass)).toEqual(levels);
      expect(fireEscapeLevels({ ...p, fireEscapes: 0 }, mass)).toEqual([]);
      expect(fireEscapeLevels(p, { ...mass, h: 4.9 })).toEqual([]);
    }
  });

  it('places actual escapes without roof or ground overrun in each frontage, retaining centre clearance and public picking', () => {
    for (const type of ['tenementPoor', 'tenementMid', 'tenementRich']) for (const index of [0, 1, 2, 3, 5, 6, 7, 8]) {
      const f = fixture(type, index, true), before = JSON.stringify(f.world); f.refresh();
      const p = profileFor(f.target, BUILDING_BY_ID[type]), mass = massesForView(p, index % 2 === 1, false).masses[0];
      const levels = fireEscapeLevels(p, mass), pool = f.pools.fireEscapes, geometry = pool.mesh.geometry;
      expect(pool.count).toBe(levels.length); geometry.computeBoundingBox();
      const proxy = f.proxy().expandByScalar(.00005);
      for (let slot = 0; slot < pool.count; slot++) {
        const matrix = f.matrixFor('fireEscapes', slot), placed = geometry.boundingBox!.clone().applyMatrix4(matrix);
        expect(placed.min.y).toBeGreaterThan(.20); expect(placed.max.y).toBeLessThan(p.height + .34);
        expect(proxy.containsBox(placed)).toBe(true);
      }
      const matrix = f.matrixFor('fireEscapes', pool.count - 1), point = new THREE.Vector3(2.3, .5, 1.99).applyMatrix4(matrix);
      const origin = point.clone().addScaledVector(new THREE.Vector3(0, 0, 1).transformDirection(matrix), 30);
      expect(f.geometryHits('fireEscapes', origin, point).length).toBeGreaterThan(0);
      expect(f.pickRay(origin, point).buildingId).toBe(TARGET);
      expect(f.proxy().intersectsBox(f.proxy(CENTRE))).toBe(false);
      f.refresh(true);
      const cutMass = sectionMasses([mass],true)[0];
      expect(pool.count).toBe(fireEscapeLevels(p,cutMass).length);
      for (let slot=0;slot<pool.count;slot++) {
        const placed=geometry.boundingBox!.clone().applyMatrix4(f.matrixFor('fireEscapes',slot));
        expect(placed.max.y).toBeLessThan(cutMass.y+cutMass.h+.34);
      }
      expect(pool.count).toBe(0);
      // With every upper floor removed, the remaining ground footprint is pickable.
      const groundCentre=f.world.lots[f.target.lotId].center;
      const cutPoint=new THREE.Vector3(groundCentre.x,.8,groundCentre.y);
      expect(f.pickRay(cutPoint.clone().add(new THREE.Vector3(0,30,0)),cutPoint).buildingId).toBe(TARGET);
      expect(JSON.stringify(f.world)).toBe(before);
    }
  });
});
