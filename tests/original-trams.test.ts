import { describe, expect, it } from 'vitest';
import { defaultGameOptions, newCampaignOptions } from '../src/app/newGame';
import { createWorld } from '../src/sim/citygen';
import { CELL, MINUTES_PER_WEEK } from '../src/sim/constants';
import { validateSaveWorld } from '../src/sim/saveSchema';
import {
  TRAMS_PER_DIRECTION, TRAM_SPEED, TRAM_STOP_DWELL, TRAM_TRACK, cityTramLines, originalTramLines, tramLineValid, tramsAt,
} from '../src/sim/trams';
import type { WorldState } from '../src/sim/types';

// The original's avenues are tramways (block names 0x4EC3D0: contents 34..37
// "Tramway", 41 "Tram crossing"). CityGen 0x53A520 puts four trams each way on
// every avenue's middle cell, at cells W/2 + k·W; each runs one cell past the
// map edge, crosses to the other track and comes back (0x621020).
// docs/audit/2026-10-29/trams/review.md.

const original = createWorld({ ...newCampaignOptions(), seed: 404 }).world;
const clone = (w: WorldState): WorldState => JSON.parse(JSON.stringify(w));

describe('original city tram lines', () => {
  it('lays one line down the middle of each avenue, edge to edge, the same for the same seed', () => {
    const { rows, cols } = original.cityLayout!.original!.avenues;
    const lines = original.cityLayout!.tramLines;
    expect(lines).toHaveLength(rows.length + cols.length);
    expect(lines.map(l => l.points)).toEqual([
      ...rows.map(r => [{ x: 0, y: (r + .5) * CELL }, { x: original.gridW * CELL, y: (r + .5) * CELL }]),
      ...cols.map(c => [{ x: (c + .5) * CELL, y: 0 }, { x: (c + .5) * CELL, y: original.gridH * CELL }]),
    ]);
    for (const line of lines) expect(line.stops).toEqual([]); // no fixed stops in the original
    const again = createWorld({ ...newCampaignOptions(), seed: 404 }).world;
    expect(again.cityLayout!.tramLines).toEqual(lines);
    const other = createWorld({ ...newCampaignOptions(), seed: 1928 }).world;
    expect(other.cityLayout!.tramLines.map(l => l.points)).not.toEqual(lines.map(l => l.points));
  }, 120000);

  it('runs only over open avenue blocks, never through a parcel', () => {
    for (const w of [original, createWorld({ ...newCampaignOptions(), seed: 1928 }).world]) {
      for (const line of w.cityLayout!.tramLines) {
        const [a, b] = line.points, alongX = a.y === b.y;
        const n = alongX ? w.gridW : w.gridH, fixed = Math.floor((alongX ? a.y : a.x) / CELL);
        for (let k = 0; k < n; k++) {
          const block = w.blocks[alongX ? fixed * w.gridW + k : k * w.gridW + fixed];
          expect(block.layout?.use, `${line.name} at ${k}`).toBe('avenue');
          expect(block.lotIds).toHaveLength(0);
        }
        expect(tramLineValid(w, line)).toBe(true);
      }
    }
  }, 120000);

  it('saves and loads its lines, and refuses one moved off its avenue', () => {
    expect(() => validateSaveWorld(clone(original))).not.toThrow();
    const { rows } = original.cityLayout!.original!.avenues;
    const row = Array.from({ length: original.gridH }, (_, i) => i).find(i => !rows.includes(i))!;
    const bad = clone(original);
    bad.cityLayout!.tramLines[0].points = [{ x: 0, y: (row + .5) * CELL }, { x: bad.gridW * CELL, y: (row + .5) * CELL }];
    expect(() => validateSaveWorld(bad)).toThrow(/tram route/);
  });

  it('gives an original city saved without lines its avenues’ lines', () => {
    const old = clone(original);
    old.cityLayout!.tramLines = [];
    expect(cityTramLines(old)).toEqual(originalTramLines(old));
    expect(tramsAt(old, 300)).toEqual(tramsAt(original, 300));
  });
});

describe('original city trams', () => {
  it('runs four each way on every avenue: 64 on the stock map', () => {
    const trams = tramsAt(original, 0);
    expect(trams).toHaveLength(8 * 2 * TRAMS_PER_DIRECTION);
    const lines = original.cityLayout!.tramLines;
    lines.forEach((line, li) => {
      const mine = trams.filter(t => t.line === li);
      const length = Math.hypot(line.points[1].x - line.points[0].x, line.points[1].y - line.points[0].y);
      // Cells W/2 + k·W of 5W (middle of the cell): fractions .1, .3, .5, .7 of the line, on both tracks.
      for (const outbound of [true, false]) {
        const along = mine.filter(t => t.outbound === outbound).map(t => t.along).sort((a, b) => a - b);
        expect(along).toHaveLength(TRAMS_PER_DIRECTION);
        along.forEach((s, k) => expect(s).toBeCloseTo((.1 + .2 * k) * length + CELL / 10, 6));
      }
    });
  });

  it('keeps to the right-hand track, the avenue’s middle ± the track offset', () => {
    const lines = original.cityLayout!.tramLines;
    for (const time of [0, 333.3, 1800]) for (const t of tramsAt(original, time)) {
      const [a, b] = lines[t.line].points, alongX = a.y === b.y;
      const across = alongX ? t.y - a.y : t.x - a.x;
      expect(Math.abs(across)).toBeCloseTo(TRAM_TRACK, 9);
      // Right of the direction of travel: east on the south (+y) track, south on the west (-x) one.
      if (alongX) expect(Math.sign(across)).toBe(Math.sign(t.dx));
      else expect(Math.sign(across)).toBe(-Math.sign(t.dy));
    }
  });

  it('is a pure function of the clock that runs on across weeks', () => {
    const a = tramsAt(original, 1234.5);
    expect(tramsAt(original, 1234.5)).toEqual(a);
    expect(tramsAt(clone(original), 1234.5)).toEqual(a);
    const later = clone(original);
    later.week = (original.week ?? 1) + 1;
    expect(tramsAt(later, 100)).toEqual(tramsAt(original, MINUTES_PER_WEEK + 100));
  });

  it('moves at the cars’ pace and never closes the gap on the tram ahead', () => {
    const lines = original.cityLayout!.tramLines;
    for (let time = 0; time < 3 * MINUTES_PER_WEEK; time += 97) {
      const now = tramsAt(original, time), next = tramsAt(original, time + 10);
      now.forEach((t, k) => {
        const u = next[k];
        if (u.outbound === t.outbound) expect(Math.abs(u.along - t.along)).toBeCloseTo(10 * TRAM_SPEED, 6);
      });
      lines.forEach((line, li) => {
        const length = Math.hypot(line.points[1].x - line.points[0].x, line.points[1].y - line.points[0].y);
        for (const outbound of [true, false]) {
          const along = now.filter(t => t.line === li && t.outbound === outbound).map(t => t.along).sort((a, b) => a - b);
          // The original holds a tram off the map until the one ahead is W (H) cells away: a fifth of the line.
          along.slice(1).forEach((s, i) => expect(s - along[i]).toBeGreaterThanOrEqual(.2 * length - 1e-6));
        }
      });
    }
  });

  it('is shown only while its whole body is on the map', () => {
    for (let time = 0; time < MINUTES_PER_WEEK; time += 61) for (const t of tramsAt(original, time)) {
      if (!t.visible) continue;
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(original.gridW * CELL);
      expect(t.y).toBeLessThanOrEqual(original.gridH * CELL);
    }
  });
});

describe('compact city trams', () => {
  const compact = createWorld({ ...defaultGameOptions(), seed: 7 }).world;

  it('run on the saved routes and stand at their stops', () => {
    const lines = cityTramLines(compact);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(tramLineValid(compact, line)).toBe(true);
    expect(tramsAt(compact, 0)).toHaveLength(lines.length * 2 * TRAMS_PER_DIRECTION);
    let dwelling = 0;
    for (let time = 0; time < MINUTES_PER_WEEK; time += 5) {
      for (const t of tramsAt(compact, time)) {
        if (!t.dwelling) continue;
        dwelling++;
        const stops = lines[t.line].stops.map(s => s.pos);
        const near = Math.min(...stops.map(p => Math.hypot(p.x - t.x, p.y - t.y)));
        expect(near).toBeLessThanOrEqual(TRAM_TRACK + 3.01);
      }
    }
    expect(dwelling).toBeGreaterThan(0);
    // A dwell holds the tram where it stands.
    const t0 = tramsAt(compact, 0);
    for (let time = 0; time < MINUTES_PER_WEEK; time += 1) {
      const now = tramsAt(compact, time), soon = tramsAt(compact, time + TRAM_STOP_DWELL / 4);
      const k = now.findIndex((t, i) => t.dwelling && soon[i].dwelling);
      if (k < 0) continue;
      expect([soon[k].x, soon[k].y]).toEqual([now[k].x, now[k].y]);
      break;
    }
    expect(t0.length).toBeGreaterThan(0);
  });
});
