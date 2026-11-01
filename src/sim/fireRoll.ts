/**
 * The original gunfire roll, FireRoll 0x516860 (police) ≡ 0x6F7490 (hoods),
 * with Hit Table.xtx and Damage Table.xtx as decoded in the reference
 * (p4/police_combat_spec.md §1.2–§3.2):
 *
 *   range  = distance in cells (96 fine units; five to a block)
 *   atk    = (attacker firearms byte >> 3) + 1
 *   def    = gang members and owners: (stealth byte >> 3) + 1;
 *            constables and FBI: their dodge byte, the same shape;
 *            anyone else: rand % 4 + 1
 *   chance = atk · (rand % 40 + 80) · Hit[row][range] / (100 · def)
 *   hit when rand % 100 + 1 < chance; then wound = Damage[row][8·range + rand & 7]
 *   wound 3 (badly wounded) or 4 (dead) kills; 0..2 only staggers.
 *
 * Weapon rows (0x5A80A0): pistol and twin pistols → Pistol, Tommy → Tommy,
 * rifle → Rifle, shotgun → Shotgun. Twin pistols' own rows are dead data.
 * Our skills (0.5..5 stars) map onto the original 0..63 skill bytes (the
 * predefined hoods' maximum). The remake RNG replaces the shared MSVC stream.
 */
import { CELL } from './constants';
import type { Rng } from './rng';
import type { Person } from './types';
import type { Firearm } from './weapons';

const HIT: Record<string, readonly number[]> = {
  pistol: [50, 21, 14, 11, 7, 0, 0, 0],
  tommy: [12, 10, 9, 8, 6, 5, 4, 0],
  rifle: [34, 50, 50, 50, 24, 20, 17, 0],
  shotgun: [52, 100, 52, 24, 20, 0, 0, 0],
  // Row 8. Its last token sits in the file's plaintext trailer; the retail
  // reader fails that read and keeps 0 (deep/14 §6).
  twinPistols: [60, 45, 30, 26, 22, 20, 15, 0],
};
const DAMAGE: Record<string, readonly number[]> = {
  pistol: [1, 1, 2, 2, 3, 3, 4, 4, 1, 1, 2, 2, 3, 3, 4, 4, 1, 1, 2, 2, 3, 3, 3, 4, 1, 1, 1, 2, 2, 3, 3, 4, 1, 1, 1, 1, 2, 2, 3, 4],
  tommy: [2, 3, 3, 3, 3, 3, 4, 4, 1, 2, 2, 3, 3, 4, 4, 4, 1, 2, 2, 3, 3, 3, 4, 4, 1, 1, 2, 2, 3, 3, 4, 4, 1, 1, 2, 2, 3, 3, 3, 4,
    1, 1, 1, 2, 2, 3, 3, 4, 1, 1, 1, 2, 2, 2, 3, 4],
  rifle: [1, 2, 2, 3, 3, 3, 4, 4, 1, 2, 2, 3, 3, 3, 4, 4, 1, 2, 2, 3, 3, 3, 4, 4, 1, 1, 2, 2, 3, 3, 4, 4, 1, 1, 2, 2, 3, 3, 3, 4,
    1, 1, 2, 2, 3, 3, 3, 4, 1, 1, 2, 2, 2, 3, 3, 4],
  shotgun: [2, 3, 3, 3, 4, 4, 4, 4, 2, 2, 3, 3, 3, 4, 4, 4, 1, 2, 2, 3, 3, 3, 4, 4, 1, 1, 1, 2, 2, 3, 3, 4, 1, 1, 1, 2, 2, 3, 3, 4],
};
/** Hit rows by weapon. Twin pistols have their own Hit row, but the Damage
 * table declares eight weapons and never reads its ninth (twin-pistol) block,
 * so their damage uses the pistol row — zero past band 4. */
const HIT_ROW: Record<Firearm, string> = { pistol: 'pistol', twinPistols: 'twinPistols', tommy: 'tommy', rifle: 'rifle', shotgun: 'shotgun' };
const DAMAGE_ROW: Record<Firearm, string> = { pistol: 'pistol', twinPistols: 'pistol', tommy: 'tommy', rifle: 'rifle', shotgun: 'shotgun' };

/** One original cell: a fifth of a block's street-to-street pitch. */
export const ORIGINAL_CELL_METRES = CELL / 5;

export const skillByte = (stars: number) => Math.round(Math.max(0, Math.min(5, stars)) / 5 * 63);
const tier = (stars: number) => (skillByte(stars) >> 3) + 1;
const DODGERS = new Set<Person['role']>(['boss', 'lieutenant', 'hood', 'owner', 'police', 'fbi', 'policeChief', 'fbiHead']);

/**
 * The roll's exact odds: the probability of a hit, averaged over the 40 morale
 * draws (and a civilian's 1..4 defence), and the share of the damage octet at
 * this range that is lethal. Drawing `hit` then `kills | hit` from these gives
 * the original's distribution with one RNG call per stage.
 */
export function originalFireOdds(attacker: Person, defender: Person, weapon: Firearm, metres: number):
  { hit: number; killGivenHit: number } {
  const range = Math.floor(metres / ORIGINAL_CELL_METRES);
  const base = HIT[HIT_ROW[weapon]][range] ?? 0;
  if (!base) return { hit: 0, killGivenHit: 0 };
  const atk = tier(attacker.skills.firearms);
  const defs = DODGERS.has(defender.role) ? [tier(defender.skills.stealth)] : [1, 2, 3, 4];
  let hit = 0;
  for (const def of defs) for (let m = 0; m < 40; m++) {
    const chance = Math.trunc(atk * (m + 80) * base / (100 * def));
    hit += Math.max(0, Math.min(100, chance - 1)) / 100;   // rand % 100 + 1 < chance
  }
  const octet = DAMAGE[DAMAGE_ROW[weapon]].slice(8 * range, 8 * range + 8);
  return { hit: hit / (40 * defs.length), killGivenHit: octet.filter(v => v >= 3).length / 8 };
}

export function originalFireRoll(rng: Rng, attacker: Person, defender: Person, weapon: Firearm, metres: number):
  { hit: boolean; kills: boolean } {
  const odds = originalFireOdds(attacker, defender, weapon, metres);
  const hit = rng.chance(odds.hit);
  return { hit, kills: hit && rng.chance(odds.killGivenHit) };
}

/** Farthest distance at which the weapon's hit table is non-zero. */
export function originalFireReach(weapon: Firearm): number {
  const row = HIT[HIT_ROW[weapon]];
  let last = 0;
  row.forEach((v, i) => { if (v > 0) last = i; });
  return (last + 1) * ORIGINAL_CELL_METRES;
}
