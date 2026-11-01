/** Alternate known claim colours along every side of a shared block. */
export function drawTerritoryOutline(ctx: CanvasRenderingContext2D, x: number, y: number,
  width: number, height: number, colors: string[], lineWidth: number): void {
  if (!colors.length) return;
  ctx.save(); ctx.lineWidth = lineWidth;
  if (colors.length === 1) {
    ctx.strokeStyle = colors[0]; ctx.strokeRect(x, y, width, height);
    ctx.restore(); return;
  }
  const corners = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
  for (let side = 0; side < 4; side++) {
    const a = corners[side], b = corners[(side + 1) % 4];
    colors.forEach((color, i) => {
      ctx.strokeStyle = color; ctx.beginPath();
      ctx.moveTo(a[0] + (b[0] - a[0]) * i / colors.length, a[1] + (b[1] - a[1]) * i / colors.length);
      ctx.lineTo(a[0] + (b[0] - a[0]) * (i + 1) / colors.length, a[1] + (b[1] - a[1]) * (i + 1) / colors.length);
      ctx.stroke();
    });
  }
  ctx.restore();
}
