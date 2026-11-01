import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultGameOptions } from '../src/app/newGame';
import { useGame } from '../src/app/store';
import { handleMapHit } from '../src/ui/mapClick';
import { NewspaperContent } from '../src/ui/organizer/NewspaperTab';
import { defaultOptions, issueOrder, nearTerritory, previewOrder, validBuildingTarget } from '../src/sim/api';
import { CHARITY_APPEAL_SQUALOR, donationAmount, donationTarget } from '../src/sim/charity';
import { beginWeekOrders, tickOrders } from '../src/sim/execution';
import { addNews, reportBusinessMove } from '../src/sim/events';
import { buildingMapIntel, knownBlockOwners } from '../src/sim/mapIntel';
import { newspaperEdition, newspaperLead, publishBusinessIntelligence, publishingNewspapers } from '../src/sim/newspaper';
import { planGang } from '../src/sim/ai';
import { Sim } from '../src/sim/sim';
import { weeklyNews } from '../src/sim/systems/news';
import { weeklyPolitics } from '../src/sim/systems/politics';
import type { Order } from '../src/sim/types';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, startHoods: 8 });
  const w = sim.world, g = sim.playerGang, team = w.teams[g.teamIds[0]];
  w.orders = {}; w.news = []; g.cash = 500000;
  for (const t of Object.values(w.teams)) { t.orderIds = []; t.timeUsed = 0; }
  const charities = Object.values(w.buildings).filter(donationTarget);
  const rival = Object.values(w.gangs).find(g => !g.isPlayer)!;
  const site = Object.values(w.buildings).find(b => b.ownerGangId == null && b.cls === 'commercial' && nearTerritory(w, g.id, b.blockId, 2))!;
  site.typeId = 'departmentStore'; site.protection = null;
  return { sim, w, g, team, charity: charities[0], charities, rival, site };
}
function finish(sim: Sim, order: Order) {
  beginWeekOrders(sim.world);
  for (let i = 0; i < 2400 && !['done', 'failed'].includes(order.state); i++) tickOrders(sim.world, sim.rng, 1);
}
function purchase(s: ReturnType<typeof fixture>, secret: boolean) {
  if (secret) publishingNewspapers(s.w)[0].ownerGangId = s.g.id;
  expect(issueOrder(s.w, s.g.id, { teamId: s.team.id, type: 'buyPremises', buildingIds: [s.site.id] }).ok).toBe(true);
  const order = s.w.orders[s.team.orderIds[0]];
  finish(s.sim, order); expect(order.state, order.failReason ?? '').toBe('done');
}

describe('donation selection, execution and reporting', () => {
  it('quotes the selected charity’s local poverty instead of a fixed $1,000', () => {
    const s = fixture(), [poor, rich] = s.charities;
    s.w.blocks[poor.blockId].squalor = 90; s.w.blocks[rich.blockId].squalor = 10;
    useGame.setState({ sim: s.sim, jobCard: null, pickMode: null, sheet: null });
    useGame.getState().beginOrder('donate', s.team.id);
    expect(useGame.getState().jobCard!.opts.amount).toBeUndefined();
    const pick = (b: typeof poor) => handleMapHit({ buildingId: b.id, blockId: b.blockId, personId: null, point: s.w.lots[b.lotId].center });
    pick(poor);
    const cheap = previewOrder(s.w, s.g.id, useGame.getState().jobCard!)!;
    expect(cheap.opts.amount).toBe(620);
    pick(rich);
    const dear = previewOrder(s.w, s.g.id, useGame.getState().jobCard!)!;
    expect(dear.opts.amount).toBe(2380);
    expect(cheap.opts.amount!).toBeLessThan(dear.opts.amount!);
  });

  it('keeps the accepted quote across a changed neighbourhood, save and actual delivery', () => {
    const s = fixture(); s.w.blocks[s.charity.blockId].squalor = 90;
    expect(issueOrder(s.w, s.g.id, { teamId: s.team.id, type: 'donate', buildingIds: [s.charity.id] }).ok).toBe(true);
    const id = s.team.orderIds[0], quote = s.w.orders[id].opts.amount!;
    expect(quote).toBe(620);
    s.w.blocks[s.charity.blockId].squalor = 10;
    const restored = Sim.fromSave(structuredClone(s.w)), order = restored.world.orders[id], before = restored.playerGang.cash;
    const priest = restored.world.people[s.charity.ownerPersonId!], opinion = priest.opinion[s.g.id] ?? 0;
    finish(restored, order);
    expect(order.state).toBe('done'); expect(restored.playerGang.cash).toBe(before - quote);
    expect(priest.opinion[s.g.id]).toBeGreaterThan(opinion);
    expect(restored.world.news.filter(n => n.kind === 'donation')).toEqual([expect.objectContaining({
      buildingId: s.charity.id, amount: quote, gangId: s.g.id, week: s.w.week,
    })]);
    tickOrders(restored.world, restored.rng, 30);
    expect(restored.playerGang.cash).toBe(before - quote);
    expect(restored.world.news.filter(n => n.kind === 'donation')).toHaveLength(1);
    expect(newspaperEdition(restored.world, s.g.id).items.some(n => n.kind === 'donation')).toBe(false);
    restored.world.week++;
    expect(newspaperEdition(restored.world, s.g.id).items.some(n => n.kind === 'donation')).toBe(true);
  });

  it('honours an explicit donation retained in a historical order', () => {
    const s = fixture();
    expect(issueOrder(s.w, s.g.id, { teamId: s.team.id, type: 'donate', buildingIds: [s.charity.id], opts: { amount: 1200 } }).ok).toBe(true);
    const restored = Sim.fromSave(structuredClone(s.w)), before = restored.playerGang.cash;
    finish(restored, restored.world.orders[s.team.orderIds[0]]);
    expect(restored.playerGang.cash).toBe(before - 1200);
    expect(restored.world.news.find(n => n.kind === 'donation')?.amount).toBe(1200);
  });

  it.each(['no money', 'changed site', 'destroyed site'] as const)('publishes no thanks or goodwill for a failed donation: %s', cause => {
    const s = fixture();
    expect(issueOrder(s.w, s.g.id, { teamId: s.team.id, type: 'donate', buildingIds: [s.charity.id] }).ok).toBe(true);
    if (cause === 'no money') s.g.cash = 0;
    if (cause === 'changed site') { s.charity.typeId = 'hospital'; s.charity.cls = 'municipal'; }
    if (cause === 'destroyed site') s.charity.state = 'destroyed';
    const before = s.g.cash, goodwill = s.g.goodwill, order = s.w.orders[s.team.orderIds[0]];
    finish(s.sim, order);
    expect(order.state).toBe('failed'); expect(s.g.cash).toBe(before); expect(s.g.goodwill).toBe(goodwill);
    expect(s.w.news.filter(n => n.kind === 'donation')).toHaveLength(0);
  });

  it('rejects zero donations and sites outside the church/orphanage workflow', () => {
    const s = fixture();
    expect(issueOrder(s.w, s.g.id, { teamId: s.team.id, type: 'donate', buildingIds: [s.charity.id], opts: { amount: 0 } }).ok).toBe(false);
    const kitchen = { ...s.charity, typeId: 'soupKitchen' };
    expect(validBuildingTarget(s.w, s.g.id, 'donate', kitchen, defaultOptions())).toBe(false);
    expect(s.w.news).toEqual([]); expect(s.team.orderIds).toEqual([]);
  });

  it.each(['poor', 'funded', 'wealthy', 'closed', 'unstaffed'] as const)('publishes poverty appeals only for an eligible charity: %s', condition => {
    const s = fixture();
    for (const block of s.w.blocks) block.squalor = 0;
    const site = s.charity;
    s.w.blocks[site.blockId].squalor = condition === 'wealthy' ? 0 : CHARITY_APPEAL_SQUALOR;
    if (condition === 'closed') site.state = 'ceased';
    if (condition === 'unstaffed') s.w.people[site.ownerPersonId!].status = 'dead';
    if (condition === 'funded') {
      expect(issueOrder(s.w, s.g.id, { teamId: s.team.id, type: 'donate', buildingIds: [site.id] }).ok).toBe(true);
      finish(s.sim, s.w.orders[s.team.orderIds[0]]);
    }
    s.g.popularity = 100;
    weeklyNews(s.w, s.sim.rng);
    const appeals = s.w.news.filter(n => n.kind === 'charityAppeal');
    expect(appeals.map(n => n.buildingId)).toEqual(condition === 'poor' ? [site.id] : []);
    if (condition === 'poor') expect(appeals[0].amount).toBe(donationAmount(s.w, site));
    expect(s.w.news.filter(n => n.kind === 'donation')).toHaveLength(condition === 'funded' ? 1 : 0);
    expect(s.w.news.some(n => n.headline === 'GENEROSITY PRAISED FROM THE PULPIT')).toBe(false);
    weeklyNews(s.w, s.sim.rng);
    expect(s.w.news.filter(n => n.kind === 'charityAppeal')).toHaveLength(condition === 'poor' ? 1 : 0);
  });

  it('does not invent donations for a popular gang', () => {
    const s = fixture(); s.g.popularity = 100;
    weeklyNews(s.w, s.sim.rng);
    expect(s.w.news.filter(n => n.section === 'charity' && n.gangId === s.g.id)).toEqual([]);
  });
});

describe('published business intelligence', () => {
  it('has no readable edition when every publisher is closed', () => {
    const s = fixture();
    reportBusinessMove(s.w, s.g.id, s.site, 'bought');
    s.w.week++;
    for (const paper of publishingNewspapers(s.w)) paper.state = 'ceased';
    expect(newspaperEdition(s.w, s.g.id)).toMatchObject({ paper: null, items: [] });
    s.w.week = 1;
    expect(newspaperEdition(s.w, s.g.id).items).toEqual([]);
  });

  it('reveals just the named owner after publication, retaining protection and headquarters fog', () => {
    const s = fixture(), other = Object.values(s.w.gangs).find(g => g.id !== s.g.id && g.id !== s.rival.id)!;
    for (const b of Object.values(s.w.buildings)) b.knowledge[s.rival.id] = 0;
    s.site.protection = { gangId: other.id, weekly: 100, base: 100, grievance: 0, refusing: false };
    purchase(s, false);
    expect(buildingMapIntel(s.site, s.rival.id).ownerGangId).toBeNull();
    const beforeOthers = Object.values(s.w.buildings).filter(b => b.id !== s.site.id).map(b => [b.id, b.knowledge[s.rival.id]]);
    weeklyNews(s.w, s.sim.rng);
    expect(buildingMapIntel(s.site, s.rival.id)).toMatchObject({ ownerGangId: s.g.id, protectionGangId: null, isHQ: false });
    expect(s.site.knowledge[s.rival.id]).toBe(1);
    expect(knownBlockOwners(s.w, s.w.blocks[s.site.blockId], s.rival.id)).toContain(s.g.id);
    expect(Object.values(s.w.buildings).filter(b => b.id !== s.site.id).map(b => [b.id, b.knowledge[s.rival.id]])).toEqual(beforeOthers);
    const restored = Sim.fromSave(structuredClone(s.w));
    expect(buildingMapIntel(restored.world.buildings[s.site.id], s.rival.id).ownerGangId).toBe(s.g.id);
    const snapshot = structuredClone(restored.world); publishBusinessIntelligence(restored.world);
    expect(restored.world).toEqual(snapshot);
    restored.world.buildings[s.site.id].ownerGangId = other.id;
    expect(buildingMapIntel(restored.world.buildings[s.site.id], s.rival.id).ownerGangId).toBeNull();
  });

  it('keeps an owned-paper purchase hidden from rival maps and editions after save/restore', () => {
    const s = fixture(); s.site.knowledge[s.rival.id] = 0;
    purchase(s, true);
    const restored = Sim.fromSave(structuredClone(s.w)); weeklyNews(restored.world, restored.rng); restored.world.week++;
    expect(buildingMapIntel(restored.world.buildings[s.site.id], s.rival.id).ownerGangId).toBeNull();
    expect(newspaperEdition(restored.world, s.rival.id).items.some(n => n.kind === 'purchase')).toBe(false);
    expect(newspaperEdition(restored.world, s.g.id).items.some(n => n.kind === 'purchase')).toBe(true);
  });

  it.each(['old report', 'sold', 'illegal now', 'no publisher'] as const)('does not reveal an inapplicable holding: %s', reason => {
    const s = fixture(); s.site.ownerGangId = s.g.id; s.site.knowledge[s.rival.id] = 0;
    reportBusinessMove(s.w, s.g.id, s.site, 'bought');
    if (reason === 'old report') s.w.week++;
    if (reason === 'sold') s.site.ownerGangId = null;
    if (reason === 'illegal now') { s.site.typeId = 'office'; s.site.cls = 'illegal'; }
    if (reason === 'no publisher') for (const p of publishingNewspapers(s.w)) p.state = 'destroyed';
    publishBusinessIntelligence(s.w);
    expect(buildingMapIntel(s.site, s.rival.id).ownerGangId).toBeNull();
    expect(s.site.knowledge[s.rival.id]).toBe(0);
  });

  it.each([false, true])('changes actual rival wartime targeting only for public purchases (protected=%s)', secret => {
    const s = fixture(); purchase(s, secret);
    for (const b of Object.values(s.w.buildings)) {
      b.knowledge[s.rival.id] = 0;
      if (b.ownerGangId == null && b.cls !== 'empty' && b.typeId !== 'newspaper') b.ownerGangId = s.g.id;
    }
    publishBusinessIntelligence(s.w);
    s.w.orders = {};
    for (const t of Object.values(s.w.teams)) { t.orderIds = []; t.timeUsed = 0; }
    s.rival.knownPeople = []; s.rival.cash = 500000; s.rival.personality = 'aggressive';
    for (const g of Object.values(s.w.gangs)) if (g.id !== s.rival.id) {
      s.rival.offered[g.id] = g.id === s.g.id ? 'war' : 'peace'; s.rival.known[g.id] = s.rival.offered[g.id];
    }
    // Hold the diplomacy stance fixed and expose ordinary planning opportunities.
    vi.spyOn(s.sim.rng, 'chance').mockImplementation(p => p !== .25 && p !== .4);
    planGang(s.w, s.sim.rng, s.rival);
    const attacks = Object.values(s.w.orders).filter(o => o.gangId === s.rival.id && ['smashUp', 'torch', 'raid', 'bomb'].includes(o.type));
    expect(attacks.some(o => o.targetBuildingIds.includes(s.site.id))).toBe(!secret);
  });
});

describe('front-page importance', () => {
  it('promotes actual election calls and results above a later routine or gang headline', () => {
    const s = fixture(); s.w.week = 26;
    // The recovered mayor counter calls the poll when it reaches 22.
    s.w.election.mayorTerm = { personId: s.w.mayorId, weeks: 21 };
    weeklyPolitics(s.w, s.sim.rng); weeklyNews(s.w, s.sim.rng);
    expect(newspaperLead(s.w.news.filter(n => n.week === 26))?.headline).toBe('MAYORAL ELECTION CALLED');
    s.w.week++; s.w.election.weeksLeft = 1;
    weeklyPolitics(s.w, s.sim.rng); weeklyNews(s.w, s.sim.rng);
    addNews(s.w, { section: 'front', frontPagePriority: 2, headline: 'NEW HAND AT THE TOP', body: 'A gang changed leaders.', gangId: s.g.id });
    const lead = newspaperLead(s.w.news.filter(n => n.week === 27));
    expect(lead?.headline).toBe('MAYOR TAKES OFFICE'); expect(lead?.frontPagePriority).toBe(3);
    s.w.week++;
    const restored = Sim.fromSave(structuredClone(s.w));
    const markup = renderToStaticMarkup(createElement(NewspaperContent, { sim: restored }));
    expect(markup).toContain('<h2>MAYOR TAKES OFFICE</h2>');
    expect(markup).toContain('Political News');
  });

  it('preserves legacy front-page ordering without inventing priorities', () => {
    const s = fixture();
    addNews(s.w, { section: 'front', headline: 'Old front', body: '', gangId: null });
    addNews(s.w, { section: 'front', headline: 'Later front', body: '', gangId: null });
    expect(newspaperLead(s.w.news)?.headline).toBe('Later front');
  });
});
