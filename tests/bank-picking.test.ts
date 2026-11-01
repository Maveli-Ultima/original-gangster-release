import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CityRenderer } from '../src/render/scene';
import { BuildingPickBounds } from '../src/render/buildingPickBounds';
import { InstancePool } from '../src/render/pool';
import { columnGeometry, pedimentGeometry, spireGeometry, domeGeometry, slabGeometry, wallShellGeometry } from '../src/render/geometry';
import { frontOf, massesForView } from '../src/render/architecture';
import { profileFor } from '../src/render/profile';
import { BUILDING_BY_ID } from '../src/sim/data/buildings';
import type { Building, Person, WorldState as World } from '../src/sim/types';
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
    : name === 'domes' ? domeGeometry() : slabGeometry())]));
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

describe('bank pediment and visible portico picking', () => {
  it('picks the centre of specialist markers while street actors are hidden, then clears them', () => {
    const f = fixture(), pos = f.world.lots[f.target.lotId].center;
    f.state.scene = new THREE.Scene();
    f.renderer.setPlanningPeople([{ id: 123, pos } as Person], 123);
    const marks = f.state.planningPersonMarks as InstancePool;
    cleanup.push(() => marks.dispose());
    expect(marks.count).toBe(1);
    const color = new THREE.Color(); marks.mesh.getColorAt(0, color);
    expect(color.getHex()).toBe(0xd63832);
    const aim = new THREE.Vector3(pos.x, .35 + .18, pos.y);
    expect(f.pickRay(aim.clone().add(new THREE.Vector3(40, 50, 40)), aim).personId).toBe(123);
    f.renderer.setPlanningPeople([], null);
    expect(marks.count).toBe(0);
    expect(f.pickRay(aim.clone().add(new THREE.Vector3(40, 50, 40)), aim).personId).toBeNull();
  });
  it('centres the triangular roof over its entablature instead of projecting a sideways blade', () => {
    const geometry = pedimentGeometry(); cleanup.push(() => geometry.dispose());
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    expect(bounds.min.x).toBeCloseTo(-.5, 6); expect(bounds.max.x).toBeCloseTo(.5, 6);
    expect(bounds.min.z).toBeCloseTo(-.5, 6); expect(bounds.max.z).toBeCloseTo(.5, 6);
    const material = new THREE.MeshBasicMaterial(); cleanup.push(() => material.dispose());
    const mesh = new THREE.Mesh(geometry, material);
    for (const x of [-.4, -.2, 0, .2, .4]) {
      const hit = new THREE.Raycaster(new THREE.Vector3(x, 2, .2), new THREE.Vector3(0, -1, 0)).intersectObject(mesh)[0];
      expect(hit).toBeDefined(); expect(hit.point.y).toBeCloseTo(.26 + .55 * (1 - Math.abs(x) * 2), 5);
    }
  });

  it('contains the actual column and pediment vertices for both banks on every edge/corner lot', () => {
    for (const type of ['bankSmall', 'bankLarge']) for (const index of [0, 1, 2, 3, 5, 6, 7, 8]) {
      const f = fixture(type, index); f.refresh(); const pick = f.proxy().expandByScalar(.00002);
      for (const name of ['columns', 'pediments']) {
        const pool = f.pools[name], positions = pool.mesh.geometry.getAttribute('position');
        expect(pool.count).toBeGreaterThan(0);
        for (let slot = 0; slot < pool.count; slot++) {
          const matrix = f.matrixFor(name, slot);
          for (let vertex = 0; vertex < positions.count; vertex++) {
            const point = new THREE.Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(matrix);
            expect(pick.containsPoint(point), `${type} lot${index} ${name} vertex${vertex}`).toBe(true);
          }
        }
      }
    }
  });

  it('selects the bank from a ray through its visible forward pediment overhang', () => {
    const f = fixture(); f.refresh();
    const point = new THREE.Vector3(0, .5, .4).applyMatrix4(f.matrixFor('pediments'));
    const origin = point.clone().add(new THREE.Vector3(0, 40, 0));
    expect(f.geometryHits('pediments', origin, point).length).toBeGreaterThan(0);
    expect(f.pickRay(origin, point).buildingId).toBe(TARGET);
  });

  it('keeps the portico extension outward and leaves the reserved centre-site proxy clear', () => {
    for (const type of ['bankSmall', 'bankLarge']) for (const index of [0, 1, 2, 3, 5, 6, 7, 8]) {
      const f = fixture(type, index, true); f.refresh();
      expect(f.proxy().intersectsBox(f.proxy(CENTRE)), `${type} lot${index}`).toBe(false);
    }
  });

  it('removes upper portico details and keeps the ground-floor footprint pickable', () => {
    const f = fixture(), before = JSON.stringify(f.world); f.refresh();
    const point = new THREE.Vector3(0, .5, .4).applyMatrix4(f.matrixFor('pediments'));
    const origin = point.clone().add(new THREE.Vector3(0, 40, 0));
    expect(f.pickRay(origin, point).buildingId).toBe(TARGET);
    f.refresh(true);
    expect(f.pools.columns.count).toBe(0); expect(f.pools.pediments.count).toBe(0);
    expect(f.proxy().max.y).toBeCloseTo(1.69, 4);
    const lot=f.world.lots[f.target.lotId];
    const groundPoint=new THREE.Vector3(lot.center.x,.8,lot.center.y);
    expect(f.pickRay(groundPoint.clone().add(new THREE.Vector3(0,40,0)),groundPoint).buildingId).toBe(TARGET);
    expect(f.pickRay(point.clone().add(new THREE.Vector3(0,0,40)),point).buildingId).toBeNull();
    // Opened at the top storey instead, the portico stays on the full facade.
    f.refresh(true, false);
    expect(f.pools.columns.count).toBeGreaterThan(0);
    expect(f.proxy().max.y).toBeGreaterThan(4);
    expect(f.pickRay(groundPoint.clone().add(new THREE.Vector3(0,40,0)),groundPoint).buildingId).toBe(TARGET);
    expect(JSON.stringify(f.world)).toBe(before);
  });

  it('refreshes the cached aggregate bound when the roof is restored', () => {
    const f = fixture(); f.refresh(true);
    const lot = f.world.lots[f.target.lotId], profile = profileFor(f.target, BUILDING_BY_ID[f.target.typeId]);
    const point = new THREE.Vector3(lot.center.x, .7, lot.center.y + profile.depth / 2);
    expect(f.pickRay(point.clone().add(new THREE.Vector3(0, 0, 40)), point).buildingId).toBe(TARGET);
    expect(f.pools.picks.mesh.boundingSphere).not.toBeNull();
    f.refresh();
    point.y = profile.height * .94;
    expect(f.pickRay(point.clone().add(new THREE.Vector3(0, 0, 40)), point).buildingId).toBe(TARGET);
  });

  it('retains current-person picking on top of the widened building proxy', () => {
    const f = fixture(); f.refresh();
    const point = new THREE.Vector3(0, .5, .4).applyMatrix4(f.matrixFor('pediments'));
    const matrix = new THREE.Matrix4().makeScale(.4, 1.95, .4).setPosition(point.x, .348, point.z);
    f.agentMesh.setMatrixAt(0, matrix); f.agentMesh.count = 1;
    const result = f.pickRay(point.clone().add(new THREE.Vector3(0, 40, 0)), point, true);
    expect(result.personId).toBe(777); expect(result.buildingId).toBe(TARGET);
  });

  it('keeps the outward facade in the same place when extending an edge building inward', () => {
    const b = building('bankSmall', TARGET, 7), p = profileFor(b, BUILDING_BY_ID.bankSmall);
    const full = massesForView(p, true, false), cut = massesForView(p, true, true);
    expect(frontOf(full.masses[0])).toEqual(frontOf(cut.masses[0]));
    expect(frontOf(full.masses[0]).z).toBeCloseTo(frontOf(p.masses[0]).z, 10);
  });
});


describe('combined ornament transforms and public picking', () => {
  it('contains real civic porticos, church spires and civic domes on all eight frontage rotations', () => {
    for (const type of ['church', 'cityHall', 'courthouse', 'policeHQ']) for (const index of [0, 1, 2, 3, 5, 6, 7, 8]) {
      const f = fixture(type, index, true), before = JSON.stringify(f.world); f.refresh();
      const pick = f.proxy().expandByScalar(.00004);
      const names = type === 'church' ? ['spires'] : type === 'policeHQ' ? ['columns', 'pediments'] : ['columns', 'pediments', 'domes'];
      for (const name of names) {
        const pool = f.pools[name], positions = pool.mesh.geometry.getAttribute('position');
        expect(pool.count, type + ' ' + name).toBeGreaterThan(0);
        for (let slot = 0; slot < pool.count; slot++) for (let vertex = 0; vertex < positions.count; vertex++) {
          const point = new THREE.Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(f.matrixFor(name, slot));
          expect(pick.containsPoint(point), type + ' lot' + index + ' ' + name + ' vertex' + vertex).toBe(true);
        }
      }
      expect(f.proxy().intersectsBox(f.proxy(CENTRE)), type + ' lot' + index).toBe(false);
      expect(JSON.stringify(f.world)).toBe(before);
    }
  });

  it('selects the actual ornament crown from a horizontal ray above the building body in each rotation', () => {
    for (const type of ['church', 'cityHall', 'courthouse']) for (const index of [0, 1, 2, 3, 5, 6, 7, 8]) {
      const f = fixture(type, index); f.refresh();
      const name = type === 'church' ? 'spires' : 'domes', geometry = f.pools[name].mesh.geometry;
      geometry.computeBoundingBox();
      const matrix = f.matrixFor(name), point = new THREE.Vector3(0, geometry.boundingBox!.max.y - .10, 0).applyMatrix4(matrix);
      const direction = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
      const origin = point.clone().addScaledVector(direction, 40);
      expect(f.geometryHits(name, origin, point).length, type + ' lot' + index).toBeGreaterThan(0);
      expect(f.pickRay(origin, point).buildingId, type + ' lot' + index).toBe(TARGET);
    }
  });

  it('invalidates cached lowered bounds before restoring the real crown, without changing world data', () => {
    for (const type of ['church', 'cityHall', 'courthouse']) {
      const f = fixture(type), before = JSON.stringify(f.world); f.refresh();
      const name = type === 'church' ? 'spires' : 'domes', geometry = f.pools[name].mesh.geometry;
      geometry.computeBoundingBox(); const matrix = f.matrixFor(name);
      const point = new THREE.Vector3(0, geometry.boundingBox!.max.y - .10, 0).applyMatrix4(matrix);
      const origin = point.clone().addScaledVector(new THREE.Vector3(0, 0, 1).transformDirection(matrix), 40);
      expect(f.pickRay(origin, point).buildingId).toBe(TARGET);
      f.refresh(true);
      expect(f.pools[name].count).toBe(0); expect(f.pickRay(origin, point).buildingId).toBeNull();
      expect(f.pools.picks.mesh.boundingSphere).not.toBeNull();
      f.refresh();
      expect(f.pools.picks.mesh.boundingSphere).toBeNull();
      expect(f.pickRay(origin, point).buildingId).toBe(TARGET);
      expect(JSON.stringify(f.world)).toBe(before);
    }
  });

  it('retains the municipal pediment width over its shorter columns while preserving bank height', () => {
    for (const type of ['cityHall', 'courthouse', 'policeHQ', 'bankSmall', 'bankLarge']) {
      const f = fixture(type); f.refresh();
      const profile = profileFor(f.target, BUILDING_BY_ID[type]);
      const mass = massesForView(profile, true, false).masses[0];
      const scale = new THREE.Vector3().setFromMatrixScale(f.matrixFor('pediments'));
      expect(scale.x).toBeCloseTo(mass.w * .82 + 2.4, 5);
      expect(scale.y).toBeCloseTo(f.target.cls === 'municipal' ? 1.15 : 2.9, 5);
      const column = f.pools.columns.mesh.geometry; column.computeBoundingBox();
      const columnHeight = column.boundingBox!.getSize(new THREE.Vector3()).y * new THREE.Vector3().setFromMatrixScale(f.matrixFor('columns')).y;
      expect(columnHeight).toBeCloseTo(f.target.cls === 'municipal' ? 4.45 : 9.3324, 4);
    }
  });
});
