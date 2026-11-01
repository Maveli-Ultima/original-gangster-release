import { describe, expect, it } from 'vitest';
import {
  BLAST_DAMAGE, blastFear, blastRadius, fearOf, gangsPresentInBlock, hostilityOf, initialAttitude, ORIGINAL_ACTOR_CLASS,
  seedOriginalOwnerAttitudes, setAttitude, weeklyProtectionFear,
} from '../src/sim/attitudes';
import type { Building, CourtCase, Person, Protection, WorldState } from '../src/sim/types';
import { CENTRE_LOT } from '../src/sim/world';

const G = 1, OTHER = 2;

function person(id: number, role: Person['role'] = 'owner', extra: Partial<Person> = {}): Person {
  return { id, role, status: 'active', gangId: null, opinion: {}, ...extra } as Person;
}

/** A one-row street of blocks (gx 0..9), one premises per block, for the original-city attitude rules. */
function street(occupants: { gx: number; person: Person; protection?: Partial<Protection>; lotIndex?: number }[], week = 10) {
  const blocks: Record<number, unknown> = {}, buildings: Record<number, Building> = {}, lots: Record<number, unknown> = {};
  const people: Record<number, Person> = {};
  for (let gx = 0; gx < 10; gx++) blocks[gx] = { id: gx, gx, gy: 0 };
  occupants.forEach(({ gx, person: p, protection, lotIndex }, i) => {
    const id = 100 + i;
    people[p.id] = p;
    lots[id] = { id, blockId: gx, index: lotIndex ?? 0, buildingId: id };
    buildings[id] = {
      id, blockId: gx, lotId: id, cls: 'legal', ownerGangId: null, ownerPersonId: p.id, state: 'trading',
      protection: protection ? { gangId: G, weekly: 100, base: 100, refusing: false, grievance: 0, ...protection } : null,
    } as unknown as Building;
  });
  const w = { nextId: 1000, week, people, blocks, buildings, lots, gangs: { [G]: { id: G }, [OTHER]: { id: OTHER } } } as unknown as WorldState;
  return { w, b: (i: number) => buildings[100 + i] };
}

describe('HQ-distance owner seeding beyond ten blocks (0x6566A0 → vt+0x6C, 0x5A2B10)', () => {
  it('adds twice the block count to the creation hostility, leaves fear, and draws nothing', () => {
    const near = person(1), edge = person(2), far = person(3);
    let draws = 0;
    const next = () => { draws++; return 7; };
    seedOriginalOwnerAttitudes([{ gangId: G, fx: 0, fy: 0 }],
      [{ owner: near, fx: 54, fy: 0 }, { owner: edge, fx: 55, fy: 0 }, { owner: far, fx: 150, fy: 0 }], next);
    // 54 cells = 10.8 blocks: the last band (120, 50), one LCG draw.
    expect(draws).toBe(1);
    expect(hostilityOf(near, G)).toBe(7 % 120);
    expect(fearOf(near, G)).toBe(50 + 7 % 120);
    // 55 cells = 11 blocks: +22 hostility on the creation roll, fear untouched.
    expect(hostilityOf(edge, G)).toBe(Math.min(255, initialAttitude(edge, G, 'hostility') + 22));
    expect(fearOf(edge, G)).toBe(initialAttitude(edge, G, 'fear'));
    // 150 cells = 30 blocks: +60, saturating at 255.
    expect(hostilityOf(far, G)).toBe(Math.min(255, initialAttitude(far, G, 'hostility') + 60));
    expect(fearOf(far, G)).toBe(initialAttitude(far, G, 'fear'));
  });
});

describe('weekly protection fear and cell flags 1 / 8 (0x527640, 0x4CD730)', () => {
  const setup = (protection: Partial<Protection>, extra: Partial<Person> = {}) => {
    const p = person(1, 'owner', extra);
    const { w } = street([{ gx: 0, person: p, protection }], 10);
    setAttitude(p, G, { fear: 100 });
    weeklyProtectionFear(w);
    return fearOf(p, G);
  };

  it('fades 5 where the racket went uncollected last week, whatever the trading or refusing state', () => {
    expect(setup({})).toBe(95);
    expect(setup({ refusing: true })).toBe(95);
    expect(setup({ collectedWeek: 8 })).toBe(95);
    expect(setup({ refusedWeek: 7 })).toBe(95);
  });

  it('holds where the owner paid (flag 1) or refused (flag 8) at a collection call last week', () => {
    expect(setup({ collectedWeek: 9 })).toBe(100);
    expect(setup({ refusedWeek: 9 })).toBe(100);
  });

  it('skips gangster occupiers (0x712D30) and dead or jailed ones', () => {
    expect(setup({}, { gangId: OTHER })).toBe(100);
    expect(setup({}, { status: 'dead' })).toBe(100);
    expect(setup({}, { status: 'jailed' })).toBe(100);
  });

  it('touches nothing without a protecting gang', () => {
    const p = person(1);
    const { w } = street([{ gx: 0, person: p }]);
    setAttitude(p, G, { fear: 100 });
    weeklyProtectionFear(w);
    expect(fearOf(p, G)).toBe(100);
  });
});

describe('blast fear (0x4DE430) and its two-block variant (order flag bit 2)', () => {
  it('uses the original damage of each order handler', () => {
    expect(BLAST_DAMAGE).toEqual({ bomb: 400, bombFailed: 50, torch: 200, torchFailed: 50, smashUp: 100, assault: 100, kill: 200 });
  });

  function blast(targetLotIndex: number, damage = 100) {
    const target = person(1), racket = person(2), three = person(3), five = person(4), six = person(5), hood = person(6, 'hood');
    const { w, b } = street([
      { gx: 0, person: target, lotIndex: targetLotIndex },
      { gx: 1, person: hood },
      { gx: 2, person: racket, protection: {} },
      { gx: 3, person: three },
      { gx: 5, person: five },
      { gx: 6, person: six },
    ]);
    for (const p of [target, racket, three, five, six, hood]) setAttitude(p, G, { fear: 0 });
    blastFear(w, G, b(0), damage);
    return { w, b, fear: (p: Person) => fearOf(p, G), target, racket, three, five, six, hood };
  }

  it('reaches five blocks from an edge-lot target', () => {
    const r = blast(0);
    expect(blastRadius(r.w, r.b(0))).toBe(5);
    expect(r.fear(r.target)).toBe(48 + 8);      // direct, then its own premises in the area
    expect(r.fear(r.racket)).toBe(48);          // protected by the attacker
    expect(r.fear(r.three)).toBe(8);
    expect(r.fear(r.five)).toBe(8);
    expect(r.fear(r.six)).toBe(0);
    expect(r.fear(r.hood)).toBe(0);             // only shopkeepers (type 15) in the area
  });

  it('reaches only two blocks when the target is the block centre (0x4C8BB0 sets bit 2)', () => {
    const r = blast(CENTRE_LOT);
    expect(blastRadius(r.w, r.b(0))).toBe(2);
    expect(r.fear(r.target)).toBe(48 + 8);
    expect(r.fear(r.racket)).toBe(48);
    expect(r.fear(r.three)).toBe(0);
    expect(r.fear(r.five)).toBe(0);
  });

  it('scales a bomb: 400 damage gives 192 to the racket, 32 elsewhere, saturating', () => {
    const r = blast(0, BLAST_DAMAGE.bomb);
    expect(r.fear(r.racket)).toBe(192);
    expect(r.fear(r.three)).toBe(32);
    expect(r.fear(r.target)).toBe(192 + 32);
  });

  it('makes the mayor and police chief, and the shopkeepers around, more hostile to the gangs present', () => {
    // 0x4DE430: for each gang present in the target's block (byte +0x6A + g;
    // here: the block is in its territory) the mayor (city+0x2A4) and the
    // police chief (city+0x29C) gain 4·d/100 hostility; each shopkeeper in the
    // area gains 8·d/100 toward every gang present in his own block (0x5A2AE0).
    const target = person(1), racket = person(2), bystander = person(3);
    const mayor = person(50, 'mayor'), chief = person(51, 'policeChief');
    const { w, b } = street([
      { gx: 2, person: target, lotIndex: 1 },
      { gx: 2, person: racket, protection: {} },
      { gx: 3, person: bystander },
    ]);
    Object.assign(w.people, { [mayor.id]: mayor, [chief.id]: chief });
    Object.assign(w, { mayorId: mayor.id, policeChiefId: chief.id });
    for (const p of [target, racket, bystander, mayor, chief]) for (const g of [G, OTHER]) setAttitude(p, g, { hostility: 100, fear: 0 });
    blastFear(w, OTHER, b(0), 100);
    expect(hostilityOf(mayor, G)).toBe(104);
    expect(hostilityOf(chief, G)).toBe(104);
    expect(hostilityOf(mayor, OTHER)).toBe(100);         // the attacker holds nothing there
    expect(hostilityOf(target, G)).toBe(108);
    expect(hostilityOf(racket, G)).toBe(108);
    expect(hostilityOf(bystander, G)).toBe(100);         // no gang present in his block
    expect(fearOf(racket, OTHER)).toBe(8);               // fear still goes to the attacker
  });

  it('scales a civilian occupant’s fear by (100 + damage/10)% instead', () => {
    const citizen = person(1, 'citizen');
    const { w, b } = street([{ gx: 0, person: citizen }]);
    setAttitude(citizen, G, { fear: 100 });
    blastFear(w, G, b(0), 200);
    expect(fearOf(citizen, G)).toBe(120);
  });
});

describe('block presence: the +0x6A count (writers 0x526570, 0x52572F)', () => {
  it('counts a gang that protects or owns a standing business in that very block', () => {
    const a = person(1), b = person(2), c = person(3), d = person(4);
    const { w, b: bld } = street([
      { gx: 0, person: a, protection: {} },
      { gx: 1, person: b },
      { gx: 2, person: c },
      { gx: 3, person: d, protection: { gangId: OTHER } },
    ]);
    bld(1).ownerGangId = OTHER;
    bld(2).ownerGangId = G;
    bld(2).state = 'destroyed';
    expect(gangsPresentInBlock(w, 0)).toEqual([G]);
    expect(gangsPresentInBlock(w, 1)).toEqual([OTHER]);
    expect(gangsPresentInBlock(w, 2)).toEqual([]);      // rubble holds no claim
    expect(gangsPresentInBlock(w, 4)).toEqual([]);
    (w.gangs[OTHER] as { eliminated?: boolean }).eliminated = true;
    expect(gangsPresentInBlock(w, 3)).toEqual([]);
  });
});

describe('0x4DE430: the victim’s own scaling and who else reacts, by class', () => {
  /** A street with the city's officials, police, agents, judges, attorneys and press on hand. */
  function city(victim: Person, extra: Person[] = []) {
    const nearby = person(2);
    const { w, b } = street([{ gx: 0, person: victim }, { gx: 1, person: nearby, protection: { gangId: OTHER } }]);
    const cast = {
      mayor: person(50, 'mayor'), chief: person(51, 'policeChief'), head: person(52, 'fbiHead'),
      cop: person(53, 'police'), agent: person(54, 'fbi'), judge: person(55, 'judge'), judge2: person(56, 'judge'),
      da: person(57, 'da'), da2: person(58, 'da'), reporter: person(59, 'reporter'), priest: person(60, 'clergy'),
      priest2: person(61, 'clergy'),
    };
    for (const p of [...Object.values(cast), ...extra]) w.people[p.id] = p;
    Object.assign(w, {
      mayorId: 50, policeChiefId: 51, fbiHeadId: 52, judgeIds: [55, 56], daIds: [57, 58],
      cases: {} as Record<number, CourtCase>,
    });
    for (const p of [victim, nearby, ...Object.values(cast), ...extra]) {
      for (const g of [G, OTHER]) setAttitude(p, g, { hostility: 100, fear: 100 });
    }
    return { w, b, nearby, ...cast };
  }
  const h = (p: Person) => hostilityOf(p, G);

  it('maps the remake roles onto the original classes', () => {
    expect(ORIGINAL_ACTOR_CLASS).toMatchObject({
      owner: 0x0F, citizen: 0x10, police: 0x11, fbi: 0x13, judge: 0x15, da: 0x16, reporter: 0x18, clergy: 0x23,
      accountant: 0x1A, lawyer: 0x1B, hood: 0x1C, boss: 0x1E, lieutenant: 0x1F, mayor: 0x20, policeChief: 0x21, fbiHead: 0x22,
    });
  });

  it('an FBI agent: hostility × (100 + d/5)%, stored as a byte (vt+0x68 = 0x5A2C50 wraps)', () => {
    const agent = person(1, 'fbi');
    const r = city(agent);
    setAttitude(agent, G, { hostility: 200 });
    blastFear(r.w, G, { blockId: 0, ownerPersonId: agent.id }, 200);
    // 200 × 140 / 100 = 280 → 280 & 255 = 24; then every agent (him too) +16.
    expect(h(agent)).toBe(24 + 16);
    expect(h(r.mayor)).toBe(116);
    expect(h(r.head)).toBe(132);
    expect(h(r.agent)).toBe(116);
    expect(h(r.chief)).toBe(100);
    expect(fearOf(r.nearby, G)).toBe(100);              // no area pass
  });

  it('a policeman: fear scaled; mayor +8, chief +16, every policeman +8, no area pass', () => {
    const cop = person(1, 'police');
    const r = city(cop);
    blastFear(r.w, G, { blockId: 0, ownerPersonId: cop.id }, 100);
    expect(fearOf(cop, G)).toBe(110);
    expect(h(cop)).toBe(108);
    expect(h(r.cop)).toBe(108);
    expect(h(r.mayor)).toBe(108);
    expect(h(r.chief)).toBe(116);
    expect(h(r.head)).toBe(100);
    expect(fearOf(r.nearby, G)).toBe(100);
    expect(hostilityOf(r.mayor, OTHER)).toBe(100);      // presence plays no part
  });

  it('a judge: the other judges +32, attorneys and the three officials +16', () => {
    const r = city(person(1));
    blastFear(r.w, G, { blockId: 0, ownerPersonId: r.judge.id }, 100);
    expect(fearOf(r.judge, G)).toBe(110);
    expect(h(r.judge)).toBe(100);
    expect(h(r.judge2)).toBe(132);
    expect(h(r.da)).toBe(116);
    for (const p of [r.mayor, r.chief, r.head]) expect(h(p)).toBe(116);
  });

  it('an attorney: the judges +16, the other attorneys +32', () => {
    const r = city(person(1));
    blastFear(r.w, G, { blockId: 0, ownerPersonId: r.da.id }, 100);
    expect([h(r.da), h(r.da2), h(r.judge), h(r.mayor), h(r.chief), h(r.head)]).toEqual([100, 132, 116, 116, 116, 116]);
  });

  it('a reporter: mayor and chief +64, FBI head +32, the bench +32, the other reporters +64, the clergy +16', () => {
    const colleague = person(70, 'reporter');
    const r = city(person(1), [colleague]);
    blastFear(r.w, G, { blockId: 0, ownerPersonId: r.reporter.id }, 100);
    expect(fearOf(r.reporter, G)).toBe(110);
    expect([h(r.mayor), h(r.chief), h(r.head), h(r.judge), h(r.da2)]).toEqual([164, 164, 132, 132, 132]);
    expect(h(r.reporter)).toBe(100);
    expect(h(colleague)).toBe(164);
    expect([h(r.priest), h(r.priest2)]).toEqual([116, 116]);
    expect(h(r.cop)).toBe(100);
  });

  it('a priest: every other clergyman +64', () => {
    const r = city(person(1));
    blastFear(r.w, G, { blockId: 0, ownerPersonId: r.priest.id }, 100);
    expect(fearOf(r.priest, G)).toBe(110);
    expect(h(r.priest)).toBe(100);
    expect(h(r.priest2)).toBe(164);
    expect(h(r.mayor)).toBe(100);
  });

  it('the mayor, the police chief and the FBI head', () => {
    let r = city(person(1));
    blastFear(r.w, G, { blockId: 0, ownerPersonId: r.mayor.id }, 100);
    expect([h(r.mayor), h(r.chief), h(r.cop), h(r.head), h(r.agent), h(r.judge), h(r.da)])
      .toEqual([100, 164, 108, 164, 108, 132, 132]);
    r = city(person(1));
    blastFear(r.w, G, { blockId: 0, ownerPersonId: r.chief.id }, 100);
    expect([h(r.mayor), h(r.chief), h(r.cop), h(r.head), h(r.agent), h(r.judge)]).toEqual([164, 100, 108, 164, 100, 116]);
    r = city(person(1));
    blastFear(r.w, G, { blockId: 0, ownerPersonId: r.head.id }, 100);
    // Hostility × 120% first, then the original's own +64 to city+0x2A0.
    expect([h(r.mayor), h(r.chief), h(r.head), h(r.agent), h(r.da)]).toEqual([164, 100, 120 + 64, 108, 116]);
  });

  it('gang men: hostility × (100 + d/10)%; an accountant or lawyer in no gang has his fear scaled', () => {
    const hood = person(1, 'hood', { gangId: OTHER });
    let r = city(hood);
    blastFear(r.w, G, { blockId: 0, ownerPersonId: hood.id }, 200);
    expect(h(hood)).toBe(120);
    expect(fearOf(hood, G)).toBe(100);
    expect(fearOf(r.nearby, G)).toBe(100 + 16);         // the area pass runs for gang men
    const free = person(1, 'accountant');
    r = city(free);
    blastFear(r.w, G, { blockId: 0, ownerPersonId: free.id }, 200);
    expect(fearOf(free, G)).toBe(120);
    expect(h(free)).toBe(100);
    const kept = person(1, 'lawyer', { gangId: OTHER });
    r = city(kept);
    blastFear(r.w, G, { blockId: 0, ownerPersonId: kept.id }, 200);
    expect(h(kept)).toBe(120);
    expect(fearOf(kept, G)).toBe(100);
  });

  it('a civilian witness is struck off the case (a fifth off its value) and gains 32·d/100 fear', () => {
    const witness = person(1, 'citizen');
    const r = city(witness);
    const c = { id: 9, witnessIds: [7, witness.id], strength: 52 } as unknown as CourtCase;
    (r.w.cases as Record<number, CourtCase>)[9] = c;
    blastFear(r.w, G, { blockId: 0, ownerPersonId: witness.id }, 100);
    expect(c.witnessIds).toEqual([7]);
    expect(c.strength).toBe(52 - 10);
    expect(fearOf(witness, G)).toBe(132);
  });

  it('premises with no occupier: nothing at all', () => {
    const owner = person(1);
    const r = city(owner);
    setAttitude(r.nearby, G, { fear: 0 });
    blastFear(r.w, G, { blockId: 0, ownerPersonId: null, managerId: null }, 400);
    expect(fearOf(r.nearby, G)).toBe(0);
    expect(fearOf(owner, G)).toBe(100);
    expect(h(r.mayor)).toBe(100);
  });

  it('a gang-run premises: the manager is the occupier', () => {
    const manager = person(1, 'hood', { gangId: OTHER });
    const r = city(manager);
    blastFear(r.w, G, { blockId: 0, ownerPersonId: null, managerId: manager.id }, 100);
    expect(h(manager)).toBe(110);
    expect(fearOf(r.nearby, G)).toBe(108);
  });
});
