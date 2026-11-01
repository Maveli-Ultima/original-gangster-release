/**
 * Close-combat result tables, transcribed from the original's Data\Cart.txt
 * (decoded: full_recode/reference/xtx_decoded/Cart.xtx.txt; loader 0x464A80,
 * resolver 0x465330). Each attack type has four result lists in file order:
 * missed from behind, hit from behind, missed from the front, hit from the front.
 * An entry is [reaction, trigger frame, wait time, lost turns, damage]; the
 * loader discards the wait time. Damage 5 is instant death (the file's notes).
 */
export type CartEntry = readonly [reaction: number, triggerFrame: number, wait: number, lostTurns: number, damage: number];
export interface CartAttack { readonly name: string; readonly missBehind: readonly CartEntry[]; readonly hitBehind: readonly CartEntry[]; readonly missFront: readonly CartEntry[]; readonly hitFront: readonly CartEntry[] }

/** Reaction ids (the file's header). */
export const CART_REACTIONS = ['head back', 'head forward', 'duck', 'fall to knees', 'fall forward', 'spinning fall', 'twitch while down', 'nothing', 'head forward on knees', 'fall forward from knees', 'get up from knees', 'get up from fall to knees', 'get up from fall'] as const;

export const CART: readonly CartAttack[] = [
  { name: 'Downward head attack with club', missBehind: [[7, 0, 0, 0, 0], [1, 0, 0, 0, 0], [2, 0, 0, 0, 0]], hitBehind: [[1, 3, 0, 1, 1], [3, 3, 0, 1, 1], [4, 3, 0, 1, 1]],
    missFront: [[7, 0, 0, 0, 0], [0, 0, 0, 0, 0], [2, 0, 0, 0, 0]], hitFront: [[0, 3, 0, 1, 1], [3, 3, 0, 1, 1], [5, 3, 0, 1, 1]] }, // 0
  { name: 'Fist attack straight in the face', missBehind: [[7, 0, 0, 0, 0], [1, 0, 0, 0, 0], [2, 0, 0, 0, 0]], hitBehind: [[1, 7, 0, 1, 1], [3, 7, 0, 1, 1], [4, 7, 0, 1, 1]],
    missFront: [[7, 0, 0, 0, 0], [0, 0, 0, 0, 0], [2, 0, 0, 0, 0]], hitFront: [[0, 7, 0, 1, 1], [3, 7, 0, 1, 1], [5, 7, 0, 1, 1]] }, // 1
  { name: 'Side head attack with fist', missBehind: [[7, 0, 0, 0, 0], [1, 0, 0, 0, 0], [2, 0, 0, 0, 0]], hitBehind: [[1, 4, 0, 1, 1], [3, 4, 0, 1, 1], [4, 4, 0, 1, 1]],
    missFront: [[7, 0, 0, 0, 0], [0, 0, 0, 0, 0], [2, 0, 0, 0, 0]], hitFront: [[0, 4, 0, 1, 1], [3, 4, 0, 1, 1], [5, 4, 0, 1, 1]] }, // 2
  { name: 'Side head attack with club', missBehind: [[7, 0, 0, 0, 0], [1, 0, 0, 0, 0], [2, 0, 0, 0, 0]], hitBehind: [[1, 3, 0, 1, 2], [3, 3, 0, 1, 2], [4, 3, 0, 1, 2]],
    missFront: [[7, 0, 0, 0, 0], [0, 0, 0, 0, 0], [2, 0, 0, 0, 0]], hitFront: [[0, 3, 0, 1, 2], [3, 3, 0, 1, 2], [5, 3, 0, 1, 2]] }, // 3
  { name: 'Attack to head with knife', missBehind: [[1, 0, 0, 0, 0], [2, 0, 0, 0, 0]], hitBehind: [[1, 4, 0, 1, 2], [3, 4, 0, 1, 3], [5, 4, 0, 1, 4], [5, 4, 0, 1, 5]],
    missFront: [[0, 0, 0, 0, 0], [2, 0, 0, 0, 0]], hitFront: [[0, 4, 0, 1, 1], [5, 4, 0, 1, 1], [3, 4, 0, 1, 5]] }, // 4
  { name: 'Attack to stomach with fist', missBehind: [[7, 0, 0, 0, 0], [0, 0, 0, 0, 0], [2, 0, 0, 0, 0]], hitBehind: [[0, 4, 0, 1, 1], [3, 4, 0, 1, 1], [4, 4, 0, 1, 1]],
    missFront: [[7, 0, 0, 0, 0], [1, 0, 0, 0, 0], [2, 0, 0, 0, 0]], hitFront: [[1, 4, 0, 1, 1], [3, 4, 0, 1, 1], [4, 4, 0, 1, 1], [5, 4, 0, 1, 1]] }, // 5
  { name: 'Attack to stomach with club', missBehind: [[7, 0, 0, 0, 0], [0, 0, 0, 0, 0], [2, 0, 0, 0, 0]], hitBehind: [[0, 3, 0, 1, 2], [3, 3, 0, 1, 2], [4, 3, 0, 1, 2]],
    missFront: [[7, 0, 0, 0, 0], [1, 0, 0, 0, 0], [2, 0, 0, 0, 0]], hitFront: [[1, 3, 0, 1, 2], [3, 3, 0, 1, 2], [4, 3, 0, 1, 2], [5, 3, 0, 1, 2]] }, // 6
  { name: 'Attack to stomach with knife', missBehind: [[7, 0, 0, 0, 0], [0, 0, 0, 0, 0], [2, 0, 0, 0, 0]], hitBehind: [[0, 4, 0, 1, 2], [3, 4, 0, 1, 3], [4, 4, 0, 1, 4]],
    missFront: [[7, 0, 0, 0, 0], [1, 0, 0, 0, 0], [2, 0, 0, 0, 0]], hitFront: [[1, 4, 0, 1, 2], [3, 4, 0, 1, 3], [4, 4, 0, 1, 3], [5, 4, 0, 1, 4]] }, // 7
  { name: 'Attack while on knees by club hitting down', missBehind: [[7, 0, 0, 0, 0], [8, 0, 0, 0, 0], [10, 0, 0, 0, 0]], hitBehind: [[8, 4, 0, 1, 2], [9, 4, 0, 1, 2]],
    missFront: [[7, 0, 0, 0, 0], [8, 0, 0, 0, 0], [10, 0, 0, 0, 0]], hitFront: [[8, 4, 0, 1, 2], [9, 4, 0, 1, 2]] }, // 8
  { name: 'Attack while on knees by fist hitting head (stomach attacks)', missBehind: [[7, 0, 0, 0, 0], [8, 0, 0, 0, 0], [10, 0, 0, 0, 0]], hitBehind: [[8, 4, 0, 1, 1], [9, 4, 0, 1, 1]],
    missFront: [[7, 0, 0, 0, 0], [8, 0, 0, 0, 0], [10, 0, 0, 0, 0]], hitFront: [[8, 4, 0, 1, 1], [9, 4, 0, 1, 1]] }, // 9
  { name: 'Attack while on knees by club hitting head (stomach attacks)', missBehind: [[7, 0, 0, 0, 0], [8, 0, 0, 0, 0], [10, 0, 0, 0, 0]], hitBehind: [[8, 3, 0, 1, 2], [9, 3, 0, 1, 2]],
    missFront: [[7, 0, 0, 0, 0], [8, 0, 0, 0, 0], [10, 0, 0, 0, 0]], hitFront: [[8, 3, 0, 1, 2], [9, 3, 0, 1, 2]] }, // 10
  { name: 'Attack while on knees by knife hitting head (stomach attacks)', missBehind: [[7, 0, 0, 0, 0], [8, 0, 0, 0, 0], [10, 0, 0, 0, 0]], hitBehind: [[8, 4, 0, 1, 3], [9, 4, 0, 1, 5]],
    missFront: [[7, 0, 0, 0, 0], [8, 0, 0, 0, 0], [10, 0, 0, 0, 0]], hitFront: [[8, 4, 0, 1, 3], [9, 4, 0, 1, 5]] }, // 11
  { name: 'Attack while on knees by coup de grace to head (standard c.d.g.)', missBehind: [[7, 0, 0, 0, 0], [8, 0, 0, 0, 0], [10, 0, 0, 0, 0]], hitBehind: [[9, 8, 0, 1, 5]],
    missFront: [[7, 0, 0, 0, 0], [8, 0, 0, 0, 0], [10, 0, 0, 0, 0]], hitFront: [[9, 8, 0, 1, 5]] }, // 12
  { name: 'Attack while down with club', missBehind: [[7, 0, 0, 0, 0], [11, 0, 0, 0, 0], [12, 0, 0, 0, 0]], hitBehind: [[7, 4, 0, 1, 2], [6, 4, 0, 1, 2]],
    missFront: [[7, 0, 0, 0, 0], [11, 0, 0, 0, 0], [12, 0, 0, 0, 0]], hitFront: [[7, 4, 0, 1, 2], [6, 4, 0, 1, 2]] }, // 13
  { name: 'Attack while down by kicking', missBehind: [[7, 0, 0, 0, 0], [11, 0, 0, 0, 0], [12, 0, 0, 0, 0]], hitBehind: [[7, 4, 0, 1, 1], [6, 4, 0, 1, 1]],
    missFront: [[7, 0, 0, 0, 0], [11, 0, 0, 0, 0], [12, 0, 0, 0, 0]], hitFront: [[7, 4, 0, 1, 1], [6, 4, 0, 1, 1]] }, // 14
  { name: 'Attack while down with coup de grace', missBehind: [[7, 0, 0, 0, 0], [11, 0, 0, 0, 0], [12, 0, 0, 0, 0]], hitBehind: [[7, 8, 0, 1, 5], [6, 8, 0, 1, 5]],
    missFront: [[7, 0, 0, 0, 0], [11, 0, 0, 0, 0], [12, 0, 0, 0, 0]], hitFront: [[7, 8, 0, 1, 5], [6, 8, 0, 1, 5]] }, // 15
];
