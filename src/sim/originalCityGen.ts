/**
 * Port of the original new-city generator, `CityGen_Generate` (0x5330C0) and its
 * helpers: district seeds (0x5370B0), land-value diffusion (0x537170), district
 * growth (0x537D70), parks (0x5394A0), church mini-parks (0x539F60) and the
 * content-id results of `Block_BuildContent` (0x545A40) / the strip builder
 * (0x54C090). Ported from the supplied pseudocode exports
 * (`full_recode/scripts/re_export/functions/05x/*.txt`), including the original's
 * quirks, which are marked QUIRK. See docs/audit/2026-09-28/city-grid/.
 *
 * Output is a block-level plan: content ids, 0..255 land values, terrain records,
 * POIs and the ordered build log. Cell geometry, businesses (economics tables)
 * and the road-vertex graph are later phases. The random stream uses the
 * original LCG, but the original's cell builders also draw from it, so a given
 * seed does not reproduce the original's city exactly.
 */

/** The original's shared LCG (0x712500): MSVC `rand()`. */
export class OriginalRng {
  constructor(public state: number) { this.state >>>= 0; }
  next(): number {
    this.state = (Math.imul(this.state, 214013) + 2531011) >>> 0;
    return (this.state >>> 16) & 0x7fff;
  }
}

/** Block content ids (deep16 §5.1). */
export const C = {
  SHOP_STRIP: 0, ROWHOUSE_A: 1, ROWHOUSE_B: 2, ROWHOUSE_C: 3, RADIO: 4, POWER_PLANT: 6, NEWSPAPER: 7,
  WATER_PLANT: 8, DOCKS: 9, PLAZA: 10, SINGLE_BUSINESS: 11, MIXED: 15, PREMIUM: 16,
  RIVER_V: 19, RIVER_H: 20, RIVER_DOWN: 21, RIVER_UP: 22, RIVER_DOWN_CAP: 23, RIVER_UP_CAP: 24,
  AVENUE_H: 34, AVENUE_V: 35, AVENUE_CROSSING: 36, BRIDGE: 37, STATION: 38, RAIL: 39, RAIL_BRIDGE: 40,
  RAIL_OVER_AVENUE: 41, CITY_HALL: 42, HOSPITAL: 43, POLICE_HQ: 44, EMPLOYMENT: 45, FIRE_DEPT: 46,
  US_POST: 47, MUSEUM: 48, DEPARTMENT_STORE: 49, BANK_LARGE: 50, COURTHOUSE: 51, BATHS: 52, FBI_HQ: 54,
  HOTEL_LARGE: 55, ORPHANAGE: 56, SCHOOL: 57, EMPTY: 58, CHURCH_V_LOWER: 68, CHURCH_V_UPPER: 69, CHURCH_H: 70,
} as const;

const PARK_CONTENT_BY_MASK = [26, 33, 25, 28, 29, 66, 31, 62, 32, 27, 67, 64, 30, 63, 65, 26];
export const isParkContent = (c: number) => (c >= 25 && c <= 33) || (c >= 62 && c <= 67);
export const isRiverContent = (c: number) => c >= 19 && c <= 24;
const FREE = 0xff, BLOCKED = 0xfe;

export interface Point { x: number; y: number }
export interface ParkPlan { x: number; y: number; w: number; h: number; quadrant: number;
  /** Edge-mask per block, column-major like the original (index = x * h + y), -1 = not park. */
  masks: number[]; treeDensity: number[] }
export interface DistrictSeed { x: number; y: number; landValue: number; budget: number; jitter: number;
  floor: number; content: number; claimed: number; radius: number }
export interface BuildEntry { x: number; y: number; requested: number; result: number }

export interface OriginalCityPlan {
  w: number; h: number;
  /** Row-major, index = y * w + x. */
  content: number[];
  landValue: number[];
  /** Citygen scratch grid: land value and district id (0xFF free, 0xFE blocked). */
  gridValue: number[]; gridId: number[];
  layout: 1 | 2 | 3;
  /** Per column: river block row, whether it turned, and the turn's signed delta. */
  river: { row: number; turned: boolean; delta: number }[] | null;
  riverFineRows: { min: number; max: number };
  railColumn: number | null; station: Point | null;
  avenues: { cols: number[]; rows: number[] };
  centre: Point; departmentStores: Point[];
  civics: Partial<Record<'cityHall' | 'courthouse' | 'fbiHQ' | 'policeHQ' | 'hospital' | 'fireDept', Point>>;
  innerCivics: Partial<Record<'employment' | 'museum' | 'baths' | 'usPost', Point>>;
  premiumCorners: Point[]; radioStations: Point[]; newspapers: Point[]; churches: Point[]; schools: Point[];
  orphanage: Point;
  industrialAnchor: Point; docks: Point | null; docksRemoved: boolean; waterPlant: Point; powerPlant: Point;
  districts: DistrictSeed[]; parks: ParkPlan[];
  builds: BuildEntry[];
  /** Behaviour the port records instead of hanging or misbehaving. */
  notes: string[];
}

/** Economics-dependent choices, supplied by the block-content phase. */
export interface OriginalBlockBuilder {
  /** Content 11–14: false when no business kind is eligible, making a plaza (content 10). */
  eligibleBusiness?(plan: OriginalCityPlan, x: number, y: number, rng: () => number): boolean;
  /** Content 15/17/18: 49, 50 or 55 when the placer turned the block into that kind. */
  mixedBusinesses?(plan: OriginalCityPlan, x: number, y: number, rng: () => number): number | undefined;
  /** Content 16: the premium single-business placer. */
  premiumBusinesses?(plan: OriginalCityPlan, x: number, y: number, rng: () => number): void;
  /** After every logged build, in the original's build order. */
  onBuild?(plan: OriginalCityPlan, x: number, y: number, requested: number, result: number, rng: () => number): void;
  /** No river: the economy erases the Docks record. */
  onDocksErased?(): void;
}

export interface OriginalCityOptions {
  seed: number; w?: number; h?: number;
  /** Churches to place (our override of the original's four). */
  churches?: number;
  builder?: OriginalBlockBuilder;
}

const u8 = (n: number) => n & 0xff;
const trunc = Math.trunc;

/** A retry loop that the original leaves unbounded found no valid site. */
export class OriginalCityStuck extends Error {
  constructor(readonly loop: string, readonly seed: number, readonly plan?: OriginalCityPlan) {
    super(`Original city generation stuck in "${loop}" (seed ${seed}); the original would hang.`);
    this.name = 'OriginalCityStuck';
  }
}
const SPIN_LIMIT = 100_000;

/** Generate a city, re-rolling the seed where the original would hang. */
export function generateOriginalCitySafe(opts: OriginalCityOptions, attempts = 16): OriginalCityPlan {
  const skipped: string[] = [];
  for (let k = 0; k < attempts; k++) {
    try {
      const plan = generateOriginalCity({ ...opts, seed: (opts.seed + k) >>> 0 });
      plan.notes.unshift(...skipped);
      return plan;
    } catch (e) {
      if (!(e instanceof OriginalCityStuck)) throw e;
      skipped.push(`${e.message} Re-rolled with the next seed.`);
    }
  }
  throw Error(`Original city generation failed for ${attempts} consecutive seeds from ${opts.seed}.`);
}

export function generateOriginalCity(opts: OriginalCityOptions): OriginalCityPlan {
  const W = opts.w ?? 40, H = opts.h ?? 32;
  // Avenue ranges (e.g. columns 26–29), quadrants and the 64 × 32 scratch grid
  // are hardcoded for the stock map, so only 40 × 32 is meaningful.
  if (W !== 40 || H !== 32) throw Error('The original generator is defined for the 40 × 32 city only.');
  const rng = new OriginalRng(opts.seed), r = () => rng.next();
  const spins = new Map<string, number>();
  const spin = (loop: string) => {
    const count = (spins.get(loop) ?? 0) + 1; spins.set(loop, count);
    if (count > SPIN_LIMIT) throw new OriginalCityStuck(loop, opts.seed, plan);
  };
  const builder = opts.builder ?? {};
  const n = W * H, at = (x: number, y: number) => y * W + x;
  const plan: OriginalCityPlan = {
    w: W, h: H, content: new Array(n).fill(C.EMPTY), landValue: new Array(n).fill(0),
    gridValue: new Array(n).fill(0), gridId: new Array(n).fill(FREE), layout: 3, river: null,
    riverFineRows: { min: 40, max: 0 }, railColumn: null, station: null, avenues: { cols: [], rows: [] },
    centre: { x: 0, y: 0 }, departmentStores: [], civics: {}, innerCivics: {}, premiumCorners: [], radioStations: [],
    newspapers: [], churches: [], schools: [], orphanage: { x: 0, y: 0 }, industrialAnchor: { x: 0, y: 0 },
    docks: null, docksRemoved: false, waterPlant: { x: 0, y: 0 }, powerPlant: { x: 0, y: 0 }, districts: [],
    parks: [], builds: [], notes: [],
  };
  const content = (x: number, y: number) => plan.content[at(x, y)];
  const setLV = (x: number, y: number, v: number) => { plan.landValue[at(x, y)] = u8(v); };
  const grid = (x: number, y: number, v: number, id = BLOCKED) => { plan.gridValue[at(x, y)] = u8(v); plan.gridId[at(x, y)] = id; };

  /** Content-id outcome of Block_BuildContent (0x545A40). */
  const build = (x: number, y: number, id: number): void => {
    const i = at(x, y), before = plan.content[i];
    const strip = () => { // 0x54C090: LV <= 0x42 → row-house styles 1..3, else shop strip 0.
      if (plan.landValue[i] <= 0x42) { const s = r() % 3; plan.content[i] = s === 0 ? 2 : s === 1 ? 1 : 3; }
      else plan.content[i] = 0;
    };
    const onlyEmpty = (then: () => void) => { if (before === C.EMPTY) then(); };
    switch (id) {
      case 0: case 1: case 2: case 3: onlyEmpty(() => { plan.content[i] = id; strip(); }); break;
      case 5: case 68: case 69: case 70: case 19: case 20: case 21: case 22: case 23: case 24: case 38:
        plan.content[i] = id; break;
      case 11: case 12: case 13: case 14: onlyEmpty(() => {
        if (builder.eligibleBusiness?.(plan, x, y, r) === false) plan.content[i] = C.PLAZA;
        else plan.content[i] = r() % 4 + id;
      }); break;
      case 15: case 17: case 18: onlyEmpty(() => {
        const kind = builder.mixedBusinesses?.(plan, x, y, r);
        if (kind != null) plan.content[i] = kind;
        else { const s = r() % 3; plan.content[i] = s === 0 ? 15 : s === 1 ? 17 : 18; }
      }); break;
      case 34: plan.content[i] = before === C.AVENUE_V ? C.AVENUE_CROSSING : before === C.RAIL ? C.RAIL_OVER_AVENUE : id; break;
      case 35: plan.content[i] = before === C.RIVER_H ? C.BRIDGE : before === C.AVENUE_H ? C.AVENUE_CROSSING : id; break;
      case 39:
        if (before === C.RIVER_H) plan.content[i] = C.RAIL_BRIDGE;
        else if (before === C.AVENUE_H) plan.content[i] = C.RAIL_OVER_AVENUE;
        else if (before !== C.STATION) {
          if (plan.landValue[i] > 0x42) plan.landValue[i] = 65;
          strip(); plan.content[i] = C.RAIL;
        }
        break;
      case 36: case 37: case 40: case 41: onlyEmpty(() => { // two stacked builds from empty
        build(x, y, id === 36 ? 34 : id === 37 ? 20 : id === 40 ? 20 : 34);
        build(x, y, id === 41 || id === 40 ? 39 : 35);
      }); return;
      case 16: onlyEmpty(() => { builder.premiumBusinesses?.(plan, x, y, r); plan.content[i] = id; }); break;
      default:
        if (isParkContent(id) || id >= 42 || id === 4 || id === 6 || id === 7 || id === 8 || id === 9 || id === 10)
          onlyEmpty(() => { plan.content[i] = id; });
        else plan.content[i] = id;
    }
    plan.builds.push({ x, y, requested: id, result: plan.content[i] });
    builder.onBuild?.(plan, x, y, id, plan.content[i], r);
  };

  // §3.2 terrain roll: bit0 river, bit1 elevated rail.
  const roll = r() % 20;
  const layout = (roll === 0 ? 1 : roll === 1 ? 2 : 3) as 1 | 2 | 3;
  plan.layout = layout;
  const hasRiver = (layout & 1) !== 0, hasRail = (layout & 2) !== 0;
  const record = Array.from({ length: W }, () => ({ row: 0, turned: false, delta: 0 }));
  let riverMin = 40, riverMax = 0;

  // §3.3 river.
  if (!hasRiver) {
    for (const rec of record) { rec.row = H; rec.turned = false; rec.delta = 0; }
    riverMin = u8(5 * H); riverMax = H + 4; // QUIRK: the no-river maximum is not ×5.
  } else {
    let row = (r() & 3) + 16, x = 0, straight = 0;
    do {
      let run = (r() & 3) + 5;
      const runLength = run;
      if (straight < 5) {
        if (riverMin > row) riverMin = row;
        if (riverMax < row) riverMax = row;
        do { build(x, row, C.RIVER_H); record[x] = { row, turned: false, delta: 0 }; x++; run--; }
        while (W > x && run > 1); // QUIRK: builds run − 1 blocks (4..7).
      }
      if (W - 2 > x) {
        straight += runLength;
        const t = r() & 7;
        record[x].row = row; record[x].delta = 0;
        let turned = false;
        if (t <= 2 && row > 15) {
          build(x, row, C.RIVER_UP); row--; record[x].delta--; record[x].turned = true;
          if (t === 0 && row > 15) { build(x, row, C.RIVER_V); row--; record[x].delta--; }
          build(x, row, C.RIVER_UP_CAP); turned = true;
        } else if (t >= 5 && row < 20) {
          build(x, row, C.RIVER_DOWN); row++; record[x].delta++; record[x].turned = true;
          if (t === 7 && row < 20) { build(x, row, C.RIVER_V); row++; record[x].delta++; }
          build(x, row, C.RIVER_DOWN_CAP); turned = true;
        } else if (t === 3 || t === 4) {
          build(x, row, C.RIVER_H); record[x].delta = 0; record[x].turned = false;
        } else { spin('river turn'); continue; } // A blocked turn: roll again without advancing.
        if (turned) straight = 0;
        const edge = row + record[x].delta;
        if (edge < riverMin) riverMin = edge;
        if (edge > riverMax) riverMax = edge;
        x++;
      } else straight = 0;
    } while (W > x);
    riverMin = u8(riverMin * 5); riverMax = u8(riverMax * 5 + 4);
    plan.river = record;
  }
  plan.riverFineRows = { min: riverMin, max: riverMax };

  // §3.4 elevated rail and station.
  let railCol = W;
  if (hasRail) {
    do {
      const s = r() & 1;
      railCol = (s ? 10 : -16) + (W >> 1) + r() % 6;
      spin('rail column');
    } while (record[railCol]?.turned);
    for (let tries = 0; tries < 2 * H; tries++) {
      const row = r() % (H - 10) + 5;
      if (content(railCol, row) === C.EMPTY) { build(railCol, row, C.STATION); plan.station = { x: railCol, y: row }; break; }
    }
    for (let y = 0; y < H; y++) if (content(railCol, y) !== C.STATION) {
      const v = r() % 9 + 62;
      grid(railCol, y, v); setLV(railCol, y, v); build(railCol, y, C.RAIL);
    }
    plan.railColumn = railCol;
  }

  // §3.5 avenues: four columns and four rows, stamped in vertical/horizontal pairs.
  const pickCol = (f: () => number) => { let c; do { c = f(); spin('avenue column'); } while (record[c]?.turned || c === railCol); return c; };
  const pickRow = (f: () => number) => { let v; do { v = f(); spin('avenue row'); } while (hasRail && content(railCol, v) === C.STATION); return v; };
  const cols = [pickCol(() => r() % 4 + 4), pickCol(() => 14 - r() % 4), pickCol(() => r() % 4 + 26), pickCol(() => W - r() % 4 - 2)];
  const rows = [pickRow(() => r() % 3 + 3), pickRow(() => 12 - r() % 3), pickRow(() => r() % 3 + 21), pickRow(() => H + r() % 3 - 6)];
  plan.avenues = { cols, rows };
  for (let k = 0; k < 4; k++) {
    for (let y = 0; y < H; y++) {
      const c = content(cols[k], y);
      if (c === C.AVENUE_H || c === C.EMPTY || c === C.RIVER_H) build(cols[k], y, C.AVENUE_V);
    }
    for (let x = 0; x < W; x++) {
      const c = content(x, rows[k]);
      if (c === C.AVENUE_V || c === C.EMPTY || c === C.RAIL) build(x, rows[k], C.AVENUE_H);
    }
  }

  // §3.6 map-edge residential ring.
  const edge = (x: number, y: number) => {
    if (content(x, y) !== C.EMPTY) return;
    const v = r() % 13 + 67; setLV(x, y, v); build(x, y, C.SHOP_STRIP); grid(x, y, v);
  };
  for (let x = 0; x < W; x++) { edge(x, 0); edge(x, H - 1); }
  for (let y = 1; y < H - 1; y++) { edge(0, y); edge(W - 1, y); }
  for (let i = 0; i < 2; i++) for (let b = 0; b < 2; b++) {
    edge(b + 1, i + 1); edge(W - b - 2, i + 1); edge(W - b - 2, H - i - 2); edge(b + 1, H - i - 2);
  }
  for (let i = 0; i < n; i++) if (plan.content[i] !== C.EMPTY) plan.gridId[i] = BLOCKED;

  // §3.7 centre, bank and six department stores.
  const cx0 = (cols[1] + cols[2]) >> 1, cy0 = (rows[1] + rows[2]) >> 1;
  let cx, cy;
  do { cx = cx0 + r() % 5 - 2; cy = cy0 + r() % 5 - 2; spin('city centre'); } while (content(cx, cy) !== C.EMPTY);
  { const v = u8(r() % 11 - 61); grid(cx, cy, v); setLV(cx, cy, v); build(cx, cy, C.BANK_LARGE); }
  plan.centre = { x: cx, y: cy };
  const manhattan = (a: Point, x: number, y: number) => Math.abs(a.x - x) + Math.abs(a.y - y);
  while (plan.departmentStores.length < 6) {
    const q = plan.departmentStores.length & 3;
    let x, y;
    do {
      let dx = (r() & 3) + 2, dy = (r() & 3) + 2;
      if (q === 0) { dx = -dx; dy = -dy; } else if (q === 1) dy = -dy; else if (q === 2) dx = -dx;
      x = cx + dx; y = cy + dy; spin('department store');
    } while (content(x, y) !== C.EMPTY);
    if (plan.departmentStores.some(p => manhattan(p, x, y) < 3)) continue;
    const v = u8(r() % 11 - 61); grid(x, y, v); setLV(x, y, v); build(x, y, C.DEPARTMENT_STORE);
    plan.departmentStores.push({ x, y });
  }

  // Six civic institutions on the inner avenue box. QUIRK: spacing divides the
  // stored block coordinates by 5 as if they were fine-cell coordinates.
  const civicOrder = [['cityHall', C.CITY_HALL], ['courthouse', C.COURTHOUSE], ['fbiHQ', C.FBI_HQ],
    ['policeHQ', C.POLICE_HQ], ['hospital', C.HOSPITAL], ['fireDept', C.FIRE_DEPT]] as const;
  const near5 = (p: Point | undefined, x: number, y: number) => !!p &&
    Math.abs(trunc(p.y / 5) - y) + Math.abs(trunc(p.x / 5) - x) < 3;
  let prevSide = -1;
  for (let idx = 0; idx < 6;) {
    spin('civic');
    let side; do side = r() & 3; while (side === prevSide);
    prevSide = side;
    let x = 0, y = 0, tries = idx;
    do {
      if (side === 0) { x = cols[1] + 1; y = rows[1] + r() % (rows[2] - rows[1] - 1) + 1; }
      else if (side === 1) { y = rows[1] + 1; x = cols[1] + r() % (cols[2] - cols[1] - 1) + 1; }
      else if (side === 2) { x = cols[2] - 1; y = rows[1] + r() % (rows[2] - rows[1] - 1) + 1; }
      else { y = rows[2] - 1; x = cols[1] + r() % (cols[2] - cols[1] - 1) + 1; }
      tries++;
    } while (content(x, y) !== C.EMPTY && tries < 24);
    if (civicOrder.slice(0, idx).some(([key]) => near5(plan.civics[key], x, y))) continue;
    const v = r() % 9 + 66; grid(x, y, v); setLV(x, y, v);
    const [key, id] = civicOrder[idx];
    if (content(x, y) !== C.EMPTY) plan.notes.push(`${key} site (${x},${y}) was occupied after 24 tries; the original builds nothing there.`);
    plan.civics[key] = { x, y }; build(x, y, id);
    idx++;
  }

  // §3.8 ring POIs around the outer avenue corners.
  const ring = (list: Point[], jitter: () => number, value: () => number, id: number) => {
    let ax = cols[0], ay = rows[0];
    for (let k = 0; k < 4; k++) {
      if (k === 1) ax = cols[3]; else if (k === 2) ay = rows[3]; else if (k === 3) ax = cols[0];
      let x, y;
      for (;;) {
        const dx = jitter(), dy = jitter(); spin(`ring landmark ${id}`);
        x = ax + dx; y = ay + dy;
        if (x < W && x >= 0 && y < H && y >= 0 && content(x, y) === C.EMPTY) break;
      }
      const v = value(); grid(x, y, v); setLV(x, y, v); build(x, y, id); list.push({ x, y });
    }
  };
  const pm1 = () => (r() & 1) ? 1 : -1;
  const pm = (mask: number, off: number) => () => { const v = r() & mask; return v - off <= 0 ? v - off - 1 : v - off; };
  ring(plan.premiumCorners, pm1, () => u8(r() % 11 - 111), C.PREMIUM);
  ring(plan.radioStations, pm(7, 3), () => r() % 11 + 70, C.RADIO);
  ring(plan.newspapers, pm(7, 3), () => r() % 11 + 70, C.NEWSPAPER);

  // Churches on a quadrant mini-park. The original places four; our
  // override keeps one or two, taken from diagonal quadrants first.
  const churchCount = Math.max(0, Math.min(4, opts.churches ?? 4));
  for (const quadrant of [0, 3, 1, 2].slice(0, churchCount)) {
    const { x, y } = placeMiniPark(plan, r, build, quadrant);
    let bx = 0, by = 0, id: number;
    if (isParkContent(plan.content[at(x, y) + 1] ?? C.EMPTY)) {
      for (let j = 0; j < 2; j++) { const v = r() % 11 + 70; grid(x + j, y, v); setLV(x + j, y, v); }
      bx = 1; id = C.CHURCH_H;
    } else {
      for (let k = 0; k < 2; k++) { const v = r() % 11 + 70; grid(x, y + k, v); setLV(x, y + k, v); }
      by = r() & 1; id = by ? C.CHURCH_V_LOWER : C.CHURCH_V_UPPER;
    }
    build(x + bx, y + by, id); plan.churches.push({ x: x + bx, y: y + by });
  }
  ring(plan.schools, pm(15, 7), () => r() % 11 + 70, C.SCHOOL);

  // §3.9 orphanage anywhere inside the outer avenue rectangle.
  { let x, y;
    do { x = cols[0] + r() % (cols[3] - cols[0] + 1); y = rows[0] + r() % (rows[3] - rows[0] + 1); spin('orphanage'); } while (content(x, y) !== C.EMPTY);
    const v = r() % 11 + 70; grid(x, y, v); setLV(x, y, v); build(x, y, C.ORPHANAGE); plan.orphanage = { x, y }; }

  // §3.10 inner-box civics, clear of the six civics (÷5 QUIRK) and of each other.
  const inner = [['employment', C.EMPLOYMENT], ['museum', C.MUSEUM], ['baths', C.BATHS], ['usPost', C.US_POST]] as const;
  const placedInner: Point[] = [];
  for (const [key, id] of inner) {
    let x, y;
    for (;;) {
      x = cols[1] + r() % (cols[2] - cols[1] + 1); y = rows[1] + r() % (rows[2] - rows[1] + 1); spin(key);
      const clear = civicOrder.every(([k]) => !near5(plan.civics[k], x!, y!)) && placedInner.every(p => manhattan(p, x!, y!) >= 3);
      if (clear && content(x, y) === C.EMPTY) break;
    }
    const v = r() % 11 + 70; grid(x, y, v); setLV(x, y, v);
    plan.content[at(x, y)] = id; plan.builds.push({ x, y, requested: id, result: id });
    plan.innerCivics[key] = { x, y }; placedInner.push({ x, y });
  }

  // §3.12 commercial district seeds.
  const total = r() % 51 + 200, B = total + r() % 41 - 64;
  const seed = (x: number, y: number, lv: number, budget: number, jitter: number, floor: number, id: number) => {
    const d: DistrictSeed = { x, y, landValue: u8(lv), budget, jitter, floor, content: id, claimed: 0, radius: 1 };
    const districtId = plan.districts.length;
    if (districtId === 12) return;
    plan.districts.push(d);
    if (plan.gridId[at(x, y)] === FREE) { plan.gridValue[at(x, y)] = d.landValue; plan.gridId[at(x, y)] = districtId; }
  };
  seed(cx, cy, r() % 11 - 61, B - 6 * (B >> 3), 10, 80, C.MIXED);
  for (const p of plan.departmentStores) seed(p.x, p.y, plan.landValue[at(p.x, p.y)], B >> 3, 10, 80, C.MIXED);
  const share = (total - B) >> 2;
  for (const p of plan.premiumCorners.slice(0, 3)) seed(p.x, p.y, plan.landValue[at(p.x, p.y)], share, 10, 80, C.MIXED);
  { const p = plan.premiumCorners[3]; seed(p.x, p.y, plan.landValue[at(p.x, p.y)], total - 3 * share - B, 10, 80, C.MIXED); }

  // §3.11 industrial anchor, docks, water plant and power plant.
  let ax = hasRail ? railCol : (r() & 1) ? cols[3] : cols[0];
  let ay = hasRiver ? record[ax].row : (r() & 1) ? rows[2] : rows[1];
  plan.industrialAnchor = { x: ax, y: ay };
  {
    const dir = r() & 3;
    let dx = dir === 0 ? 1 : dir === 2 ? -1 : 0, dy = dir === 1 ? 1 : dir === 3 ? -1 : 0;
    const mirror = r() & 1;
    let segment = 1, stepInSegment = 0, half = 0, found = false;
    for (let steps = 0; steps < 1280 && !found; steps++) {
      if (mirror) { ax -= dx; ay -= dy; } else { ax += dx; ay += dy; }
      if (ax >= 0 && ax < W && ay >= 0 && ay < H && plan.gridId[at(ax, ay)] === FREE) {
        if (!hasRiver) found = true;
        else {
          const a = record[ax].row - ay, b = record[ax].row + record[ax].delta - ay;
          if (a === 1 || a === -1 || b === 1 || b === -1) found = true;
        }
      }
      if (++stepInSegment === segment) {
        stepInSegment = 0;
        if (half) segment++;
        half = 1 - half;
        if (dx) { dy = dx > 0 ? 1 : -1; dx = 0; } else { dx = dy > 0 ? -1 : 1; dy = 0; }
      }
    }
    if (!found) plan.notes.push('Docks spiral found no free site in 1,280 steps; the original uses its last position.');
  }
  const docksValue = u8(r() % 11 - 111);
  plan.gridValue[at(ax, ay)] = docksValue;
  if (!hasRiver) { plan.docksRemoved = true; builder.onDocksErased?.(); } // The economy erases the Docks record.
  else {
    plan.gridId[at(ax, ay)] = BLOCKED; setLV(ax, ay, docksValue);
    plan.content[at(ax, ay)] = C.DOCKS; plan.builds.push({ x: ax, y: ay, requested: C.DOCKS, result: C.DOCKS });
    builder.onBuild?.(plan, ax, ay, C.DOCKS, C.DOCKS, r);
    plan.docks = { x: ax, y: ay };
  }
  const docksX = ax, docksY = ay;
  const nearIndustry = (id: number, key: 'waterPlant' | 'powerPlant') => {
    let x, y;
    for (;;) {
      const v = r() & 7; x = docksX + (v >= 4 ? v - 3 : v - 4); spin(key);
      if (x < 0 || x >= W || !hasRiver) { y = rows[1] + r() % (rows[2] - rows[1] + 1); }
      else {
        y = record[x].row - 1;
        if (content(x, y) !== C.EMPTY) y += 2;
        if (content(x, y) === C.EMPTY) break;
        continue;
      }
      if (x >= 0 && x < W && content(x, y) === C.EMPTY) break;
    }
    const v = r() % 11 + 70; grid(x, y, v); setLV(x, y, v); build(x, y, id); plan[key] = { x, y };
  };
  nearIndustry(C.WATER_PLANT, 'waterPlant');
  nearIndustry(C.POWER_PLANT, 'powerPlant');
  seed(docksX, docksY, plan.gridValue[at(docksX, docksY)], r() % 10 + 46, 10, 64, C.SINGLE_BUSINESS);

  diffuseLandValues(plan, r);
  growDistricts(plan, build);
  placeParks(plan, r, build);

  // §3.13 leftover residential fill.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (plan.gridId[at(x, y)] !== FREE) continue;
    let sum = 0, count = 0;
    for (let ny = y - 2; ny <= y + 2; ny++) {
      if (ny < 0 || ny >= H) continue;
      for (let nx = x - 2; nx <= x + 2; nx++) {
        if (nx < 0 || nx >= W || (nx === x && ny === y)) continue;
        const c = content(nx, ny);
        sum += c === C.SINGLE_BUSINESS ? r() % 5 + 38 : isRiverContent(c) ? r() % 9 + 76 : r() % 7 + 57;
        count++;
      }
    }
    if (!count) continue;
    const avg = trunc(sum / count);
    setLV(x, y, Math.min(avg, 66)); build(x, y, C.ROWHOUSE_B); setLV(x, y, avg);
  }
  return plan;
}

/** CityGen_DiffuseLandValues (0x537170), both phases. */
function diffuseLandValues(plan: OriginalCityPlan, r: () => number): void {
  const { w: W, h: H } = plan, ds = plan.districts, S = Math.sqrt(0.5);
  // The scratch grid is a flat 64 × 32 array indexed 32·x + y, so a row past the
  // bottom edge reads the next column's top rows; columns past W were never
  // cleared and read as district 0 in a fresh process.
  const idAt = (x: number, y: number) => {
    const flat = 32 * x + y, fx = flat >> 5, fy = flat & 31;
    return fx < W ? plan.gridId[fy * W + fx] : 0;
  };
  const valueFor = (d: DistrictSeed, dist: number) => {
    let f = 1; for (let k = 0; k < dist; k++) f *= S;
    let v = trunc(d.landValue * f);
    if (v < d.floor) v = d.floor;
    const range = trunc(v * d.jitter / 100);
    v = r() % (range + 1) + v - ((range + 1) >> 1);
    return Math.min(255, Math.max(d.floor, v));
  };
  // Claim (x, y) for district `di`. QUIRK: the "already mine" test for the
  // mirrored upper row reads the district id from the lower row (ownerX, ownerY).
  const claim = (di: number, x: number, y: number, v: number, owner: [number, number] | null) => {
    const i = y * W + x, id = plan.gridId[i];
    if (id === BLOCKED) return false;
    if (id === FREE) { plan.gridId[i] = di; plan.gridValue[i] = v; ds[di].claimed++; return true; }
    const mine = owner ? idAt(owner[0], owner[1]) === di : id === di;
    if (!mine && plan.gridValue[i] < v) { ds[id].claimed--; plan.gridId[i] = di; plan.gridValue[i] = v; ds[di].claimed++; return true; }
    return false;
  };
  const maxRadius = W + H;
  let active = true;
  while (active) {
    active = false;
    ds.forEach((d, di) => {
      if (d.budget <= d.claimed) return;
      if (d.radius > maxRadius) return; // GUARD: the original would loop forever here.
      active = true;
      let iter = 0, err = 1, acc = 0, rMax = d.radius, errStep = 2 * d.radius - 1, none = true;
      const room = () => d.budget > d.claimed;
      do {
        const yLo = d.y - iter, yHi = d.y + iter;
        for (let i = 0; i <= rMax; i++) {
          const xHi = d.x + i, xLo = d.x - i;
          if (!(W > xLo && xHi >= 0 && room())) continue;
          const loIn = yLo >= 0 && H > yLo, hiIn = yHi >= 0 && H > yHi;
          if (!loIn && !hiIn) continue;
          const v = valueFor(d, trunc(Math.sqrt(iter * iter + i * i)));
          if (loIn) {
            if (xLo >= 0 && claim(di, xLo, yLo, v, [xLo, yHi])) none = false;
            if (xHi !== xLo && W > xHi && room() && claim(di, xHi, yLo, v, [xHi, yHi])) none = false;
          }
          if (yHi !== yLo && hiIn && room()) {
            if (xLo >= 0 && claim(di, xLo, yHi, v, null)) none = false;
            if (xHi !== xLo && W > xHi && room() && claim(di, xHi, yHi, v, null)) none = false;
          }
        }
        iter++; acc += err; err += 2;
        if (2 * acc > errStep && rMax > iter) {
          acc -= errStep; errStep -= 2;
          const yHi2 = d.y + rMax, yLo2 = d.y - rMax;
          for (let i = 0; i <= iter; i++) {
            const xLo = d.x - i, xHi = d.x + i;
            if (!(W > xLo && xHi >= 0 && room())) continue;
            const loIn = yLo2 >= 0 && H > yLo2, hiIn = yHi2 >= 0 && H > yHi2;
            if (!loIn && !hiIn) continue;
            // QUIRK: the distance uses (i − seedX) instead of i.
            const v = valueFor(d, trunc(Math.sqrt((i - d.x) * (i - d.x) + rMax * rMax)));
            if (loIn) {
              if (xLo >= 0 && claim(di, xLo, yLo2, v, [xLo, yHi2])) none = false;
              if (xHi !== xLo && W > xHi && room() && claim(di, xHi, yLo2, v, [xHi, yHi2])) none = false;
            }
            if (yHi2 !== yLo2 && hiIn && room()) {
              if (xLo >= 0 && claim(di, xLo, yHi2, v, null)) none = false;
              if (xHi !== xLo && W > xHi && room() && claim(di, xHi, yHi2, v, null)) none = false;
            }
          }
          rMax--;
        }
      } while (rMax >= iter);
      if (none) d.radius++;
    });
  }
  if (ds.some(d => d.budget > d.claimed)) plan.notes.push('A district could not reach its block budget; the original would not terminate.');

  // Phase 2: shuffle sub-120 values inside 4×4 windows at four mirrored positions.
  for (let j = (H >> 1) - 1; j > 1; j -= 2) for (let k = (W >> 1) - 1; k > 1; k -= 2) for (let m = 0; m < 4; m++) {
    const x0 = m === 0 || m === 3 ? k : W - k - 2, y0 = m <= 1 ? j : H - j - 2;
    const cells: number[] = [];
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
      const x = x0 + dx, y = y0 + dy; if (x >= W || y >= H) continue;
      const i = y * W + x;
      if (plan.gridId[i] !== BLOCKED && plan.gridValue[i] < 0x78) cells.push(i);
    }
    const pool = cells.map(i => [plan.gridValue[i], plan.gridId[i]]), out: number[][] = [];
    while (pool.length) out.push(pool.splice(r() % pool.length, 1)[0]);
    cells.forEach((i, n2) => { [plan.gridValue[i], plan.gridId[i]] = out[n2]; });
  }
}

/** CityGen_GrowDistricts (0x537D70): square rings out from the city centre. */
function growDistricts(plan: OriginalCityPlan, build: (x: number, y: number, id: number) => void): void {
  const { w: W, h: H, centre: { x: cx, y: cy } } = plan;
  const visit = (x: number, y: number) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = y * W + x, id = plan.gridId[i];
    if (id >= BLOCKED) return;
    plan.landValue[i] = plan.gridValue[i];
    build(x, y, plan.districts[id].content);
  };
  for (let d = 0; ; d++) {
    if (cx - d < 0 && W <= cx + d && cy - d < 0 && H <= cy + d) break;
    for (let i = 0; i <= d; i++) {
      visit(cx - d, cy - i); visit(cx - d, cy + i);
      if (d) { visit(cx + d, cy + i); visit(cx + d, cy - i); }
      if (i !== d) { visit(cx + i, cy - d); visit(cx - i, cy - d); visit(cx - i, cy + d); visit(cx + i, cy + d); }
    }
  }
}

/** Edge masks for a park rectangle (column-major, stride h), as 0x5394A0/0x539F60 compute them. */
function parkMasks(free: boolean[], w: number, h: number): number[] {
  const m: number[] = free.map(f => f ? 0 : -1), get = (x: number, y: number) => m[x * h + y];
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    let c = get(x, y); if (c < 0) continue;
    if (x > 0 && y > 0 && get(x - 1, y - 1) < 0) c |= 0x10;
    if (x < w - 1 && y > 0 && get(x + 1, y - 1) < 0) c |= 0x80;
    if (x > 0 && y < h - 1 && get(x - 1, y + 1) < 0) c |= 0x20;
    if (x < w - 1 && y < h - 1 && get(x + 1, y + 1) < 0) c |= 0x40;
    if (x === 0 || get(x - 1, y) < 0) c = (c | 2) & 0xcf;
    if ((x < w - 1 && get(x + 1, y) < 0) || w - x === 1) c = (c | 8) & 0x3f;
    if (y === 0 || get(x, y - 1) < 0) c = (c | 1) & 0x6f;
    if ((y < h - 1 && get(x, y + 1) < 0) || h - y === 1) c = (c | 4) & 0x9f;
    m[x * h + y] = c;
  }
  return m;
}

const quadrantOrigin = (plan: OriginalCityPlan, q: number) => ({
  x: q === 1 || q === 3 ? (plan.w >> 1) + 1 : 0, y: q === 2 || q === 3 ? (plan.h >> 1) + 1 : 0 });
const clearOfRiver = (plan: OriginalCityPlan, q: number, top: number, bottom: number) =>
  q <= 1 ? trunc(plan.riverFineRows.min / 5) - 1 > bottom : trunc(plan.riverFineRows.max / 5) + 1 < top;

/** CityGen_PlaceParks (0x5394A0): one park per quadrant. */
function placeParks(plan: OriginalCityPlan, r: () => number, build: (x: number, y: number, id: number) => void): void {
  const { w: W, h: H } = plan;
  for (let q = 0; q < 4; q++) {
    const o = quadrantOrigin(plan, q);
    let pw = 0, ph = 0, px = 0, py = 0, tries = 0, ok = false;
    do {
      pw = r() % 3 + 2; ph = (r() & 1) + 2;
      px = r() % ((W >> 1) - pw - 1) + o.x; py = o.y + r() % ((H >> 1) - ph - 1);
      let free = 0;
      for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) if (plan.content[y * W + x] === C.EMPTY) free++;
      ok = free === pw * ph && clearOfRiver(plan, q, py, py + ph);
      tries++;
    } while (!ok && tries < 1000);
    // QUIRK: a fit found on the 1,000th try still counts as a failure.
    if (tries >= 1000) { plan.notes.push(`No park fitted quadrant ${q} in 1,000 tries.`); continue; }
    const free: boolean[] = [];
    for (let x = 0; x < pw; x++) for (let y = 0; y < ph; y++) free.push(plan.content[(py + y) * W + px + x] === C.EMPTY);
    const masks = parkMasks(free, pw, ph), density: number[] = [];
    for (let x = 0; x < pw; x++) for (let y = 0; y < ph; y++) {
      const c = masks[x * ph + y]; if (c < 0) continue;
      plan.landValue[(py + y) * W + px + x] = r() % 8 + 67;
      build(px + x, py + y, PARK_CONTENT_BY_MASK[c & 0xf]);
    }
    for (const c of masks) density.push(c < 0 ? 0 : c ? r() % 15 + 35 : r() % 25 + 50);
    plan.parks.push({ x: px, y: py, w: pw, h: ph, quadrant: q, masks, treeDensity: density });
  }
}

/** CityGen_PlaceQuadrantMiniPark (0x539F60): a 1×2 or 2×1 park for church grounds. */
function placeMiniPark(plan: OriginalCityPlan, r: () => number, build: (x: number, y: number, id: number) => void, q: number): Point {
  const { w: W, h: H } = plan, o = quadrantOrigin(plan, q);
  let pw = 1, ph = 2, px = 0, py = 0, tries = 0, ok = false;
  do {
    if (r() & 1) { pw = 2; ph = 1; } else { pw = 1; ph = 2; }
    px = r() % ((W >> 1) - pw - 1) + o.x; py = r() % ((H >> 1) - ph - 1) + o.y;
    let free = 0;
    for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) if (plan.content[y * W + x] === C.EMPTY) free++;
    ok = free === pw * ph && clearOfRiver(plan, q, py, py + ph);
    tries++;
  } while (!ok && tries < 1000);
  if (tries >= 1000) { plan.notes.push(`Church mini-park in quadrant ${q} fell back to its last try (${px},${py}).`); return { x: px, y: py }; }
  const free: boolean[] = [];
  for (let x = 0; x < pw; x++) for (let y = 0; y < ph; y++) {
    const gx = px + x, gy = py + y;
    free.push(gx >= 0 && gy >= 0 && gx < W && gy < H && plan.content[gy * W + gx] === C.EMPTY);
  }
  const masks = parkMasks(free, pw, ph);
  for (let x = 0; x < pw; x++) for (let y = 0; y < ph; y++) {
    const c = masks[x * ph + y]; if (c < 0) continue;
    plan.landValue[(py + y) * W + px + x] = r() % 8 + 67;
    build(px + x, py + y, PARK_CONTENT_BY_MASK[c & 0xf]);
  }
  plan.parks.push({ x: px, y: py, w: pw, h: ph, quadrant: q, masks, treeDensity: masks.map(() => 0) });
  return { x: px, y: py };
}
