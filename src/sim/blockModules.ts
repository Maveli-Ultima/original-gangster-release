import type { Block, Lot } from './types';
import { rint } from './hash';

export type ModuleRect = { x: number; y: number; w: number; h: number };
type Use = 'homes' | 'shops' | 'business' | 'works';
export type ModulePlot = ModuleRect & { index: number; facing: NonNullable<Lot['facing']>; use: Use; vacant?: boolean; setback?: number };
export interface BlockModule {
  id: string; name: string; width: number; depth: number;
  plots: ModulePlot[];
  grounds: (ModuleRect & { surface: 'lawn' | 'gravel' })[];
  walls: { ax: number; ay: number; bx: number; by: number }[];
  trees: { x: number; y: number }[];
}

/** Authored in metres on a 2 m planning grid. IDs are versioned: saved cities
 * retain their parcels and a later catalogue must not silently redesign them. */
function court(id: string, name: string, use: Use, garden: boolean, vacant: boolean): BlockModule {
  const plot = (index: number, x: number, y: number, w: number, h: number,
    facing: ModulePlot['facing'], kind = use): ModulePlot => ({ index, x, y, w, h, facing, use: kind });
  return { id, name, width: 34, depth: 34,
    plots: [plot(0, 0, 0, 10, 10, 'north'), plot(1, 10, 0, 14, 10, 'north'), plot(2, 24, 0, 10, 10, 'north'),
      { ...plot(3, 0, 10, 10, 14, 'west'), vacant }, plot(5, 24, 10, 10, 14, 'east'),
      plot(6, 0, 24, 12, 10, 'south'), plot(7, 12, 24, 10, 10, 'south'), plot(8, 22, 24, 12, 10, 'south'),
      plot(4, 14, 14, 6, 6, 'south', 'works')],
    grounds: [{ x: 10, y: 10, w: 14, h: 14, surface: 'gravel' },
      ...(vacant ? [{ x: .6, y: 10.6, w: 8.8, h: 12.8, surface: garden ? 'lawn' as const : 'gravel' as const }] : []),
      ...[ [10, 10], [20, 10], [10, 20], [20, 20] ].map(([x, y]) => ({ x, y, w: 4, h: 4,
        surface: garden ? 'lawn' as const : 'gravel' as const }))],
    // Low rear-yard edges, clear of the centre business and its access paths.
    walls: garden ? [{ ax: 10.3, ay: 14, bx: 13, by: 14 }, { ax: 21, ay: 14, bx: 23.7, by: 14 },
      { ax: 10.3, ay: 20, bx: 13, by: 20 }, { ax: 21, ay: 20, bx: 23.7, by: 20 }] : [],
    trees: garden ? [{ x: 12, y: 12 }, { x: 22, y: 22 }] : [],
  };
}

function row(id: string, name: string, use: Use, garden: boolean): BlockModule {
  const plots: ModulePlot[] = [];
  // Seven deliberately sized frontages on each long street; a 4 m service
  // alley passes behind the south row and exits at both short streets.
  const widths = [12, 14, 12, 12, 14, 12, 12];
  let index = 0;
  for (const [y, facing] of [[0, 'north'], [24, 'south']] as const) {
    let x = 0;
    for (const w of widths) {
      if (index === 4) index++;
      plots.push({ index: index++, x, y, w, h: 10, facing, use }); x += w;
    }
  }
  plots.push({ index: index++, x: 0, y: 10, w: 10, h: 10, facing: 'west', use },
    { index, x: 78, y: 10, w: 10, h: 10, facing: 'east', use },
    // The rear business is attached to a particular frontage's yard instead
    // of being stranded at the centre of an otherwise empty concrete field.
    { index: 4, x: 38, y: 10, w: 10, h: 10, facing: 'south', use: 'works' });
  const yards = [[12, 12], [26, 10], [50, 12], [64, 12]];
  return { id, name, width: 88, depth: 34, plots,
    grounds: [{ x: 0, y: 10, w: 88, h: 14, surface: 'gravel' },
      ...yards.map(([x, w]) => ({ x, y: 10, w, h: 10, surface: garden ? 'lawn' as const : 'gravel' as const }))],
    walls: yards.flatMap(([x, w]) => [
      { ax: x, ay: 11, bx: x, by: 20 }, { ax: x + w, ay: 11, bx: x + w, by: 20 },
      { ax: x, ay: 20, bx: x + w / 2 - 1.2, by: 20 }, { ax: x + w / 2 + 1.2, ay: 20, bx: x + w, by: 20 }]),
    trees: garden ? [{ x: 18, y: 15 }, { x: 70, y: 15 }] : [],
  };
}

/** Shop/work blocks have deep premises and a small concealed back-lot site,
 * not the residential lawn court. The long kit leaves a narrow rear passage. */
function compact(module: BlockModule): BlockModule {
  const long = module.width > 34;
  return { ...module, plots: module.plots.map(p => {
    if (p.index === 4) return { ...p, x: long ? 38 : 14, y: 14, w: long ? 10 : 6, h: 6 };
    if (p.facing === 'north') return { ...p, h: 14, vacant: false };
    if (p.facing === 'south') return { ...p, y: 20, h: 14, vacant: false };
    return { ...p, x: p.facing === 'west' ? 0 : module.width - (long ? 10 : 14),
      y: 14, w: long ? 10 : 14, h: long ? 4 : 6, vacant: false };
  }), grounds: [{ x: long ? 0 : 14, y: 14, w: long ? 88 : 6, h: 6, surface: 'gravel' }], walls: [], trees: [] };
}

/** Solid shop blocks share party/rear walls. Only the reserved hidden-business
 * parcel remains inside; there is no continuous courtyard or service strip. */
function commercial(id: string, name: string, use: Use, long = false): BlockModule {
  const module = compact(court(id, name, use, false, false));
  if (long) {
    const widths = [10, 14, 14, 10, 14, 16, 10];
    const plots: ModulePlot[] = [];
    let index = 0;
    for (const facing of ['north', 'south'] as const) {
      let x = 0;
      for (const w of widths) {
        if (index === 4) index++;
        // The short ends and one back-lot bay occupy the middle six metres.
        // Everywhere else, the two street rows meet at a shared rear wall.
        const bay = x === 0 || x === 38 || x === 78;
        const y = facing === 'north' ? 0 : bay ? 20 : 18;
        const h = facing === 'north' ? bay ? 14 : 18 : 34 - y;
        plots.push({ index: index++, x, y, w, h, facing, use });
        x += w;
      }
    }
    plots.push({ index: index++, x: 0, y: 14, w: 10, h: 6, facing: 'west', use },
      { index, x: 78, y: 14, w: 10, h: 6, facing: 'east', use },
      { index: 4, x: 38, y: 14, w: 10, h: 6, facing: 'south', use: 'works' });
    module.width = 88; module.plots = plots;
    module.grounds = [{ x: 38, y: 14, w: 10, h: 6, surface: 'gravel' }];
  }
  module.plots = module.plots.map(p => ({ ...p, setback: p.index === 4 ? 1.2 : 0 }));
  return module;
}

export function moduleSetback(plot: ModulePlot): number {
  return plot.setback ?? (plot.index === 4 ? 1.2 : .4);
}

// Preserve old saved parcels exactly; only new cities choose the revised kits.
export const LEGACY_BLOCK_MODULES: readonly BlockModule[] = [
  compact(court('corner-shops-v1', 'Compact corner shops (legacy)', 'shops', false, false)),
  compact(court('mercantile-court-v1', 'Compact mercantile block (legacy)', 'business', false, false)),
  compact(row('shopping-row-v1', 'Shopping terrace and service passage (legacy)', 'shops', false)),
];

export const BLOCK_MODULES: readonly BlockModule[] = [
  court('terrace-court-v1', 'Residential court', 'homes', true, true),
  compact(court('residential-row-v1', 'Compact residential block', 'homes', false, false)),
  commercial('corner-shops-v2', 'Back-to-back corner shops', 'shops'),
  commercial('mercantile-court-v2', 'Back-to-back mercantile block', 'business'),
  compact(court('works-court-v1', 'Compact workshops', 'works', false, false)),
  row('terrace-row-v1', 'Long residential terrace', 'homes', true),
  commercial('shopping-row-v2', 'Back-to-back shopping terrace', 'shops', true),
  compact(row('works-row-v1', 'Workshops and service passage', 'works', false)),
];
export const BLOCK_MODULE_BY_ID = Object.fromEntries([...LEGACY_BLOCK_MODULES, ...BLOCK_MODULES].map(m => [m.id, m]));

/** Building families are chosen per module, not independently from a citywide
 * pool. Business state/ownership still belongs to each real simulation site. */
export const MODULE_BUILDING_TYPES: Record<Use, readonly string[]> = {
  homes: ['tenementPoor', 'tenementMid', 'tenementMid', 'tenementRich'],
  shops: ['grocers', 'bakers', 'butchers', 'convenienceStore', 'shoeStore', 'tailors', 'bookStore', 'pawnbroker',
    'jewellers', 'furrier', 'drugStore', 'plumbers', 'cafe', 'milkBar', 'breakfastBar', 'restaurant', 'poolHall', 'gym',
    'healthCenter', 'massageParlor', 'danceStudio', 'barbers', 'laundry', 'hardwareStore', 'autoShop'],
  business: ['bankSmall', 'bankLarge', 'financeCompany', 'hotelSmall', 'hotelLarge', 'departmentStore', 'accountancy',
    'lawFirm', 'school', 'library', 'firehouse', 'labourExchange'],
  works: ['warehouse', 'garageDepot', 'printers', 'foundry', 'mill', 'cannery', 'tradeUnion'],
};

export function chooseBlockModule(block: Block, seed: number): { id: string; turn: number } {
  const long = Math.max(block.layout?.spanX ?? 1, block.layout?.spanY ?? 1) > 1;
  const d = block.district;
  const id = long ? d === 'industrial' ? 'works-row-v1' : d === 'residential' ? 'terrace-row-v1' : 'shopping-row-v2'
    : d === 'industrial' ? 'works-court-v1' : d === 'downtown' || d === 'civic' ? 'mercantile-court-v2'
      : d === 'residential' ? rint(block.id, seed + 832, 4) === 0 ? 'terrace-court-v1' : 'residential-row-v1' : 'corner-shops-v2';
  return { id, turn: (long && block.layout!.spanY > block.layout!.spanX ? 1 : 0) + 2 * rint(block.id, seed + 831, 2) };
}

export function modulePoint(m: BlockModule, turn: number, x: number, y: number): { x: number; y: number } {
  if (turn === 1) return { x: m.depth - y, y: x };
  if (turn === 2) return { x: m.width - x, y: m.depth - y };
  if (turn === 3) return { x: y, y: m.width - x };
  return { x, y };
}
export function moduleRect(m: BlockModule, turn: number, r: ModuleRect): ModuleRect {
  const a = modulePoint(m, turn, r.x, r.y), b = modulePoint(m, turn, r.x + r.w, r.y + r.h);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}
export function moduleFacing(facing: ModulePlot['facing'], turn: number): ModulePlot['facing'] {
  const sides = ['north', 'east', 'south', 'west'] as const;
  return sides[(sides.indexOf(facing) + turn) % 4];
}
