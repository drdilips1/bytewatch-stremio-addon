// Home's big carousel: five books at a time from a bigger mix (up to 20), and after each full
// turn the next five come in — so it keeps showing different books (user, 28 Nov: "keep it to 5
// books and keep it rotating").

export const HERO_SIZE = 5;
export const HERO_POOL = 20;

/** The five books shown for this turn (`turn` counts full loops), wrapping round the mix. */
export function heroWindow(pool, turn, size = HERO_SIZE) {
  const list = pool || [];
  if (list.length <= size) return list;
  const start = (turn * size) % list.length;
  return Array.from({ length: size }, (_, k) => list[(start + k) % list.length]);
}
