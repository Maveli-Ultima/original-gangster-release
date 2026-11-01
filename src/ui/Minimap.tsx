import { activeBlocks, blockRect } from '../sim/cityLayout';
import { useEffect, useRef, type MouseEvent } from 'react';
import { useGame } from '../app/store';
import { CELL, GANG_COLORS } from '../sim/constants';
import { buildingMapIntel, knownBlockOwners } from '../sim/mapIntel';
import { cameraApi } from './CityView';
import { buildingList } from '../sim/entityLists';
import { cityTramLines } from '../sim/trams';

/** Unclaimed blocks are drawn in the tone of their district. */
const DISTRICT_INK: Partial<Record<string, string>> = {
  downtown: '#c7b99a',
  commercial: '#b9a98d',
  industrial: '#8a857a',
  residential: '#a1937c',
  civic: '#b5ad9a',
};

/**
 * The city plan in the corner of the week view: every block in the colour of
 * whoever is known to hold it, the streets between, and the frame of what the main view
 * is looking at. Clicking anywhere moves the camera there.
 */
export function Minimap({ size = 250 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sim = useGame((s) => s.sim);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !sim) return;
    const w = sim.world;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size * dpr;
    cv.height = size * dpr;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const cityW = w.gridW * CELL;
    const cityH = w.gridH * CELL;
    const scale = size / Math.max(cityW, cityH);

    // Blocks, territory, rail and HQs change only with the world: draw them
    // into a cached layer (1,280 blocks' owner lookups every 400 ms showed up
    // in Street View profiles) and redraw just the view frame each tick.
    const base = document.createElement('canvas');
    base.width = cv.width; base.height = cv.height;
    const baseCtx = base.getContext('2d');
    let baseKey = '';
    const draw = () => {
      const key = `${useGame.getState().version}|${w.week}|${w.phase}|${Math.floor(w.minute / 60)}`;
      if (baseCtx && key !== baseKey) { baseKey = key; drawBase(baseCtx); }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (baseCtx) ctx.drawImage(base, 0, 0); else drawBase(ctx);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawFrame();
    };
    const drawBase = (ctx: CanvasRenderingContext2D) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#4a3f33';
      ctx.fillRect(0, 0, size, size);

      for (const blk of activeBlocks(w)) {
        const owners = knownBlockOwners(w, blk, sim.playerGang.id);
        ctx.fillStyle = blk.layout?.use === 'park' ? '#94aa7c' : blk.layout?.use === 'water' ? '#8fb3b8'
          : blk.layout?.use === 'avenue' ? '#d9d2c1' : DISTRICT_INK[blk.district] ?? '#b9a98d';
        const r = blockRect(blk);
        ctx.fillRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
        ctx.globalAlpha = 0.85;
        owners.forEach((id, i) => {
          ctx.fillStyle = GANG_COLORS[w.gangs[id].color].hex;
          ctx.fillRect((r.x + r.w * i / owners.length) * scale, r.y * scale, r.w * scale / owners.length, r.h * scale);
        });
        ctx.globalAlpha = 1;
      }

      for (const line of cityTramLines(w)) {
        ctx.strokeStyle = line.color; ctx.lineWidth = 1;
        ctx.beginPath(); line.points.forEach((p, i) => i ? ctx.lineTo(p.x * scale, p.y * scale) : ctx.moveTo(p.x * scale, p.y * scale)); ctx.stroke();
      }
      // Headquarters.
      const player = sim.playerGang;
      for (const b of buildingList(w)) {
        const intel = buildingMapIntel(b, player.id);
        if (!intel.isHQ || intel.ownerGangId == null) continue;
        const lot = w.lots[b.lotId];
        const g = w.gangs[intel.ownerGangId];
        ctx.fillStyle = g?.id === player.id ? '#f0d489' : '#111';
        ctx.beginPath();
        ctx.arc(lot.center.x * scale, lot.center.y * scale, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const drawFrame = () => {
      // The frame of the main view.
      const cam = cameraApi.ref;
      if (cam) {
        const t = cam.getTarget();
        const zoom = cam.getZoom();
        const aspect = window.innerWidth / Math.max(1, window.innerHeight);
        const viewH = 240 / zoom;
        const reachX = viewH * 0.36 + viewH * aspect * 0.25;
        const reachZ = reachX;
        ctx.strokeStyle = '#a8341f';
        ctx.lineWidth = 2;
        ctx.strokeRect((t.x - reachX) * scale, (t.y - reachZ) * scale, reachX * 2 * scale, reachZ * 2 * scale);
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect((t.x - reachX) * scale - 1, (t.y - reachZ) * scale - 1, reachX * 2 * scale + 2, reachZ * 2 * scale + 2);
      }
    };

    draw();
    const id = window.setInterval(draw, 400);
    return () => window.clearInterval(id);
  }, [sim, size]);

  const requestCamera = useGame((s) => s.requestCamera);
  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!sim) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const w = sim.world;
    const scale = size / Math.max(w.gridW * CELL, w.gridH * CELL);
    requestCamera({ x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale });
  };

  return (
    <canvas
      ref={ref}
      className="minimap"
      style={{ width: size, height: size, display: 'block', cursor: 'crosshair' }}
      onClick={onClick}
      title="Click to look there"
    />
  );
}
