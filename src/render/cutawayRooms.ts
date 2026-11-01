import * as THREE from 'three';
import { MeshBuilder, type RGB } from './architecture';
import { interiorLinearRgb } from './interiorMaterials';

/**
 * Cutaway rooms in the original's manner (playtest, 2 October: "do them more like
 * the original"). The original shows an opened building as thick walls with
 * broken grey masonry along their tops, partition walls dividing the floor into
 * rooms, a staircase, and furniture that says what the place is. Layouts are
 * seeded by building id, so a building looks the same every time it is opened.
 *
 * All coordinates here are mass-local metres: x across the mass, z from back
 * (-) to street front (+), y above the floor.
 */

export type FurnitureKind = 'bed' | 'wardrobe' | 'table' | 'counter' | 'shelf' | 'desk'
  | 'pew' | 'roundTable' | 'poolTable' | 'stairs';
export type Kit = 'home' | 'shop' | 'eatery' | 'poolHall' | 'office' | 'church' | 'library' | 'ward' | 'bare';

export const FURNITURE_KINDS: FurnitureKind[] = ['bed', 'wardrobe', 'table', 'counter', 'shelf', 'desk',
  'pew', 'roundTable', 'poolTable', 'stairs'];

/** Footprint (width along the wall, depth out from it) of each piece. */
export const FOOTPRINT: Record<FurnitureKind, [number, number]> = {
  bed: [1.4, 2.0], wardrobe: [1.1, .55], table: [1.9, 1.7], counter: [2.6, .65], shelf: [2.0, .45],
  desk: [1.5, 1.3], pew: [2.4, .7], roundTable: [1.7, 1.7], poolTable: [1.6, 2.8], stairs: [1.0, 2.6],
};

/** Pieces that stand free in the room rather than against a wall. */
const FREE: ReadonlySet<FurnitureKind> = new Set(['table', 'roundTable', 'poolTable', 'pew']);

const KITS: Record<Kit, FurnitureKind[]> = {
  home: ['bed', 'wardrobe', 'table', 'bed', 'wardrobe'],
  shop: ['counter', 'shelf', 'shelf', 'shelf'],
  eatery: ['counter', 'roundTable', 'roundTable', 'shelf', 'roundTable'],
  poolHall: ['poolTable', 'poolTable', 'shelf'],
  office: ['desk', 'shelf', 'desk', 'shelf', 'desk'],
  church: ['pew', 'pew', 'pew', 'pew', 'pew', 'pew'],
  library: ['shelf', 'shelf', 'desk', 'shelf', 'shelf'],
  ward: ['bed', 'bed', 'bed', 'bed', 'desk'],
  bare: [],
};

/** What a building's rooms hold. Hidden illegal sites stay unfurnished, so a
 * cutaway never reveals what goes on there. Industry keeps its own works props. */
export function kitFor(cls: string, typeId: string): Kit {
  if (cls === 'illegal' || cls === 'industrial') return 'bare';
  if (cls === 'tenement' || cls === 'residential' || typeId === 'hotelSmall' || typeId === 'hotelLarge'
    || typeId === 'orphanage') return 'home';
  if (typeId === 'church') return 'church';
  if (typeId === 'hospital') return 'ward';
  if (typeId === 'library' || typeId === 'museum' || typeId === 'school') return 'library';
  if (typeId === 'poolHall') return 'poolHall';
  if (['cafe', 'milkBar', 'breakfastBar', 'restaurant', 'soupKitchen'].includes(typeId)) return 'eatery';
  if (cls === 'municipal' || ['financeCompany', 'accountancy', 'lawFirm', 'bankSmall', 'bankLarge',
    'newspaper', 'radioStation'].includes(typeId)) return 'office';
  return 'shop';
}

export interface Segment { x: number; z: number; w: number; d: number; h: number; tint: number }
export interface Placement { kind: FurnitureKind; x: number; z: number; yaw: number }
export interface RoomLayout {
  /** Broken masonry along the tops of the outer and partition walls (y = wall top). */
  caps: Segment[];
  /** Plaster on the inner faces and the partitions themselves (y = floor). */
  linings: Segment[];
  furniture: Placement[];
}

export const WALL = .34;
const PARTITION = .16;
const DOOR = 1.05;

function rng(seed: number): () => number {
  let s = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    s ^= s >>> 12;
    return (s >>> 0) / 4294967296;
  };
}

interface Rect { x0: number; z0: number; x1: number; z1: number }
const area = (r: Rect) => (r.x1 - r.x0) * (r.z1 - r.z0);

/** Broken masonry: short courses of varying height along one wall run. */
function capRun(out: Segment[], ax: number, az: number, bx: number, bz: number, thick: number, rand: () => number): void {
  const length = Math.hypot(bx - ax, bz - az);
  if (length < .05) return;
  let t = 0;
  while (t < length - .02) {
    // Long courses with gentle steps: a quiet top edge reads as a cut wall,
    // not rubble, at the small size the cutaways are seen at.
    const piece = Math.min(length - t, .9 + rand() * 1.1);
    const mid = (t + piece / 2) / length;
    const x = ax + (bx - ax) * mid, z = az + (bz - az) * mid;
    const alongX = Math.abs(bx - ax) >= Math.abs(bz - az);
    // Mostly even courses, with the odd lower dip.
    const roll = rand();
    const h = roll < .1 ? .06 + rand() * .04 : .12 + rand() * .07;
    out.push({ x, z, w: alongX ? piece : thick, d: alongX ? thick : piece, h, tint: .93 + rand() * .1 });
    t += piece;
  }
}

/** A wall run with a doorway gap at `gap` (distance from a), as two segments. */
function withGap(ax: number, az: number, bx: number, bz: number, gap: number | null): [number, number, number, number][] {
  if (gap == null) return [[ax, az, bx, bz]];
  const length = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / length, uz = (bz - az) / length;
  const g0 = Math.max(0, gap - DOOR / 2), g1 = Math.min(length, gap + DOOR / 2);
  return [[ax, az, ax + ux * g0, az + uz * g0], [ax + ux * g1, az + uz * g1, bx, bz]];
}

/**
 * Rooms, masonry and furniture for one opened mass.
 * `w`/`d` are the mass's outer size; `wallHeight` is the cut height above the floor.
 */
export function cutawayRoomLayout(buildingId: number, w: number, d: number, wallHeight: number,
  kit: Kit, opts: { stairs: boolean; partitions: boolean; frontDoor: boolean }): RoomLayout {
  const rand = rng(buildingId * 7919 + Math.round(w * 13) + Math.round(d * 131));
  const caps: Segment[] = [], linings: Segment[] = [], furniture: Placement[] = [];
  const hx = w / 2, hz = d / 2, inner: Rect = { x0: -hx + WALL, z0: -hz + WALL, x1: hx - WALL, z1: hz - WALL };
  if (inner.x1 - inner.x0 < 1.5 || inner.z1 - inner.z0 < 1.5) return { caps, linings, furniture };

  // Outer walls: a broken cap over the full thickness, plaster on the inside.
  const c = WALL / 2;
  capRun(caps, -hx, -hz + c, hx, -hz + c, WALL, rand);
  capRun(caps, -hx, hz - c, hx, hz - c, WALL, rand);
  capRun(caps, -hx + c, -hz + WALL, -hx + c, hz - WALL, WALL, rand);
  capRun(caps, hx - c, -hz + WALL, hx - c, hz - WALL, WALL, rand);
  const lining = .05, lh = Math.max(.2, wallHeight - .06);
  const frontGap = opts.frontDoor ? 0 : null;
  linings.push({ x: 0, z: inner.z0 + lining / 2, w: inner.x1 - inner.x0, d: lining, h: lh, tint: 1 });
  for (const [ax, , bx] of withGap(inner.x0, 0, inner.x1, 0, frontGap == null ? null : (inner.x1 - inner.x0) / 2))
    linings.push({ x: (ax + bx) / 2, z: inner.z1 - lining / 2, w: bx - ax, d: lining, h: lh, tint: 1 });
  linings.push({ x: inner.x0 + lining / 2, z: 0, w: lining, d: inner.z1 - inner.z0, h: lh, tint: 1 });
  linings.push({ x: inner.x1 - lining / 2, z: 0, w: lining, d: inner.z1 - inner.z0, h: lh, tint: 1 });

  // Partitions: split the longer side once, then the larger half again if big.
  const rooms: Rect[] = [inner];
  const split = (r: Rect, alongX: boolean): void => {
    const span = alongX ? r.x1 - r.x0 : r.z1 - r.z0, cross = alongX ? r.z1 - r.z0 : r.x1 - r.x0;
    if (span < 5 || cross < 2.4) return;
    const at = (alongX ? r.x0 : r.z0) + span * (.42 + rand() * .16);
    const a: Rect = alongX ? { ...r, x1: at - PARTITION / 2 } : { ...r, z1: at - PARTITION / 2 };
    const b: Rect = alongX ? { ...r, x0: at + PARTITION / 2 } : { ...r, z0: at + PARTITION / 2 };
    rooms.splice(rooms.indexOf(r), 1, a, b);
    const gap = DOOR / 2 + .3 + rand() * Math.max(0, cross - DOOR - .6);
    const [ax, az, bx, bz] = alongX ? [at, r.z0, at, r.z1] : [r.x0, at, r.x1, at];
    for (const [sx, sz, ex, ez] of withGap(ax, az, bx, bz, gap)) {
      const len = Math.hypot(ex - sx, ez - sz);
      if (len < .1) continue;
      linings.push({ x: (sx + ex) / 2, z: (sz + ez) / 2, w: alongX ? PARTITION : len, d: alongX ? len : PARTITION, h: lh, tint: .94 });
      capRun(caps, sx, sz, ex, ez, PARTITION + .04, rand);
    }
  };
  // Keep dividing the largest room, across its longer side, until the rooms
  // are house-sized (the original's opened buildings show several each).
  // Rooms stay generous: a few large rooms read clearly in a small window.
  if (opts.partitions) for (let n = 0; n < 4; n++) {
    const big = rooms.reduce((m, r) => (area(r) > area(m) ? r : m));
    if (area(big) < 42) break;
    const before = rooms.length;
    split(big, big.x1 - big.x0 >= big.z1 - big.z0);
    if (rooms.length === before) break;
  }

  // A staircase up the back wall of the smallest room.
  const taken: Rect[] = [];
  const fits = (r: Rect) => taken.every(t => r.x1 + .25 <= t.x0 || r.x0 - .25 >= t.x1 || r.z1 + .25 <= t.z0 || r.z0 - .25 >= t.z1);
  const place = (kind: FurnitureKind, room: Rect, side: number, along: number): boolean => {
    const [fw, fd] = FOOTPRINT[kind];
    const rw = room.x1 - room.x0, rd = room.z1 - room.z0;
    // side 0: back (-z) wall, 1: left (-x), 2: right (+x), 3: free-standing.
    let x: number, z: number, yaw: number, ex: number, ez: number;
    if (side === 3) {
      if (rw < fw + .9 || rd < fd + .9) return false;
      ex = fw / 2; ez = fd / 2;
      x = room.x0 + ex + .45 + (rw - fw - .9) * along; z = room.z0 + ez + .45 + (rd - fd - .9) * (1 - along);
      yaw = 0;
    } else if (side === 0) {
      if (rw < fw + .2 || rd < fd + .4) return false;
      ex = fw / 2; ez = fd / 2; x = room.x0 + ex + .1 + (rw - fw - .2) * along; z = room.z0 + ez + .02; yaw = 0;
    } else {
      if (rd < fw + .2 || rw < fd + .4) return false;
      ex = fd / 2; ez = fw / 2; z = room.z0 + ez + .1 + (rd - fw - .2) * along;
      x = side === 1 ? room.x0 + ex + .02 : room.x1 - ex - .02; yaw = side === 1 ? Math.PI / 2 : -Math.PI / 2;
    }
    const box = { x0: x - ex, z0: z - ez, x1: x + ex, z1: z + ez };
    if (!fits(box)) return false;
    taken.push(box);
    furniture.push({ kind, x, z, yaw });
    return true;
  };
  const byArea = [...rooms].sort((a, b) => area(a) - area(b));
  if (opts.stairs) place('stairs', byArea[0], rand() < .5 ? 1 : 2, rand() < .5 ? 0 : 1) || place('stairs', byArea[0], 0, 0);

  // Furniture: the kit's pieces dealt round the rooms, largest room first.
  const order = [...rooms].sort((a, b) => area(b) - area(a));
  const pieces = KITS[kit];
  if (kit === 'church') {
    // Pews in rows facing the front, down the largest room.
    const room = order[0], rows = Math.min(6, Math.floor((room.z1 - room.z0 - 1.5) / 1.15));
    for (let i = 0; i < rows; i++) for (const side of [-1, 1]) {
      const x = (room.x0 + room.x1) / 2 + side * Math.min(1.6, (room.x1 - room.x0) / 4);
      const z = room.z0 + 1 + i * 1.15;
      const box = { x0: x - 1.2, z0: z - .35, x1: x + 1.2, z1: z + .35 };
      if ((room.x1 - room.x0) > 5.2 && fits(box)) { taken.push(box); furniture.push({ kind: 'pew', x, z, yaw: 0 }); }
    }
  } else {
    // A room gets one or two pieces, dealt from the kit in turn: furnished,
    // not crowded.
    if (pieces.length) order.forEach((room, r) => {
      const count = Math.min(2, 1 + Math.floor(area(room) / 20));
      for (let i = 0; i < count; i++) {
        const kind = pieces[(r * 2 + i) % pieces.length];
        const tries = FREE.has(kind) ? [3] : [0, 1 + Math.floor(rand() * 2), 2, 1];
        for (const side of tries) if (place(kind, room, side, rand())) break;
      }
    });
  }
  return { caps, linings, furniture };
}

/** Furniture geometries: origin on the floor at the footprint centre, back to -z. */
export function furnitureGeometry(kind: FurnitureKind): THREE.BufferGeometry {
  const m = new MeshBuilder();
  const wood = interiorLinearRgb(0x5a3a22), dark = interiorLinearRgb(0x3a2617), light = interiorLinearRgb(0x8a6440);
  const linen = interiorLinearRgb(0xd8d0bd), cloth = interiorLinearRgb(0x7a2f2a), green = interiorLinearRgb(0x2e5a3a);
  const brass = interiorLinearRgb(0xb59a62), paper = interiorLinearRgb(0xc9bd9c);
  const [fw, fd] = FOOTPRINT[kind];
  switch (kind) {
    case 'bed':
      m.box(0, 0, 0, fw, .32, fd, dark);
      // Aged linen and a dark wool cover: no brighter than the floor boards.
      m.box(0, .32, .05, fw - .1, .16, fd - .2, interiorLinearRgb(0xa89e88));
      m.box(0, .48, -fd / 2 + .32, fw - .3, .1, .38, interiorLinearRgb(0xb3aa94));
      m.box(0, .32, .45, fw - .08, .2, fd / 2 - .3, interiorLinearRgb(0x4e3a33));
      m.box(0, 0, -fd / 2 + .04, fw, .95, .08, wood);
      break;
    case 'wardrobe':
      m.box(0, 0, 0, fw, 1.75, fd, wood);
      m.box(-.27, .2, fd / 2, .5, 1.4, .02, light);
      m.box(.27, .2, fd / 2, .5, 1.4, .02, light);
      m.box(-.04, .9, fd / 2 + .02, .03, .12, .02, brass);
      m.box(.04, .9, fd / 2 + .02, .03, .12, .02, brass);
      break;
    case 'table': {
      m.box(0, .72, 0, 1.1, .05, .8, light);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.box(sx * .48, 0, sz * .33, .06, .72, .06, dark);
      for (const sx of [-.3, .3]) for (const sz of [-1, 1]) {
        m.box(sx, .42, sz * .62, .4, .05, .38, wood);
        for (const lx of [-.16, .16]) for (const lz of [-.15, .15]) m.box(sx + lx, 0, sz * .62 + lz, .04, .42, .04, dark);
        m.box(sx, .47, sz * .79, .4, .45, .05, wood);
      }
      break;
    }
    case 'counter':
      m.box(0, 0, 0, fw, .98, fd, wood);
      m.box(0, .98, .02, fw + .06, .05, fd + .08, light);
      m.box(fw / 2 - .45, 1.03, 0, .42, .3, .3, brass);
      m.box(-fw / 2 + .5, 1.03, 0, .5, .08, .35, paper);
      break;
    case 'shelf':
      m.box(0, 0, 0, fw, 1.6, .06, dark);
      for (const sx of [-1, 1]) m.box(sx * (fw / 2 - .03), 0, 0, .06, 1.6, fd, dark);
      for (const y of [.05, .5, .95, 1.4]) m.box(0, y, 0, fw - .1, .04, fd, wood);
      for (const [y, c] of [[.09, paper], [.54, cloth], [.99, green], [1.44, paper]] as [number, RGB][])
        for (let i = 0; i < 4; i++) m.box(-fw / 2 + .3 + i * (fw - .5) / 3, y, 0, .32, .28, fd * .7, c);
      break;
    case 'desk':
      m.box(0, .74, -.2, 1.4, .06, .75, wood);
      m.box(-.48, 0, -.2, .4, .74, .7, dark);
      m.box(.62, 0, -.2, .06, .74, .7, dark);
      m.box(.3, .8, -.35, .4, .02, .3, paper);
      m.box(-.4, .8, -.42, .18, .28, .18, green);
      m.box(.1, .42, .32, .44, .05, .42, wood);
      for (const lx of [-.18, .18]) for (const lz of [-.17, .17]) m.box(.1 + lx, 0, .32 + lz, .04, .42, .04, dark);
      m.box(.1, .47, .51, .44, .5, .05, wood);
      break;
    case 'pew':
      m.box(0, .42, 0, fw, .06, .42, wood);
      m.box(0, .45, .2, fw, .5, .06, wood);
      for (const sx of [-1, 1]) m.box(sx * (fw / 2 - .04), 0, .05, .08, .95, .5, dark);
      break;
    case 'roundTable': {
      const top = new THREE.CylinderGeometry(.48, .48, .05, 16); top.translate(0, .745, 0); m.primitive(top, linen);
      const stem = new THREE.CylinderGeometry(.05, .05, .72, 6); stem.translate(0, .36, 0); m.primitive(stem, dark);
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3, cx = Math.sin(a) * .68, cz = Math.cos(a) * .68;
        const seat = new THREE.CylinderGeometry(.18, .18, .05, 10); seat.translate(cx, .45, cz); m.primitive(seat, cloth);
        const leg = new THREE.CylinderGeometry(.03, .03, .44, 5); leg.translate(cx, .22, cz); m.primitive(leg, dark);
      }
      break;
    }
    case 'poolTable':
      m.box(0, 0, 0, 1.3, .68, 2.5, dark);
      m.box(0, .68, 0, 1.4, .1, 2.6, wood);
      m.box(0, .72, 0, 1.18, .08, 2.38, green);
      for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) m.box(sx * .6, .76, sz * 1.15, .1, .05, .1, interiorLinearRgb(0x111111));
      m.box(.25, .8, .5, .06, .06, .06, interiorLinearRgb(0xe8e2d0));
      m.box(-.2, .8, -.3, .06, .06, .06, interiorLinearRgb(0xa8221c));
      break;
    case 'stairs': {
      const steps = 8, rise = 1.3 / steps, run = fd / steps;
      for (let i = 0; i < steps; i++) m.box(0, 0, fd / 2 - run * (i + .5), fw, rise * (i + 1), run, i % 2 ? wood : light);
      m.box(fw / 2 - .04, 0, 0, .06, 1.35, fd, dark);
      break;
    }
  }
  const geometry = m.finish(`cutaway-${kind}`);
  geometry.userData.fixtureKind = kind;
  return geometry;
}
