import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { Sim } from '../src/sim/sim';
import { planGang } from '../src/sim/ai';
import { setTrading, issueStreetOrder } from '../src/sim/api';
import { releaseGangHoldings } from '../src/sim/execution';
import { finishTradingRestarts } from '../src/sim/businessState';
import { officeEntryCheck } from '../src/sim/systems/politics';
import { tickStreetOrders } from '../src/sim/systems/street';
import { settleBurningEscapes } from '../src/sim/systems/buildingEmergency';
import { vehicleRoute } from '../src/sim/vehicleNavigation';
import { LANE_OFFSET } from '../src/sim/constants';
import { activeBlocks } from '../src/sim/cityLayout';
import { teamsOf } from '../src/sim/world';
import type { GameOptions } from '../src/sim/types';

const game = (over: Partial<GameOptions> = {}) => new Sim({ ...defaultGameOptions(), citySize: 10, seed: 404, ...over });
const kit = (cache: Record<string, number>) => Object.values(cache).reduce((s, n) => s + n, 0);

describe('rival AI housekeeping', () => {
  it('arms its men once, not again every week', () => {
    const sim = game(), w = sim.world, rival = Object.values(w.gangs).find(g => !g.isPlayer)!;
    rival.cash = 500_000;
    const owned = () => kit(rival.weapons) + teamsOf(w, rival).reduce((s, t) => s + kit(t.weapons), 0);
    planGang(w, sim.rng, rival);
    const first = owned();
    for (let week = 0; week < 3; week++) planGang(w, sim.rng, rival);
    expect(owned()).toBe(first);
  });

  it('hands a broken gang\'s premises and rackets back to the city', () => {
    const sim = game(), w = sim.world, rival = Object.values(w.gangs).find(g => !g.isPlayer)!;
    const held = Object.values(w.buildings).filter(b => b.ownerGangId === rival.id || b.protection?.gangId === rival.id);
    expect(held.length).toBeGreaterThan(0);
    releaseGangHoldings(w, rival.id);
    expect(held.every(b => b.ownerGangId !== rival.id && b.protection?.gangId !== rival.id && !b.isHQ)).toBe(true);
  });
});

describe('business state', () => {
  it('shutting a front shuts the business it hides', () => {
    const sim = game(), w = sim.world, g = sim.playerGang;
    const front = Object.values(w.buildings).find(b => b.ownerGangId === g.id && b.state === 'trading' && b.cls !== 'illegal' && !b.isHQ)!;
    const hidden = Object.values(w.buildings).find(b => b.id !== front.id && b.blockId === front.blockId && b.ownerGangId !== g.id)!;
    hidden.ownerGangId = g.id; hidden.cls = 'illegal'; hidden.state = 'trading'; front.hidesId = hidden.id;
    expect(setTrading(w, g.id, front.id, false).ok).toBe(true);
    expect(hidden.state).toBe('ceased');
  });

  it('keeps a restart asked for before a fire until the repairs are done', () => {
    const sim = game(), w = sim.world, g = sim.playerGang;
    const site = Object.values(w.buildings).find(b => b.ownerGangId === g.id && b.state === 'trading' && !b.isHQ)!;
    site.state = 'damaged'; site.ceasedWeek = w.week; site.resumeTradingWeek = w.week;
    finishTradingRestarts(w);
    expect(site.resumeTradingWeek).toBe(w.week);
  });
});

describe('elections and the street', () => {
  it('a short game has no mayoralty to stand for', () => {
    const sim = game({ mode: 'power' });
    expect(officeEntryCheck(sim.world, sim.playerGang.id).can).toBe(false);
  });

  it('nobody keeps after a man the police have taken', () => {
    const sim = game(), w = sim.world, g = sim.playerGang;
    const hood = Object.values(w.people).find(p => p.gangId === g.id && p.role === 'hood' && p.status === 'active')!;
    const target = Object.values(w.people).find(p => p.gangId != null && p.gangId !== g.id && p.status === 'active')!;
    w.phase = 'week';
    expect(issueStreetOrder(w, g.id, [hood.id], 'kill', target.id, null).ok).toBe(true);
    target.status = 'arrested';
    tickStreetOrders(w, sim.rng, 1);
    expect(hood.streetOrder).toBeNull();
    expect(target.status).toBe('arrested');
  });
});

describe('fires', () => {
  it('a survivor of a fire is free again, and an escape the week cut short is settled', () => {
    const sim = game(), w = sim.world;
    const [survivor, victim] = Object.values(w.people).filter(p => p.role === 'citizen' && p.status === 'active');
    const base = { week: w.week, buildingId: 1, startMinute: w.minute, door: { ...survivor.pos }, pavement: { ...survivor.pos },
      end: { ...survivor.pos }, gangId: null, perpetratorId: null };
    survivor.burningEscape = { ...base, fatal: false };
    victim.burningEscape = { ...base, fatal: true };
    settleBurningEscapes(w, sim.rng);
    expect(survivor.burningEscape).toBeUndefined();
    expect(survivor.status).toBe('active');
    expect(victim.status).toBe('dead');
  });
});

describe('save stream', () => {
  it('a save carries the random stream after planning-desk draws', () => {
    const sim = game();
    sim.rng.chance(.5); sim.rng.chance(.5);
    sim.settleDeferred();
    expect(sim.world.rngState).toBe(sim.rng.state);
  });
});

describe('vehicle routes', () => {
  it('turn at the corner, never running past the junction and backing up', () => {
    const w = game().world, blocks = activeBlocks(w);
    for (let i = 0; i + 7 < blocks.length; i += 7) {
      const { start, path } = vehicleRoute(w, blocks[i].center, blocks[i + 7].center, (i & 1) === 0);
      const pts = [start, ...path];
      for (let k = 2; k < pts.length; k++) {
        const ax = pts[k - 1].x - pts[k - 2].x, ay = pts[k - 1].y - pts[k - 2].y;
        const bx = pts[k].x - pts[k - 1].x, by = pts[k].y - pts[k - 1].y;
        // A U-turn (straight back the way it came) is allowed; a step back at an angle is not.
        const backward = ax * bx + ay * by < -1e-6, angled = Math.abs(ax * by - ay * bx) > 1e-6;
        // A U-turn rounds through the junction and leaves in the opposite lane
        // at the same point along the street: that is not backing up.
        const across = Math.hypot(pts[k].x - pts[k - 2].x, pts[k].y - pts[k - 2].y);
        const uTurn = Math.abs(across - 2 * LANE_OFFSET) < 1e-3 && (Math.abs(pts[k].x - pts[k - 2].x) < 1e-6 || Math.abs(pts[k].y - pts[k - 2].y) < 1e-6);
        expect(backward && angled && !uTurn, JSON.stringify(pts.slice(k - 2, k + 1))).toBe(false);
      }
    }
  });
});
