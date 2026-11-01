/**
 * The five stages of the game clock, as the original had them: normal, ×2, ×4,
 * ×8 and maximum. There is no End Week in the original: maximum runs the
 * simulation flat out (its busy loop) — `isFlatOut`; 10 is its label, from the
 * original's stage table (0x74DD30: 1, 2, 4, 8, 10).
 */
export const SPEED_STAGES: readonly number[] = [1, 2, 4, 8, 10];
export const FLAT_OUT_BUDGET_MS = 12;
export const isFlatOut = (speed: number) => speed >= SPEED_STAGES[SPEED_STAGES.length - 1];

export function stageIndex(speed: number): number {
  let best = 0;
  for (let i = 0; i < SPEED_STAGES.length; i++) if (SPEED_STAGES[i] <= speed) best = i;
  return best;
}

/** The stage at or just below `speed`. */
export function nearestStage(speed: number): number {
  return SPEED_STAGES[stageIndex(speed)];
}
