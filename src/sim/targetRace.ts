import type { ID, WorldState } from './types';
import { gangWealth, territoryCount } from './world';

/** A seed-based lot breaks genuinely simultaneous/legacy ties without favouring
 * the player or object insertion order, and without consuming gameplay RNG. */
export function tieRank(seed: number, id: ID): number {
  let n = (seed ^ Math.imul(id, 0x9e3779b1)) >>> 0;
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  return (n ^ (n >>> 16)) >>> 0;
}

/** Call only after a complete economic or ownership event, never between the
 * cash and inventory halves of a transaction. The first recorded result wins. */
export function observeTargetRace(w: WorldState, gangIds?: ID[], basis: NonNullable<WorldState['targetRace']>['basis'] = 'event'): void {
  const mode = w.options.mode;
  if (w.phase === 'gameOver' || w.targetRace || (mode !== 'wealth' && mode !== 'territory')) return;
  const target = mode === 'wealth' ? w.options.wealthTarget : w.options.territoryTarget;
  const contenders = [...new Set(gangIds ?? Object.values(w.gangs).map(g => g.id))]
    .map(id => w.gangs[id]).filter(g => {
      const boss = g && w.people[g.bossId];
      return g && !g.eliminated && boss && boss.status !== 'dead' && !(boss.status === 'jailed' && boss.jailWeeks >= 999);
    }).map(g => ({ id: g.id, value: mode === 'wealth' ? gangWealth(w, g) : territoryCount(w, g.id) }))
    .filter(g => g.value >= target)
    .sort((a, b) => tieRank(w.options.seed, a.id) - tieRank(w.options.seed, b.id) || a.id - b.id);
  if (!contenders.length) return;
  const winner = contenders[0];
  w.targetRace = { mode, gangId: winner.id, value: winner.value, target, week: w.week, minute: w.minute,
    basis, tiedGangIds: contenders.map(g => g.id).sort((a, b) => a - b) };
}
