import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { hireRecruit, issueOrder, moveToTeam, promote, setPay } from '../src/sim/api';
import { MAX_TEAM_SIZE } from '../src/sim/constants';
import { isValidAreaTarget } from '../src/sim/execution';
import { Sim } from '../src/sim/sim';
import type { Block, Building, ID } from '../src/sim/types';
import {
  allBuildings,
  buildingsOfBlock,
  gangWealth,
  gangManpower,
  ownedBuildings,
  protectedBuildings,
  territoryCount,
} from '../src/sim/world';

/**
 * A scripted player who follows the advice the game itself gives: take a block
 * at a time, always collect what you are owed, keep hiring, and put an illegal
 * business behind a front as soon as you can afford one. If this player cannot
 * build an empire, the game is not playable.
 */
function playCompetently(sim: Sim, weeks: number): void {
  const w = sim.world;
  const gang = sim.playerGang;

  for (let i = 0; i < weeks && w.phase !== 'gameOver'; i++) {
    const teams = gang.teamIds.map((id) => w.teams[id]).filter(Boolean);
    if (!teams.length) {
      // Rebuild if we lost our lieutenant.
      const spare = gang.poolIds[0];
      if (spare != null) promote(w, gang.id, spare);
    }

    // Pay everybody what they ask, while the money lasts.
    for (const p of Object.values(w.people)) {
      if (p.gangId !== gang.id || p.role === 'boss') continue;
      if (p.pay < p.payDemand && gang.cash > p.payDemand * 6) setPay(w, p.id, p.payDemand);
    }

    // Take on anybody willing.
    for (const id of [...gang.recruitIds]) {
      if (gang.cash < 3000) break;
      const room = gang.teamIds.map((t) => w.teams[t]).find((t) => t && t.memberIds.length < 9);
      hireRecruit(w, gang.id, id, room ? 'team' : 'pool', room?.id);
    }

    // This strategy prefers crews with an active lieutenant. The game also
    // allows available members to work while their lieutenant is unavailable.
    const available = () =>
      gang.teamIds.map((id) => w.teams[id]).filter((t) => t && w.people[t.lieutenantId]?.status === 'active');
    let crews = available();
    if (!crews.length && gang.poolIds[0] != null) {
      promote(w, gang.id, gang.poolIds[0]);
      crews = available();
    }
    if (!crews.length) {
      sim.launchWeek();
      sim.finishWeek();
      continue;
    }

    // New games leave extra starting hoods in the pool. Assign those paid
    // reserves through the same control a player uses before requesting work.
    for (const id of [...gang.poolIds]) {
      const hood = w.people[id];
      if (hood?.role !== 'hood' || hood.status !== 'active') continue;
      const room = [...crews].sort((a, b) => a.memberIds.length - b.memberIds.length)
        .find(t => t.memberIds.length < MAX_TEAM_SIZE - 1);
      if (room) expect(moveToTeam(w, gang.id, id, room.id).ok).toBe(true);
    }

    // 1. Collect from everyone who pays.
    const racket = protectedBuildings(w, gang.id).filter((b) => b.state === 'trading');
    if (racket.length) {
      issueOrder(w, gang.id, {
        teamId: crews[0].id,
        type: 'collectProtection',
        buildingIds: racket.map((b) => b.id),
        opts: { manpower: Math.min(3, crews[0].memberIds.length || 1) },
      });
    }

    // 2. Take the next block, whole.
    const hq = allBuildings(w).find((b) => b.ownerGangId === gang.id && b.isHQ);
    const home = hq ? w.blocks[hq.blockId] : w.blocks[0];
    const targetBlock = w.blocks
      .filter((blk: Block) =>
        buildingsOfBlock(w, blk).some(
          (b: Building) => b.state === 'trading' && isValidAreaTarget(w, gang.id, 'extort', b),
        ),
      )
      .sort(
        (a, b) =>
          Math.abs(a.gx - home.gx) + Math.abs(a.gy - home.gy) - (Math.abs(b.gx - home.gx) + Math.abs(b.gy - home.gy)),
      )[0];

    const crewForExtort = crews[1] ?? crews[0];
    if (targetBlock) {
      issueOrder(w, gang.id, {
        teamId: crewForExtort.id,
        type: 'extort',
        blockIds: [targetBlock.id],
        opts: { manpower: Math.max(1, Math.min(4, crewForExtort.memberIds.length)) },
      });
    }

    // 3. Keep hiring.
    const recruitSite = allBuildings(w).find(
      (b) => b.state === 'trading' && ['gym', 'poolHall', 'docks', 'labourExchange'].includes(b.typeId),
    );
    if (recruitSite && gangManpower(w, gang) < 16) {
      issueOrder(w, gang.id, {
        teamId: crews[crews.length - 1].id,
        type: 'recruit',
        buildingIds: [recruitSite.id],
        opts: { manpower: 1 },
      });
    }

    // 4. Once there is money, put a speakeasy behind a cafe.
    if (gang.cash > 30_000) {
      const owned = ownedBuildings(w, gang.id);
      const land = owned.find((b) => b.cls === 'empty' && w.lots[b.lotId].index === 4);
      if (land) {
        const front = buildingsOfBlock(w, w.blocks[land.blockId]).find(
          (b) => b.ownerGangId === gang.id && b.cls !== 'illegal' && b.cls !== 'empty' && b.hidesId == null,
        );
        if (front) {
          issueOrder(w, gang.id, {
            teamId: crews[0].id,
            type: 'setUpBusiness',
            buildingIds: [land.id],
            opts: { manpower: 1, businessTypeId: 'speakeasy', frontBuildingId: front.id },
          });
        }
      } else {
        // Buy a front, then the centre lot behind it.
        const blockWithMine = w.blocks.find((blk) =>
          buildingsOfBlock(w, blk).some((b) => b.ownerGangId === gang.id && b.cls !== 'illegal'),
        );
        const buyTarget = blockWithMine
          ? buildingsOfBlock(w, blockWithMine).find(
              (b) => b.cls === 'empty' && w.lots[b.lotId].index === 4 && b.ownerGangId == null,
            )
          : undefined;
        const fallback = allBuildings(w).find(
          (b) => b.typeId === 'cafe' && b.ownerGangId == null && b.state === 'trading',
        );
        const buy = buyTarget ?? fallback;
        if (buy) {
          issueOrder(w, gang.id, {
            teamId: crews[0].id,
            type: 'buyPremises',
            buildingIds: [buy.id],
            opts: { manpower: 1 },
          });
        }
      }
    }

    // 5. A second crew, once there are bodies for it.
    if (gang.poolIds.length >= 2 && gang.teamIds.length < 3) {
      promote(w, gang.id, gang.poolIds[0] as ID);
    }

    sim.launchWeek();
    sim.finishWeek();
    if ((i + 1) % 5 === 0) console.info(`Campaign seed ${w.options.seed}, week ${w.week}: cash ${Math.round(gang.cash)}, racket ${protectedBuildings(w, gang.id).length}, active rivals ${Object.values(w.gangs).filter(g => !g.isPlayer && !g.eliminated).length}`);
  }
}

describe('a competently played game', () => {
  it('lets a working boss build a real empire', () => {
    let sim = new Sim({ ...defaultGameOptions(), seed: 11, citySize: 12 });
    const startWealth = gangWealth(sim.world, sim.playerGang);

    playCompetently(sim, 15);
    sim = Sim.fromSave(structuredClone(sim.world));
    playCompetently(sim, 15);
    const gang = sim.playerGang;

    // The boss should be alive and considerably better off.
    expect(sim.world.phase).not.toBe('gameOver');
    expect(sim.world.people[gang.bossId].status).not.toBe('dead');
    expect(protectedBuildings(sim.world, gang.id).length).toBeGreaterThan(10);
    expect(territoryCount(sim.world, gang.id)).toBeGreaterThan(2);
    expect(gangWealth(sim.world, gang)).toBeGreaterThan(startWealth);

    // Still a going concern: a crew to give orders to, and takings that more
    // than cover the wage bill.
    expect(gang.teamIds.length).toBeGreaterThanOrEqual(1);
    expect(gangManpower(sim.world, gang)).toBeGreaterThanOrEqual(3);
    const income =
      gang.lastWeekIncome.legal +
      gang.lastWeekIncome.illegal +
      gang.lastWeekIncome.protection +
      gang.lastWeekIncome.other;
    expect(income).toBeGreaterThan(gang.lastWeekCosts.wages);
  }, 1200000);

  it('comes out ahead in most cities, whatever the dice do', () => {
    // One city can go badly — a lieutenant jailed in week three, a raid on the
    // first casino — so competence is judged across several rather than on a
    // single lucky seed.
    const seeds = [33, 44, 55, 66];
    let ahead = 0;
    for (const seed of seeds) {
      const sim = new Sim({ ...defaultGameOptions(), seed, citySize: 12 });
      const gang = sim.playerGang;
      const startWealth = gangWealth(sim.world, gang);
      playCompetently(sim, 30);
      const ok =
        sim.world.phase !== 'gameOver' &&
        protectedBuildings(sim.world, gang.id).length > 10 &&
        gangWealth(sim.world, gang) > startWealth;
      if (ok) ahead++;
    }
    expect(ahead).toBeGreaterThanOrEqual(3);
  }, 3600000);

  it('leaves the rivals competitive rather than collapsing', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 5150, citySize: 12 });
    playCompetently(sim, 25);

    const rivals = Object.values(sim.world.gangs).filter((g) => !g.isPlayer);
    const alive = rivals.filter((g) => !g.eliminated);
    // The city should still have opposition in it.
    expect(alive.length).toBeGreaterThanOrEqual(2);
    // And at least one of them should be running a real racket of its own.
    const biggest = Math.max(...rivals.map((g) => protectedBuildings(sim.world, g.id).length));
    expect(biggest).toBeGreaterThan(8);
  }, 600000);

  it('punishes a boss who does nothing at all', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 8080, citySize: 12 });
    const gang = sim.playerGang;
    for (let i = 0; i < 25 && sim.world.phase !== 'gameOver'; i++) {
      sim.launchWeek();
      sim.finishWeek();
    }
    // Idleness costs money: an empire that gives no orders does not grow.
    const racket = protectedBuildings(sim.world, gang.id).length;
    expect(racket).toBeLessThan(10);
  }, 600000);
});
