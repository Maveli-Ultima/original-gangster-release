import * as THREE from 'three';
import { LOT_SIZE } from '../sim/world';
import type { Mass, Profile } from './profile';
import { interiorLinearRgb, INTERIOR_PALETTE } from './interiorMaterials';
import { STOREY_H } from './util';

/** Reserve the back-lot business (including its possible quarter-turn), plus a
 * future normal illegal site when the centre is empty. Render-only dimensions. */
export function centreSiteHalfExtent(profile?: Profile): number {
  return Math.max(LOT_SIZE * .95 * .6 / 2, ...(profile?.masses.flatMap(m =>
    [Math.abs(m.dx) + m.w / 2, Math.abs(m.dz) + m.d / 2]) ?? []));
}

/** Both roof modes preserve every mass and the same footprint, leaving the
 * centre site and both picking-box margins clear. */
export function massesForView(profile: Profile, edgeLot: boolean, _lowered: boolean,
  centreHalfExtent = centreSiteHalfExtent()): { masses: Mass[]; extension: number } {
  const desired = LOT_SIZE + .3 - profile.depth / 2;
  const available = LOT_SIZE - profile.depth / 2 - centreHalfExtent - 1.2 - .24;
  const extension = edgeLot ? Math.max(0, Math.min(desired, available)) : 0;
  const masses = profile.masses.map(m => extension > 0 && m.y === 0 && Math.abs(m.dz) < .01 && m.d >= profile.depth * .9
    ? { ...m, d: m.d + extension, dz: m.dz - extension / 2 } : { ...m });
  return { masses, extension };
}

export interface SectionMass extends Mass {
  open: boolean;
  /** Absolute height above the pavement, rather than an offset from the roof. */
  floorY?: number;
}

/** How high the opened storey's walls stand above its floor. */
export const CUT_WALL = 1.35;

/** The floor of a building's top storey: where the original opens it. */
export function topStoreyFloor(masses: Mass[]): number {
  const top = Math.max(0, ...masses.map(m => m.y + m.h));
  return Math.max(0, Math.floor((top - .5) / STOREY_H) * STOREY_H);
}

/** A cutaway in the original's manner: the roof comes off and the top storey
 * opens with low walls; storeys below keep their facades, and anything that
 * rose above the cut (towers, setbacks) goes. `ground` opens the building at
 * the pavement instead, for buildings standing between the camera and the
 * person or place it is watching. */
export function sectionMasses(masses: Mass[], lowered: boolean, ground = true): SectionMass[] {
  if (!lowered) return masses.map(m => ({ ...m, open: false }));
  const floorY = ground ? 0 : topStoreyFloor(masses);
  const wallTop = floorY + CUT_WALL;
  return masses.filter(m => m.y < wallTop).map(m => m.y + m.h <= floorY
    ? { ...m, open: false }
    : {
      ...m,
      h: Math.min(m.h, wallTop - m.y),
      open: true,
      ...(m.y <= floorY ? { floorY } : {}),
    });
}

/** Local +Z is the public street frontage; an inward extension must not move it. */
export function frontOf(mass: Mass, clearance = 0): { x: number; z: number } {
  return { x: mass.dx, z: mass.dz + mass.d / 2 + clearance };
}

/** One facade only, y=0..1, x=-.5..+.5, z=0. No top cap or reverse lettering. */
export function frontageGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.translate(0, .5, 0);
  return geometry;
}

type Vec3 = [number, number, number];
export type RGB = [number, number, number];
export class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];
  triangle(a: Vec3, b: Vec3, c: Vec3, color: RGB): void {
    const normal = new THREE.Vector3(...b).sub(new THREE.Vector3(...a))
      .cross(new THREE.Vector3(...c).sub(new THREE.Vector3(...a))).normalize();
    for (const point of [a, b, c]) {
      this.positions.push(...point); this.normals.push(normal.x, normal.y, normal.z);
      this.colors.push(...color); this.uvs.push(point[0] + .5, point[2] + .5);
    }
  }
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: RGB): void {
    this.triangle(a, b, c, color); this.triangle(a, c, d, color);
  }
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: RGB): void {
    const source = new THREE.BoxGeometry(w, h, d);
    const geometry = source.toNonIndexed();
    source.dispose();
    geometry.translate(x, y + h / 2, z);
    const p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i += 3) {
      this.triangle([p.getX(i), p.getY(i), p.getZ(i)], [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)],
        [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)], color);
    }
    geometry.dispose();
  }
  primitive(source: THREE.BufferGeometry, color: RGB): void {
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    source.dispose();
    const p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i += 3)
      this.triangle([p.getX(i), p.getY(i), p.getZ(i)], [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)],
        [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)], color);
    geometry.dispose();
  }
  finish(name: string): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.name = name;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Shared authored period doorway, not a reconstruction of a specific civic
 * building. The 1.1 by 2.7 leaf has a timber panel, glazing, frame and handle.
 * Cutaway geometry clips at its wall height without squashing these details. */
export function entryDoorGeometry(cutaway = false): THREE.BufferGeometry {
  const mesh = new MeshBuilder();
  const top = cutaway ? 1.25 : 2.82;
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, color: RGB) => {
    if (y < top) mesh.box(x, y, z, w, Math.min(h, top - y), d, color);
  };
  const timber: RGB = [.16, .105, .065], trim: RGB = [.43, .37, .28];
  box(0, .08, .04, 1.10, 2.62, .07, timber);
  for (const x of [-.60, .60]) box(x, 0, .04, .10, 2.82, .16, trim);
  box(0, 2.70, .04, 1.30, .12, .16, trim);
  box(0, 0, .06, 1.30, .08, .20, [.48, .45, .39]);
  box(0, .28, .085, .86, .92, .035, [.215, .145, .085]);
  box(0, 1.56, .081, .88, .94, .024, [.22, .29, .31]);
  box(0, 1.56, .102, .045, .94, .025, timber);
  box(0, 2.02, .102, .88, .045, .025, timber);
  box(.39, 1.05, .13, .045, .19, .07, [.49, .40, .19]);
  const geometry = mesh.finish(cutaway ? 'period-entry-door-cutaway' : 'period-entry-door');
  geometry.userData.leafWidth = 1.10;
  geometry.userData.leafHeight = 2.70;
  geometry.userData.cutawayHeight = cutaway ? top : null;
  return geometry;
}

/** Open cutaway floor. Y is already in metres and is not scaled. */
export function interiorGeometry(industrial = false): THREE.BufferGeometry {
  const mesh = new MeshBuilder();
  // One upward plane: board dimensions come from the material's metre UVs.
  mesh.quad([-.495, .071, .495], [.495, .071, .495], [.495, .071, -.495], [-.495, .071, -.495], [1, 1, 1]);
  const floorVertices = mesh.positions.length / 3;
  mesh.box(0, .015, 0, .995, .05, .995, interiorLinearRgb(INTERIOR_PALETTE.slabEdge));
  // Only the floor: rooms, masonry, stairs and furniture are laid out per
  // building in cutawayRooms.ts; industrial machinery/storage are separate props.
  const geometry = mesh.finish(industrial ? 'cutaway-works-floor' : 'cutaway-timber-floor');
  geometry.addGroup(0, floorVertices, 0);
  geometry.addGroup(floorVertices, geometry.getAttribute('position').count - floorVertices, 1);
  geometry.userData.floorSurface = industrial ? 'physical-concrete' : 'physical-timber';
  geometry.userData.floorElevation = .071;
  geometry.userData.openTop = true;
  geometry.userData.partitions = false;
  return geometry;
}

/** A floor-standing horizontal boiler/works machine, visible above low walls. */
export function worksMachineGeometry(): THREE.BufferGeometry {
  const mesh = new MeshBuilder();
  const stone = interiorLinearRgb(0x514b43), iron = interiorLinearRgb(0x626a67);
  const copper = interiorLinearRgb(0xac7145), brass = interiorLinearRgb(0xb59a62);
  mesh.box(0, .08, 0, 3.7, .20, 2.35, stone);
  for (const x of [-1.12, 1.12]) mesh.box(x, .28, 0, .26, .42, 1.30, iron);
  const barrel = new THREE.CylinderGeometry(.64, .64, 2.90, 14);
  barrel.rotateZ(Math.PI / 2); barrel.translate(0, 1.12, 0);
  mesh.primitive(barrel, iron);
  for (const x of [-1.18, 1.18]) {
    const ring = new THREE.CylinderGeometry(.685, .685, .09, 14);
    ring.rotateZ(Math.PI / 2); ring.translate(x, 1.12, 0);
    mesh.primitive(ring, copper);
  }
  mesh.box(0, 1.73, 0, .23, .22, .24, brass);
  const pipe = new THREE.CylinderGeometry(.085, .085, .48, 8);
  pipe.translate(0, 2.02, 0);
  mesh.primitive(pipe, copper);
  const geometry = mesh.finish('cutaway-works-machine');
  geometry.userData.fixtureKind = 'machine';
  return geometry;
}

/** Crated stock on low skids for warehouses, docks and rail depots. */
export function storedGoodsGeometry(): THREE.BufferGeometry {
  const mesh = new MeshBuilder();
  const skid = interiorLinearRgb(0x3a2b20), timber = interiorLinearRgb(0x805b36);
  const alternate = interiorLinearRgb(0x6e5032), slat = interiorLinearRgb(0xa27a4a);
  for (const [x, z, h, color] of [
    [-1.15, -.62, .95, timber], [0, -.62, 1.22, alternate], [1.12, -.62, .85, timber],
    [-.55, .72, .72, alternate], [.72, .72, .95, timber],
  ] as [number, number, number, RGB][]) {
    mesh.box(x, .08, z, 1.04, .12, .90, skid);
    mesh.box(x, .20, z, .94, h, .82, color);
    for (const dx of [-.31, .31]) mesh.box(x + dx, .20, z + .425, .075, h, .045, slat);
    mesh.box(x, .20 + h, z, 1.02, .075, .88, slat);
  }
  const geometry = mesh.finish('cutaway-stored-goods');
  geometry.userData.fixtureKind = 'storage';
  return geometry;
}

/** Closed cornice slabs must remain below the true roof plane. */
export function cornicePlacement(bodyHeight: number, pitched: boolean): { bottom: number; height: number } {
  const height = pitched ? .20 : .38;
  return { bottom: bodyHeight - height - .04, height };
}
/** One horizontal stone moulding round a mass: bottom and height above the
 * mass's underside, and how far it stands proud of each wall (metres). */
export interface Moulding { bottom: number; height: number; projection: number }

/**
 * The period mouldings on a closed mass, as in the original's street fronts:
 * a deep projecting crown over a smaller bed mould at the eaves, and a stone
 * string course over the ground floor of a building two or more storeys tall.
 * Every piece stays below the roof plane (see `cornicePlacement`).
 */
export function mouldingsFor(bodyHeight: number, pitched: boolean, groundFloor: number | null): Moulding[] {
  const crown = cornicePlacement(bodyHeight, pitched);
  const out: Moulding[] = [{ ...crown, projection: pitched ? .22 : .30 }];
  if (!pitched && crown.bottom > 1.2) out.push({ bottom: crown.bottom - .18, height: .18, projection: .12 });
  // A string course only where there is a real upper storey above it.
  if (groundFloor != null && groundFloor > 2.4 && groundFloor < crown.bottom - 2.4)
    out.push({ bottom: groundFloor, height: .22, projection: .07 });
  return out;
}

/**
 * Rusticated base (civic stone fronts): courses of dressed stone standing
 * slightly proud, with a shadowed joint between each, from the pavement to
 * sill height, so the ground-floor windows and door stay clear above it.
 */
export const RUSTICATION_TOP = 1.2;
export function rusticationCourses(groundFloor: number): Moulding[] {
  const course = .34, joint = .07, top = Math.min(RUSTICATION_TOP, groundFloor - .1), out: Moulding[] = [];
  for (let y = .04; y + course <= top + .001; y += course + joint)
    out.push({ bottom: y, height: course, projection: .05 });
  return out;
}

/** Unit roof rises from y=0 to y=1; gable ridge runs along local Z.
 * Slopes and vertical gable-end walls have separate material groups. */
export function pitchedRoofGeometry(hip = false): THREE.BufferGeometry {
  const mesh = new MeshBuilder();
  const ridge = hip ? .28 : .5;
  const white: RGB = [1, 1, 1];
  const left: Vec3 = [-.5, 0, .5], right: Vec3 = [.5, 0, .5];
  const leftBack: Vec3 = [-.5, 0, -.5], rightBack: Vec3 = [.5, 0, -.5];
  const frontPeak: Vec3 = [0, 1, ridge], backPeak: Vec3 = [0, 1, -ridge];
  mesh.quad(left, frontPeak, backPeak, leftBack, white);
  mesh.quad(frontPeak, right, rightBack, backPeak, white);
  mesh.triangle(left, right, frontPeak, white);
  mesh.triangle(rightBack, leftBack, backPeak, white);
  const geometry = mesh.finish(hip ? 'hip-roof' : 'gable-roof');
  if (hip) geometry.addGroup(0, 18, 0);
  else { geometry.addGroup(0, 12, 0); geometry.addGroup(12, 6, 1); }
  geometry.userData.roofSurface = 'physical-staggered-courses';
  geometry.userData.gableEndMaterialIndex = hip ? null : 1;
  return geometry;
}

/** A dockside travelling crane for the Docks (A23 identity; user, 1 October):
 * lattice mast on the roof edge, operator's cab, a jib out over the street and
 * a counter-jib behind. Metres; the jib points along +Z (the street front). */
export function dockCraneGeometry(): THREE.BufferGeometry {
  const mesh = new MeshBuilder();
  const iron: RGB = interiorLinearRgb(0x4b514e), dark: RGB = interiorLinearRgb(0x2b2f2d), cab: RGB = interiorLinearRgb(0x6e2b20);
  mesh.box(0, 0, 0, 1.8, .45, 1.8, dark);
  for (const [x, z] of [[-.55, -.55], [.55, -.55], [-.55, .55], [.55, .55]]) mesh.box(x, .45, z, .16, 8.6, .16, iron);
  for (let y = 1.2; y < 9; y += 1.6) { mesh.box(0, y, -.55, 1.26, .1, .1, iron); mesh.box(0, y, .55, 1.26, .1, .1, iron);
    mesh.box(-.55, y, 0, .1, .1, 1.26, iron); mesh.box(.55, y, 0, .1, .1, 1.26, iron); }
  mesh.box(0, 9.05, .1, 1.7, 1.5, 2.0, cab);
  mesh.box(0, 10.3, 4.4, .55, .5, 9.6, iron);
  mesh.box(0, 10.8, 3.0, .12, .5, 6.0, iron);
  mesh.box(0, 10.3, -2.4, .7, .5, 3.4, iron);
  mesh.box(0, 9.7, -3.6, 1.2, 1.1, 1.0, dark);
  mesh.box(0, 5.6, 8.8, .05, 4.7, .05, dark);
  mesh.box(0, 5.2, 8.8, .3, .4, .3, dark);
  const geometry = mesh.finish('dock-crane');
  geometry.userData.jibReach = 9.2;
  return geometry;
}

/** A pitched, glazed train shed on iron ribs over the Railroad Terminal.
 * Unit footprint x, z in -.5..+.5 rising 0..1; the ridge runs along Z. */
export function trainShedGeometry(): THREE.BufferGeometry {
  const mesh = new MeshBuilder();
  const glass: RGB = interiorLinearRgb(0x8ea4a8), rib: RGB = interiorLinearRgb(0x363b3a);
  const l: Vec3 = [-.5, 0, .5], r: Vec3 = [.5, 0, .5], lb: Vec3 = [-.5, 0, -.5], rb: Vec3 = [.5, 0, -.5];
  const fp: Vec3 = [0, 1, .5], bp: Vec3 = [0, 1, -.5];
  mesh.quad(l, fp, bp, lb, glass); mesh.quad(fp, r, rb, bp, glass);
  mesh.triangle(l, r, fp, glass); mesh.triangle(rb, lb, bp, glass);
  // Ribs just proud of the glazing, and a ridge beam.
  for (let z = -.5; z <= .5001; z += .125) {
    mesh.quad([-.5, 0, z - .012], [0, 1.02, z - .012], [0, 1.02, z + .012], [-.5, 0, z + .012], rib);
    mesh.quad([0, 1.02, z - .012], [.5, 0, z - .012], [.5, 0, z + .012], [0, 1.02, z + .012], rib);
  }
  mesh.box(0, .99, 0, .03, .04, 1.0, rib);
  return mesh.finish('train-shed');
}

/** A station clock for the terminal front: a white dial in a dark rim, facing +Z. */
export function stationClockGeometry(): THREE.BufferGeometry {
  const mesh = new MeshBuilder();
  const rim = new THREE.CylinderGeometry(.75, .75, .16, 24); rim.rotateX(Math.PI / 2);
  mesh.primitive(rim, interiorLinearRgb(0x2b2f2d));
  const face = new THREE.CylinderGeometry(.64, .64, .04, 24); face.rotateX(Math.PI / 2); face.translate(0, 0, .09);
  mesh.primitive(face, interiorLinearRgb(0xe9e3d2));
  const hand: RGB = interiorLinearRgb(0x1a1b1a);
  mesh.box(0, 0, .12, .06, .42, .02, hand);
  const minute = new THREE.BoxGeometry(.05, .56, .02); minute.translate(0, .28, 0); minute.rotateZ(-1.05); minute.translate(0, 0, .13);
  mesh.primitive(minute, hand);
  return mesh.finish('station-clock');
}
