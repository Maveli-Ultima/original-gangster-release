import { describe, expect, it } from 'vitest';
import { newCampaignOptions } from '../src/app/newGame';
import { createWorld } from '../src/sim/citygen';
import { blockRect } from '../src/sim/cityLayout';
import { BUILDING_BY_ID } from '../src/sim/data/buildings';
import { lotFacing, profileForLot } from '../src/render/profile';

describe('original-city buildings stay inside their blocks', () => {
  it('sizes and orients every parcel the same way, so terraces run along their street', () => {
    const { world: w } = createWorld({ ...newCampaignOptions(), seed: 404 });
    const outside: string[] = [];
    for (const b of Object.values(w.buildings)) {
      if (b.cls === 'empty') continue;
      const lot = w.lots[b.lotId], blk = w.blocks[b.blockId];
      if (!lot?.bounds || !blk || blk.layout?.mergedInto != null) continue;
      const facing = lotFacing(lot, blk.center, b.id);
      const p = profileForLot(b, BUILDING_BY_ID[b.typeId], lot, facing);
      const turned = facing === 'east' || facing === 'west';
      const hx = (turned ? p.depth : p.width) / 2, hz = (turned ? p.width : p.depth) / 2;
      const r = blockRect(blk), m = 1;
      if (lot.center.x - hx < r.x - m || lot.center.x + hx > r.x + r.w + m ||
          lot.center.y - hz < r.y - m || lot.center.y + hz > r.y + r.h + m) outside.push(`${b.typeId}@${blk.gx},${blk.gy}`);
    }
    expect(outside.slice(0, 10)).toEqual([]);
  }, 120000);
});
