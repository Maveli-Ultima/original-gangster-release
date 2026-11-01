import { describe, expect, it } from 'vitest';
import { originalCivicBlocks, originalEffectiveHostility, originalElectionVotes, originalGangSupport, originalTeamstersWeight,
  type Four, type GangSlot, type OriginalElectionCell, type OriginalElectionCity, type OriginalVoter } from '../src/sim/originalElectionVotes';

const four = <T>(v: T): Four<T> => [v, v, v, v];
const person = (hostility = 0, fear = 0, gangSlot: GangSlot | null = null): OriginalVoter => ({ role: gangSlot == null ? 15 : 30, hostility: four(hostility), fear: four(fear), gangSlot });
const scalar = (value: number) => value < 128 ? person(0, Math.min(255, 256 - 2 * value)) : person(2 * value - 256, 0);
const cell = (owner: OriginalVoter | null, kind = 3, isMaster = true, hasOverlay = false): OriginalElectionCell => ({ owner, kind, isMaster, hasOverlay });
function city(width = 40, height = 32): OriginalElectionCity {
  return { width, height, blocks: Array.from({ length: width * height }, (_, index) => ({ index, content: 1, owner: person(), cells: [cell(person())] })),
    avenueRows: [], avenueColumns: [], riverBlocks: [], territories: [[], [], [], []], teamstersWeights: [0, 0, 0, 0],
    principals: [person(), person()], standingGangSlots: [] };
}
const ids = (n: number, start = 0) => Array.from({ length: n }, (_, i) => i + start);

describe('raw original election consumers', () => {
  it.each([[0, 0, 128], [255, 0, 255], [0, 255, 0], [140, 84, 156], [1, 0, 128]])
  ('hostility %i and fear %i produce byte %i', (h, f, expected) => expect(originalEffectiveHostility(person(h, f), 0)).toBe(expected));

  it('temporarily ignores own hostility, keeps fear, and leaves both inputs intact', () => {
    const p = person(200, 128, 0), before = structuredClone(p);
    expect(originalEffectiveHostility(p, 0)).toBe(164);
    expect(originalEffectiveHostility(p, 0, true)).toBe(64);
    expect(originalEffectiveHostility(p, 1, true)).toBe(164);
    expect(p).toEqual(before);
  });

  it('excludes parks, empty content, coordinate-defined avenues and the river from the civic complement', () => {
    const c = city(10, 4);
    c.blocks[0].content = 0;
    for (let i = 1; i <= 9; i++) c.blocks[i].content = 24 + i;
    for (let i = 10; i <= 15; i++) c.blocks[i].content = 52 + i;
    c.avenueRows = [2]; c.avenueColumns = [9]; c.riverBlocks = [31, 32];
    expect(originalCivicBlocks(c, new Set([16, 17]))).toEqual([18, 30, 33, 34, 35, 36, 37, 38]);
  });

  it('two-way tally uses first principal attitudes, ceil-half unclaimed blocks and no second-principal or Teamsters term', () => {
    const c = city(3, 2);
    c.territories = [[0, 1], [2], [], []];
    c.principals = [{ ...person(), hostility: [0, 255, 0, 0], fear: [255, 0, 0, 0] }, person(255)];
    // 2*256 + 1*1 + ceil(3/2)*256 =1025; 100*1025/(6*256) truncates to66.
    expect(originalElectionVotes(c).percentages).toEqual([66, 34, 0, 0, 0, 0]);
    c.principals = [c.principals[0], person(0, 255)]; c.teamstersWeights = [3, 3, 3, 3];
    expect(originalElectionVotes(c).percentages).toEqual([66, 34, 0, 0, 0, 0]);
  });

  it('counts overlapping gang claims independently but unions them for unclaimed blocks', () => {
    const c = city(1, 1); c.territories = [[0], [0], [0], [0]]; c.principals = [scalar(64), scalar(255)];
    expect(originalElectionVotes(c).percentages).toEqual([75, 25, 0, 0, 0, 0]);
  });

  it('retains the recovered empty two-way electorate fallback', () => {
    const c = city(1, 1); c.blocks[0].content = 25;
    expect(originalElectionVotes(c).percentages).toEqual([0, 100, 0, 0, 0, 0]);
  });

  it('normalizes a 40 by 32 multi-candidate city and gives truncation remainder to the first principal', () => {
    const c = city(); c.territories = [ids(300), [], [], []]; c.standingGangSlots = [0];
    for (const b of c.blocks.slice(0, 300)) b.cells = [cell(scalar(0))];
    const r = originalElectionVotes(c);
    expect(r.civicBlocks).toBe(980); expect(r.civicPool).toBe(980);
    expect(r.scores).toEqual([490, 490, 300, 0, 0, 0]);
    expect(r.percentages).toEqual([39, 38, 23, 0, 0, 0]);
  });

  it('applies the literal 500 civic minimum even when only 280 unclaimed blocks remain', () => {
    const c = city(); c.territories = [ids(1000), [], [], []]; c.standingGangSlots = [0];
    for (const b of c.blocks.slice(0, 1000)) b.cells = [];
    const r = originalElectionVotes(c);
    expect(r.civicBlocks).toBe(280); expect(r.civicPool).toBe(500);
    expect(r.scores).toEqual([250, 250, 1000, 0, 0, 0]);
    expect(r.percentages).toEqual([18, 16, 66, 0, 0, 0]);
  });

  it('uses both principal attitude averages in contested races', () => {
    const c = city(10, 10); c.standingGangSlots = [0]; c.principals = [scalar(64), scalar(192)];
    expect(originalElectionVotes(c).scores?.slice(0, 2)).toEqual([374, 126]); //500*193/258
    c.principals = [scalar(192), scalar(64)];
    expect(originalElectionVotes(c).scores?.slice(0, 2)).toEqual([125, 375]); //500*65/258
  });

  it('Teamsters weights are maxima and a union front must belong to that operation', () => {
    expect(originalTeamstersWeight([])).toBe(0);
    expect(originalTeamstersWeight([{ teamsters: false, tradeUnionFront: true }])).toBe(0);
    expect(originalTeamstersWeight(Array.from({ length: 4 }, () => ({ teamsters: true, tradeUnionFront: false })))).toBe(1);
    expect(originalTeamstersWeight([{ teamsters: true, tradeUnionFront: true }, { teamsters: true, tradeUnionFront: true }])).toBe(3);
  });

  it('distributes an eight-block business pool in a 1:3 ratio in gang-slot and row-major order', () => {
    const c = city(4, 2); c.standingGangSlots = [1, 0]; c.teamstersWeights = [1, 3, 0, 0];
    for (const b of c.blocks) b.content = 11;
    const r = originalElectionVotes(c);
    expect(r.unionQuotas).toEqual([2, 6, 0, 0]);
    expect(r.unionTransferred).toEqual([[0, 1], [2, 3, 4, 5, 6, 7], [], []]);
    expect(r.support).toEqual([[0, 1], [2, 3, 4, 5, 6, 7], [], []]);
    expect(r.scores).toEqual([250, 250, 6, 2, 0, 0]);
    expect(r.percentages).toEqual([50, 49, 1, 0, 0, 0]);
  });

  it('truncates union quotas, ignores non-candidates, and counts only kinds11–14 with nongang owners', () => {
    const c = city(10, 1); c.standingGangSlots = [0, 1]; c.teamstersWeights = [1, 1, 3, 0];
    for (const b of c.blocks) b.content = 12;
    c.blocks[5].content = 10; c.blocks[6].content = 15;
    c.blocks[7].owner = null; c.blocks[8].owner = person(0, 0, 0); c.blocks[9].owner = person(0, 0, 3);
    const r = originalElectionVotes(c);
    expect(r.unionQuotas).toEqual([2, 2, 0, 0]);
    expect(r.unionTransferred).toEqual([[0, 1], [2, 3], [], []]);
    expect(r.support[0]).toEqual([0, 1]); expect(r.support[1]).toEqual([2, 3]);
  });

  it('spends a union quota on an already-held bit without creating duplicate support', () => {
    const c = city(3, 1); c.standingGangSlots = [0, 1]; c.teamstersWeights = [1, 1, 0, 0];
    for (const b of c.blocks) b.content = 11;
    c.territories = [[0], [], [], []];
    const r = originalElectionVotes(c);
    expect(r.unionTransferred).toEqual([[0], [1], [], []]);
    expect(r.support).toEqual([[0], [1], [], []]);
  });

  it('filters the union pool by actor role26..31 rather than just a gang ownership link', () => {
    const c = city(8, 1); c.standingGangSlots = [0]; c.teamstersWeights = [1, 0, 0, 0];
    for (const b of c.blocks) { b.content = 11; b.owner = { ...person(), role: 25 + b.index }; }
    expect(originalElectionVotes(c).unionTransferred).toEqual([[0, 7], [], [], []]);
  });

  it.each([4, 7, 9, 11, 12, 13, 14])('special content%i bypasses hostility filtering even with a hostile owner', content => {
    const c = city(1, 1); c.blocks[0].content = content; c.blocks[0].owner = scalar(255); c.blocks[0].cells = [cell(scalar(255))];
    expect(originalGangSupport(c, new Set([0]), 0)).toEqual([0]);
  });

  it.each([[63, 100], [64, 100], [127, 37], [128, 36], [163, 1], [164, 0]])
  ('hostility scalar%i retains%i of one hundred ordinary support blocks', (value, expected) => {
    const c = city(10, 10); for (const b of c.blocks) b.cells = [cell(scalar(value))];
    expect(originalGangSupport(c, new Set(ids(100)), 0)).toHaveLength(expected);
  });

  it('floors the combined reluctant average before calculating the retained quota', () => {
    const c = city(5, 4); for (const b of c.blocks) b.cells = [cell(scalar(b.index < 10 ? 100 : 101))];
    expect(originalGangSupport(c, new Set(ids(20)), 0)).toHaveLength(12); //floor(64*20/100)
  });

  it('retains reluctant blocks in column-major order, unlike union transfers', () => {
    const c = city(2, 2);
    expect(originalGangSupport(c, new Set([1, 2, 3]), 0)).toEqual([2]); //three neutral blocks -> one retained
  });

  it('averages qualifying occupiers and preserves ownerless ordinary support', () => {
    const c = city(2, 1);
    c.blocks[0].cells = [cell(scalar(0)), cell(scalar(255))]; c.blocks[1].cells = [];
    expect(originalGangSupport(c, new Set([0, 1]), 0)).toEqual([1]); //first avg127, quota floor(.37)=0
    c.blocks[0].cells = [cell(person(200, 128, 0))];
    expect(originalGangSupport(c, new Set([0, 1]), 0)).toEqual([0, 1]); //self avg64 retains all
  });

  it('subtracts non-candidates territory from the civic pool without giving them a ballot score', () => {
    const c = city(); c.standingGangSlots = [0]; c.territories = [ids(100), ids(300, 100), [], []];
    for (const b of c.blocks) b.cells = [];
    const r = originalElectionVotes(c);
    expect(r.civicBlocks).toBe(880); expect(r.scores).toEqual([440, 440, 100, 0, 0, 0]);
  });

  it.each([[10, 16, false], [14, 28, false], [18, 39, true]])
  ('shows the maximum-support ceiling in a %i-square remake city (%i percent, can win %s)', (size, share, wins) => {
    const c = city(size, size); c.standingGangSlots = [0]; c.territories = [ids(size * size), [], [], []];
    for (const b of c.blocks) b.cells = []; //optimistic: every block eligible, claimed and fully supportive
    const r = originalElectionVotes(c);
    expect(r.percentages[2]).toBe(share);
    expect(r.percentages[2] > Math.max(r.percentages[0], r.percentages[1])).toBe(wins);
  });

  it('is deterministic, insensitive to storage order, and does not mutate city, voters or claims', () => {
    const c = city(); c.standingGangSlots = [0, 2]; c.territories = [ids(200), [], ids(250, 200), []];
    for (const b of c.blocks.slice(500, 530)) b.content = 11;
    c.teamstersWeights = [1, 0, 3, 0];
    const before = structuredClone(c), first = originalElectionVotes(c);
    expect(originalElectionVotes(c)).toEqual(first); expect(c).toEqual(before);
    c.blocks = [...c.blocks].reverse();
    expect(originalElectionVotes(c)).toEqual(first);
  });

  it.each([2, 3, 6, 7, 8, 9])('counts eligible cell kind%i', kind => {
    const c = city(1, 1); c.blocks[0].cells = [cell(scalar(255), kind)];
    expect(originalGangSupport(c, new Set([0]), 0)).toEqual([]);
  });

  it.each([0, 1, 4, 5, 10])('ignores unsupported cell kind%i rather than inventing an occupier vote', kind => {
    const c = city(1, 1); c.blocks[0].cells = [cell(scalar(255), kind)];
    expect(originalGangSupport(c, new Set([0]), 0)).toEqual([0]);
  });

  it.each([3, 9])('skips covered cell kind%i', kind => {
    const c = city(1, 1); c.blocks[0].cells = [cell(scalar(255), kind, true, true)];
    expect(originalGangSupport(c, new Set([0]), 0)).toEqual([0]);
  });

  it.each([6, 7, 8])('skips secondary footprint cells for kind%i', kind => {
    const c = city(1, 1); c.blocks[0].cells = [cell(scalar(255), kind, false)];
    expect(originalGangSupport(c, new Set([0]), 0)).toEqual([0]);
  });

  it('does not apply self-hostility suppression to civic cell kind8', () => {
    const c = city(1, 1); c.blocks[0].cells = [cell(person(200, 128, 0), 8)];
    expect(originalGangSupport(c, new Set([0]), 0)).toEqual([]);
    c.blocks[0].cells = [cell(person(200, 128, 0), 3)];
    expect(originalGangSupport(c, new Set([0]), 0)).toEqual([0]);
  });

  it('requires role28/30 for own-gang suppression except for kind2', () => {
    const c = city(1, 1), p = { ...person(200, 128, 0), role: 27 };
    c.blocks[0].cells = [cell(p, 3)]; expect(originalGangSupport(c, new Set([0]), 0)).toEqual([]);
    c.blocks[0].cells = [cell(p, 2)]; expect(originalGangSupport(c, new Set([0]), 0)).toEqual([0]);
  });

  it('proves a single effective opinion cannot reconstruct the separate original fear and hostility inputs', () => {
    const a = person(0, 0, 0), b = person(128, 128, 0);
    expect(originalEffectiveHostility(a, 0)).toBe(128);
    expect(originalEffectiveHostility(b, 0)).toBe(128);
    const c = city(10, 10);
    for (const block of c.blocks) block.cells = [cell(a)];
    expect(originalGangSupport(c, new Set(ids(100)), 0)).toHaveLength(36);
    for (const block of c.blocks) block.cells = [cell(b)];
    expect(originalGangSupport(c, new Set(ids(100)), 0)).toHaveLength(100);
  });

  it('ignores missing cell owners and counts business masters rather than footprint area', () => {
    const c = city(1, 1);
    c.blocks[0].cells = [cell(null, 3), cell(scalar(0), 6), cell(scalar(255), 6), ...Array.from({ length: 6 }, () => cell(scalar(0), 6, false))];
    expect(originalGangSupport(c, new Set([0]), 0)).toEqual([]); //avg127, one reluctant block -> zero
  });
});
