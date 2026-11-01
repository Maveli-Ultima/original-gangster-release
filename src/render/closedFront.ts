import * as THREE from 'three';

/**
 * A shopfront the FBI has closed: planks nailed across the ground floor and a
 * government notice (TODO §4). Drawn over the frontage plane (unit width,
 * origin at the bottom centre), slightly pulled toward the camera.
 */
export function closedFrontMaterial(): THREE.MeshStandardMaterial {
  const w = 256, h = 128, canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const plank = (x: number, y: number, len: number, angle: number, shade: number) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.fillStyle = `rgb(${92 + shade},${66 + shade},${40 + shade})`; ctx.fillRect(-len / 2, -9, len, 18);
    ctx.fillStyle = 'rgba(40,26,14,.55)'; ctx.fillRect(-len / 2, 7, len, 2);
    ctx.fillStyle = '#2a2622'; for (const e of [-len / 2 + 8, len / 2 - 10]) ctx.fillRect(e, -3, 3, 3);
    ctx.restore();
  };
  // Two horizontal boards and a cross over the window and door.
  plank(w / 2, 34, w * .96, 0, 0);
  plank(w / 2, 92, w * .96, 0, 8);
  plank(w / 2, h / 2, w * 1.02, Math.atan2(h * .8, w), -6);
  plank(w / 2, h / 2, w * 1.02, -Math.atan2(h * .8, w), 4);
  // The notice.
  ctx.fillStyle = '#efe8d4'; ctx.fillRect(w * .36, h * .3, w * .28, h * .4);
  ctx.strokeStyle = '#8c8270'; ctx.lineWidth = 2; ctx.strokeRect(w * .36, h * .3, w * .28, h * .4);
  ctx.fillStyle = '#2b2620'; ctx.textAlign = 'center';
  ctx.font = 'bold 13px Georgia, serif'; ctx.fillText('CLOSED', w / 2, h * .46);
  ctx.font = '8px Georgia, serif'; ctx.fillText('BY ORDER OF THE', w / 2, h * .56); ctx.fillText('U.S. GOVERNMENT', w / 2, h * .64);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: .1, roughness: .9,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}
