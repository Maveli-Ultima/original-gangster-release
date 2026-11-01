import { STREET_WIDTH, CELL } from '../sim/constants';
import { cityStreetInset } from '../sim/cityLayout';
import type { Block, WorldState } from '../sim/types';
import { paveWidth } from './util';

export interface Rect { x: number; y: number; w: number; h: number }
export interface RiverBank {
  /** Open water: to the cell edge where the river continues, to the plot line on land sides. */
  water: Rect;
  /** Raised bank pavements between the kerb and the water, on each land side. */
  banks: Rect[];
  /** Railings along the water's edge on land sides; at a bridge, its parapets. */
  railings: { x0: number; y0: number; x1: number; y1: number }[];
}

/**
 * The original city's river block: rows 1..3 are water and the outer ring is
 * bank pavement where it meets land (Block_BuildContent 19..24). Neighbouring
 * river blocks join into one channel; the map edge leaves the river open.
 * Bridges are avenue blocks, so their side of a river block is a land side: the
 * streets beside a bridge cross on dry deck behind the parapet railings.
 */
/** An avenue crossing the river (content 37): water under the avenue's two
 * carriageways, which cross on decks at the cell's street edges. */
export function riverCrossing(b: Block | null | undefined): boolean {
  return b?.layout?.use === 'avenue' && b.original?.content === 37;
}

export function riverBank(w: WorldState, b: Block): RiverBank {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w.gridW && y < w.gridH ? w.blocks[y * w.gridW + x] : null;
  // A side is land when there is a non-river block there; off the map the river flows on.
  const wet = (n: Block | null) => n?.layout?.use === 'water' || riverCrossing(n);
  const land = (x: number, y: number) => { const n = at(x, y); return !!n && !wet(n); };
  // Either side of a crossing is a street deck, so the water stops at the plot
  // line there too, behind a parapet; the bank pavement runs only on land sides.
  const crossing = riverCrossing(b);
  const deck = (x: number, y: number) => crossing || riverCrossing(at(x, y));
  const N = land(b.gx, b.gy - 1) || deck(b.gx, b.gy - 1), S = land(b.gx, b.gy + 1) || deck(b.gx, b.gy + 1);
  const W = land(b.gx - 1, b.gy) || deck(b.gx - 1, b.gy), E = land(b.gx + 1, b.gy) || deck(b.gx + 1, b.gy);
  const bankN = land(b.gx, b.gy - 1), bankS = land(b.gx, b.gy + 1), bankW = land(b.gx - 1, b.gy), bankE = land(b.gx + 1, b.gy);
  const plot = STREET_WIDTH / 2 + cityStreetInset(w), kerb = plot - paveWidth(w);
  const x0 = b.gx * CELL, y0 = b.gy * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
  const water = { x: x0 + (W ? plot : 0), y: y0 + (N ? plot : 0), w: 0, h: 0 };
  water.w = x1 - (E ? plot : 0) - water.x; water.h = y1 - (S ? plot : 0) - water.y;
  const banks: Rect[] = [], railings: RiverBank['railings'] = [];
  // North and south banks run between the kerbs of any land to the west or east;
  // west and east banks fill between them.
  const bx0 = x0 + (W ? kerb : 0), bx1 = x1 - (E ? kerb : 0);
  if (bankN) banks.push({ x: bx0, y: y0 + kerb, w: bx1 - bx0, h: plot - kerb });
  if (bankS) banks.push({ x: bx0, y: y1 - plot, w: bx1 - bx0, h: plot - kerb });
  const by0 = y0 + (N ? plot : 0), by1 = y1 - (S ? plot : 0);
  if (bankW) banks.push({ x: x0 + kerb, y: by0, w: plot - kerb, h: by1 - by0 });
  if (bankE) banks.push({ x: x1 - plot, y: by0, w: plot - kerb, h: by1 - by0 });
  const r = water;
  if (N) railings.push({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y });
  if (S) railings.push({ x0: r.x, y0: r.y + r.h, x1: r.x + r.w, y1: r.y + r.h });
  if (W) railings.push({ x0: r.x, y0: r.y, x1: r.x, y1: r.y + r.h });
  if (E) railings.push({ x0: r.x + r.w, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
  return { water, banks, railings };
}
